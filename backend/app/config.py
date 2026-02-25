"""
프로젝트 설정 관리
임베딩 모델, 컬렉션 설정 등을 한 곳에서 관리
"""

import os


class AgentConfig:
    """홈 에이전트 LLM 설정 — 환경변수로 모델 교체 가능"""
    ROUTER_MODEL = os.getenv("AGENT_ROUTER_MODEL", "gpt-4o-mini")
    AGENT_MODEL = os.getenv("AGENT_TOOL_MODEL", "gpt-4o-mini")
    GENERATOR_MODEL = os.getenv("AGENT_GENERATOR_MODEL", "gpt-4o")


class EmbeddingConfig:
    """임베딩 모델 설정"""

    # ========== 판례 검색용 임베딩 모델 선택 ==========
    # "openai", "kure_local", "kure_api" 중 선택
    PRECEDENT_EMBEDDING = "kure_api"

    # OpenAI 모델 설정
    OPENAI_MODEL = "text-embedding-3-small"
    OPENAI_DIMENSION = 1536

    # KURE 모델 설정 (로컬 & API 공용)
    KURE_MODEL = "nlpai-lab/KURE-v1"
    KURE_DIMENSION = 1024
    KURE_HF_API_URL = "https://router.huggingface.co/hf-inference/pipeline/feature-extraction/nlpai-lab/KURE-v1"

    # 워밍업 핑 간격 (분)
    WARMUP_INTERVAL_MINUTES = 10

    # 요약용 (유사 판례 검색에 사용) - OpenAI만 사용
    SUMMARY_MODEL = "text-embedding-3-large"
    SUMMARY_DIMENSION = 3072

    # 레거시 호환성
    CHUNK_MODEL = OPENAI_MODEL
    CHUNK_DIMENSION = OPENAI_DIMENSION


class QuantizationConfig:
    """양자화 검색 설정"""
    ENABLED = True  # 양자화 컬렉션 사용 여부
    RESCORE = True  # 원본 벡터로 재계산
    OVERSAMPLING = 20.0  # 후보 배수 (limit × 20 = 100개 후보)


class CollectionConfig:
    """Qdrant 컬렉션 설정"""

    # 컬렉션 이름
    LAWS = "laws_hybrid"
    PRECEDENTS_OPENAI = "precedents"
    PRECEDENTS_KURE = "precedents_kure_q"  # 양자화 버전
    SUMMARIES = "precedent_summaries"

    @classmethod
    def get_precedents_collection(cls) -> str:
        """현재 설정에 맞는 판례 컬렉션 이름 반환"""
        if EmbeddingConfig.PRECEDENT_EMBEDDING in ("kure_local", "kure_api"):
            return cls.PRECEDENTS_KURE
        return cls.PRECEDENTS_OPENAI

    # 레거시 호환성
    PRECEDENTS = PRECEDENTS_OPENAI

    # 청크 설정
    MAX_CHUNK_SIZE = 1500
    MIN_LAST_CHUNK = 150
    OVERLAP_SIZE = 150
