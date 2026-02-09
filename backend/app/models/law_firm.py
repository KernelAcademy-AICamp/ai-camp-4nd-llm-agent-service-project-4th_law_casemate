from sqlalchemy import Column, BigInteger, String, DateTime, Text, text
from sqlalchemy.sql import func
from tool.database import Base

class LawFirm(Base):
    """법무법인/로펌 모델"""
    __tablename__ = "law_firms"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=False, server_default=text('get_time_id()'))  # DB DEFAULT로 시간 기반 ID 생성
    name = Column(String(200), nullable=False)
    address = Column(Text, nullable=True)
    phone = Column(String(50), nullable=True)
    business_number = Column(String(50), nullable=True)
    logo_url = Column(Text, nullable=True)
    representative_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
