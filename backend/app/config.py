"""
프로젝트 설정 관리
임베딩 모델, 컬렉션 설정 등을 한 곳에서 관리
"""


class EmbeddingConfig:
    """임베딩 모델 설정"""

    # 청크용 (판례 원문 청크 임베딩)
    CHUNK_MODEL = "text-embedding-3-small"
    CHUNK_DIMENSION = 1536

    # 요약용 (유사 판례 검색에 사용)
    SUMMARY_MODEL = "text-embedding-3-large"
    SUMMARY_DIMENSION = 3072


class CollectionConfig:
    """Qdrant 컬렉션 설정"""

    # 컬렉션 이름
    LAWS = "laws"
    PRECEDENTS = "precedents"
    SUMMARIES = "precedent_summaries"

    # 청크 설정
    MAX_CHUNK_SIZE = 1000
    MIN_CHUNK_SIZE = 300
    OVERLAP_SIZE = 100
