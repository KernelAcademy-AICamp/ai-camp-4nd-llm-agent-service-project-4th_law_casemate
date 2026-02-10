from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, Integer, text
from sqlalchemy.sql import func
from tool.database import Base


class CaseDocument(Base):
    """사건 관련 법률 문서 (고소장, 소장, 내용증명 등)"""
    __tablename__ = "case_documents"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=False, server_default=text('get_time_id()'))
    case_id = Column(BigInteger, ForeignKey('cases.id', ondelete='CASCADE'), nullable=False)
    law_firm_id = Column(BigInteger, ForeignKey('law_firms.id', ondelete='SET NULL'), nullable=True)
    created_by = Column(BigInteger, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    title = Column(String(255), nullable=False)
    document_type = Column(String(50), default="complaint")  # complaint, civil_suit, notice, brief, opinion, settlement
    content = Column(Text, nullable=True)  # Markdown 형식
    version = Column(Integer, default=1)
    parent_id = Column(BigInteger, ForeignKey('case_documents.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
