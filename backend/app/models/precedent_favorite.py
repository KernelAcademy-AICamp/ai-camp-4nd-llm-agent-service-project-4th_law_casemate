from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey
from datetime import datetime
from tool.database import Base


class PrecedentFavorite(Base):
    """
    판례 즐겨찾기 모델

    사용자가 즐겨찾기한 판례 정보를 저장합니다.
    판례 상세 정보(case_name, court_name 등)는 Qdrant에서 조회합니다.
    """
    __tablename__ = "precedent_favorites"

    # 즐겨찾기 고유 ID (자동 증가)
    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)

    # 사용자 ID (users 테이블 외래키, 사용자 삭제 시 즐겨찾기도 삭제)
    user_id = Column(BigInteger, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)

    # 판례 사건번호 (예: "2024다12345") - Qdrant에서 판례 조회용 키
    case_number = Column(String(50), nullable=False, index=True)

    # 즐겨찾기 추가 일시
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<PrecedentFavorite(id={self.id}, user_id={self.user_id}, case_number={self.case_number})>"
