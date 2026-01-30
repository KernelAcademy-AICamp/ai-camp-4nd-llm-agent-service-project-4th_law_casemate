from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from tool.database import Base


class TimeLine(Base):
    """타임라인 테이블 모델"""
    __tablename__ = "timelines"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey('cases.id', ondelete='CASCADE'), nullable=False)
    firm_id = Column(Integer, ForeignKey('law_firms.id', ondelete='SET NULL'), nullable=True)  # 소속 법무법인/사무실 ID

    # 날짜/시간 정보
    date = Column(String(20), nullable=False)  # YYYY-MM-DD 또는 "미상"
    time = Column(String(10), nullable=False)  # HH:MM

    # 이벤트 정보
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(20), nullable=False)  # 의뢰인, 상대방, 증거, 기타
    actor = Column(String(100), nullable=True)  # 관련 인물명 또는 증거명

    # 정렬 순서
    order_index = Column(Integer, nullable=True, server_default="0")

    # 메타 정보
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        """딕셔너리로 변환 (API 응답용)"""
        return {
            "id": str(self.id),
            "case_id": self.case_id,
            "firm_id": self.firm_id,
            "date": self.date,
            "time": self.time,
            "title": self.title,
            "description": self.description or "",
            "type": self.type,
            "actor": self.actor or "",
            "order_index": self.order_index
        }
