"""
프로젝트 설정 관리
임베딩 모델, 컬렉션 설정 등을 한 곳에서 관리
"""


class EmbeddingConfig:
    """임베딩 모델 설정"""

    # ========== 판례 검색용 임베딩 모델 선택 ==========
    # "openai" 또는 "kure" 중 선택
    PRECEDENT_EMBEDDING = "openai"

    # OpenAI 모델 설정
    OPENAI_MODEL = "text-embedding-3-small"
    OPENAI_DIMENSION = 1536

    # KURE 모델 설정
    KURE_MODEL = "nlpai-lab/KURE-v1"
    KURE_DIMENSION = 1024

    # 요약용 (유사 판례 검색에 사용) - OpenAI만 사용
    SUMMARY_MODEL = "text-embedding-3-large"
    SUMMARY_DIMENSION = 3072

    # 레거시 호환성
    CHUNK_MODEL = OPENAI_MODEL
    CHUNK_DIMENSION = OPENAI_DIMENSION


class CollectionConfig:
    """Qdrant 컬렉션 설정"""

    # 컬렉션 이름
    LAWS = "laws_hybrid"
    PRECEDENTS_OPENAI = "precedents"
    PRECEDENTS_KURE = "precedents_kure"
    SUMMARIES = "precedent_summaries"

    @classmethod
    def get_precedents_collection(cls) -> str:
        """현재 설정에 맞는 판례 컬렉션 이름 반환"""
        if EmbeddingConfig.PRECEDENT_EMBEDDING == "kure":
            return cls.PRECEDENTS_KURE
        return cls.PRECEDENTS_OPENAI

    # 레거시 호환성
    PRECEDENTS = PRECEDENTS_OPENAI

    # 청크 설정
    MAX_CHUNK_SIZE = 1500
    MIN_LAST_CHUNK = 150
    OVERLAP_SIZE = 150
