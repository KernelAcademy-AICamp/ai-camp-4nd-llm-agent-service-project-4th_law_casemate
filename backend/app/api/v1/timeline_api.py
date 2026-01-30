from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.services.timeline_service import TimeLineService
from app.models.case import Case
from app.models.tiemline import TimeLine
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
    사건의 타임라인 목록 조회

    Args:
        case_id: 사건 ID (문자열 "CASE-001" 형식)
        db: 데이터베이스 세션

    Returns:
        타임라인 목록 (시간순 정렬)
    """
    try:
        # case_id가 "CASE-002" 형식이면 숫자만 추출 (임시 처리)
        # 실제 DB의 case_id는 integer이므로
        if isinstance(case_id, str) and case_id.startswith("CASE-"):
            numeric_case_id = int(case_id.split("-")[1])
        else:
            numeric_case_id = int(case_id)

        timelines = db.query(TimeLine).filter(
            TimeLine.case_id == numeric_case_id
        ).order_by(
            TimeLine.date.asc(),
            TimeLine.time.asc(),
            TimeLine.order_index.asc()
        ).all()

        # case_id를 문자열 형식으로 변환하여 반환
        result = []
        for timeline in timelines:
            tl_dict = timeline.to_dict()
            tl_dict["case_id"] = f"CASE-{tl_dict['case_id']:03d}"  # 2 -> "CASE-002"
            result.append(tl_dict)

        return result
    except Exception as e:
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
    use_llm: bool = False,
    firm_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """
    AI를 사용하여 타임라인 자동 생성

    Args:
        case_id: 사건 ID
        use_llm: LLM 사용 여부 (기본값: False, 샘플 데이터 사용)
        firm_id: 소속 법무법인/사무실 ID (옵션)
        db: 데이터베이스 세션

    Returns:
        생성된 타임라인 목록
    """
    print(f"\n[Timeline Generate API] 시작")
    print(f"[Timeline Generate API] case_id: {case_id}")
    print(f"[Timeline Generate API] use_llm: {use_llm}")
    print(f"[Timeline Generate API] firm_id: {firm_id}")

    try:
        # case_id 변환
        if isinstance(case_id, str) and case_id.startswith("CASE-"):
            numeric_case_id = int(case_id.split("-")[1])
        else:
            numeric_case_id = int(case_id)

        print(f"[Timeline Generate API] numeric_case_id: {numeric_case_id}")

        # TODO: 실제로는 DB에서 Case 정보와 증거 목록을 가져와야 함
        # case = db.query(Case).filter(Case.id == numeric_case_id).first()
        # evidences = db.query(Evidence).filter(Evidence.case_id == numeric_case_id).all()

        # 임시: 샘플 데이터 생성
        print(f"[Timeline Generate API] Case 객체 생성 중...")
        case = Case()
        print(f"[Timeline Generate API] Case 객체 생성 완료: {case}")

        print(f"[Timeline Generate API] TimeLineService 초기화 중...")
        timeline_service = TimeLineService(case, use_llm=use_llm)
        print(f"[Timeline Generate API] TimeLineService 초기화 완료")

        print(f"[Timeline Generate API] 타임라인 생성 실행 중...")
        timelines = timeline_service.execute()
        print(f"[Timeline Generate API] 생성된 타임라인 개수: {len(timelines)}")

        # DB에 저장
        print(f"[Timeline Generate API] DB 저장 시작...")
        saved_timelines = []
        for i, tl in enumerate(timelines):
            print(f"[Timeline Generate API] 타임라인 {i+1} 저장 중: {tl.title}")
            timeline = TimeLine(
                case_id=numeric_case_id,
                firm_id=firm_id,
                date=tl.date,
                time=tl.time,
                title=tl.title,
                description=tl.description,
                type=tl.type,
                actor=tl.actor,
                order_index=len(saved_timelines)
            )
            db.add(timeline)
            saved_timelines.append(timeline)

        print(f"[Timeline Generate API] DB commit 중...")
        db.commit()
        print(f"[Timeline Generate API] DB commit 완료")

        # 저장된 타임라인 반환
        print(f"[Timeline Generate API] 타임라인 refresh 중...")
        for timeline in saved_timelines:
            db.refresh(timeline)

        result = []
        for timeline in saved_timelines:
            tl_dict = timeline.to_dict()
            tl_dict["case_id"] = f"CASE-{tl_dict['case_id']:03d}"
            result.append(tl_dict)

        print(f"[Timeline Generate API] 반환할 타임라인 개수: {len(result)}")
        print(f"[Timeline Generate API] 완료\n")

        return result
    except Exception as e:
        print(f"[Timeline Generate API] 에러 발생: {type(e).__name__}")
        print(f"[Timeline Generate API] 에러 메시지: {str(e)}")
        import traceback
        print(f"[Timeline Generate API] 트레이스백:\n{traceback.format_exc()}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
