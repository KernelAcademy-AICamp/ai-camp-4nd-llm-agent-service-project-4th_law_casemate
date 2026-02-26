import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.services.timeline_service import TimeLineService
from app.models.timeline import TimeLine
from app.models.evidence import Case, Evidence
from app.models.user import User
from tool.database import SessionLocal
from tool.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/timeline", tags=["timeline"])


# DB 세션 의존성
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def format_timeline_with_evidence(timeline: TimeLine, db: Session) -> dict:
    """
    타임라인을 응답 형식으로 변환하고 증거 정보 포함

    Args:
        timeline: TimeLine 객체
        db: 데이터베이스 세션

    Returns:
        타임라인 딕셔너리 (증거 정보 포함)
    """
    tl_dict = timeline.to_dict()
    tl_dict["case_id"] = f"CASE-{tl_dict['case_id']:03d}"

    # 증거 정보 가져오기
    if timeline.evidence_id:
        evidence = db.query(Evidence).filter(Evidence.id == timeline.evidence_id).first()
        if evidence:
            tl_dict["evidence"] = {
                "id": str(evidence.id),
                "file_name": evidence.file_name,
                "file_url": evidence.file_url,
                "doc_type": evidence.doc_type,
                "content": evidence.content[:200] + "..." if evidence.content and len(evidence.content) > 200 else evidence.content
            }

    return tl_dict


class TimelineRequest(BaseModel):
    """타임라인 생성/수정 요청"""
    date: str
    time: str
    title: str
    description: Optional[str] = ""
    type: str  # 의뢰인, 상대방, 증거, 기타
    actor: Optional[str] = ""
    order_index: Optional[int] = 0
    firm_id: Optional[int] = None  # 소속 법무법인/사무실 ID
    evidence_id: Optional[int] = None  # 연관된 증거 ID


class EvidenceInfo(BaseModel):
    """증거 정보 (타임라인에 포함)"""
    id: str
    file_name: str
    file_url: str
    doc_type: Optional[str] = None
    content: Optional[str] = None


class TimelineResponse(BaseModel):
    """타임라인 응답"""
    id: str
    case_id: str
    firm_id: Optional[int] = None
    evidence_id: Optional[str] = None
    date: str
    time: str
    title: str
    description: str
    type: str
    actor: str
    order_index: int
    evidence: Optional[EvidenceInfo] = None  # 연관된 증거 정보

    class Config:
        from_attributes = True


