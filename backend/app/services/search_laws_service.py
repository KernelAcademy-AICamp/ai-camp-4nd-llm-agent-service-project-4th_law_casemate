"""
법령 검색 서비스
Qdrant laws 컬렉션을 활용한 관련 법령 검색
하이브리드 검색 지원 (Dense + Sparse + RRF)

v2.0 업데이트:
- Parent/Child 구조 기반 중복 제거
- 동일 조문에서 최대 2개 Child만 반환
- limit 기본값 8로 조정 (정확도/다양성 균형)

v3.0 업데이트:
- 2단계 파이프라인: 법적 쟁점 추출 → 법령 검색
- 일상 언어 → 법률 용어 변환으로 검색 정확도 향상
"""

import json
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from qdrant_client.http import models

from tool.qdrant_client import get_qdrant_client
from app.services.precedent_embedding_service import (
    create_dense_embedding_cached,
    get_sparse_model,
    get_openai_client,
)

logger = logging.getLogger(__name__)


@dataclass
class LawSearchResult:
    """법령 검색 결과 데이터 클래스"""
    law_name: str
    article_number: str
    article_title: str
    content: str
    score: float
    point_type: str = ""      # "parent" or "child"
    law_role: str = ""        # "substance" or "procedure"
    parent_id: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "law_name": self.law_name,
            "article_number": self.article_number,
            "article_title": self.article_title,
            "content": self.content,
            "score": self.score,
            "point_type": self.point_type,
            "law_role": self.law_role,
        }


