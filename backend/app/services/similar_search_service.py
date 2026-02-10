"""
유사 판례 검색 서비스
쿼리 변환 + 하이브리드 검색 (Dense + Sparse) + 리랭킹 기반 유사 판례 검색
"""

import logging
import numpy as np
from typing import List, Dict, Any
from dataclasses import dataclass

from app.services.precedent_embedding_service import PrecedentEmbeddingService, get_openai_client
from tool.qdrant_client import get_qdrant_client
from app.prompts.query_transform_prompt import (
    QUERY_TRANSFORM_SYSTEM_PROMPT,
    QUERY_TRANSFORM_USER_PROMPT,
)

logger = logging.getLogger(__name__)

# 리랭커 모델 (Lazy Loading - 최초 사용 시 로드)
_reranker_model = None


def get_reranker_model():
    """리랭커 모델 싱글톤 로드"""
    global _reranker_model
    if _reranker_model is None:
        from sentence_transformers import CrossEncoder
        logger.info("리랭커 모델 로딩 중... (BAAI/bge-reranker-v2-m3)")
        _reranker_model = CrossEncoder("BAAI/bge-reranker-v2-m3", max_length=512)
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

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_number": self.case_number,
            "case_name": self.case_name,
            "court_name": self.court_name,
            "judgment_date": self.judgment_date,
            "score": self.score,
        }


