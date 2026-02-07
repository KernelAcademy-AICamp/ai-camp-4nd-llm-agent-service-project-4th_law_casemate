"""
판례 검색 서비스
Qdrant 벡터 DB를 활용한 하이브리드 검색
"""

import re
import logging
from typing import List, Dict, Any, Tuple
from qdrant_client.http import models

from app.services.precedent_embedding_service import PrecedentEmbeddingService
from app.services.precedent_repository import PrecedentRepository, SearchResult

logger = logging.getLogger(__name__)


class PrecedentSearchService:
    """판례 하이브리드 검색 서비스"""

    CASES_COLLECTION = "precedents"

    # 사건번호 패턴 (컴파일된 정규식)
    CASE_NUMBER_PATTERN = re.compile(r'(\d{2,4}[가-힣]{1,2}\d+)')

    # 쿼리 유형별 가중치 프로필
    WEIGHT_PROFILES = {
        "keyword": {"dense": 0.3, "sparse": 0.7},
        "semantic": {"dense": 0.55, "sparse": 0.45},
    }

    # 최소 점수 하한선
    MIN_SCORE_THRESHOLD = 0.3

    # 법률 용어 (정확한 단어 매칭용)
    LEGAL_TERMS = {
        # 기존 용어
        "명예훼손", "모욕", "비방", "허위사실", "손해배상", "위자료",
        "불법행위", "인격권", "원고", "피고", "청구",
        # 추가 법률 용어
        "채무불이행", "계약해제", "계약위반", "해제", "해지", "취소",
        "사기", "횡령", "배임", "절도", "강도", "폭행", "상해",
        "과실", "고의", "위법", "항소", "상고", "기각", "인용",
        "가처분", "가압류", "압류", "경매", "담보", "저당", "질권",
        "임대차", "매매", "증여", "상속", "유언", "이혼", "양육권",
        "근로계약", "해고", "퇴직금", "임금", "산재",
    }

    # 법률 용어 패턴 (정규식 매칭용)
    LEGAL_PATTERNS = [
        r'.+법$',       # ~법 (형법, 민법 등)
        r'.+죄$',       # ~죄 (사기죄, 절도죄 등)
        r'.+권$',       # ~권 (재산권, 인격권 등)
        r'제\d+조',     # 제307조 등
    ]

    # 문장형 쿼리 판단 기준
    SENTENCE_MIN_LENGTH = 12  # 12자 이상이면 문장으로 간주
    SENTENCE_PARTICLES = {"이", "가", "을", "를", "은", "는", "에서", "으로", "했", "된", "한", "하는"}

    # 불용어
    STOPWORDS = {"의", "가", "이", "은", "는", "을", "를", "에", "에서", "로", "으로", "와", "과", "도", "만", "및", "또는"}

    # 섹션 가중치 (핵심 섹션에 보너스 점수 부여)
    SECTION_WEIGHTS = {
        "판시사항": 1.3,
        "판결요지": 1.3,
        "사건명": 1.2,
    }
    DEFAULT_SECTION_WEIGHT = 1.0

    def __init__(self):
        self.embedding_service = PrecedentEmbeddingService()
        self.repository = PrecedentRepository()

    # ==================== 점수 계산 ====================

    def _normalize_scores(self, points: List) -> Tuple[float, float]:
        """점수 정규화를 위한 min, range 계산"""
        if not points:
            return 0.0, 1.0
        scores = [p.score for p in points]
        s_min = min(scores)
        s_max = max(scores)
        s_range = s_max - s_min if s_max != s_min else 1.0
        return s_min, s_range

    def _get_section_weight(self, section: str) -> float:
        """섹션에 따른 가중치 반환"""
        if not section:
            return self.DEFAULT_SECTION_WEIGHT
        for key, weight in self.SECTION_WEIGHTS.items():
            if key in section:
                return weight
        return self.DEFAULT_SECTION_WEIGHT

    def _combine_weighted_scores(
        self,
        dense_points: List,
        sparse_points: List,
        dense_weight: float = 0.4,
        sparse_weight: float = 0.6,
    ) -> Dict[str, Dict[str, Any]]:
        """Dense와 Sparse 검색 결과를 가중치 기반으로 결합 (섹션 가중치 적용)"""
        combined = {}

        dense_min, dense_range = self._normalize_scores(dense_points)
        sparse_min, sparse_range = self._normalize_scores(sparse_points)

        for point in dense_points:
            point_id = str(point.id)
            normalized_score = (point.score - dense_min) / dense_range
            section = point.payload.get("section", "")
            section_weight = self._get_section_weight(section)
            combined[point_id] = {
                "score": normalized_score * dense_weight * section_weight,
                "payload": point.payload,
                "dense_score": normalized_score,
                "sparse_score": 0,
            }

        for point in sparse_points:
            point_id = str(point.id)
            normalized_score = (point.score - sparse_min) / sparse_range
            section = point.payload.get("section", "")
            section_weight = self._get_section_weight(section)
            weighted_score = normalized_score * sparse_weight * section_weight

            if point_id in combined:
                combined[point_id]["score"] += weighted_score
                combined[point_id]["sparse_score"] = normalized_score
            else:
                combined[point_id] = {
                    "score": weighted_score,
                    "payload": point.payload,
                    "dense_score": 0,
                    "sparse_score": normalized_score,
                }

        return combined

    # ==================== 쿼리 분석 ====================

    def _detect_query_type(self, query: str) -> str:
        """쿼리 유형 감지 (keyword / semantic)

        판단 로직:
        1. 문장형 쿼리 (15자 이상 + 조사 포함) → semantic
        2. 법률 용어 포함 → keyword
        3. 그 외 → semantic

        Note: 사건번호 패턴은 search_cases에서 먼저 처리되므로 여기서는 체크하지 않음
        """
        query = query.strip()

        # 1. 문장형 쿼리 판단: 길이 + 조사 포함 여부
        if len(query) >= self.SENTENCE_MIN_LENGTH:
            has_particle = any(p in query for p in self.SENTENCE_PARTICLES)
            if has_particle:
                return "semantic"

        # 2. 법률 용어 정확 매칭 (LEGAL_TERMS)
        for term in self.LEGAL_TERMS:
            if term in query:
                return "keyword"

        # 3. 법률 패턴 매칭 (~법, ~죄, ~권, 제N조)
        for pattern in self.LEGAL_PATTERNS:
            if re.search(pattern, query):
                return "keyword"

        return "semantic"

    def _get_weights(self, query_type: str) -> Tuple[float, float]:
        """쿼리 유형에 따른 가중치 반환"""
        profile = self.WEIGHT_PROFILES.get(query_type, self.WEIGHT_PROFILES["semantic"])
        return profile["dense"], profile["sparse"]

    def _extract_keywords(self, query: str) -> List[str]:
        """쿼리에서 검색 키워드 추출"""
        tokens = query.strip().split()
        return [t for t in tokens if t and t not in self.STOPWORDS]

    def _count_keyword_matches(self, content: str, keywords: List[str]) -> int:
        """콘텐츠에서 키워드 매칭 개수 계산"""
        if not content or not keywords:
            return 0
        content_lower = content.lower()
        return sum(1 for kw in keywords if kw.lower() in content_lower)

    # ==================== 사건번호/사건명 검색 ====================

    def _is_case_number(self, query: str) -> bool:
        """검색어가 사건번호 패턴인지 확인"""
        return bool(self.CASE_NUMBER_PATTERN.search(query))

    def _find_exact_case_name_matches(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """사건명이 정확히 일치하는 판례 찾기"""
        query_clean = query.strip()

        if len(query_clean) < 2:
            return []

        # case_name 필드에서 정확히 일치하는 것 검색
        results = self.repository.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="case_name",
                        match=models.MatchValue(value=query_clean)
                    )
                ]
            ),
            limit=limit * 10,
            with_payload=True,
            with_vectors=False,
        )

        if not results[0]:
            return []

        # 사건번호별 중복 제거
        case_data: Dict[str, Dict[str, Any]] = {}
        for point in results[0]:
            payload = point.payload
            case_num = payload.get("case_number", "")

            if case_num and case_num not in case_data:
                case_data[case_num] = {
                    "case_number": case_num,
                    "case_name": payload.get("case_name", ""),
                    "court_name": payload.get("court_name", ""),
                    "judgment_date": payload.get("judgment_date", ""),
                }

        logger.info(f"사건명 정확 매칭: '{query_clean}' → {len(case_data)}건")
        return list(case_data.values())[:limit]

    def _search_by_case_number(self, query: str, limit: int = 30) -> Dict[str, Any]:
        """사건번호로 정확 검색"""
        match = self.CASE_NUMBER_PATTERN.search(query)

        if not match:
            return {"query": query, "total": 0, "results": []}

        case_number_pattern = match.group(1)

        results = self.repository.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="case_number",
                        match=models.MatchText(text=case_number_pattern)
                    )
                ]
            ),
            limit=limit * 5,
            with_payload=True,
            with_vectors=False,
        )

        # 사건번호별 메타데이터 수집 (중복 제거)
        case_data: Dict[str, Dict[str, str]] = {}
        for point in results[0]:
            payload = point.payload
            case_num = payload.get("case_number", "")

            if case_num not in case_data:
                case_data[case_num] = {
                    "case_name": payload.get("case_name", ""),
                    "court_name": payload.get("court_name", ""),
                    "judgment_date": payload.get("judgment_date", ""),
                }

        # 전체 콘텐츠 일괄 조회
        case_numbers = list(case_data.keys())
        all_contents = self.repository.get_full_case_contents_batch(case_numbers)

        search_results = [
            SearchResult(
                case_number=case_num,
                case_name=metadata["case_name"],
                court_name=metadata["court_name"],
                judgment_date=metadata["judgment_date"],
                content=all_contents.get(case_num, ""),
                section="전문",
                score=1.0,
            )
            for case_num, metadata in case_data.items()
        ]

        return {
            "query": query,
            "total": len(search_results),
            "results": [r.to_dict() for r in search_results[:limit]]
        }

    # ==================== 하이브리드 검색 ====================

    def search_cases(
        self,
        query: str,
        limit: int = 30,
        merge_chunks: bool = True
    ) -> Dict[str, Any]:
        """
        판례 하이브리드 검색

        Args:
            query: 검색 쿼리
            limit: 반환할 최대 결과 수
            merge_chunks: 같은 판례의 청크 병합 여부

        Returns:
            검색 결과 딕셔너리
        """
        if self._is_case_number(query):
            return self._search_by_case_number(query, limit)

        # 1. 사건명 정확 매칭 먼저 확인
        exact_matches = self._find_exact_case_name_matches(query, limit=5)
        exact_case_numbers = {m["case_number"] for m in exact_matches}

        query_type = self._detect_query_type(query)
        dense_weight, sparse_weight = self._get_weights(query_type)
        logger.info(f"쿼리 유형: {query_type} (Dense: {dense_weight}, Sparse: {sparse_weight})")

        dense_vector, sparse_vector = self.embedding_service.create_both_parallel(query)

        search_limit = limit * 5 if merge_chunks else limit

        dense_results = self.repository.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            query=dense_vector,
            using="dense",
            limit=search_limit,
        )

        sparse_results = self.repository.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            query=sparse_vector,
            using="sparse",
            limit=search_limit,
        )

        combined_scores = self._combine_weighted_scores(
            dense_results.points,
            sparse_results.points,
            dense_weight=dense_weight,
            sparse_weight=sparse_weight,
        )

        # 점수 기준 정렬 및 최소 점수 필터링을 한 번에 처리
        sorted_results = sorted(
            ((pid, data) for pid, data in combined_scores.items() if data["score"] >= self.MIN_SCORE_THRESHOLD),
            key=lambda x: x[1]["score"],
            reverse=True
        )

        search_results = [
            SearchResult(
                case_number=data["payload"].get("case_number", ""),
                case_name=data["payload"].get("case_name", ""),
                court_name=data["payload"].get("court_name", ""),
                judgment_date=data["payload"].get("judgment_date", ""),
                content=data["payload"].get("content", ""),
                section=data["payload"].get("section", ""),
                score=data["score"],
            )
            for _, data in sorted_results[:search_limit]
        ]

        if merge_chunks:
            search_results = self._merge_case_chunks(search_results)

        # 키워드 매칭 재정렬 (키워드가 2개 이상인 경우)
        keywords = self._extract_keywords(query)
        if len(keywords) > 1:
            search_results.sort(
                key=lambda r: (self._count_keyword_matches(r.content, keywords), r.score),
                reverse=True
            )
            logger.info(f"키워드 매칭 재정렬 적용: {keywords}")

        # 2. 정확 매칭 결과를 맨 앞에 배치
        if exact_matches:
            # 정확 매칭된 사건번호는 벡터 검색 결과에서 제외
            search_results = [r for r in search_results if r.case_number not in exact_case_numbers]

            # 정확 매칭 결과의 전체 콘텐츠 조회
            exact_contents = self.repository.get_full_case_contents_batch(list(exact_case_numbers))

            # 정확 매칭 결과를 SearchResult로 변환 (score = 2.0으로 최상위 표시)
            exact_results = [
                SearchResult(
                    case_number=m["case_number"],
                    case_name=m["case_name"],
                    court_name=m["court_name"],
                    judgment_date=m["judgment_date"],
                    content=exact_contents.get(m["case_number"], ""),
                    section="전문",
                    score=2.0,  # 정확 매칭은 최고 점수
                )
                for m in exact_matches
            ]

            # 정확 매칭 + 벡터 검색 결과 합치기
            search_results = exact_results + search_results
            logger.info(f"사건명 정확 매칭 {len(exact_results)}건 우선 배치")

        search_results = search_results[:limit]

        return {
            "query": query,
            "query_type": query_type,
            "weights": {"dense": dense_weight, "sparse": sparse_weight},
            "keywords": keywords,
            "exact_match_count": len(exact_matches),
            "total": len(search_results),
            "results": [r.to_dict() for r in search_results]
        }

    def _merge_case_chunks(self, results: List[SearchResult]) -> List[SearchResult]:
        """같은 판례의 여러 청크를 병합 (이미 가져온 content 활용, DB 재조회 없음)"""
        # 사건번호별 데이터 수집
        case_data: Dict[str, Dict[str, Any]] = {}

        for result in results:
            case_num = result.case_number
            if case_num not in case_data:
                case_data[case_num] = {
                    "score": result.score,
                    "case_name": result.case_name,
                    "court_name": result.court_name,
                    "judgment_date": result.judgment_date,
                    "contents": [],  # 청크 content 수집
                }
            else:
                # 더 높은 점수로 업데이트
                if result.score > case_data[case_num]["score"]:
                    case_data[case_num]["score"] = result.score

            # 청크 content 수집 (중복 방지)
            if result.content and result.content not in case_data[case_num]["contents"]:
                case_data[case_num]["contents"].append(result.content)

        # 수집된 청크들을 합쳐서 결과 생성
        merged_results = [
            SearchResult(
                case_number=case_num,
                case_name=data["case_name"],
                court_name=data["court_name"],
                judgment_date=data["judgment_date"],
                content="\n\n".join(data["contents"]),  # 청크들을 합침
                section="전문",
                score=data["score"],
            )
            for case_num, data in case_data.items()
        ]

        merged_results.sort(key=lambda x: x.score, reverse=True)
        return merged_results

    # ==================== Repository 위임 메서드 ====================

    def get_case_detail(self, case_number: str) -> Dict[str, Any]:
        """판례 상세 조회 (Repository 위임)"""
        return self.repository.get_case_detail(case_number)

    def get_recent_cases(self, limit: int = 50) -> Dict[str, Any]:
        """최신 판례 조회 (Repository 위임)"""
        return self.repository.get_recent_cases(limit)

    async def get_case_detail_with_fallback(self, case_number: str) -> Dict[str, Any] | None:
        """판례 상세 조회 with fallback (Repository 위임)"""
        return await self.repository.get_case_detail_with_fallback(case_number)
