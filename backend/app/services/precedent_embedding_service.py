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

    MODEL_SMALL = "text-embedding-3-small"
    MODEL_LARGE = "text-embedding-3-large"

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
