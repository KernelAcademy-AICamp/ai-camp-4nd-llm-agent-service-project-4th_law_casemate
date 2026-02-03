"""
관계도 관련 데이터베이스 모델
"""
from sqlalchemy import Column, BigInteger, String, Text, Integer, Boolean, DateTime, ForeignKey, text
from sqlalchemy.sql import func
from tool.database import Base


class CasePerson(Base):
    """사건 관련 인물 테이블 모델"""
    __tablename__ = "case_persons"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=False, server_default=text('get_time_id()'))
    case_id = Column(BigInteger, ForeignKey('cases.id', ondelete='CASCADE'), nullable=False, index=True)
    firm_id = Column(BigInteger, ForeignKey('law_firms.id', ondelete='SET NULL'), nullable=True)

    # 인물 정보
    name = Column(String(100), nullable=False)              # 이름 (예: "김OO", "박OO")
    role = Column(String(50), nullable=False)               # 역할 (예: "피해자", "가해자", "증인")
    description = Column(Text, nullable=True)               # 인물 설명

    # UI 위치 정보 (프론트엔드에서 저장)
    position_x = Column(Integer, default=0)
    position_y = Column(Integer, default=0)

    # 타임스탬프
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        """딕셔너리로 변환 (API 응답용)"""
        return {
            "id": str(self.id),
            "case_id": self.case_id,
            "firm_id": self.firm_id,
            "name": self.name,
            "role": self.role,
            "description": self.description or "",
            "position_x": self.position_x,
            "position_y": self.position_y
        }


class CaseRelationship(Base):
    """인물 간 관계 테이블 모델"""
    __tablename__ = "case_relationships"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=False, server_default=text('get_time_id()'))
    case_id = Column(BigInteger, ForeignKey('cases.id', ondelete='CASCADE'), nullable=False, index=True)
    firm_id = Column(BigInteger, ForeignKey('law_firms.id', ondelete='SET NULL'), nullable=True)

    # 관계 연결
    source_person_id = Column(BigInteger, ForeignKey('case_persons.id', ondelete='CASCADE'), nullable=False, index=True)
    target_person_id = Column(BigInteger, ForeignKey('case_persons.id', ondelete='CASCADE'), nullable=False, index=True)

    # 관계 정보
    relationship_type = Column(String(50), nullable=False)  # 관계 유형 (예: "명예훼손", "목격", "동료")
    label = Column(String(100), nullable=True)              # 관계 라벨
    memo = Column(Text, nullable=True)                      # 관계 메모
    is_directed = Column(Boolean, default=True)             # 방향성 여부

    # 타임스탬프
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        """딕셔너리로 변환 (API 응답용)"""
        return {
            "id": str(self.id),
            "case_id": self.case_id,
            "firm_id": self.firm_id,
            "source_person_id": str(self.source_person_id),
            "target_person_id": str(self.target_person_id),
            "relationship_type": self.relationship_type,
            "label": self.label or "",
            "memo": self.memo or "",
            "is_directed": self.is_directed
        }
