"""
판례 임베딩 서비스
Dense(OpenAI/KURE) + Sparse(BM25) 임베딩 생성
설정에 따라 OpenAI, KURE 로컬, KURE HF API 사용
"""

import os
import logging
import threading
import time
from typing import List, Tuple
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from qdrant_client.http import models
from fastembed import SparseTextEmbedding
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

from app.config import EmbeddingConfig

logger = logging.getLogger(__name__)
load_dotenv()

# HF InferenceClient 설정
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")
_hf_client = None
_hf_client_lock = threading.Lock()


def get_hf_client():
    """HuggingFace InferenceClient 싱글톤 (thread-safe)"""
    global _hf_client
    if _hf_client is None:
        with _hf_client_lock:
            if _hf_client is None:
                _hf_client = InferenceClient(
                    provider="hf-inference",
                    token=HF_API_TOKEN if HF_API_TOKEN else None
                )
                logger.info("HuggingFace InferenceClient 초기화 완료")
    return _hf_client

# ==================== Thread-safe 싱글톤 ====================

_sparse_model = None
_openai_client = None
_kure_model = None
_sparse_lock = threading.Lock()
_openai_lock = threading.Lock()
_kure_lock = threading.Lock()


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


def get_kure_model():
    """KURE 임베딩 모델 싱글톤 (thread-safe)"""
    global _kure_model
    if _kure_model is None:
        with _kure_lock:
            if _kure_model is None:
                from sentence_transformers import SentenceTransformer
                logger.info(f"KURE 임베딩 모델 로딩 중... ({EmbeddingConfig.KURE_MODEL})")
                _kure_model = SentenceTransformer(EmbeddingConfig.KURE_MODEL)
                logger.info("KURE 임베딩 모델 로드 완료")
    return _kure_model


# ==================== 캐싱된 임베딩 함수 ====================

@lru_cache(maxsize=500)
def create_openai_embedding_cached(text: str, model: str = "text-embedding-3-small") -> Tuple[float, ...]:
    """OpenAI Dense 임베딩 생성 (캐싱됨)"""
    client = get_openai_client()
    response = client.embeddings.create(
        model=model,
        input=text
    )
    return tuple(response.data[0].embedding)


@lru_cache(maxsize=500)
def create_kure_local_embedding_cached(text: str) -> Tuple[float, ...]:
    """KURE Dense 임베딩 생성 - 로컬 모델 (캐싱됨)"""
    model = get_kure_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return tuple(embedding.tolist())


@lru_cache(maxsize=500)
def create_kure_api_embedding_cached(text: str) -> Tuple[float, ...]:
    """KURE Dense 임베딩 생성 - HF InferenceClient (캐싱됨)"""
    max_retries = 3
    retry_delay = 2

    for attempt in range(max_retries):
        try:
            client = get_hf_client()
            embedding = client.feature_extraction(
                text,
                model=EmbeddingConfig.KURE_MODEL
            )
            # 결과가 리스트 형태로 반환됨
            if hasattr(embedding, 'tolist'):
                return tuple(embedding.tolist())
            elif isinstance(embedding, list):
                # [[...]] 또는 [...] 형태
                if len(embedding) > 0 and isinstance(embedding[0], list):
                    return tuple(embedding[0])
                return tuple(embedding)
            return tuple(embedding)

        except Exception as e:
            error_msg = str(e)
            if "503" in error_msg or "loading" in error_msg.lower():
                logger.warning(f"HF API 모델 로딩 중... (시도 {attempt + 1}/{max_retries})")
                time.sleep(retry_delay * (attempt + 1))
                continue
            elif attempt < max_retries - 1:
                logger.warning(f"HF API 에러 (시도 {attempt + 1}/{max_retries}): {e}")
                time.sleep(retry_delay)
                continue
            raise ValueError(f"HF API 호출 실패: {e}")

    raise ValueError("HF API 호출 실패: 최대 재시도 횟수 초과")


def warmup_hf_api():
    """HF API 워밍업 (슬립 방지)"""
    try:
        client = get_hf_client()
        client.feature_extraction("ping", model=EmbeddingConfig.KURE_MODEL)
        logger.info("HF API 워밍업 성공")
        return True
    except Exception as e:
        logger.warning(f"HF API 워밍업 실패: {e}")
        return False


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
    """
    판례 임베딩 생성 서비스
    EmbeddingConfig.PRECEDENT_EMBEDDING 설정에 따라:
    - "openai": OpenAI API
    - "kure_local": KURE 로컬 모델
    - "kure_api": KURE HF API (메모리 절약)
    """

    # 레거시 호환성을 위해 유지 (EmbeddingConfig 사용 권장)
    MODEL_SMALL = EmbeddingConfig.CHUNK_MODEL
    MODEL_LARGE = EmbeddingConfig.SUMMARY_MODEL

    def __init__(self, model: str = None):
        """
        Args:
            model: OpenAI 모델명 (KURE 사용 시 무시됨)
        """
        self.sparse_model = get_sparse_model()
        self.executor = get_executor()
        self.embedding_mode = EmbeddingConfig.PRECEDENT_EMBEDDING
        self.openai_model = model or EmbeddingConfig.OPENAI_MODEL

        # 로깅
        if self.embedding_mode == "kure_api":
            logger.info("임베딩 모델: KURE (HF API)")
        elif self.embedding_mode == "kure_local":
            logger.info("임베딩 모델: KURE (로컬)")
        else:
            logger.info(f"임베딩 모델: OpenAI ({self.openai_model})")

    def create_dense(self, text: str) -> List[float]:
        """
        Dense 임베딩 생성 (설정에 따라 OpenAI, KURE 로컬, KURE API 사용)

        Args:
            text: 임베딩할 텍스트

        Returns:
            임베딩 벡터 (list)
        """
        if self.embedding_mode == "kure_api":
            return list(create_kure_api_embedding_cached(text))
        elif self.embedding_mode == "kure_local":
            return list(create_kure_local_embedding_cached(text))
        return list(create_openai_embedding_cached(text, self.openai_model))

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
        Dense 임베딩 배치 생성

        Args:
            texts: 임베딩할 텍스트 리스트

        Returns:
            임베딩 벡터 리스트
        """
        if not texts:
            return []

        if self.embedding_mode == "kure_api":
            # KURE HF API 배치 (개별 호출)
            return [list(create_kure_api_embedding_cached(t)) for t in texts]
        elif self.embedding_mode == "kure_local":
            # KURE 로컬 배치 임베딩
            model = get_kure_model()
            embeddings = model.encode(texts, normalize_embeddings=True)
            return [emb.tolist() for emb in embeddings]
        else:
            # OpenAI 배치 임베딩
            client = get_openai_client()
            response = client.embeddings.create(
                model=self.openai_model,
                input=texts
            )
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
