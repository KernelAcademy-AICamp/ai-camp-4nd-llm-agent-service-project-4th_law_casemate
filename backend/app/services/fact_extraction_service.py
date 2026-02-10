"""
핵심 사실관계 추출 서비스
키워드 밀도 스캔 + GPT 추출 기반으로 판례의 핵심 사실관계를 추출합니다.
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass

from app.services.precedent_embedding_service import PrecedentEmbeddingService, get_openai_client
from tool.qdrant_client import QdrantService, get_qdrant_client
from app.prompts.fact_extraction_prompt import (
    FACT_EXTRACTION_SYSTEM_PROMPT,
    FACT_EXTRACTION_USER_PROMPT,
    FACT_DENSITY_KEYWORDS,
)

logger = logging.getLogger(__name__)


@dataclass
class ChunkScore:
    """청크 키워드 밀도 점수"""
    chunk_id: str
    section: str
    content: str
    keyword_count: int
    density_score: float


class FactExtractionService:
    """핵심 사실관계 추출 서비스"""

    # 키워드 밀도 임계값 (이 이상인 청크만 선택)
    MIN_DENSITY_SCORE = 0.02  # 2%

    # 최대 선택 청크 수
    MAX_CHUNKS = 3

    # GPT 모델
    GPT_MODEL = "gpt-4o-mini"

    def __init__(self):
        self.openai_client = get_openai_client()
        self.qdrant_client = get_qdrant_client()
        self.qdrant_service = QdrantService()
        self.embedding_service = PrecedentEmbeddingService(
            model=PrecedentEmbeddingService.MODEL_SMALL
        )

    # ==================== 키워드 밀도 스캔 ====================

    def _calculate_keyword_density(self, content: str) -> Tuple[int, float]:
        """
        청크의 키워드 밀도 계산

        Args:
            content: 청크 내용

        Returns:
            (키워드 수, 밀도 점수)
        """
        if not content:
            return 0, 0.0

        # 키워드 출현 횟수 계산
        keyword_count = 0
        for keyword in FACT_DENSITY_KEYWORDS:
            keyword_count += content.count(keyword)

        # 밀도 = 키워드 수 / 전체 문자 수
        density = keyword_count / len(content) if len(content) > 0 else 0

        return keyword_count, density

    def _select_fact_dense_chunks(
        self,
        chunks: List[Dict[str, Any]],
    ) -> List[ChunkScore]:
        """
        키워드 밀도 기반으로 사실관계가 밀집된 청크 선택

        Args:
            chunks: 판례의 모든 청크 목록

        Returns:
            밀도 점수가 높은 상위 청크들
        """
        scored_chunks = []

        for chunk in chunks:
            content = chunk.get("content", "")
            section = chunk.get("section", "")
            chunk_id = chunk.get("id", "")

            keyword_count, density = self._calculate_keyword_density(content)

            # 밀도 임계값 이상인 것만 선택
            if density >= self.MIN_DENSITY_SCORE:
                scored_chunks.append(ChunkScore(
                    chunk_id=chunk_id,
                    section=section,
                    content=content,
                    keyword_count=keyword_count,
                    density_score=density,
                ))

        # 밀도 점수로 정렬
        scored_chunks.sort(key=lambda x: x.density_score, reverse=True)

        # 상위 N개 선택
        selected = scored_chunks[:self.MAX_CHUNKS]

        if selected:
            logger.info(
                f"키워드 밀도 스캔: {len(chunks)}개 청크 → {len(selected)}개 선택 "
                f"(최고 밀도: {selected[0].density_score:.3f})"
            )
        else:
            logger.warning(f"키워드 밀도 스캔: 임계값 이상인 청크 없음")

        return selected

    # ==================== 청크 조회 ====================

    def get_case_chunks(self, case_number: str) -> List[Dict[str, Any]]:
        """
        Qdrant에서 특정 판례의 모든 청크 조회

        Args:
            case_number: 사건번호

        Returns:
            청크 목록 (id, section, content 포함)
        """
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        chunks = []
        offset = None

        while True:
            results, offset = self.qdrant_client.scroll(
                collection_name=QdrantService.CASES_COLLECTION,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key="case_number",
                            match=MatchValue(value=case_number)
                        )
                    ]
                ),
                limit=100,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )

            for point in results:
                chunks.append({
                    "id": str(point.id),
                    "section": point.payload.get("section", ""),
                    "content": point.payload.get("content", ""),
                })

            if offset is None:
                break

        return chunks

    # ==================== GPT 사실관계 추출 ====================

    def _extract_facts_with_gpt(self, combined_content: str) -> Optional[str]:
        """
        GPT를 사용하여 사실관계 추출

        Args:
            combined_content: 선택된 청크들의 결합 내용

        Returns:
            추출된 사실관계 텍스트 (2~3문장)
        """
        try:
            # 최대 토큰 제한을 위해 내용 자르기
            truncated = combined_content[:4000]

            response = self.openai_client.chat.completions.create(
                model=self.GPT_MODEL,
                messages=[
                    {"role": "system", "content": FACT_EXTRACTION_SYSTEM_PROMPT},
                    {"role": "user", "content": FACT_EXTRACTION_USER_PROMPT.format(
                        chunk_content=truncated
                    )},
                ],
                temperature=0.3,
                max_tokens=300,
            )

            fact_text = response.choices[0].message.content.strip()
            logger.info(f"사실관계 추출 완료: {fact_text[:100]}...")
            return fact_text

        except Exception as e:
            logger.error(f"GPT 사실관계 추출 실패: {e}")
            return None

    # ==================== 메인 처리 ====================

    def extract_and_save_facts(
        self,
        case_number: str,
        case_name: str = "",
        court_name: str = "",
        judgment_date: str = "",
    ) -> Optional[str]:
        """
        판례의 핵심 사실관계 추출 및 저장

        1. 판례의 모든 청크 조회
        2. 키워드 밀도 스캔으로 상위 청크 선택
        3. GPT로 사실관계 추출
        4. 임베딩 생성 후 저장

        Args:
            case_number: 사건번호
            case_name: 사건명
            court_name: 법원명
            judgment_date: 선고일자

        Returns:
            추출된 사실관계 텍스트 또는 None
        """
        logger.info(f"[{case_number}] 사실관계 추출 시작")

        # 1. 청크 조회
        chunks = self.get_case_chunks(case_number)
        if not chunks:
            logger.warning(f"[{case_number}] 청크 없음")
            return None

        # 2. 키워드 밀도 스캔
        selected_chunks = self._select_fact_dense_chunks(chunks)

        # 밀도 높은 청크가 없으면 전체 청크 중 상위 3개 사용 (fallback)
        if not selected_chunks:
            logger.info(f"[{case_number}] Fallback: 전체 청크 상위 {self.MAX_CHUNKS}개 사용")
            # 섹션 우선순위: 사실관계 > 이유 > 기타
            priority_sections = ["사실관계", "범죄사실", "인정사실", "이유", "판결이유"]

            def section_priority(chunk):
                section = chunk.get("section", "")
                for i, ps in enumerate(priority_sections):
                    if ps in section:
                        return i
                return len(priority_sections)

            chunks.sort(key=section_priority)

            for chunk in chunks[:self.MAX_CHUNKS]:
                keyword_count, density = self._calculate_keyword_density(chunk["content"])
                selected_chunks.append(ChunkScore(
                    chunk_id=chunk["id"],
                    section=chunk["section"],
                    content=chunk["content"],
                    keyword_count=keyword_count,
                    density_score=density,
                ))

        # 3. 선택된 청크 결합
        combined_content = "\n\n".join([c.content for c in selected_chunks])
        source_sections = list(set([c.section for c in selected_chunks]))

        # 4. GPT 사실관계 추출
        fact_text = self._extract_facts_with_gpt(combined_content)
        if not fact_text:
            return None

        # 5. 임베딩 생성
        try:
            dense_vector, sparse_vector_obj = self.embedding_service.create_both_parallel(fact_text)
            # SparseVector 객체를 dict로 변환
            sparse_vector = {
                "indices": sparse_vector_obj.indices,
                "values": sparse_vector_obj.values,
            }
        except Exception as e:
            logger.error(f"[{case_number}] 임베딩 생성 실패: {e}")
            return None

        # 6. 저장
        success = self.qdrant_service.save_fact(
            case_number=case_number,
            fact_text=fact_text,
            dense_vector=dense_vector,
            sparse_vector=sparse_vector,
            case_name=case_name,
            court_name=court_name,
            judgment_date=judgment_date,
            source_sections=source_sections,
        )

        if success:
            logger.info(f"[{case_number}] 사실관계 저장 완료")
            return fact_text
        else:
            logger.error(f"[{case_number}] 사실관계 저장 실패")
            return None