class SimilarSearchService:
    """유사 판례 검색 서비스 (쿼리 변환 + 하이브리드: Dense + Sparse, RRF + 리랭킹)"""

    FACTS_COLLECTION = "precedent_facts"

    # RRF 파라미터 (값이 클수록 순위 간 점수 차이가 완만해짐)
    # A/B 테스트 결과 80이 최적 (Dense+Sparse 균형 반영)
    RRF_K = 80

    # 리랭킹 설정
    RERANK_CANDIDATES = 20  # 리랭킹할 후보 수

    def __init__(self, use_reranking: bool = True):
        # precedent_facts 컬렉션은 text-embedding-3-small로 인덱싱됨
        self.embedding_service = PrecedentEmbeddingService(
            model=PrecedentEmbeddingService.MODEL_SMALL
        )
        self.qdrant_client = get_qdrant_client()  # 싱글톤 사용
        self.openai_client = get_openai_client()  # 싱글톤 사용
        self.use_reranking = use_reranking

    # ==================== 쿼리 변환 ====================

    def _transform_query(self, user_query: str) -> str:
        """
        GPT를 사용해 사용자 쿼리를 검색에 최적화된 쿼리로 변환

        - 고유명사 제거 (인명 → 피고인/피해자)
        - 법률 용어로 변환
        - 100자 이내로 축소
        """
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": QUERY_TRANSFORM_SYSTEM_PROMPT},
                    {"role": "user", "content": QUERY_TRANSFORM_USER_PROMPT.format(user_query=user_query)}
                ],
                temperature=0.3,
                max_tokens=200,
            )

            transformed = response.choices[0].message.content.strip()
            logger.info(f"쿼리 변환 완료: {transformed[:100]}...")
            return transformed

        except Exception as e:
            logger.error(f"쿼리 변환 실패: {e}, 원본 쿼리 사용")
            return user_query

    # ==================== RRF 점수 결합 ====================

    def _combine_rrf_scores(
        self,
        dense_points: List,
        sparse_points: List,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Dense와 Sparse 검색 결과를 RRF(Reciprocal Rank Fusion)로 결합

        - 순위 기반으로 결합하여 최종 순위 결정
        - 표시용 점수는 Dense 유사도 사용 (실제 의미 있는 값)
        """
        combined = {}

        # Dense 결과: RRF 점수 + 실제 유사도 저장
        for rank, point in enumerate(dense_points, start=1):
            point_id = str(point.id)
            rrf_score = 1.0 / (self.RRF_K + rank)
            combined[point_id] = {
                "rrf_score": rrf_score,
                "dense_similarity": point.score,
                "payload": point.payload,
            }

        # Sparse 결과: RRF 점수 합산
        for rank, point in enumerate(sparse_points, start=1):
            point_id = str(point.id)
            rrf_score = 1.0 / (self.RRF_K + rank)
            if point_id in combined:
                combined[point_id]["rrf_score"] += rrf_score
            else:
                combined[point_id] = {
                    "rrf_score": rrf_score,
                    "dense_similarity": 0,
                    "payload": point.payload,
                }

        return combined

    # ==================== 하이브리드 검색 ====================

    def _fill_missing_dense_scores(
        self,
        combined: Dict[str, Dict[str, Any]],
        query_dense_vector: List[float]
    ) -> None:
        """
        Sparse 전용 결과에 대해 Dense 유사도 계산

        Sparse 검색에서만 발견된 결과는 dense_similarity가 0으로 설정되어 있음.
        해당 포인트들의 dense 벡터를 가져와 쿼리와의 코사인 유사도를 계산.
        """
        # dense_similarity가 0인 포인트들 찾기
        missing_ids = [
            point_id for point_id, data in combined.items()
            if data["dense_similarity"] == 0
        ]

        if not missing_ids:
            return

        # 해당 포인트들의 dense 벡터 가져오기
        points = self.qdrant_client.retrieve(
            collection_name=self.FACTS_COLLECTION,
            ids=missing_ids,
            with_vectors=["dense"]
        )

        # 코사인 유사도 계산
        query_vec = np.array(query_dense_vector)
        query_norm = np.linalg.norm(query_vec)

        for point in points:
            point_id = str(point.id)
            if point.vector and "dense" in point.vector:
                doc_vec = np.array(point.vector["dense"])
                doc_norm = np.linalg.norm(doc_vec)
                similarity = float(np.dot(query_vec, doc_vec) / (query_norm * doc_norm))
                combined[point_id]["dense_similarity"] = similarity

        logger.info(f"Sparse 전용 결과 {len(missing_ids)}개에 Dense 유사도 계산 완료")

    def _search_hybrid(self, query: str, search_limit: int) -> Dict[str, Dict[str, Any]]:
        """
        단일 쿼리로 하이브리드 검색 수행 (Dense + Sparse)

        Returns:
            {point_id: {"rrf_score": float, "dense_similarity": float, "payload": dict}}
        """
        # Dense + Sparse 임베딩 생성
        dense_vector, sparse_vector = self.embedding_service.create_both_parallel(query)

        # Dense 검색
        dense_results = self.qdrant_client.query_points(
            collection_name=self.FACTS_COLLECTION,
            query=dense_vector,
            using="dense",
            limit=search_limit,
        )

        # Sparse 검색
        sparse_results = self.qdrant_client.query_points(
            collection_name=self.FACTS_COLLECTION,
            query=sparse_vector,
            using="sparse",
            limit=search_limit,
        )

        # RRF 점수 결합
        combined = self._combine_rrf_scores(dense_results.points, sparse_results.points)

        # Sparse 전용 결과에 Dense 유사도 채우기
        self._fill_missing_dense_scores(combined, dense_vector)

        return combined

    # ==================== 리랭킹 ====================

    def _rerank(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        top_k: int
    ) -> List[Dict[str, Any]]:
        """
        Cross-encoder를 사용한 리랭킹

        Args:
            query: 검색 쿼리
            candidates: RRF로 정렬된 후보 리스트
            top_k: 반환할 상위 K개

        Returns:
            리랭킹된 상위 K개 결과
        """
        if not candidates:
            return []

        reranker = get_reranker_model()

        # (쿼리, 문서) 쌍 생성 - fact_text를 문서로 사용
        pairs = []
        for c in candidates:
            fact_text = c.get("fact_text", "")[:500]  # 최대 500자
            pairs.append((query[:500], fact_text))

        # Cross-encoder로 점수 계산
        scores = reranker.predict(pairs)

        # 점수와 함께 정렬
        scored_candidates = list(zip(candidates, scores))
        scored_candidates.sort(key=lambda x: x[1], reverse=True)

        # 리랭크 점수 추가하여 반환
        reranked = []
        for candidate, rerank_score in scored_candidates[:top_k]:
            candidate["rerank_score"] = float(rerank_score)
            reranked.append(candidate)

        return reranked

    # ==================== 유사 판례 검색 (메인) ====================

    def search_similar_cases(
        self,
        query: str,
        exclude_case_number: str = None,
        limit: int = 3
    ) -> Dict[str, Any]:
        """
        유사 판례 검색 (쿼리 변환 + RRF 하이브리드 + 리랭킹)

        Args:
            query: 검색 쿼리 (사건 요약 + 사실관계 + 청구내용)
            exclude_case_number: 제외할 판례 사건번호
            limit: 반환할 유사 판례 수 (기본 3개)

        Returns:
            유사 판례 목록
        """
        if not query or len(query.strip()) < 10:
            return {"total": 0, "results": []}

        # 1. 쿼리 변환 (GPT)
        transformed_query = self._transform_query(query)

        # 2. 하이브리드 검색 (리랭킹 시 더 많은 후보 추출)
        search_limit = self.RERANK_CANDIDATES * 2 if self.use_reranking else (limit + 1) * 10
        search_results = self._search_hybrid(transformed_query, search_limit)

        # 3. 결과 처리 (자기 자신 제외)
        similar_cases = []

        for point_id, data in search_results.items():
            payload = data["payload"]
            rrf_score = data["rrf_score"]
            dense_similarity = data["dense_similarity"]
            case_num = payload.get("case_number", "")

            # 현재 판례 제외
            if exclude_case_number and case_num == exclude_case_number:
                continue

            similar_cases.append({
                "case_number": case_num,
                "case_name": payload.get("case_name", ""),
                "court_name": payload.get("court_name", ""),
                "judgment_date": payload.get("judgment_date", ""),
                "fact_text": payload.get("fact_text", ""),  # 리랭킹용
                "rrf_score": rrf_score,
                "dense_similarity": dense_similarity,
            })

        # 4. RRF 점수로 1차 정렬
        similar_cases.sort(key=lambda x: x["rrf_score"], reverse=True)

        # 5. 리랭킹 적용 (옵션)
        if self.use_reranking and len(similar_cases) > 0:
            # 상위 N개 후보를 리랭킹
            top_candidates = similar_cases[:self.RERANK_CANDIDATES]
            similar_cases = self._rerank(transformed_query, top_candidates, limit)
            logger.info(f"리랭킹 적용: {self.RERANK_CANDIDATES}개 후보 → {limit}개 선정")
        else:
            similar_cases = similar_cases[:limit]

        # 6. 최종 결과
        results = [
            SimilarCaseResult(
                case_number=case["case_number"],
                case_name=case["case_name"],
                court_name=case["court_name"],
                judgment_date=case["judgment_date"],
                score=round(case["dense_similarity"], 4),  # 항상 Dense 유사도 표시 (정렬은 리랭킹 순서 유지)
            )
            for case in similar_cases
        ]

        # 디버깅 정보
        debug_info = {
            "transformed_query": transformed_query,
            "use_reranking": self.use_reranking,
            "top_scores": [
                {
                    "case": c["case_number"],
                    "dense": round(c["dense_similarity"], 4),
                    "rerank": round(c.get("rerank_score", 0), 4) if self.use_reranking else None,
                }
                for c in similar_cases
            ]
        }
        logger.info(f"디버깅 정보: {debug_info}")

        return {
            "total": len(results),
            "results": [r.to_dict() for r in results],
            "debug": debug_info,
        }
