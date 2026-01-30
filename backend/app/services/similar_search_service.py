"""
유사 판례 검색 서비스
하이브리드 검색 (Dense + Sparse) 기반 유사 판례 검색
"""

import os
import logging
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models
from fastembed import SparseTextEmbedding
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

# Sparse 임베딩 모델 (싱글톤)
_sparse_model = None


def get_sparse_model():
    global _sparse_model
    if _sparse_model is None:
        logger.info("Sparse 임베딩 모델 로딩 중...")
        _sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_model


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
    """유사 판례 검색 서비스 (요약 기반 하이브리드: Dense + Sparse, RRF 기반)"""

    SUMMARIES_COLLECTION = "case_summaries"

    # RRF 파라미터 (값이 클수록 순위 간 점수 차이가 완만해짐)
    RRF_K = 60

    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "localhost"),
            port=int(os.getenv("QDRANT_PORT", "6333"))
        )
        self.sparse_model = get_sparse_model()

    # ==================== 임베딩 생성 ====================

    def _create_dense_embedding(self, text: str) -> List[float]:
        """Dense 임베딩 생성 (OpenAI text-embedding-3-large)"""
        response = self.openai_client.embeddings.create(
            model="text-embedding-3-large",
            input=text
        )
        return response.data[0].embedding

    def _create_sparse_embedding(self, text: str) -> models.SparseVector:
        """Sparse 임베딩 생성 (BM25)"""
        sparse_emb = list(self.sparse_model.embed([text]))[0]
        return models.SparseVector(
            indices=sparse_emb.indices.tolist(),
            values=sparse_emb.values.tolist(),
        )

    def _create_embeddings_parallel(self, text: str) -> Tuple[List[float], models.SparseVector]:
        """Dense와 Sparse 임베딩을 병렬로 생성"""
        with ThreadPoolExecutor(max_workers=2) as executor:
            dense_future = executor.submit(self._create_dense_embedding, text)
            sparse_future = executor.submit(self._create_sparse_embedding, text)

            dense_vector = dense_future.result()
            sparse_vector = sparse_future.result()

        return dense_vector, sparse_vector

    # ==================== RRF 점수 결합 ====================

    def _combine_rrf_scores(
        self,
        dense_points: List,
        sparse_points: List,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Dense와 Sparse 검색 결과를 RRF(Reciprocal Rank Fusion)로 결합

        - 점수가 아닌 순위만 사용하여 결합
        - 양쪽 검색에서 모두 상위권인 문서가 높은 점수를 받음
        - score = 1/(k + rank_dense) + 1/(k + rank_sparse)
        """
        combined = {}

        # Dense 결과: 순위 기반 RRF 점수
        for rank, point in enumerate(dense_points, start=1):
            point_id = str(point.id)
            rrf_score = 1.0 / (self.RRF_K + rank)
            combined[point_id] = {
                "score": rrf_score,
                "payload": point.payload,
            }

        # Sparse 결과: RRF 점수 합산
        for rank, point in enumerate(sparse_points, start=1):
            point_id = str(point.id)
            rrf_score = 1.0 / (self.RRF_K + rank)
            if point_id in combined:
                combined[point_id]["score"] += rrf_score
            else:
                combined[point_id] = {
                    "score": rrf_score,
                    "payload": point.payload,
                }

        return combined

    # ==================== 유사 판례 검색 ====================

    def search_similar_cases(
        self,
        query: str,
        exclude_case_number: str = None,
        limit: int = 3
    ) -> Dict[str, Any]:
        """
        유사 판례 검색 (요약 컬렉션 대상, RRF 하이브리드)

        Args:
            query: 검색 쿼리 (사건 요약 + 사실관계 + 청구내용)
            exclude_case_number: 제외할 판례 사건번호
            limit: 반환할 유사 판례 수 (기본 3개)

        Returns:
            유사 판례 목록
        """
        if not query or len(query.strip()) < 10:
            return {"total": 0, "results": []}

        # Dense + Sparse 임베딩 병렬 생성
        dense_vector, sparse_vector = self._create_embeddings_parallel(query)

        # 요약 컬렉션 대상 하이브리드 검색 (1건 = 1판례, 청크 없음)
        search_limit = (limit + 1) * 10

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
        combined_scores = self._combine_rrf_scores(
            dense_results.points,
            sparse_results.points,
        )

        # 결과 처리 (자기 자신 제외)
        similar_cases = []

        for point_id, data in combined_scores.items():
            payload = data["payload"]
            score = data["score"]
            case_num = payload.get("case_number", "")

            # 현재 판례 제외
            if exclude_case_number and case_num == exclude_case_number:
                continue

            similar_cases.append(SimilarCaseResult(
                case_number=case_num,
                case_name=payload.get("case_name", ""),
                court_name=payload.get("court_name", ""),
                judgment_date=payload.get("judgment_date", ""),
                score=score,
            ))

        # 점수순 정렬 후 limit 적용
        similar_cases.sort(key=lambda x: x.score, reverse=True)
        similar_cases = similar_cases[:limit]

        # RRF 점수를 0~1 스케일로 변환 (표시용)
        # 이론상 최대: 양쪽 모두 1등 = 2/(k+1)
        max_rrf_score = 2.0 / (self.RRF_K + 1)
        for case in similar_cases:
            case.score = min(case.score / max_rrf_score, 1.0)

        return {
            "total": len(similar_cases),
            "results": [r.to_dict() for r in similar_cases]
        }