@router.get("/{case_id}", response_model=List[TimelineResponse])
async def get_timelines(case_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    사건의 타임라인 목록 조회 (자동 생성 포함)

    Process:
    1. 타임라인이 이미 존재하면 바로 반환
    2. 타임라인이 없으면 자동 생성 후 반환

    Args:
        case_id: 사건 ID (문자열 "CASE-001" 형식 또는 숫자)
        db: 데이터베이스 세션

    Returns:
        타임라인 목록 (시간순 정렬)
    """
    try:
        # case_id 파싱
        if isinstance(case_id, str) and case_id.startswith("CASE-"):
            numeric_case_id = int(case_id.split("-")[1])
        else:
            numeric_case_id = int(case_id)

        # 소유권 검증
        case = db.query(Case).filter(Case.id == numeric_case_id).first()
        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")
        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # Step 1: 기존 타임라인 확인
        existing_timelines = db.query(TimeLine).filter(
            TimeLine.case_id == numeric_case_id
        ).order_by(
            TimeLine.date.asc(),
            TimeLine.time.asc(),
            TimeLine.order_index.asc()
        ).all()

        # Step 2: 타임라인이 이미 존재하면 바로 반환 (증거 정보 포함)
        if existing_timelines:
            result = []
            for timeline in existing_timelines:
                result.append(format_timeline_with_evidence(timeline, db))
            return result

        # Step 3: 타임라인이 없으면 자동 생성 시도 (실패 시 빈 배열 반환)
        logger.debug(f"[Timeline GET] 타임라인 없음 - 자동 생성 시도: case_id={numeric_case_id}")

        try:
            timeline_service = TimeLineService(db=db, case_id=numeric_case_id)
            generated_timelines = await timeline_service.generate_timeline_auto()

            # Step 4: 생성된 타임라인을 응답 형식으로 변환 (증거 정보 포함)
            result = []
            for timeline in generated_timelines:
                result.append(format_timeline_with_evidence(timeline, db))

            logger.info(f"[Timeline GET] 자동 생성 완료: {len(result)}개")
            return result
        except Exception as gen_error:
            # 자동 생성 실패 시 빈 배열 반환 (사용자는 수동으로 생성 버튼 클릭 가능)
            logger.debug(f"[Timeline GET] 자동 생성 실패 (빈 배열 반환): {str(gen_error)}")
            return []

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Timeline GET] 에러: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="타임라인 조회 중 오류가 발생했습니다")


@router.post("/{case_id}", response_model=TimelineResponse)
async def create_timeline(
    case_id: str,
    request: TimelineRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    타임라인 이벤트 추가

    Args:
        case_id: 사건 ID (문자열 "CASE-001" 형식)
        request: 타임라인 데이터
        db: 데이터베이스 세션

    Returns:
        생성된 타임라인
    """
    try:
        # case_id 변환
        if isinstance(case_id, str) and case_id.startswith("CASE-"):
            numeric_case_id = int(case_id.split("-")[1])
        else:
            numeric_case_id = int(case_id)

        # 소유권 검증
        case = db.query(Case).filter(Case.id == numeric_case_id).first()
        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")
        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # 새 타임라인 생성
        timeline = TimeLine(
            case_id=numeric_case_id,
            firm_id=request.firm_id,
            evidence_id=request.evidence_id,
            date=request.date,
            time=request.time,
            title=request.title,
            description=request.description,
            type=request.type,
            actor=request.actor,
            order_index=request.order_index
        )

        db.add(timeline)
        db.commit()
        db.refresh(timeline)

        return format_timeline_with_evidence(timeline, db)
    except Exception as e:
        db.rollback()
        logger.error(f"[Timeline POST] 에러: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="타임라인 생성 중 오류가 발생했습니다")


@router.put("/{timeline_id}", response_model=TimelineResponse)
async def update_timeline(
    timeline_id: int,
    request: TimelineRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    타임라인 이벤트 수정

    Args:
        timeline_id: 타임라인 ID
        request: 수정할 타임라인 데이터
        db: 데이터베이스 세션

    Returns:
        수정된 타임라인
    """
    try:
        timeline = db.query(TimeLine).filter(TimeLine.id == timeline_id).first()

        if not timeline:
            raise HTTPException(status_code=404, detail="타임라인을 찾을 수 없습니다")

        # 소유권 검증
        case = db.query(Case).filter(Case.id == timeline.case_id).first()
        if not case or case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # 업데이트
        timeline.firm_id = request.firm_id
        timeline.evidence_id = request.evidence_id
        timeline.date = request.date
        timeline.time = request.time
        timeline.title = request.title
        timeline.description = request.description
        timeline.type = request.type
        timeline.actor = request.actor
        timeline.order_index = request.order_index

        db.commit()
        db.refresh(timeline)

        return format_timeline_with_evidence(timeline, db)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"[Timeline PUT] 에러: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="타임라인 수정 중 오류가 발생했습니다")


@router.delete("/{timeline_id}")
async def delete_timeline(timeline_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    타임라인 이벤트 삭제

    Args:
        timeline_id: 타임라인 ID
        db: 데이터베이스 세션

    Returns:
        삭제 성공 메시지
    """
    try:
        timeline = db.query(TimeLine).filter(TimeLine.id == timeline_id).first()

        if not timeline:
            raise HTTPException(status_code=404, detail="타임라인을 찾을 수 없습니다")

        # 소유권 검증
        case = db.query(Case).filter(Case.id == timeline.case_id).first()
        if not case or case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        db.delete(timeline)
        db.commit()

        return {"message": "타임라인이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"[Timeline DELETE] 에러: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="타임라인 삭제 중 오류가 발생했습니다")


@router.post("/{case_id}/generate", response_model=List[TimelineResponse])
async def generate_timeline(
    case_id: str,
    force: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    타임라인 강제 재생성

    기존 타임라인을 삭제하고 새로 생성합니다.
    GET 엔드포인트는 자동 생성하므로, 이 엔드포인트는 "재생성"이 필요할 때 사용합니다.

    Args:
        case_id: 사건 ID (문자열 "CASE-001" 형식 또는 숫자)
        force: 기존 타임라인 삭제 여부 (기본값: True)
        db: 데이터베이스 세션

    Returns:
        생성된 타임라인 목록
    """
    logger.debug(f"[Timeline Generate API] 재생성 시작: case_id={case_id}, force={force}")

    try:
        # case_id 파싱
        if isinstance(case_id, str) and case_id.startswith("CASE-"):
            numeric_case_id = int(case_id.split("-")[1])
        else:
            numeric_case_id = int(case_id)

        # 소유권 검증
        case = db.query(Case).filter(Case.id == numeric_case_id).first()
        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")
        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # Step 1: 기존 타임라인 삭제 (force=True인 경우)
        if force:
            deleted_count = db.query(TimeLine).filter(
                TimeLine.case_id == numeric_case_id
            ).delete()
            db.commit()
            logger.debug(f"[Timeline Generate API] 기존 타임라인 삭제: {deleted_count}개")

        # Step 2: 새 타임라인 생성
        logger.debug("[Timeline Generate API] TimeLineService 초기화")
        timeline_service = TimeLineService(db=db, case_id=numeric_case_id)

        logger.debug("[Timeline Generate API] 타임라인 생성 실행")
        generated_timelines = await timeline_service.generate_timeline_auto()

        logger.info(f"[Timeline Generate API] 생성 완료: {len(generated_timelines)}개")

        # Step 3: 응답 형식으로 변환 (증거 정보 포함)
        result = []
        for timeline in generated_timelines:
            result.append(format_timeline_with_evidence(timeline, db))

        logger.info("[Timeline Generate API] 완료")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Timeline Generate API] 에러: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail="타임라인 생성 중 오류가 발생했습니다")
