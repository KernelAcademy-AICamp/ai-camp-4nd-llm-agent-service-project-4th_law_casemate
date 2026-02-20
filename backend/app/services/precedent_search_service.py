"""
판례 검색 서비스
Prefetch + RRF 1회 호출 + Python 우선순위 부스팅
"""

import re
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Set, Optional
from qdrant_client.http import models

from app.services.precedent_embedding_service import PrecedentEmbeddingService
from app.services.precedent_repository import PrecedentRepository, SearchResult
from app.config import CollectionConfig

logger = logging.getLogger(__name__)


class PrecedentSearchService:
    """판례 검색 서비스 (Prefetch + RRF + Python 부스팅)"""

    @property
    def CASES_COLLECTION(self) -> str:
        """설정에 따른 컬렉션 이름 반환"""
        return CollectionConfig.get_precedents_collection()

    # 사건번호 패턴
    CASE_NUMBER_PATTERN = re.compile(r'(\d{2,4}[가-힣]{1,2}\d+)')

    # 섹션 가중치
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
        # 양방향 동의어 사전 구축
        self.bidirectional_synonyms = self._build_bidirectional_synonyms()

    def _build_bidirectional_synonyms(self) -> Dict[str, List[str]]:
        """단방향 SYNONYM_MAP을 양방향으로 확장"""
        result = {}

        # 1. 기존 매핑 복사 (일상어 → 법률용어)
        for key, values in self.SYNONYM_MAP.items():
            if key not in result:
                result[key] = []
            result[key].extend(v for v in values if v not in result[key])

        # 2. 역방향 매핑 추가 (법률용어 → 일상어)
        for key, values in self.SYNONYM_MAP.items():
            for value in values:
                if value not in result:
                    result[value] = []
                if key not in result[value]:
                    result[value].append(key)

        # 3. 같은 그룹 내 상호 연결 (카카오톡 ↔ 카톡)
        # 같은 values를 공유하는 키들을 서로 연결
        value_to_keys: Dict[str, List[str]] = {}
        for key, values in self.SYNONYM_MAP.items():
            for value in values:
                if value not in value_to_keys:
                    value_to_keys[value] = []
                if key not in value_to_keys[value]:
                    value_to_keys[value].append(key)

        for keys_group in value_to_keys.values():
            if len(keys_group) > 1:
                for key in keys_group:
                    for other_key in keys_group:
                        if key != other_key and other_key not in result.get(key, []):
                            if key not in result:
                                result[key] = []
                            result[key].append(other_key)

        return result

    # ==================== 유틸리티 ====================

    def _extract_keywords(self, query: str) -> List[str]:
        """쿼리에서 의미 있는 키워드 추출 (조사 제외)"""
        return [w for w in query.split() if len(w) >= 2 and w not in self.STOPWORDS]

    def _expand_query(self, query: str) -> str:
        """양방향 동의어 사전으로 쿼리 확장"""
        words = query.split()
        expanded = list(words)
        for word in words:
            if word in self.bidirectional_synonyms:
                expanded.extend(s for s in self.bidirectional_synonyms[word] if s not in expanded)
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
        메타데이터는 PostgreSQL에서 조회

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

        # Qdrant에서 case_number만 추출
        case_numbers = []
        for point in results[0]:
            payload = point.payload
            case_num = payload.get("case_number", "")
            if case_num and case_num not in case_numbers and case_num not in exclude:
                case_numbers.append(case_num)

        # PostgreSQL에서 메타데이터 일괄 조회
        metadata_batch = self.repository.get_metadata_batch(case_numbers) if case_numbers else {}

        case_data = {}
        for case_num in case_numbers:
            meta = metadata_batch.get(case_num, {})
            case_data[case_num] = {
                "case_name": meta.get("case_name", ""),
                "court_name": meta.get("court_name", ""),
                "judgment_date": meta.get("judgment_date", ""),
                "content": "",  # 전문은 별도 조회
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
        판례 검색 (Prefetch + RRF 1회 호출 + Python 우선순위 부스팅)

        우선순위 부스팅:
        - 전체 문구 일치 → 3배 부스트
        - 키워드 전부 포함 → 2배 부스트
        - 키워드 일부 포함 → 1.5배 부스트
        - 섹션 가중치 적용 (판시사항, 판결요지 등)

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
        expanded_query = self._expand_query(query)
        logger.info(f"검색어: '{query}' → 키워드: {keywords}, 확장: '{expanded_query}', 필터: {filters}")

        # 임베딩 생성 (확장된 쿼리 사용)
        dense_vec, sparse_vec = self.embedding_service.create_both_parallel(expanded_query)
        query_filter = self._build_filter(filters)

        # offset + limit + 1 만큼 검색 (has_more 판단용, 중복 제거 고려해 여유있게)
        internal_limit = (offset + limit + 1) * 3

        # ★ Qdrant API 1회: Prefetch + RRF Fusion
        results = self.repository.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            prefetch=[
                models.Prefetch(query=dense_vec, using="dense", limit=internal_limit),
                models.Prefetch(query=sparse_vec, using="sparse", limit=internal_limit),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            query_filter=query_filter,
            limit=internal_limit,
            with_payload=["case_number", "section"],  # 최소 payload만 요청
        )

        # 사건번호별 중복 제거 (섹션 가중치만 적용)
        found: Set[str] = set()
        temp_results: List[tuple] = []  # (case_number, section, score)

        for point in results.points:
            payload = point.payload
            case_num = payload.get("case_number", "")
            section = payload.get("section", "")
            score = point.score

            # 섹션 가중치
            score *= self.SECTION_WEIGHTS.get(section, self.DEFAULT_SECTION_WEIGHT)

            if case_num and case_num not in found:
                found.add(case_num)
                temp_results.append((case_num, section, score))

        # 점수순 재정렬
        temp_results.sort(key=lambda x: x[2], reverse=True)

        # PostgreSQL에서 메타데이터 + 전문 일괄 조회
        case_numbers = [r[0] for r in temp_results]
        metadata_batch = self.repository.get_metadata_batch(case_numbers) if case_numbers else {}

        # ★ Python 우선순위 부스팅 (PostgreSQL 전문 기반)
        all_results: List[SearchResult] = []
        for case_num, section, score in temp_results:
            meta = metadata_batch.get(case_num, {})
            full_content = meta.get("full_content", "")

            # 우선순위 부스팅 (전문에서 키워드 매칭)
            if query in full_content:
                score *= 10.0  # 전체 문구 일치
            elif keywords and all(kw in full_content for kw in keywords):
                score *= 5.0  # 키워드 전부 포함
            elif keywords and any(kw in full_content for kw in keywords):
                score *= 3.0  # 키워드 일부 포함

            # 미리보기 생성 (검색어 주변 텍스트)
            preview = self.repository.extract_preview(full_content, query)

            all_results.append(SearchResult(
                case_number=case_num,
                case_name=meta.get("case_name", ""),
                court_name=meta.get("court_name", ""),
                judgment_date=meta.get("judgment_date", ""),
                content=preview,
                section=section,
                score=score,
            ))

        # 부스팅 후 재정렬
        all_results.sort(key=lambda r: r.score, reverse=True)

        # 최신순 정렬 (요청 시)
        if sort == "latest":
            all_results.sort(key=lambda r: r.judgment_date or "", reverse=True)

        # offset 적용 및 has_more 판단
        total_found = len(all_results)
        has_more = total_found > offset + limit
        paginated_results = all_results[offset:offset + limit]

        return {
            "query": query,
            "keywords": keywords,
            "expanded_query": expanded_query if expanded_query != query else None,
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