class SearchLawsService:
    """법령 벡터 검색 서비스 (하이브리드 검색 지원)"""

    LAWS_COLLECTION = "laws"
    LAWS_HYBRID_COLLECTION = "laws_hybrid"

    def __init__(self):
        self.qdrant_client = get_qdrant_client()
        self.sparse_model = get_sparse_model()
        self.openai_client = get_openai_client()

        # 하이브리드 컬렉션 존재 여부 확인
        self._use_hybrid = self._check_hybrid_collection()
        if self._use_hybrid:
            logger.info("법령 검색: 하이브리드 모드 (laws_hybrid)")
        else:
            logger.info("법령 검색: Dense-only 모드 (laws)")

    # ==================== 법적 쟁점 추출 (2단계 파이프라인 1단계) ====================

    def extract_legal_issues(
        self,
        description: str,
        summary: Optional[str] = None,
        facts: Optional[str] = None,
        case_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        사건 내용에서 법적 쟁점과 관련 법조문을 추출

        Args:
            description: 상담 기록 원문
            summary: AI 생성 사건 요약 (선택)
            facts: AI 생성 사실관계 (선택)
            case_type: 사건 유형 (민사/형사/가사 등)

        Returns:
            {
                "keywords": ["모욕죄", "명예훼손", ...],
                "laws": ["형법 제311조", "형법 제307조", ...],
                "search_query": "모욕죄 명예훼손 형법 제311조 ..."
            }
        """
        # 입력 텍스트 구성
        input_parts = []
        if description:
            input_parts.append(f"[상담 기록 원문]\n{description}")
        if summary:
            input_parts.append(f"[사건 요약]\n{summary}")
        if facts:
            input_parts.append(f"[사실관계]\n{facts}")

        input_text = "\n\n".join(input_parts)

        if not input_text.strip():
            return {"crime_names": [], "keywords": [], "laws": [], "search_query": ""}

        system_prompt = """너는 법률 전문가다. 사건 내용을 분석하여 적용 가능한 죄명, 법적 쟁점, 관련 법조문을 추출하라.

[출력 규칙]
1. crime_names: 적용 가능한 정확한 죄명 (1~5개)
   - 반드시 "~죄" 형태로 출력 (예: "명예훼손죄", "모욕죄", "사기죄")
   - 형법/특별법상 공식 죄명만 사용
2. keywords: 법적 쟁점/개념/청구원인 (3~7개)
   - 죄명을 제외한 법적 쟁점만 포함 (예: "인격권 침해", "불법행위", "위자료")
3. laws: 관련될 수 있는 구체적 법조문 (3~7개)
   - 형식: "법령명 제N조" (예: "형법 제307조", "민법 제750조")
4. 확실하지 않은 것은 제외하고, 명확히 관련된 것만 포함

[주요 법령 참고]
- 형사: 형법, 정보통신망법, 성폭력처벌법, 특정범죄가중처벌법
- 민사: 민법, 상법, 근로기준법, 주택임대차보호법
- 가사: 민법(가족법), 가사소송법

JSON 형식으로만 출력하라:
{"crime_names": ["명예훼손죄", "..."], "keywords": ["...", "..."], "laws": ["...", "..."]}"""

        user_prompt = input_text
        if case_type:
            user_prompt = f"[사건 유형: {case_type}]\n\n{input_text}"

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.1,
                max_tokens=500,
            )

            result_text = response.choices[0].message.content.strip()

            # JSON 파싱 (마크다운 코드블록 제거)
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
            result_text = result_text.strip()

            result = json.loads(result_text)
            crime_names = result.get("crime_names", [])
            keywords = result.get("keywords", [])
            laws = result.get("laws", [])

            # 검색 쿼리 생성 (키워드 + 법조문 결합, crime_names는 검색 쿼리에 불포함)
            search_query = " ".join(keywords + laws)

            logger.info(f"법적 쟁점 추출 완료: crime_names={crime_names}, keywords={keywords}, laws={laws}")

            return {
                "crime_names": crime_names,
                "keywords": keywords,
                "laws": laws,
                "search_query": search_query,
            }

        except json.JSONDecodeError as e:
            logger.error(f"법적 쟁점 추출 JSON 파싱 실패: {e}")
            return {"crime_names": [], "keywords": [], "laws": [], "search_query": ""}
        except Exception as e:
            logger.error(f"법적 쟁점 추출 실패: {e}")
            return {"crime_names": [], "keywords": [], "laws": [], "search_query": ""}

    def search_laws_with_extraction(
        self,
        description: str,
        summary: Optional[str] = None,
        facts: Optional[str] = None,
        case_type: Optional[str] = None,
        limit: int = 8,
    ) -> Dict[str, Any]:
        """
        2단계 파이프라인: 법적 쟁점 추출 → 법령 검색

        Args:
            description: 상담 기록 원문
            summary: AI 생성 사건 요약
            facts: AI 생성 사실관계
            case_type: 사건 유형
            limit: 반환할 최대 결과 수

        Returns:
            {
                "total": N,
                "results": [...],
                "extracted": {"keywords": [...], "laws": [...], "search_query": "..."}
            }
        """
        # 1단계: 법적 쟁점 추출
        extracted = self.extract_legal_issues(
            description=description,
            summary=summary,
            facts=facts,
            case_type=case_type,
        )

        search_query = extracted.get("search_query", "")

        # 추출 실패 시 폴백: 요약 + 사실관계 사용
        if not search_query:
            logger.warning("법적 쟁점 추출 실패, 폴백 쿼리 사용")
            fallback_parts = []
            if summary:
                fallback_parts.append(summary)
            if facts:
                fallback_parts.append(facts)
            search_query = " ".join(fallback_parts)

        if not search_query:
            return {"total": 0, "results": [], "extracted": extracted}

        # 2단계: 법령 검색
        search_results = self.search_laws(query=search_query, limit=limit)

        # 추출 결과 포함하여 반환
        search_results["extracted"] = extracted

        return search_results

    def search_laws_with_cached_extraction(
        self,
        keywords: List[str],
        laws: List[str],
        limit: int = 8,
    ) -> Dict[str, Any]:
        """
        캐시된 법적 쟁점으로 법령 검색 (AI 추출 단계 생략)

        Args:
            keywords: 캐시된 법적 쟁점 키워드
            laws: 캐시된 관련 법조문
            limit: 반환할 최대 결과 수

        Returns:
            검색 결과 딕셔너리
        """
        # 검색 쿼리 생성
        search_query = " ".join(keywords + laws)

        if not search_query:
            return {"total": 0, "results": []}

        # 법령 검색
        return self.search_laws(query=search_query, limit=limit)

    def _check_hybrid_collection(self) -> bool:
        """하이브리드 컬렉션이 존재하고 사용 가능한지 확인"""
        try:
            collections = self.qdrant_client.get_collections()
            for col in collections.collections:
                if col.name == self.LAWS_HYBRID_COLLECTION:
                    return True
            return False
        except Exception:
            return False

    def _create_dense_embedding(self, text: str) -> List[float]:
        """Dense 임베딩 생성 (기존 캐싱 함수 재활용)"""
        return list(create_dense_embedding_cached(text))

    def _create_sparse_embedding(self, text: str) -> models.SparseVector:
        """Sparse 임베딩 생성 (BM25)"""
        sparse_emb = list(self.sparse_model.embed([text]))[0]
        return models.SparseVector(
            indices=sparse_emb.indices.tolist(),
            values=sparse_emb.values.tolist(),
        )

    def _create_embeddings_parallel(self, text: str):
        """Dense와 Sparse 임베딩을 병렬로 생성"""
        with ThreadPoolExecutor(max_workers=2) as executor:
            dense_future = executor.submit(self._create_dense_embedding, text)
            sparse_future = executor.submit(self._create_sparse_embedding, text)

            dense_vector = dense_future.result()
            sparse_vector = sparse_future.result()

        return dense_vector, sparse_vector

    def search_laws(
        self,
        query: str,
        limit: int = 8,
        score_threshold: float = 0.2,
        deduplicate: bool = True,
        max_per_article: int = 2,
        law_role_filter: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        사건 내용 기반 관련 법령 검색

        Args:
            query: 검색 쿼리 (사건 요약 + 사실관계)
            limit: 반환할 최대 결과 수 (기본 8)
            score_threshold: 최소 유사도 점수 (Dense-only 모드에서만 적용)
            deduplicate: 동일 조문 중복 제거 여부 (기본 True)
            max_per_article: 동일 조문당 최대 결과 수 (기본 2)
            law_role_filter: 법령 역할 필터 ("substance" or "procedure")

        Returns:
            검색 결과 딕셔너리
        """
        if self._use_hybrid:
            return self._search_hybrid(
                query, limit, deduplicate, max_per_article, law_role_filter
            )
        else:
            return self._search_dense_only(query, limit, score_threshold)

    def _search_hybrid(
        self,
        query: str,
        limit: int,
        deduplicate: bool = True,
        max_per_article: int = 2,
        law_role_filter: Optional[str] = None,
    ) -> Dict[str, Any]:
        """하이브리드 검색 (Dense + Sparse + RRF 융합)"""
        # 병렬로 임베딩 생성
        dense_vector, sparse_vector = self._create_embeddings_parallel(query)

        # 필터 구성
        query_filter = None
        if law_role_filter:
            query_filter = models.Filter(
                must=[
                    models.FieldCondition(
                        key="law_role",
                        match=models.MatchValue(value=law_role_filter)
                    )
                ]
            )

        # 중복 제거를 위해 더 많은 후보 검색
        fetch_limit = limit * 3 if deduplicate else limit

        # 하이브리드 검색 (RRF 융합)
        results = self.qdrant_client.query_points(
            collection_name=self.LAWS_HYBRID_COLLECTION,
            prefetch=[
                models.Prefetch(
                    query=dense_vector,
                    using="dense",
                    limit=fetch_limit,
                ),
                models.Prefetch(
                    query=sparse_vector,
                    using="sparse",
                    limit=fetch_limit,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            query_filter=query_filter,
            limit=fetch_limit,
        )

        # 결과 처리
        search_results = self._process_results_to_list(results)

        # 중복 제거 적용
        if deduplicate:
            search_results = self._deduplicate_by_article(
                search_results, max_per_article, limit
            )
        else:
            search_results = search_results[:limit]

        return {
            "total": len(search_results),
            "results": [r.to_dict() for r in search_results],
        }

    def _search_dense_only(
        self,
        query: str,
        limit: int,
        score_threshold: float,
    ) -> Dict[str, Any]:
        """Dense-only 검색 (기존 방식)"""
        query_vector = self._create_dense_embedding(query)

        results = self.qdrant_client.query_points(
            collection_name=self.LAWS_COLLECTION,
            query=query_vector,
            limit=limit,
            score_threshold=score_threshold,
        )

        return self._process_results(results)

    def _process_results_to_list(self, results) -> List[LawSearchResult]:
        """검색 결과를 LawSearchResult 리스트로 변환"""
        search_results = []
        for result in results.points:
            payload = result.payload
            search_results.append(LawSearchResult(
                law_name=payload.get("law_name", ""),
                article_number=payload.get("article_number", ""),
                article_title=payload.get("article_title", ""),
                content=payload.get("content", ""),
                score=result.score,
                point_type=payload.get("point_type", ""),
                law_role=payload.get("law_role", ""),
                parent_id=payload.get("parent_id"),
            ))
        return search_results

    def _deduplicate_by_article(
        self,
        results: List[LawSearchResult],
        max_per_article: int,
        limit: int,
    ) -> List[LawSearchResult]:
        """
        동일 조문(법령+조문번호)에서 과도한 Child 중복 방지

        전략:
        - 같은 조문에서 최대 max_per_article개만 유지
        - Child 우선, 점수 높은 순
        - Parent는 해당 조문에 Child가 없을 때만 포함
        """
        # 조문별 그룹화
        article_groups = defaultdict(list)
        for r in results:
            key = (r.law_name, r.article_number)
            article_groups[key].append(r)

        # 각 조문에서 상위 N개 선택
        deduplicated = []
        for key, items in article_groups.items():
            # Child 우선 정렬 (Child가 앞으로, 같은 타입 내에서는 점수순)
            items.sort(key=lambda x: (x.point_type != "child", -x.score))

            # 상위 N개 선택
            selected = items[:max_per_article]
            deduplicated.extend(selected)

        # 최종 점수순 정렬 후 limit 적용
        deduplicated.sort(key=lambda x: x.score, reverse=True)
        return deduplicated[:limit]

    def _process_results(self, results) -> Dict[str, Any]:
        """검색 결과 처리 (하위 호환성 유지)"""
        search_results = self._process_results_to_list(results)
        return {
            "total": len(search_results),
            "results": [r.to_dict() for r in search_results],
        }

    def get_article(self, law_name: str, article_number: str) -> Optional[Dict[str, Any]]:
        """
        특정 조문 조회 (법령명 + 조문번호)

        Args:
            law_name: 법령명 (예: "형법", "정보통신망 이용촉진 및 정보보호 등에 관한 법률")
            article_number: 조문번호 (예: "307", "70의2")

        Returns:
            조문 정보 딕셔너리 또는 None
        """
        import re

        # 컬렉션 선택 (하이브리드 우선)
        collection = self.LAWS_HYBRID_COLLECTION if self._use_hybrid else self.LAWS_COLLECTION

        # 조문번호 정규화: "제70조의2" → "70의2", "307" → "307"
        article_num_match = re.match(r"제?(\d+)(?:조)?(?:의(\d+))?", article_number)
        if article_num_match:
            base_num = article_num_match.group(1)
            sub_num = article_num_match.group(2)
            article_num_clean = f"{base_num}의{sub_num}" if sub_num else base_num
        else:
            article_num_clean = re.sub(r"[^0-9]", "", article_number)
            if not article_num_clean:
                article_num_clean = article_number

        logger.info(f"조문 조회: law_name={law_name}, article_number={article_number} → {article_num_clean}")

        # 1차 시도: 정확한 법령명 매칭
        results = self.qdrant_client.scroll(
            collection_name=collection,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="law_name",
                        match=models.MatchValue(value=law_name)
                    ),
                    models.FieldCondition(
                        key="article_number",
                        match=models.MatchValue(value=article_num_clean)
                    ),
                ]
            ),
            limit=20,
            with_payload=True,
        )

        # 2차 시도: 법령명 부분 매칭 (긴 법령명의 경우)
        if not results[0] and len(law_name) > 10:
            # 법령명에서 핵심 키워드 추출 (예: "정보통신망" 또는 앞 10자)
            law_keyword = law_name[:10]
            logger.info(f"정확한 매칭 실패, 부분 매칭 시도: {law_keyword}")

            results = self.qdrant_client.scroll(
                collection_name=collection,
                scroll_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="law_name",
                            match=models.MatchText(text=law_keyword)
                        ),
                        models.FieldCondition(
                            key="article_number",
                            match=models.MatchValue(value=article_num_clean)
                        ),
                    ]
                ),
                limit=20,
                with_payload=True,
            )

        if not results[0]:
            logger.info(f"DB에서 조문 없음: {law_name} 제{article_num_clean}조")
            return None

        # Parent와 Child 분리
        parent = None
        children = []

        for point in results[0]:
            payload = point.payload
            point_type = payload.get("point_type", "")

            if point_type == "parent":
                parent = payload
            else:
                children.append(payload)

        if not parent:
            # Parent가 없으면 첫 번째 결과 사용
            parent = results[0][0].payload

        # 항별 파싱 (①②③ 등의 기호로 분리)
        content = parent.get("content", "")
        paragraphs = self._parse_paragraphs(content)

        logger.info(f"DB에서 조문 찾음: {parent.get('law_name')} 제{parent.get('article_number')}조")

        return {
            "law_name": parent.get("law_name", ""),
            "article_number": parent.get("article_number", ""),
            "article_title": parent.get("article_title", ""),
            "content": content,
            "paragraphs": paragraphs,
        }

    async def get_article_with_fallback(
        self,
        law_name: str,
        article_number: str,
    ) -> Optional[Dict[str, Any]]:
        """
        조문 조회 (DB 우선 → API Fallback → 캐싱)

        Args:
            law_name: 법령명 (예: "형법")
            article_number: 조문번호 (예: "307")

        Returns:
            조문 정보 딕셔너리 또는 None
        """
        # 1. DB에서 먼저 조회
        result = self.get_article(law_name, article_number)
        if result:
            logger.info(f"조문 조회 (DB): {law_name} 제{article_number}조")
            return result

        # 2. DB에 없으면 API에서 가져오기
        logger.info(f"조문 조회 (API Fallback): {law_name} 제{article_number}조")

        from tool.law_api_client import LawAPIClient

        try:
            async with LawAPIClient() as client:
                api_result = await client.get_article(law_name, article_number)

                if not api_result:
                    logger.warning(f"API에서도 조문 없음: {law_name} 제{article_number}조")
                    return None

                # 3. 항별 파싱
                content = api_result.get("content", "")
                paragraphs = self._parse_paragraphs(content)

                result = {
                    "law_name": api_result.get("law_name", law_name),
                    "article_number": api_result.get("article_number", article_number),
                    "article_title": api_result.get("article_title", ""),
                    "content": content,
                    "paragraphs": paragraphs,
                }

                # 4. DB에 캐싱 (비동기로 저장)
                self._save_article_to_qdrant(result)

                return result

        except Exception as e:
            logger.error(f"API 조문 조회 실패: {e}")
            return None

    def _save_article_to_qdrant(self, article: Dict[str, Any]) -> None:
        """
        API에서 가져온 조문을 Qdrant에 저장 (캐싱)

        기존 수집 로직과 동일한 구조로 저장 (Parent/Child)
        """
        import hashlib
        from datetime import datetime

        try:
            law_name = article.get("law_name", "")
            article_number = article.get("article_number", "")
            article_title = article.get("article_title", "")
            content = article.get("content", "")

            if not law_name or not article_number or not content:
                return

            # Dense 임베딩 생성
            dense_vector = self._create_dense_embedding(content[:2000])  # 최대 2000자

            # Sparse 임베딩 생성
            sparse_emb = list(self.sparse_model.embed([content[:2000]]))[0]
            sparse_vector = {
                "indices": sparse_emb.indices.tolist(),
                "values": sparse_emb.values.tolist(),
            }

            # Point ID 생성 (Parent)
            id_string = f"law_{law_name}_{article_number}_parent"
            hash_hex = hashlib.md5(id_string.encode()).hexdigest()[:16]
            point_id = int(hash_hex, 16)

            # Qdrant에 저장
            from qdrant_client.http import models as qdrant_models

            point = qdrant_models.PointStruct(
                id=point_id,
                vector={
                    "dense": dense_vector,
                    "sparse": qdrant_models.SparseVector(
                        indices=sparse_vector["indices"],
                        values=sparse_vector["values"],
                    ),
                },
                payload={
                    "law_name": law_name,
                    "article_number": article_number,
                    "article_title": article_title,
                    "content": content,
                    "point_type": "parent",
                    "collected_date": datetime.now().strftime("%Y-%m-%d"),
                    "source": "api_fallback",
                },
            )

            self.qdrant_client.upsert(
                collection_name=self.LAWS_HYBRID_COLLECTION,
                points=[point],
            )

            logger.info(f"조문 캐싱 완료: {law_name} 제{article_number}조")

        except Exception as e:
            logger.error(f"조문 캐싱 실패: {e}")

    def _parse_paragraphs(self, content: str) -> List[Dict[str, Any]]:
        """
        조문 내용에서 항별로 분리

        Args:
            content: 조문 전체 내용

        Returns:
            [{"number": "1", "content": "①..."}, {"number": "2", "content": "②..."}, ...]
        """
        import re

        # 원문자 기호: ①②③④⑤⑥⑦⑧⑨⑩ 등
        paragraph_markers = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

        paragraphs = []

        # 항 기호로 분리
        pattern = r"([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])"
        parts = re.split(pattern, content)

        # 첫 부분이 조문 제목일 수 있음 (예: "제307조(명예훼손)")
        current_number = 0

        i = 0
        while i < len(parts):
            part = parts[i].strip()

            if part in paragraph_markers:
                # 항 번호 찾음
                current_number = paragraph_markers.index(part) + 1
                # 다음 부분이 내용
                if i + 1 < len(parts):
                    para_content = part + parts[i + 1].strip()
                    paragraphs.append({
                        "number": str(current_number),
                        "content": para_content,
                    })
                    i += 2
                else:
                    i += 1
            else:
                # 항 기호가 없는 부분 (조문 제목 등)
                i += 1

        return paragraphs
