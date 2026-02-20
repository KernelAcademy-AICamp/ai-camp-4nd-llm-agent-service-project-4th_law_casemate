"""
판례 원문 모델

Qdrant에서 이전한 판례 메타데이터 + 전문을 저장합니다.
- Qdrant: 벡터 검색용 (임베딩 + 최소 메타데이터)
- PostgreSQL: 원문 조회용 (메타데이터 + 전문)
"""

from sqlalchemy import Column, BigInteger, String, Text, DateTime, Index
from datetime import datetime
from tool.database import Base


class Precedent(Base):
    """
    판례 원문 테이블

    Qdrant 검색 후 case_number로 조인하여 메타데이터/전문 조회
    """
    __tablename__ = "precedents"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)

    # 사건번호 (Qdrant 조인 키)
    case_number = Column(String(50), unique=True, nullable=False, index=True)

    # 메타데이터
    case_name = Column(Text, nullable=True)  # 사건명
    court_name = Column(String(100), nullable=True)  # 법원명
    case_type = Column(String(50), nullable=True)  # 사건 종류 (민사, 형사 등)
    judgment_date = Column(String(20), nullable=True)  # 선고일자

    # 전문 (청크 재조립된 전체 텍스트)
    full_content = Column(Text, nullable=True)

    # 타임스탬프
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 복합 인덱스 (필터링 성능)
    __table_args__ = (
        Index('idx_precedents_court_date', 'court_name', 'judgment_date'),
    )

    def __repr__(self):
        return f"<Precedent(case_number={self.case_number}, case_name={self.case_name[:30] if self.case_name else None})>"


class PrecedentSummary(Base):
    """
    판례 요약 테이블

    기존 Qdrant summaries 컬렉션 대체
    """
    __tablename__ = "precedent_summaries"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)

    # 사건번호 (precedents 테이블 참조)
    case_number = Column(String(50), unique=True, nullable=False, index=True)

    # 요약 정보
    summary = Column(Text, nullable=True)
    prompt_version = Column(String(20), nullable=True)

    # 타임스탬프
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<PrecedentSummary(case_number={self.case_number}, prompt_version={self.prompt_version})>"
