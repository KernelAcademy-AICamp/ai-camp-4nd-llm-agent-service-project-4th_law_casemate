"""
유사 판례 검색 서비스
- precedents 컬렉션에서 청크 단위 검색
- Dense 벡터 검색 + 키워드 필터 + 리랭킹
- 청크 → 판례 그룹핑
"""

import time
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from qdrant_client.models import Filter, FieldCondition, MatchText

from app.services.precedent_embedding_service import PrecedentEmbeddingService, get_openai_client
from tool.qdrant_client import get_qdrant_client
import json
import re
from app.prompts.query_transform_prompt import (
    QUERY_TRANSFORM_V5_SYSTEM,
    QUERY_TRANSFORM_V5_USER,
)

logger = logging.getLogger(__name__)

# 리랭커 모델 (Lazy Loading)
_reranker_model = None


def get_reranker_model():
    """리랭커 모델 싱글톤 로드"""
    global _reranker_model
    if _reranker_model is None:
        from sentence_transformers import CrossEncoder
        logger.info("리랭커 모델 로딩 중... (BAAI/bge-reranker-v2-m3)")
        _reranker_model = CrossEncoder("BAAI/bge-reranker-v2-m3", max_length=4096)
        logger.info("리랭커 모델 로드 완료")
    return _reranker_model


@dataclass
class SimilarCaseResult:
    """유사 판례 검색 결과"""
    case_number: str
    case_name: str
    court_name: str
    judgment_date: str
    score: float
    matched_chunk: str = ""  # 매칭된 청크 내용 (선택)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_number": self.case_number,
            "case_name": self.case_name,
            "court_name": self.court_name,
            "judgment_date": self.judgment_date,
            "score": self.score,
        }


