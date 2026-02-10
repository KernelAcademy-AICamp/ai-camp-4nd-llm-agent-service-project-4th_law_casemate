"""
판례 검색 서비스
4단계 검색: 전체 문구 일치 → AND → OR → 하이브리드
"""

import re
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Set, Optional
from qdrant_client.http import models

from app.services.precedent_embedding_service import PrecedentEmbeddingService
from app.services.precedent_repository import PrecedentRepository, SearchResult

logger = logging.getLogger(__name__)


class PrecedentSearchService:
    """판례 4단계 검색 서비스"""

    CASES_COLLECTION = "precedents"

    # 사건번호 패턴
    CASE_NUMBER_PATTERN = re.compile(r'(\d{2,4}[가-힣]{1,2}\d+)')

    # 하이브리드 검색 가중치
    DENSE_WEIGHT = 0.3
    SPARSE_WEIGHT = 0.7
    MIN_SCORE_THRESHOLD = 0.3

    # 섹션 가중치 (하이브리드 검색용)
    SECTION_WEIGHTS = {"판시사항": 1.3, "판결요지": 1.3, "사건명": 1.2}
    DEFAULT_SECTION_WEIGHT = 1.0

    # 불용어 (조사, 접속사)
    STOPWORDS = {
        "내", "의", "에", "를", "을", "이", "가", "은", "는", "과", "와",
        "로", "으로", "에서", "까지", "부터", "도", "만", "보다", "및",
        "또는", "그", "저", "그리고", "하지만", "때문에"
    }

    # 법원 유형 키워드 매핑
    COURT_TYPE_KEYWORDS = {
        "대법원": ["대법원"],
        "고등법원": ["고등법원", "고법"],
        "지방법원": ["지방법원", "지법", "가정법원", "가법", "행정법원", "행법"],
    }

    # 기간 매핑 (년수, None은 특수 처리)
    PERIOD_MAP = {
        "1y": 1,      # 최근 1년
        "3y": 3,      # 최근 3년
        "5y": 5,      # 최근 5년
        "10y": 10,    # 최근 10년
        "old": -10,   # 10년 이상 (음수로 구분)
    }

    # 동의어 사전 (일상어 → 법률용어)
    SYNONYM_MAP = {
        # 온라인/SNS
        "카카오톡": ["정보통신망", "온라인", "메신저"],
        "카톡": ["정보통신망", "온라인", "메신저"],
        "인스타": ["정보통신망", "SNS", "소셜미디어"],
        "인스타그램": ["정보통신망", "SNS", "소셜미디어"],
        "페이스북": ["정보통신망", "SNS", "소셜미디어"],
        "유튜브": ["정보통신망", "온라인", "동영상"],
        "틱톡": ["정보통신망", "SNS", "동영상"],
        "트위터": ["정보통신망", "SNS"],
        "단톡방": ["정보통신망", "단체채팅", "메신저"],
        "오픈채팅": ["정보통신망", "채팅"],
        "댓글": ["게시글", "온라인", "게시판"],
        "디엠": ["메시지", "온라인"],
        "DM": ["메시지", "온라인"],
        "블로그": ["정보통신망", "온라인", "게시판"],
        "커뮤니티": ["정보통신망", "온라인", "게시판"],
        "카페": ["정보통신망", "온라인", "게시판"],
        # 명예훼손/모욕
        "악플": ["모욕", "비방", "명예훼손", "댓글"],
        "욕설": ["모욕", "욕설", "비하"],
        "비방": ["비방", "명예훼손", "허위사실"],
        "루머": ["허위사실", "명예훼손", "유포"],
        "소문": ["허위사실", "명예훼손", "유포"],
        "헛소문": ["허위사실", "명예훼손", "유포"],
        "거짓말": ["허위사실", "기망"],
        "뒷담화": ["명예훼손", "비방"],
        "음해": ["명예훼손", "비방", "허위사실"],
        "인신공격": ["모욕", "명예훼손", "인격권"],
        "조리돌림": ["모욕", "명예훼손", "공연성"],
        "신상털기": ["개인정보", "명예훼손", "프라이버시"],
        "폭로": ["명예훼손", "공연성", "적시"],
        # 직장/근로
        "월급": ["임금", "급여", "보수"],
        "짤림": ["해고", "면직"],
        "잘림": ["해고", "면직"],
        "왕따": ["따돌림", "괴롭힘", "집단따돌림"],
        "따돌림": ["괴롭힘", "집단따돌림", "직장내괴롭힘"],
        "갑질": ["괴롭힘", "직장내괴롭힘", "우월적지위"],
        "야근": ["연장근로", "시간외근무"],
        "퇴직금": ["퇴직급여"],
        "부당해고": ["해고", "부당해고", "면직"],
        # 금전/사기
        "떼먹음": ["횡령", "배임", "사기"],
        "먹튀": ["사기", "횡령"],
        "투자사기": ["사기", "기망"],
        "코인": ["가상자산", "암호화폐"],
        "주식": ["유가증권"],
        "빚": ["채무", "채권"],
        "돈": ["금전", "금원"],
        # 폭력/협박
        "협박": ["공갈", "협박죄"],
        "패싸움": ["폭행", "상해", "집단폭행"],
        "맞음": ["폭행", "상해"],
        "때림": ["폭행", "상해"],
        "스토킹": ["스토킹", "지속적괴롭힘"],
        "보복": ["보복", "협박"],
        # 가정/이혼
        "이혼": ["혼인파탄", "이혼"],
        "양육비": ["양육비", "부양료"],
        "위자료": ["위자료", "손해배상"],
        "불륜": ["부정행위", "혼인파탄"],
        "바람": ["부정행위", "혼인파탄"],
        # 성범죄
        "성추행": ["강제추행", "성추행"],
        "성희롱": ["성희롱", "직장내성희롱"],
        "몰카": ["촬영죄", "카메라등이용촬영"],
        "리벤지포르노": ["영상물유포", "촬영물유포"],
    }

    def __init__(self):
        self.embedding_service = PrecedentEmbeddingService()
        self.repository = PrecedentRepository()

    # ==================== 유틸리티 ====================

    def _extract_keywords(self, query: str) -> List[str]:
        """쿼리에서 의미 있는 키워드 추출 (조사 제외)"""
        return [w for w in query.split() if len(w) >= 2 and w not in self.STOPWORDS]

    def _expand_query(self, query: str) -> str:
        """동의어 사전으로 쿼리 확장"""
        words = query.split()
        expanded = list(words)
        for word in words:
            if word in self.SYNONYM_MAP:
                expanded.extend(s for s in self.SYNONYM_MAP[word] if s not in expanded)
        return " ".join(expanded)

    def _is_case_number(self, query: str) -> bool:
        """사건번호 패턴인지 확인"""
        return bool(self.CASE_NUMBER_PATTERN.search(query))

    def _build_filter(self, filters: Optional[Dict[str, str]]) -> Optional[models.Filter]:
        """필터 조건 생성 (중복 선택 지원, 각 필터 유형은 AND로 결합)"""
        if not filters:
            return None

        must_conditions = []

        # 법원 유형 필터 (쉼표로 구분된 복수 선택 가능)
        # 선택된 법원들은 OR로 묶고, 전체 결과와는 AND
        if "court_type" in filters:
            court_types = [ct.strip() for ct in filters["court_type"].split(",") if ct.strip()]
            court_keywords = []
            for court_type in court_types:
                if court_type in self.COURT_TYPE_KEYWORDS:
                    court_keywords.extend(self.COURT_TYPE_KEYWORDS[court_type])

            if court_keywords:
                court_should = [
                    models.FieldCondition(key="court_name", match=models.MatchText(text=kw))
                    for kw in court_keywords
                ]
                # nested filter로 OR 조건 묶기
                must_conditions.append(models.Filter(should=court_should))

        # 사건 종류 필터 (쉼표로 구분된 복수 선택 가능)
        # 선택된 사건종류들은 OR로 묶고, 전체 결과와는 AND
        if "case_type" in filters:
            case_types = [ct.strip() for ct in filters["case_type"].split(",") if ct.strip()]
            if case_types:
                case_should = [
                    models.FieldCondition(key="case_type", match=models.MatchValue(value=ct))
                    for ct in case_types
                ]
                if len(case_should) == 1:
                    must_conditions.append(case_should[0])
                else:
                    # nested filter로 OR 조건 묶기
                    must_conditions.append(models.Filter(should=case_should))

        # 기간 필터 (judgment_date는 정수형: 20240101)
        if "period" in filters:
            period = filters["period"]
            if period in self.PERIOD_MAP:
                years = self.PERIOD_MAP[period]
                if years > 0:
                    # 최근 N년: cutoff_date 이후
                    cutoff_date = datetime.now() - timedelta(days=years * 365)
                    cutoff_int = int(cutoff_date.strftime("%Y%m%d"))
                    must_conditions.append(
                        models.FieldCondition(
                            key="judgment_date",
                            range=models.Range(gte=cutoff_int)
                        )
                    )
                else:
                    # 10년 이상 전: cutoff_date 이전
                    cutoff_date = datetime.now() - timedelta(days=abs(years) * 365)
                    cutoff_int = int(cutoff_date.strftime("%Y%m%d"))
                    must_conditions.append(
                        models.FieldCondition(
                            key="judgment_date",
                            range=models.Range(lte=cutoff_int)
                        )
                    )

        # 조건이 없으면 None 반환
        if not must_conditions:
            return None

        return models.Filter(must=must_conditions)

    # ==================== 공통 검색 헬퍼 ====================

    def _scroll_search(
        self,
        scroll_filter: models.Filter,
        limit: int,
        exclude: Set[str] = None
    ) -> Dict[str, Dict[str, Any]]:
        """
        필터 조건으로 scroll 검색 후 사건번호별 중복 제거

        Returns:
            {case_number: {case_name, court_name, judgment_date, content}}
        """
        exclude = exclude or set()

        results = self.repository.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=scroll_filter,
            limit=limit * 5,
            with_payload=True,
            with_vectors=False,
        )

        case_data = {}
        for point in results[0]:
            payload = point.payload
            case_num = payload.get("case_number", "")
            if case_num and case_num not in case_data and case_num not in exclude:
                case_data[case_num] = {
                    "case_name": payload.get("case_name", ""),
                    "court_name": payload.get("court_name", ""),
                    "judgment_date": payload.get("judgment_date", ""),
                    "content": payload.get("content", ""),
                }
        return case_data

    def _to_search_results(
        self,
        case_data: Dict[str, Dict[str, Any]],
        section: str,
        score: float,
        limit: int
    ) -> List[SearchResult]:
        """case_data를 SearchResult 리스트로 변환"""
        results = [
            SearchResult(
                case_number=case_num,
                case_name=data["case_name"],
                court_name=data["court_name"],
                judgment_date=data["judgment_date"],
                content=data["content"],
                section=section,
                score=score,
            )
            for case_num, data in case_data.items()
        ]
        return results[:limit]

    def _search_bm25(
        self,
        query: str,
        limit: int,
        exclude: Set[str],
        filters: Optional[Dict[str, str]] = None,
        text_filter: Optional[models.Filter] = None
    ) -> List[SearchResult]:
        """
        BM25 스코어 기반 검색

        Args:
            query: 검색 쿼리
            limit: 결과 개수
            exclude: 제외할 사건번호
            filters: 필터 조건 (법원, 사건종류, 기간)
            text_filter: 텍스트 매칭 필터 (must 또는 should)

        Returns:
            BM25 점수순 정렬된 SearchResult 리스트
        """
        # sparse 임베딩 생성 (BM25)
        sparse_vec = self.embedding_service.create_sparse(query)

        # 기본 필터 조건 생성 (법원, 사건종류, 기간)
        base_filter = self._build_filter(filters)

        # 텍스트 필터와 기본 필터 병합
        if text_filter and base_filter:
            # text_filter의 must/should 유지하면서 base_filter 추가
            must_conditions = list(text_filter.must or [])
            must_conditions.append(base_filter)
            query_filter = models.Filter(
                must=must_conditions if must_conditions else None,
                should=text_filter.should
            )
        elif text_filter:
            query_filter = text_filter
        else:
            query_filter = base_filter

        # BM25 검색 (sparse vector)
        results = self.repository.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            query=sparse_vec,
            using="sparse",
            limit=limit * 5,  # 중복 제거 고려
            query_filter=query_filter,
            with_payload=True,
        )

        # 사건번호별 중복 제거 및 점수 유지
        case_data = {}
        for point in results.points:
            payload = point.payload
            case_num = payload.get("case_number", "")
            if case_num and case_num not in case_data and case_num not in exclude:
                case_data[case_num] = {
                    "case_name": payload.get("case_name", ""),
                    "court_name": payload.get("court_name", ""),
                    "judgment_date": payload.get("judgment_date", ""),
                    "content": payload.get("content", ""),
                    "score": point.score,  # BM25 점수 보존
                }

        # SearchResult 변환 (점수순 정렬)
        search_results = [
            SearchResult(
                case_number=case_num,
                case_name=data["case_name"],
                court_name=data["court_name"],
                judgment_date=data["judgment_date"],
                content=data["content"],
                section="BM25",
                score=data["score"],
            )
            for case_num, data in case_data.items()
        ]

        # 점수 내림차순 정렬
        search_results.sort(key=lambda r: r.score, reverse=True)

        return search_results[:limit]

    # ==================== 사건번호 검색 ====================

    def _search_by_case_number(self, query: str, limit: int) -> Dict[str, Any]:
        """사건번호로 정확 검색"""
        match = self.CASE_NUMBER_PATTERN.search(query)
        if not match:
            return {"query": query, "total": 0, "results": []}

        case_filter = models.Filter(
            must=[models.FieldCondition(
                key="case_number",
                match=models.MatchText(text=match.group(1))
            )]
        )
        case_data = self._scroll_search(case_filter, limit)

        # 전체 콘텐츠 일괄 조회
        case_numbers = list(case_data.keys())
        all_contents = self.repository.get_full_case_contents_batch(case_numbers)
        for case_num in case_data:
            case_data[case_num]["content"] = all_contents.get(case_num, "")

        results = self._to_search_results(case_data, "전문", 1.0, limit)
        return {
            "query": query,
            "total": len(results),
            "results": [r.to_dict() for r in results]
        }

    # ==================== 4단계 검색 ====================

    def _search_exact_phrase(
        self, query: str, limit: int, exclude: Set[str], filters: Optional[Dict[str, str]] = None
    ) -> List[SearchResult]:
        """1순위: 전체 문구 일치 + BM25 스코어 정렬"""
        # 전체 문구 포함 필수 조건
        must_filter = models.Filter(
            must=[models.FieldCondition(key="content", match=models.MatchText(text=query))]
        )
        results = self._search_bm25(query, limit, exclude, filters, text_filter=must_filter)
        logger.info(f"1순위 전체일치 (BM25): '{query}' → {len(results)}건")
        return results

    def _search_keywords_and(
        self, keywords: List[str], limit: int, exclude: Set[str], filters: Optional[Dict[str, str]] = None
    ) -> List[SearchResult]:
        """2순위: 키워드 AND (모두 포함) + BM25 스코어 정렬"""
        if len(keywords) < 2:
            return []

        # 모든 키워드 포함 필수 조건
        must_filter = models.Filter(
            must=[models.FieldCondition(key="content", match=models.MatchText(text=kw)) for kw in keywords]
        )
        query_text = " ".join(keywords)
        results = self._search_bm25(query_text, limit, exclude, filters, text_filter=must_filter)
        logger.info(f"2순위 AND (BM25): {keywords} → {len(results)}건")
        return results

    def _search_keywords_or(
        self, keywords: List[str], limit: int, exclude: Set[str], filters: Optional[Dict[str, str]] = None
    ) -> List[SearchResult]:
        """3순위: 키워드 OR (하나라도 포함) + BM25 스코어 정렬"""
        if not keywords:
            return []

        # 키워드 중 하나라도 포함 조건
        should_filter = models.Filter(
            should=[models.FieldCondition(key="content", match=models.MatchText(text=kw)) for kw in keywords]
        )
        query_text = " ".join(keywords)
        results = self._search_bm25(query_text, limit, exclude, filters, text_filter=should_filter)
        logger.info(f"3순위 OR (BM25): {keywords} → {len(results)}건")
        return results

    def _search_hybrid(
        self, query: str, limit: int, exclude: Set[str], merge_chunks: bool, filters: Optional[Dict[str, str]] = None
    ) -> List[SearchResult]:
        """4순위: 동의어 확장 + 하이브리드 검색"""
        expanded = self._expand_query(query)
        logger.info(f"4순위 하이브리드: '{expanded}'")

        dense_vec, sparse_vec = self.embedding_service.create_both_parallel(expanded)
        search_limit = limit * 5 if merge_chunks else limit

        # 필터 조건 생성
        query_filter = self._build_filter(filters)

        dense_results = self.repository.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            query=dense_vec, using="dense", limit=search_limit,
            query_filter=query_filter,
        )
        sparse_results = self.repository.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            query=sparse_vec, using="sparse", limit=search_limit,
            query_filter=query_filter,
        )

        # 점수 결합
        combined = self._combine_scores(dense_results.points, sparse_results.points)

        # SearchResult 변환
        results = [
            SearchResult(
                case_number=data["payload"].get("case_number", ""),
                case_name=data["payload"].get("case_name", ""),
                court_name=data["payload"].get("court_name", ""),
                judgment_date=data["payload"].get("judgment_date", ""),
                content=data["payload"].get("content", ""),
                section="하이브리드",
                score=data["score"],
            )
            for data in combined
            if data["payload"].get("case_number", "") not in exclude
        ]

        if merge_chunks:
            results = self._merge_case_chunks(results)

        return results[:limit]

    def _combine_scores(self, dense_points: List, sparse_points: List) -> List[Dict[str, Any]]:
        """Dense + Sparse 점수 결합"""
        combined = {}

        # 정규화용 min/range 계산
        def get_range(points):
            if not points:
                return 0.0, 1.0
            scores = [p.score for p in points]
            s_min, s_max = min(scores), max(scores)
            return s_min, (s_max - s_min) if s_max != s_min else 1.0

        d_min, d_range = get_range(dense_points)
        s_min, s_range = get_range(sparse_points)

        for point in dense_points:
            pid = str(point.id)
            norm = (point.score - d_min) / d_range
            section = point.payload.get("section", "")
            weight = self.SECTION_WEIGHTS.get(section, self.DEFAULT_SECTION_WEIGHT)
            combined[pid] = {
                "score": norm * self.DENSE_WEIGHT * weight,
                "payload": point.payload,
            }

        for point in sparse_points:
            pid = str(point.id)
            norm = (point.score - s_min) / s_range
            section = point.payload.get("section", "")
            weight = self.SECTION_WEIGHTS.get(section, self.DEFAULT_SECTION_WEIGHT)
            score = norm * self.SPARSE_WEIGHT * weight
            if pid in combined:
                combined[pid]["score"] += score
            else:
                combined[pid] = {"score": score, "payload": point.payload}

        # 정렬 및 필터링
        return sorted(
            [v for v in combined.values() if v["score"] >= self.MIN_SCORE_THRESHOLD],
            key=lambda x: x["score"],
            reverse=True
        )

    def _merge_case_chunks(self, results: List[SearchResult]) -> List[SearchResult]:
        """같은 판례의 청크 병합"""
        case_data = {}
        for r in results:
            if r.case_number not in case_data:
                case_data[r.case_number] = {
                    "score": r.score,
                    "case_name": r.case_name,
                    "court_name": r.court_name,
                    "judgment_date": r.judgment_date,
                    "contents": [],
                }
            else:
                case_data[r.case_number]["score"] = max(case_data[r.case_number]["score"], r.score)
            if r.content and r.content not in case_data[r.case_number]["contents"]:
                case_data[r.case_number]["contents"].append(r.content)

        merged = [
            SearchResult(
                case_number=cn,
                case_name=d["case_name"],
                court_name=d["court_name"],
                judgment_date=d["judgment_date"],
                content="\n\n".join(d["contents"]),
                section="전문",
                score=d["score"],
            )
            for cn, d in case_data.items()
        ]
        merged.sort(key=lambda x: x.score, reverse=True)
        return merged

    # ==================== 메인 검색 ====================

    def search_cases(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        sort: str = "relevance",
        merge_chunks: bool = True,
        filters: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        판례 4단계 검색 (페이지네이션 지원)

        1순위: 전체 문구 일치 ("직장 내 괴롭힘")
        2순위: 키워드 AND ("직장" AND "괴롭힘")
        3순위: 키워드 OR ("직장" OR "괴롭힘")
        4순위: 동의어 확장 + 하이브리드 검색

        Args:
            limit: 반환할 결과 수
            offset: 건너뛸 결과 수 (페이지네이션용)
            sort: 정렬 순서 (relevance=관련순, latest=최신순)
            filters: 필터 조건 {"court_type": "대법원", "case_type": "민사", "period": "3y"}
        """
        query = query.strip()

        # 사건번호 패턴
        if self._is_case_number(query):
            return self._search_by_case_number(query, limit)

        keywords = self._extract_keywords(query)
        logger.info(f"검색어: '{query}' → 키워드: {keywords}, 필터: {filters}, offset: {offset}, sort: {sort}")

        found: Set[str] = set()
        all_results: List[SearchResult] = []

        # offset + limit + 1 만큼 검색 (has_more 판단용)
        internal_limit = offset + limit + 1

        def add_results(results: List[SearchResult]):
            for r in results:
                if r.case_number not in found:
                    found.add(r.case_number)
                    all_results.append(r)

        # 1순위: 전체 문구 일치
        add_results(self._search_exact_phrase(query, internal_limit, found, filters))

        # 2순위: 키워드 AND
        if len(keywords) >= 2 and len(all_results) < internal_limit:
            add_results(self._search_keywords_and(keywords, internal_limit, found, filters))

        # 3순위: 키워드 OR
        if keywords and len(all_results) < internal_limit:
            add_results(self._search_keywords_or(keywords, internal_limit, found, filters))

        # 4순위: 하이브리드 (결과 부족 시)
        expanded_query = None
        if len(all_results) < internal_limit:
            expanded_query = self._expand_query(query)
            add_results(self._search_hybrid(query, internal_limit, found, merge_chunks, filters))

        # 최신순 정렬 (judgment_date 기준 내림차순)
        if sort == "latest":
            all_results.sort(key=lambda r: r.judgment_date or "", reverse=True)

        # offset 적용 및 has_more 판단
        total_found = len(all_results)
        has_more = total_found > offset + limit
        paginated_results = all_results[offset:offset + limit]

        return {
            "query": query,
            "keywords": keywords,
            "expanded_query": expanded_query if expanded_query and expanded_query != query else None,
            "filters": filters,
            "sort": sort,
            "total": len(paginated_results),
            "offset": offset,
            "has_more": has_more,
            "results": [r.to_dict() for r in paginated_results]
        }

    # ==================== Repository 위임 ====================

    def get_case_detail(self, case_number: str) -> Dict[str, Any]:
        return self.repository.get_case_detail(case_number)

    def get_recent_cases(self, limit: int = 50) -> Dict[str, Any]:
        return self.repository.get_recent_cases(limit)

    async def get_case_detail_with_fallback(self, case_number: str) -> Dict[str, Any] | None:
        return await self.repository.get_case_detail_with_fallback(case_number)
