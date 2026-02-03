"""
유사 판례 검색 서비스
쿼리 변환 + 하이브리드 검색 (Dense + Sparse) 기반 유사 판례 검색
"""

import os
import logging
from typing import List, Dict, Any
from dataclasses import dataclass
from qdrant_client import QdrantClient
from openai import OpenAI
from dotenv import load_dotenv

from app.services.precedent_embedding_service import PrecedentEmbeddingService
from app.prompts.query_transform_prompt import (
    QUERY_TRANSFORM_SYSTEM_PROMPT,
    QUERY_TRANSFORM_USER_PROMPT,
)

logger = logging.getLogger(__name__)

load_dotenv()


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
    """유사 판례 검색 서비스 (쿼리 변환 + 하이브리드: Dense + Sparse, RRF 기반)"""

    SUMMARIES_COLLECTION = "case_summaries"

    # RRF 파라미터 (값이 클수록 순위 간 점수 차이가 완만해짐)
    RRF_K = 60

    def __init__(self):
        # case_summaries 컬렉션은 text-embedding-3-large로 인덱싱됨
        self.embedding_service = PrecedentEmbeddingService(
            model=PrecedentEmbeddingService.MODEL_LARGE
        )
        self.qdrant_client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "localhost"),
            port=int(os.getenv("QDRANT_PORT", "6333"))
        )
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

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
            collection_name=self.SUMMARIES_COLLECTION,
            query=dense_vector,
            using="dense",
            limit=search_limit,
        )

        # Sparse 검색
        sparse_results = self.qdrant_client.query_points(
            collection_name=self.SUMMARIES_COLLECTION,
            query=sparse_vector,
            using="sparse",
            limit=search_limit,
        )

        # RRF 점수 결합
        return self._combine_rrf_scores(dense_results.points, sparse_results.points)

    # ==================== 유사 판례 검색 (메인) ====================

    def search_similar_cases(
        self,
        query: str,
        exclude_case_number: str = None,
        limit: int = 3
    ) -> Dict[str, Any]:
        """
        유사 판례 검색 (쿼리 변환 + RRF 하이브리드)

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

        # 2. 하이브리드 검색
        search_limit = (limit + 1) * 10
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
                "rrf_score": rrf_score,
                "dense_similarity": dense_similarity,
            })

        # 4. RRF 점수로 순위 결정
        similar_cases.sort(key=lambda x: x["rrf_score"], reverse=True)
        similar_cases = similar_cases[:limit]

        # 5. 최종 결과: Dense 유사도 그대로 표시
        results = [
            SimilarCaseResult(
                case_number=case["case_number"],
                case_name=case["case_name"],
                court_name=case["court_name"],
                judgment_date=case["judgment_date"],
                score=round(case["dense_similarity"], 4),
            )
            for case in similar_cases
        ]

        # 디버깅 정보
        debug_info = {
            "transformed_query": transformed_query,
            "top_raw_scores": [
                {"case": c["case_number"], "raw_dense": round(c["dense_similarity"], 4)}
                for c in similar_cases
            ]
        }
        logger.info(f"디버깅 정보: {debug_info}")

        return {
            "total": len(results),
            "results": [r.to_dict() for r in results],
            "debug": debug_info,
        }
