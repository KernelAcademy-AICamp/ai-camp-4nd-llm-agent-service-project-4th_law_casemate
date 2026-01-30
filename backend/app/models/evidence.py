from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint, Boolean, BigInteger, Date
from sqlalchemy.sql import func
from tool.database import Base


class Evidence(Base):
    __tablename__ = "evidences"

    id = Column(Integer, primary_key=True, index=True)
    file_name = Column(String(255), nullable=False)
    file_url = Column(Text, nullable=False)  # Signed URL (임시 접근용)
    file_path = Column(String, nullable=True)  # Storage 내부 경로 (signed URL 재생성용)
    file_type = Column(String(50), nullable=True)
    size = Column(BigInteger, nullable=True)  # 파일 크기 (바이트)
    starred = Column(Boolean, nullable=True, server_default="false")  # 중요 표시
    created_at = Column(DateTime, server_default=func.now())
    uploader_id = Column(Integer, nullable=True)
    law_firm_id = Column(Integer, ForeignKey('law_firms.id', ondelete='SET NULL'), nullable=True)  # 사무실 ID
    case_id = Column(Integer, ForeignKey('cases.id', ondelete='CASCADE'), nullable=True)  # 사건 ID
    category_id = Column(Integer, ForeignKey('evidence_categories.id', ondelete='SET NULL'), nullable=True)  # 카테고리 ID
    content = Column(Text, nullable=True)  # OCR/STT로 추출된 텍스트
    doc_type = Column(String, nullable=True)  # 문서 유형 (카카오톡, 계약서, 영수증 등)


class Case(Base):
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True)  # 레거시 호환용
    law_firm_id = Column(Integer, ForeignKey('law_firms.id', ondelete='SET NULL'), nullable=True)
    created_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    title = Column(String(255), nullable=False)
    client_name = Column(String(100), nullable=True)
    client_role = Column(String(50), nullable=True)
    case_type = Column(String(50), nullable=True)
    status = Column(String(50), server_default="접수", nullable=True)
    incident_date = Column(Date, nullable=True)
    incident_date_end = Column(Date, nullable=True)
    notification_date = Column(Date, nullable=True)
    notification_date_end = Column(Date, nullable=True)
    deadline_at = Column(Date, nullable=True)
    deadline_at_end = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CaseEvidenceMapping(Base):
    __tablename__ = "case_evidence_mappings"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, nullable=True)
    evidence_id = Column(Integer, nullable=True)
    evidence_date = Column(String(20), nullable=True)  # 증거 발생일 (이 사건에서의 관련 날짜)
    description = Column(Text, nullable=True)  # 증거 설명 (이 사건에서의 맥락)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint('case_id', 'evidence_id', name='case_evidence_mappings_case_id_evidence_id_key'),
    )


class EvidenceCategory(Base):
    __tablename__ = "evidence_categories"

    id = Column(Integer, primary_key=True, index=True)
    firm_id = Column(Integer, nullable=True)  # 회사(사무실) ID
    parent_id = Column(Integer, ForeignKey('evidence_categories.id'), nullable=True)  # 부모 카테고리
    name = Column(String(100), nullable=False)
    order_index = Column(Integer, server_default="0", nullable=True)  # 정렬 순서


class EvidenceAnalysis(Base):
    """증거 분석 결과 저장 (STT, OCR, 법적 분석 등)"""
    __tablename__ = "evidence_analyses"

    id = Column(Integer, primary_key=True, index=True)
    evidence_id = Column(Integer, nullable=True)  # 증거 ID
    summary = Column(Text, nullable=True)  # STT 결과 또는 요약
    legal_relevance = Column(Text, nullable=True)  # 법적 관련성 분석
    risk_level = Column(String(20), nullable=True)  # 위험 수준 (high, medium, low)
    ai_model = Column(String(50), nullable=True)  # 사용한 AI 모델 (예: openai-whisper)
    created_at = Column(DateTime, server_default=func.now())

class CaseSummary(Base):
    """사건 분석 결과 캐시 테이블"""
    __tablename__ = "case_summaries"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey('cases.id', ondelete='CASCADE'), unique=True, nullable=False)
    summary = Column(Text, nullable=True)  # 사건 요약
    facts = Column(Text, nullable=True)  # 사실관계
    claims = Column(Text, nullable=True)  # 청구내용
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
