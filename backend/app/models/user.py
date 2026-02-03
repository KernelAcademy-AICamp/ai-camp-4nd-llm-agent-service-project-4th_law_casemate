from sqlalchemy import Column, BigInteger, String, DateTime, text
from datetime import datetime
from tool.database import Base

class User(Base):
    """사용자 모델"""
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=False, server_default=text('get_time_id()'))  # DB DEFAULT로 시간 기반 ID 생성
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    role = Column(String, nullable=True)
    firm_id = Column(BigInteger, nullable=True)  # 사무실 ID
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, name={self.name})>"