class PrecedentSimilarService:
    """
    유사 판례 검색 서비스

    - precedents 컬렉션의 청크 임베딩에서 직접 검색
    - Dense 벡터 검색 + 키워드 필터
    - 청크 → 판례 그룹핑
    - 리랭킹으로 최종 순위 결정
    """

    # 검색 대상 컬렉션
    COLLECTION_PRECEDENTS = "precedents"

    # 검색/리랭킹 설정
    SEARCH_LIMIT = 50  # 각 검색(Dense/Sparse)에서 가져올 수
    RERANK_CANDIDATES = 30  # 리랭킹할 판례 후보 수

    def __init__(self, use_reranking: bool = True):
        self.embedding_service = PrecedentEmbeddingService(
            model=PrecedentEmbeddingService.MODEL_SMALL
        )
        self.qdrant_client = get_qdrant_client()
        self.openai_client = get_openai_client()
        self.use_reranking = use_reranking

    # ==================== 쿼리 정제 ====================

    def _transform_and_extract(self, user_query: str) -> Dict[str, Any]:
        """
        GPT를 사용해 쿼리 정제 + 키워드 추출을 한 번에 처리 (V5 프롬프트)

        Returns:
            {"query": 정제된 쿼리, "keywords": [키워드 리스트]}
        """
        try:
            logger.info("=" * 60)
            logger.info("[유사 판례 검색] 쿼리 정제 + 키워드 추출 (V5)")
            logger.info(f"[원본 쿼리]\n{user_query[:500]}...")

            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": QUERY_TRANSFORM_V5_SYSTEM},
                    {"role": "user", "content": QUERY_TRANSFORM_V5_USER.format(user_query=user_query)}
                ],
                temperature=0,
                max_tokens=600,
            )

            result_text = response.choices[0].message.content.strip()

            # V5 텍스트 형식 파싱 (query: ..., keywords: [...])
            query = ""
            keywords = []
            for line in result_text.split('\n'):
                line = line.strip()
                if line.lower().startswith('query:'):
                    query = line[6:].strip()
                elif line.lower().startswith('keywords:'):
                    kw_str = line[9:].strip()
                    # [keyword1, keyword2] 형식 파싱
                    if kw_str.startswith('[') and kw_str.endswith(']'):
                        keywords = [k.strip() for k in kw_str[1:-1].split(',')]

            logger.info(f"[정제된 쿼리] {query[:200]}...")
            logger.info(f"[추출 키워드] {keywords}")
            logger.info("=" * 60)

            if not query:
                query = self._minimal_clean(user_query)

            return {
                "query": query,
                "keywords": keywords[:5]
            }

        except Exception as e:
            logger.error(f"쿼리 변환 실패: {e}, 최소 정제 적용")
            return {
                "query": self._minimal_clean(user_query),
                "keywords": []
            }

    def _minimal_clean(self, text: str) -> str:
        """
        폴백용 최소 정제: 이름 패턴 제거
        """
        # 한글 이름 패턴 (2~4글자 + 조사/호칭)
        cleaned = re.sub(r'[가-힣]{2,4}(씨|님|가|이|은|는|을|를|에게|한테|의)\s?', '', text)
        # 연속 공백 정리
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        return cleaned[:500]

    # 키워드별 검색 limit
    SEARCH_PER_KEYWORD = 15

    def _search_hybrid(self, query: str, keywords: List[str] = None) -> Dict[str, Dict[str, Any]]:
        """
        키워드별 개별 검색 + 통합 (다양성 확보)
        - 각 키워드별로 Dense 검색 수행
        - 결과 통합 (중복은 더 높은 점수로 유지)
        - 모든 키워드가 골고루 반영됨

        Returns:
            {chunk_id: {"dense_score": float, "payload": dict, "matched_keyword": str}}
        """
        # Dense 임베딩 생성
        dense_vector = self.embedding_service.create_dense(query)

        chunk_scores = {}

        if keywords:
            # 각 키워드별로 검색
            for keyword in keywords:
                search_filter = Filter(
                    must=[
                        FieldCondition(key="section", match=MatchText(text="전문")),
                        FieldCondition(key="content", match=MatchText(text=keyword)),
                    ]
                )

                results = self.qdrant_client.query_points(
                    collection_name=self.COLLECTION_PRECEDENTS,
                    query=dense_vector,
                    using="dense",
                    limit=self.SEARCH_PER_KEYWORD,
                    query_filter=search_filter,
                    with_payload=["case_number", "case_name", "court_name", "judgment_date", "section", "content"],
                )

                logger.info(f"[키워드 '{keyword}'] {len(results.points)}개 청크 검색됨")

                for point in results.points:
                    chunk_id = str(point.id)
                    # 중복 청크는 더 높은 점수로 유지
                    if chunk_id not in chunk_scores or point.score > chunk_scores[chunk_id]["dense_score"]:
                        chunk_scores[chunk_id] = {
                            "dense_score": point.score,
                            "payload": point.payload,
                        }
        else:
            # 키워드 없으면 전문 섹션만 필터
            search_filter = Filter(
                must=[FieldCondition(key="section", match=MatchText(text="전문"))]
            )

            results = self.qdrant_client.query_points(
                collection_name=self.COLLECTION_PRECEDENTS,
                query=dense_vector,
                using="dense",
                limit=self.SEARCH_LIMIT,
                query_filter=search_filter,
                with_payload=["case_number", "case_name", "court_name", "judgment_date", "section", "content"],
            )

            for point in results.points:
                chunk_id = str(point.id)
                chunk_scores[chunk_id] = {
                    "dense_score": point.score,
                    "payload": point.payload,
                }

        logger.info(f"[키워드별 검색 통합] 총 {len(chunk_scores)}개 청크")
        return chunk_scores

    # ==================== 청크 → 판례 그룹핑 ====================

    def _group_by_case(
        self,
        chunk_scores: Dict[str, Dict[str, Any]],
        exclude_case_number: Optional[str] = None,
        keywords: List[str] = None
    ) -> List[Dict[str, Any]]:
        """
        청크 검색 결과를 판례 단위로 그룹핑

        - Dense 점수 기반 정렬
        - 상위 청크들을 저장 (리랭킹에 여러 청크 사용)
        - 매칭된 키워드 추적
        """
        cases = {}

        for chunk_id, data in chunk_scores.items():
            case_number = data["payload"].get("case_number", "")
            if not case_number:
                continue

            # 현재 판례 제외
            if exclude_case_number and case_number == exclude_case_number:
                continue

            if case_number not in cases:
                cases[case_number] = {
                    "case_number": case_number,
                    "case_name": data["payload"].get("case_name", ""),
                    "court_name": data["payload"].get("court_name", ""),
                    "judgment_date": data["payload"].get("judgment_date", ""),
                    "max_dense": 0,
                    "best_chunk": "",
                    "top_chunks": [],
                    "chunk_count": 0,
                    "matched_keywords": set(),
                }

            dense_score = data["dense_score"]
            cases[case_number]["chunk_count"] += 1

            # 청크 정보 저장 (Dense 점수 기준 정렬용)
            content = data["payload"].get("content", "")
            if content:
                # 매칭된 키워드 찾기
                if keywords:
                    for kw in keywords:
                        if kw in content:
                            cases[case_number]["matched_keywords"].add(kw)

                cases[case_number]["top_chunks"].append({
                    "content": content[:500],
                    "dense_score": dense_score,
                })

            # 가장 높은 Dense 점수 기록
            if dense_score > cases[case_number]["max_dense"]:
                cases[case_number]["max_dense"] = dense_score

        # 각 판례의 top_chunks를 Dense 점수로 정렬하고 best_chunk 설정
        for case in cases.values():
            if case["top_chunks"]:
                case["top_chunks"].sort(key=lambda x: x["dense_score"], reverse=True)
                case["best_chunk"] = case["top_chunks"][0]["content"]

            case["matched_keywords"] = list(case["matched_keywords"])

        # max_dense 기준 정렬 (키워드 가중치는 리랭킹 후 적용)
        sorted_cases = sorted(cases.values(), key=lambda x: x["max_dense"], reverse=True)

        return sorted_cases

    # ==================== 리랭킹 ====================

    # 리랭킹에 사용할 청크 수
    RERANK_CHUNKS = 3

    def _rerank(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        top_k: int
    ) -> List[Dict[str, Any]]:
        """
        Cross-encoder를 사용한 리랭킹
        - 상위 N개 청크를 concat하여 더 풍부한 맥락으로 판단
        """
        if not candidates:
            return []

        reranker = get_reranker_model()

        # (쿼리, 상위 N개 청크 concat) 쌍 생성
        pairs = []
        for c in candidates:
            top_chunks = c.get("top_chunks", [])[:self.RERANK_CHUNKS]
            if top_chunks:
                # 상위 N개 청크 내용을 concat
                combined_text = " ".join([chunk["content"] for chunk in top_chunks])
                # 리랭커 max_length(1024) 고려하여 truncate
                combined_text = combined_text[:1500]
            else:
                combined_text = c.get("best_chunk", "")[:500]

            pairs.append((query[:500], combined_text))

        # Cross-encoder로 점수 계산
        scores = reranker.predict(pairs)

        # 키워드 가중치 적용하여 최종 점수 계산
        scored_candidates = []
        for candidate, rerank_score in zip(candidates, scores):
            keyword_count = len(candidate.get("matched_keywords", []))
            keyword_bonus = keyword_count * 0.1  # 키워드당 10% 보너스
            final_score = float(rerank_score) * (1 + keyword_bonus)
            scored_candidates.append((candidate, float(rerank_score), final_score))

        # final_score로 정렬
        scored_candidates.sort(key=lambda x: x[2], reverse=True)

        # 리랭크 점수 추가하여 반환
        reranked = []
        for candidate, rerank_score, final_score in scored_candidates[:top_k]:
            candidate["rerank_score"] = rerank_score
            candidate["final_score"] = final_score
            reranked.append(candidate)

        return reranked

    # ==================== 메인 검색 ====================

    def search_similar_cases(
        self,
        query: str,
        exclude_case_number: Optional[str] = None,
        limit: int = 5
    ) -> Dict[str, Any]:
        """
        유사 판례 검색 (쿼리 정제 + Dense 검색 + 키워드 필터 + 리랭킹)

        Args:
            query: 검색 쿼리
            exclude_case_number: 제외할 판례 사건번호
            limit: 반환할 유사 판례 수

        Returns:
            유사 판례 목록
        """
        if not query or len(query.strip()) < 10:
            return {"total": 0, "results": []}

        start_time = time.time()

        # 1. 쿼리 정제 + 키워드 추출 (GPT 1회 호출)
        t1 = time.time()
        transform_result = self._transform_and_extract(query)
        transformed_query = transform_result["query"]
        keywords = transform_result["keywords"]
        logger.info(f"[시간] 1. 쿼리 정제: {time.time() - t1:.2f}초")

        # 2. Dense 검색 + 키워드 필터
        t2 = time.time()
        chunk_scores = self._search_hybrid(transformed_query, keywords)
        logger.info(f"[시간] 2. 키워드별 검색: {time.time() - t2:.2f}초")
        logger.info(f"검색된 청크 수: {len(chunk_scores)}")

        # 3. 청크 → 판례 그룹핑 (키워드 매칭 추적)
        t3 = time.time()
        grouped_cases = self._group_by_case(chunk_scores, exclude_case_number, keywords)
        logger.info(f"[시간] 3. 그룹핑: {time.time() - t3:.2f}초")
        logger.info(f"그룹핑된 판례 수: {len(grouped_cases)}")

        # 4. 리랭킹 (정제된 쿼리 사용)
        if self.use_reranking and len(grouped_cases) > 0:
            top_candidates = grouped_cases[:self.RERANK_CANDIDATES]

            # 리랭킹 후보 30개 로그
            candidates_info = [
                {
                    "case": c["case_number"],
                    "dense": round(c["max_dense"], 4),
                    "keywords": c.get("matched_keywords", []),
                }
                for c in top_candidates
            ]
            logger.info(f"[리랭킹 후보 {len(top_candidates)}개] {candidates_info}")

            t4 = time.time()
            logger.info(f"[리랭킹 쿼리] {transformed_query[:100]}...")
            final_cases = self._rerank(transformed_query, top_candidates, limit)
            logger.info(f"[시간] 4. 리랭킹: {time.time() - t4:.2f}초")
            logger.info(f"리랭킹 적용: {len(top_candidates)}개 후보 → {limit}개 선정")
        else:
            final_cases = grouped_cases[:limit]

        logger.info(f"[시간] 전체: {time.time() - start_time:.2f}초")

        # 5. 결과 변환
        results = [
            SimilarCaseResult(
                case_number=case["case_number"],
                case_name=case["case_name"],
                court_name=case["court_name"],
                judgment_date=case["judgment_date"],
                score=round(case.get("rerank_score", case["max_dense"]), 4),
                matched_chunk=case.get("best_chunk", "")[:200],
            )
            for case in final_cases
        ]

        # 디버그 정보
        debug_info = {
            "transformed_query": transformed_query,
            "extracted_keywords": keywords,
            "use_reranking": self.use_reranking,
            "total_chunks_matched": len(chunk_scores),
            "total_cases_matched": len(grouped_cases),
            "top_scores": [
                {
                    "case": c["case_number"],
                    "rerank": round(c.get("rerank_score", 0), 4) if self.use_reranking else None,
                    "final": round(c.get("final_score", 0), 4) if self.use_reranking else None,
                    "dense": round(c["max_dense"], 4),
                    "chunks": c["chunk_count"],
                    "matched_keywords": c.get("matched_keywords", []),
                    "chunk_preview": c.get("best_chunk", "")[:100] + "...",
                }
                for c in final_cases
            ]
        }
        logger.info(f"디버깅 정보: {debug_info}")

        return {
            "total": len(results),
            "results": [r.to_dict() for r in results],
            "debug": debug_info,
        }
