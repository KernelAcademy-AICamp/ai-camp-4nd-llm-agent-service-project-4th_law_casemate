"""
판례 임베딩 서비스
Dense(OpenAI) + Sparse(BM25) 임베딩 생성
"""

import os
import logging
import threading
from typing import List, Tuple
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from qdrant_client.http import models
from fastembed import SparseTextEmbedding
from dotenv import load_dotenv

from app.config import EmbeddingConfig

logger = logging.getLogger(__name__)
load_dotenv()

# ==================== Thread-safe 싱글톤 ====================

_sparse_model = None
_openai_client = None
_sparse_lock = threading.Lock()
_openai_lock = threading.Lock()


def get_sparse_model():
    """Sparse 임베딩 모델 싱글톤 (thread-safe)"""
    global _sparse_model
    if _sparse_model is None:
        with _sparse_lock:
            if _sparse_model is None:
                logger.info("Sparse 임베딩 모델 로딩 중...")
                _sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_model


def get_openai_client():
    """OpenAI 클라이언트 싱글톤 (thread-safe)"""
    global _openai_client
    if _openai_client is None:
        with _openai_lock:
            if _openai_client is None:
                _openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _openai_client


# ==================== 캐싱된 임베딩 함수 ====================

@lru_cache(maxsize=500)
def create_dense_embedding_cached(text: str, model: str = "text-embedding-3-small") -> Tuple[float, ...]:
    """
    Dense 임베딩 생성 (캐싱됨)

    - 최대 500개 검색어 캐싱 (약 3MB)
    - lru_cache는 list를 캐싱할 수 없어서 tuple로 변환
    """
    client = get_openai_client()
    response = client.embeddings.create(
        model=model,
        input=text
    )
    return tuple(response.data[0].embedding)


# ==================== 공유 ThreadPoolExecutor ====================

_executor = None
_executor_lock = threading.Lock()


def get_executor():
    """ThreadPoolExecutor 싱글톤 (thread-safe)"""
    global _executor
    if _executor is None:
        with _executor_lock:
            if _executor is None:
                _executor = ThreadPoolExecutor(max_workers=2)
    return _executor


# ==================== 임베딩 서비스 클래스 ====================

class PrecedentEmbeddingService:
    """판례 임베딩 생성 서비스"""

    # 레거시 호환성을 위해 유지 (EmbeddingConfig 사용 권장)
    MODEL_SMALL = EmbeddingConfig.CHUNK_MODEL
    MODEL_LARGE = EmbeddingConfig.SUMMARY_MODEL

    def __init__(self, model: str = MODEL_SMALL):
        """
        Args:
            model: 사용할 OpenAI 임베딩 모델 (기본: text-embedding-3-small)
        """
        self.sparse_model = get_sparse_model()
        self.executor = get_executor()
        self.dense_model = model

    def create_dense(self, text: str) -> List[float]:
        """
        Dense 임베딩 생성

        Args:
            text: 임베딩할 텍스트

        Returns:
            임베딩 벡터 (list)
        """
        return list(create_dense_embedding_cached(text, self.dense_model))

    def create_sparse(self, text: str) -> models.SparseVector:
        """
        Sparse 임베딩 생성 (BM25)

        Args:
            text: 임베딩할 텍스트

        Returns:
            Qdrant SparseVector
        """
        sparse_emb = list(self.sparse_model.embed([text]))[0]
        return models.SparseVector(
            indices=sparse_emb.indices.tolist(),
            values=sparse_emb.values.tolist(),
        )

    def create_both_parallel(self, text: str) -> Tuple[List[float], models.SparseVector]:
        """
        Dense + Sparse 임베딩 병렬 생성

        Args:
            text: 임베딩할 텍스트

        Returns:
            (dense_vector, sparse_vector) 튜플
        """
        dense_future = self.executor.submit(self.create_dense, text)
        sparse_future = self.executor.submit(self.create_sparse, text)
        return dense_future.result(), sparse_future.result()

    # ==================== 배치 임베딩 ====================

    def create_dense_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Dense 임베딩 배치 생성 (한 번의 API 호출로 여러 텍스트)

        Args:
            texts: 임베딩할 텍스트 리스트

        Returns:
            임베딩 벡터 리스트
        """
        if not texts:
            return []

        client = get_openai_client()
        response = client.embeddings.create(
            model=self.dense_model,
            input=texts
        )
        # API 응답 순서대로 정렬
        sorted_data = sorted(response.data, key=lambda x: x.index)
        return [item.embedding for item in sorted_data]

    def create_sparse_batch(self, texts: List[str]) -> List[models.SparseVector]:
        """
        Sparse 임베딩 배치 생성

        Args:
            texts: 임베딩할 텍스트 리스트

        Returns:
            SparseVector 리스트
        """
        if not texts:
            return []

        sparse_embeddings = list(self.sparse_model.embed(texts))
        return [
            models.SparseVector(
                indices=emb.indices.tolist(),
                values=emb.values.tolist(),
            )
            for emb in sparse_embeddings
        ]

    def create_both_batch(self, texts: List[str]) -> List[Tuple[List[float], models.SparseVector]]:
        """
        Dense + Sparse 임베딩 배치 병렬 생성

        Args:
            texts: 임베딩할 텍스트 리스트

        Returns:
            [(dense_vector, sparse_vector), ...] 리스트
        """
        if not texts:
            return []

        dense_future = self.executor.submit(self.create_dense_batch, texts)
        sparse_future = self.executor.submit(self.create_sparse_batch, texts)

        dense_vectors = dense_future.result()
        sparse_vectors = sparse_future.result()

        return list(zip(dense_vectors, sparse_vectors))
