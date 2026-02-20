"""
유사 판례 검색 서비스
- 2단계 검색: BM25 키워드 필터링 → Dense 의미 검색
- 청크 → 판례 그룹핑
- Cross-encoder 리랭킹
- PostgreSQL에서 메타데이터/전문 조회
"""

import os
import time
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from qdrant_client.http import models
from qdrant_client.models import Filter, FieldCondition, MatchAny

from app.services.precedent_embedding_service import PrecedentEmbeddingService, get_openai_client
from app.services.precedent_repository import PrecedentRepository
from app.config import CollectionConfig
from tool.qdrant_client import get_qdrant_client
from app.prompts.query_transform_prompt import (
    QUERY_TRANSFORM_V5_SYSTEM,
    QUERY_TRANSFORM_V5_USER,
)
import re

logger = logging.getLogger(__name__)


def is_reranking_enabled() -> bool:
    """USE_RERANKING 환경변수 확인 (기본값: false)"""
    return os.getenv("USE_RERANKING", "false").lower() in ("true", "1", "yes")


# 리랭커 모델 (Lazy Loading)
_reranker_model = None


def get_reranker_model():
    """리랭커 모델 싱글톤 로드. 리랭킹 비활성 시 None 반환."""
    if not is_reranking_enabled():
        return None
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

    검색 파이프라인:
    1. GPT 쿼리 정제 + 키워드 추출
    2. BM25로 키워드 매칭 판례 필터링
    3. 필터링된 판례에서 Dense 검색
    4. 청크 → 판례 그룹핑
    5. Cross-encoder 리랭킹
    """

    @property
    def COLLECTION_PRECEDENTS(self) -> str:
        """설정에 따른 컬렉션 이름 반환"""
        return CollectionConfig.get_precedents_collection()

    # 검색/리랭킹 설정
    SEARCH_LIMIT = 50  # 각 검색(Dense/Sparse)에서 가져올 수
    RERANK_CANDIDATES = 30  # 리랭킹할 판례 후보 수

    def __init__(self, use_reranking: bool | None = None):
        self.embedding_service = PrecedentEmbeddingService(
            model=PrecedentEmbeddingService.MODEL_SMALL
        )
        self.qdrant_client = get_qdrant_client()
        self.openai_client = get_openai_client()
        self.repository = PrecedentRepository()
        self.use_reranking = use_reranking if use_reranking is not None else is_reranking_enabled()

    # ==================== 쿼리 정제 + 키워드 추출 ====================

    def _refine_and_extract(self, user_query: str) -> Dict[str, Any]:
        """
        GPT를 사용해 쿼리 정제 + 키워드 추출 (V5 프롬프트)
        - 고유명사 → 법률 주체 변환
        - 플랫폼 일반화
        - 법률 키워드 추출

        Returns:
            {"query": 정제된 쿼리, "keywords": [키워드 리스트]}
        """
        try:
            logger.info("=" * 60)
            logger.info("[유사 판례 검색] GPT 쿼리 정제 + 키워드 추출 (V5)")
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
            logger.error(f"GPT 쿼리 정제 실패: {e}, 최소 정제 적용")
            return {
                "query": self._minimal_clean(user_query),
                "keywords": []
            }

    def _minimal_clean(self, text: str) -> str:
        """
        폴백용 최소 정제: 이름 패턴 제거
        - GPT 호출 실패 시 사용
        """
        # 한글 이름 패턴 (2~4글자 + 조사/호칭)
        cleaned = re.sub(r'[가-힣]{2,4}(씨|님|가|이|은|는|을|를|에게|한테|의)\s?', '', text)
        # 연속 공백 정리
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        return cleaned[:500]

    # ==================== 2단계 검색: BM25 → Dense ====================

    # BM25 선필터링 설정
    SPARSE_SCORE_THRESHOLD = 0.5  # BM25 점수 하한값 (이 이상만 필터링)
    SPARSE_MAX_LIMIT = 1000       # BM25 검색 최대 limit

    def _search_sparse_filter(self, keywords: List[str]) -> set:
        """
        1단계: BM25 (Sparse) 검색으로 키워드 매칭된 case_number 필터링
        - 키워드별 개별 검색 후 결과 합치기
        - 점수 하한값 이상인 모든 결과를 가져옴

        Args:
            keywords: 법률 키워드 리스트

        Returns:
            매칭된 case_number set
        """
        if not keywords:
            logger.info("[BM25 필터] 키워드 없음, 필터링 스킵")
            return set()

        # 키워드별 개별 검색 후 결과 합치기
        all_case_numbers = set()
        keyword_results = {}

        for keyword in keywords:
            sparse_vec = self.embedding_service.create_sparse(keyword)

            # BM25 검색 (하한값 이상 모두 가져오기)
            results = self.qdrant_client.query_points(
                collection_name=self.COLLECTION_PRECEDENTS,
                query=sparse_vec,
                using="sparse",
                score_threshold=self.SPARSE_SCORE_THRESHOLD,
                limit=self.SPARSE_MAX_LIMIT,
                with_payload=["case_number"],
            )

            # case_number 추출
            case_numbers = set()
            for point in results.points:
                case_number = point.payload.get("case_number", "")
                if case_number:
                    case_numbers.add(case_number)

            keyword_results[keyword] = len(case_numbers)
            all_case_numbers.update(case_numbers)

        logger.info(f"[BM25 필터] 키워드별 매칭: {keyword_results}, 하한값: {self.SPARSE_SCORE_THRESHOLD}")
        logger.info(f"[BM25 필터] 전체 합계: {len(all_case_numbers)}개 판례")
        return all_case_numbers

    def _search_dense_filtered(
        self,
        query: str,
        case_numbers: set
    ) -> Dict[str, Dict[str, Any]]:
        """
        2단계: 필터링된 case_number 내에서 Dense 검색

        Args:
            query: 정제된 쿼리
            case_numbers: BM25로 필터링된 case_number set

        Returns:
            {chunk_id: {"score": float, "payload": dict}}
        """
        dense_vec = self.embedding_service.create_dense(query)

        # case_number 필터 생성
        search_filter = None
        if case_numbers:
            search_filter = Filter(
                must=[
                    FieldCondition(
                        key="case_number",
                        match=MatchAny(any=list(case_numbers))
                    )
                ]
            )

        # Dense 검색 (필터 적용)
        results = self.qdrant_client.query_points(
            collection_name=self.COLLECTION_PRECEDENTS,
            query=dense_vec,
            using="dense",
            query_filter=search_filter,
            limit=self.SEARCH_LIMIT,
            with_payload=["case_number", "section"],
        )

        chunk_scores = {}
        for point in results.points:
            chunk_id = str(point.id)
            chunk_scores[chunk_id] = {
                "score": point.score,
                "payload": point.payload,
            }

        filter_info = f"필터: {len(case_numbers)}개 판례" if case_numbers else "필터 없음"
        logger.info(f"[Dense 검색] {filter_info} → {len(chunk_scores)}개 청크")
        return chunk_scores

    def _search_two_stage(
        self,
        query: str,
        keywords: List[str]
    ) -> Dict[str, Dict[str, Any]]:
        """
        2단계 검색: BM25 필터링 → Dense 검색

        Args:
            query: 정제된 쿼리
            keywords: 법률 키워드 리스트

        Returns:
            {chunk_id: {"score": float, "payload": dict}}
        """
        # 1단계: BM25로 키워드 매칭 판례 필터링
        case_numbers = self._search_sparse_filter(keywords)

        # 키워드 매칭 결과가 없으면 필터 없이 Dense 검색
        if not case_numbers:
            logger.info("[2단계 검색] BM25 매칭 없음, 전체 Dense 검색으로 폴백")

        # 2단계: 필터링된 판례에서 Dense 검색
        chunk_scores = self._search_dense_filtered(query, case_numbers)

        return chunk_scores

    # ==================== 청크 → 판례 그룹핑 ====================

    def _group_by_case(
        self,
        chunk_scores: Dict[str, Dict[str, Any]],
        exclude_case_number: Optional[str] = None,
        query: str = ""
    ) -> List[Dict[str, Any]]:
        """
        청크 검색 결과를 판례 단위로 그룹핑

        - RRF 점수 기반 정렬
        - PostgreSQL에서 메타데이터 + 전문 조회
        - 미리보기 추출
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
                    "case_name": "",
                    "court_name": "",
                    "judgment_date": "",
                    "max_score": 0,
                    "best_chunk": "",
                    "chunk_count": 0,
                }

            score = data["score"]
            cases[case_number]["chunk_count"] += 1

            # 가장 높은 점수 기록
            if score > cases[case_number]["max_score"]:
                cases[case_number]["max_score"] = score

        # PostgreSQL에서 메타데이터 + 전문 일괄 조회
        case_numbers = list(cases.keys())
        if case_numbers:
            metadata_batch = self.repository.get_metadata_batch(case_numbers)
            for case_number, case_data in cases.items():
                if case_number in metadata_batch:
                    meta = metadata_batch[case_number]
                    case_data["case_name"] = meta.get("case_name", "")
                    case_data["court_name"] = meta.get("court_name", "")
                    case_data["judgment_date"] = meta.get("judgment_date", "")

                    # 미리보기 추출 (검색어 주변 텍스트)
                    full_content = meta.get("full_content", "")
                    if full_content:
                        case_data["best_chunk"] = self.repository.extract_preview(
                            full_content, query, context_chars=200
                        )

        # max_score 기준 정렬
        sorted_cases = sorted(cases.values(), key=lambda x: x["max_score"], reverse=True)

        return sorted_cases

    # ==================== 리랭킹 ====================

    def _rerank(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        top_k: int
    ) -> List[Dict[str, Any]]:
        """
        Cross-encoder를 사용한 리랭킹
        - best_chunk 1개를 온전히 사용 (문맥 유지)
        """
        if not candidates:
            return []

        reranker = get_reranker_model()
        if reranker is None:
            return candidates[:top_k]

        # (쿼리, best_chunk) 쌍 생성
        pairs = []
        for c in candidates:
            # best_chunk 1개를 온전히 사용 (최대 1500자)
            best_chunk = c.get("best_chunk", "")[:1500]
            pairs.append((query[:500], best_chunk))

        # Cross-encoder로 점수 계산
        scores = reranker.predict(pairs)

        # 점수 기준 정렬
        scored_candidates = [
            (candidate, float(score))
            for candidate, score in zip(candidates, scores)
        ]
        scored_candidates.sort(key=lambda x: x[1], reverse=True)

        # 리랭크 점수 추가하여 반환
        reranked = []
        for candidate, rerank_score in scored_candidates[:top_k]:
            candidate["rerank_score"] = rerank_score
            candidate["final_score"] = rerank_score  # 단순화: 리랭크 점수 = 최종 점수
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
        유사 판례 검색 (2단계: BM25 → Dense + 리랭킹)

        검색 파이프라인:
        1. GPT 쿼리 정제 + 키워드 추출
        2. BM25로 키워드 매칭 판례 필터링
        3. 필터링된 판례에서 Dense 검색
        4. 청크 → 판례 그룹핑
        5. Cross-encoder 리랭킹

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

        # 1. GPT 쿼리 정제 + 키워드 추출 (V5 프롬프트)
        t1 = time.time()
        extract_result = self._refine_and_extract(query)
        refined_query = extract_result["query"]
        keywords = extract_result["keywords"]
        logger.info(f"[시간] 1. 쿼리 정제 + 키워드 추출: {time.time() - t1:.2f}초")

        # 2. 2단계 검색: BM25 필터링 → Dense 검색
        t2 = time.time()
        chunk_scores = self._search_two_stage(refined_query, keywords)
        logger.info(f"[시간] 2. 2단계 검색 (BM25→Dense): {time.time() - t2:.2f}초")
        logger.info(f"검색된 청크 수: {len(chunk_scores)}")

        # 3. 청크 → 판례 그룹핑 (PostgreSQL에서 메타데이터 + 미리보기)
        t3 = time.time()
        grouped_cases = self._group_by_case(chunk_scores, exclude_case_number, refined_query)
        logger.info(f"[시간] 3. 그룹핑: {time.time() - t3:.2f}초")
        logger.info(f"그룹핑된 판례 수: {len(grouped_cases)}")

        # 4. 리랭킹 (정제된 쿼리 사용)
        if self.use_reranking and len(grouped_cases) > 0:
            top_candidates = grouped_cases[:self.RERANK_CANDIDATES]

            # 리랭킹 후보 로그
            candidates_info = [
                {
                    "case": c["case_number"],
                    "score": round(c["max_score"], 4),
                }
                for c in top_candidates
            ]
            logger.info(f"[리랭킹 후보 {len(top_candidates)}개] {candidates_info}")

            t4 = time.time()
            logger.info(f"[리랭킹 쿼리] {refined_query[:100]}...")
            final_cases = self._rerank(refined_query, top_candidates, limit)
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
                score=round(case.get("rerank_score", case["max_score"]), 4),
                matched_chunk=case.get("best_chunk", "")[:200],
            )
            for case in final_cases
        ]

        # 디버그 정보
        debug_info = {
            "refined_query": refined_query,
            "extracted_keywords": keywords,
            "use_reranking": self.use_reranking,
            "search_method": "2-Stage (BM25 Filter → Dense)",
            "embedding_model": "KURE" if self.embedding_service.use_kure else "OpenAI",
            "total_chunks_matched": len(chunk_scores),
            "total_cases_matched": len(grouped_cases),
            "top_scores": [
                {
                    "case": c["case_number"],
                    "rerank": round(c.get("rerank_score", 0), 4) if self.use_reranking else None,
                    "final": round(c.get("final_score", 0), 4) if self.use_reranking else None,
                    "dense_score": round(c["max_score"], 4),
                    "chunks": c["chunk_count"],
                    "preview": c.get("best_chunk", "")[:100] + "...",
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
