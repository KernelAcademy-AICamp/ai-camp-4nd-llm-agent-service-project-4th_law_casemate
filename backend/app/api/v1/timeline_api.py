from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.services.timeline_service import TimeLineService
from app.models.timeline import TimeLine
from tool.database import SessionLocal

router = APIRouter(prefix="/timeline", tags=["timeline"])


# DB 세션 의존성
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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


class TimelineResponse(BaseModel):
    """타임라인 응답"""
    id: str
    case_id: str
    firm_id: Optional[int] = None
    date: str
    time: str
    title: str
    description: str
    type: str
    actor: str
    order_index: int

    class Config:
        from_attributes = True


@router.get("/{case_id}", response_model=List[TimelineResponse])
async def get_timelines(case_id: str, db: Session = Depends(get_db)):
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

        # Step 1: 기존 타임라인 확인
        existing_timelines = db.query(TimeLine).filter(
            TimeLine.case_id == numeric_case_id
        ).order_by(
            TimeLine.date.asc(),
            TimeLine.time.asc(),
            TimeLine.order_index.asc()
        ).all()

        # Step 2: 타임라인이 이미 존재하면 바로 반환
        if existing_timelines:
            result = []
            for timeline in existing_timelines:
                tl_dict = timeline.to_dict()
                tl_dict["case_id"] = f"CASE-{tl_dict['case_id']:03d}"
                result.append(tl_dict)
            return result

        # Step 3: 타임라인이 없으면 자동 생성
        print(f"[Timeline GET] 타임라인 없음 - 자동 생성 시작: case_id={numeric_case_id}")

        timeline_service = TimeLineService(db=db, case_id=numeric_case_id)
        generated_timelines = await timeline_service.generate_timeline_auto()

        # Step 4: 생성된 타임라인을 응답 형식으로 변환
        result = []
        for timeline in generated_timelines:
            tl_dict = timeline.to_dict()
            tl_dict["case_id"] = f"CASE-{tl_dict['case_id']:03d}"
            result.append(tl_dict)

        print(f"[Timeline GET] 자동 생성 완료: {len(result)}개")
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Timeline GET] 에러: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{case_id}", response_model=TimelineResponse)
async def create_timeline(
    case_id: str,
    request: TimelineRequest,
    db: Session = Depends(get_db)
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

        # 새 타임라인 생성
        timeline = TimeLine(
            case_id=numeric_case_id,
            firm_id=request.firm_id,
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

        result = timeline.to_dict()
        result["case_id"] = f"CASE-{result['case_id']:03d}"
        return result
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{timeline_id}", response_model=TimelineResponse)
async def update_timeline(
    timeline_id: int,
    request: TimelineRequest,
    db: Session = Depends(get_db)
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

        # 업데이트
        timeline.firm_id = request.firm_id
        timeline.date = request.date
        timeline.time = request.time
        timeline.title = request.title
        timeline.description = request.description
        timeline.type = request.type
        timeline.actor = request.actor
        timeline.order_index = request.order_index

        db.commit()
        db.refresh(timeline)

        result = timeline.to_dict()
        result["case_id"] = f"CASE-{result['case_id']:03d}"
        return result
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{timeline_id}")
async def delete_timeline(timeline_id: int, db: Session = Depends(get_db)):
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

        db.delete(timeline)
        db.commit()

        return {"message": "타임라인이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{case_id}/generate", response_model=List[TimelineResponse])
async def generate_timeline(
    case_id: str,
    force: bool = True,
    db: Session = Depends(get_db)
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
    print(f"\n[Timeline Generate API] 재생성 시작: case_id={case_id}, force={force}")

    try:
        # case_id 파싱
        if isinstance(case_id, str) and case_id.startswith("CASE-"):
            numeric_case_id = int(case_id.split("-")[1])
        else:
            numeric_case_id = int(case_id)

        # Step 1: 기존 타임라인 삭제 (force=True인 경우)
        if force:
            deleted_count = db.query(TimeLine).filter(
                TimeLine.case_id == numeric_case_id
            ).delete()
            db.commit()
            print(f"[Timeline Generate API] 기존 타임라인 삭제: {deleted_count}개")

        # Step 2: 새 타임라인 생성
        print(f"[Timeline Generate API] TimeLineService 초기화")
        timeline_service = TimeLineService(db=db, case_id=numeric_case_id)

        print(f"[Timeline Generate API] 타임라인 생성 실행")
        generated_timelines = await timeline_service.generate_timeline_auto()

        print(f"[Timeline Generate API] 생성 완료: {len(generated_timelines)}개")

        # Step 3: 응답 형식으로 변환
        result = []
        for timeline in generated_timelines:
            tl_dict = timeline.to_dict()
            tl_dict["case_id"] = f"CASE-{tl_dict['case_id']:03d}"
            result.append(tl_dict)

        print(f"[Timeline Generate API] 완료\n")
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Timeline Generate API] 에러: {type(e).__name__} - {str(e)}")
        import traceback
        print(f"[Timeline Generate API] 트레이스백:\n{traceback.format_exc()}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
