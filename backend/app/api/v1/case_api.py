"""
사건(Case) CRUD API
- POST /api/v1/cases: 사건 생성
- GET /api/v1/cases: 사건 목록 조회 (law_firm_id 기준)
- GET /api/v1/cases/{case_id}: 사건 상세 조회
- POST /api/v1/cases/{case_id}/analyze: 사건 내용 분석 (summary, facts, claims 추출)
"""

import os
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from openai import OpenAI

from tool.database import get_db
from tool.security import get_current_user
from app.models.user import User
from app.models.evidence import Case, CaseSummary

# OpenAI 클라이언트
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

router = APIRouter(tags=["Cases"])


# ==================== Request/Response 스키마 ====================

class CaseCreateRequest(BaseModel):
    title: str
    client_name: Optional[str] = None
    client_role: Optional[str] = None
    case_type: Optional[str] = None
    incident_date: Optional[date] = None
    incident_date_end: Optional[date] = None
    notification_date: Optional[date] = None
    notification_date_end: Optional[date] = None
    deadline_at: Optional[date] = None
    deadline_at_end: Optional[date] = None
    description: Optional[str] = None


class CaseResponse(BaseModel):
    id: int
    title: str
    client_name: Optional[str] = None
    client_role: Optional[str] = None
    case_type: Optional[str] = None
    status: Optional[str] = None
    incident_date: Optional[date] = None
    incident_date_end: Optional[date] = None
    notification_date: Optional[date] = None
    notification_date_end: Optional[date] = None
    deadline_at: Optional[date] = None
    deadline_at_end: Optional[date] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CaseListItem(BaseModel):
    """사건 목록용 간략 응답"""
    id: int
    title: str
    client_name: Optional[str] = None
    case_type: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== API 엔드포인트 ====================

@router.post("", response_model=CaseResponse)
async def create_case(
    request: CaseCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    새 사건 생성

    - JWT 인증 필요
    - law_firm_id, created_by는 JWT에서 자동 추출
    - status는 기본값 '접수'로 설정
    """
    print("=" * 50)
    print(f"📁 새 사건 생성 요청")
    print(f"   사용자: {current_user.email} (ID: {current_user.id})")
    print(f"   사무실: {current_user.firm_id}")
    print(f"   제목: {request.title}")
    print("=" * 50)

    try:
        new_case = Case(
            law_firm_id=current_user.firm_id,
            created_by=current_user.id,
            user_id=current_user.id,  # 레거시 호환
            title=request.title,
            client_name=request.client_name,
            client_role=request.client_role,
            case_type=request.case_type,
            incident_date=request.incident_date,
            incident_date_end=request.incident_date_end,
            notification_date=request.notification_date,
            notification_date_end=request.notification_date_end,
            deadline_at=request.deadline_at,
            deadline_at_end=request.deadline_at_end,
            description=request.description,
        )

        db.add(new_case)
        db.commit()
        db.refresh(new_case)

        print(f"✅ 사건 생성 완료: case_id={new_case.id}")

        return new_case

    except Exception as e:
        db.rollback()
        print(f"❌ 사건 생성 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"사건 생성 실패: {str(e)}")


@router.get("", response_model=dict)
async def get_cases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    사건 목록 조회

    - JWT 인증 필요
    - 현재 사용자의 law_firm_id에 해당하는 사건만 반환
    - 최신순 정렬
    """
    print(f"📋 사건 목록 조회: user_id={current_user.id}, firm_id={current_user.firm_id}")

    try:
        cases = db.query(Case).filter(
            Case.law_firm_id == current_user.firm_id
        ).order_by(
            Case.created_at.desc()
        ).all()

        print(f"✅ 조회된 사건 수: {len(cases)}")

        case_list = []
        for case in cases:
            case_list.append({
                "id": case.id,
                "title": case.title,
                "client_name": case.client_name,
                "case_type": case.case_type,
                "status": case.status,
                "created_at": case.created_at.isoformat() if case.created_at else None,
            })

        return {
            "total": len(case_list),
            "cases": case_list
        }

    except Exception as e:
        print(f"❌ 사건 목록 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"사건 목록 조회 실패: {str(e)}")


@router.get("/{case_id}", response_model=CaseResponse)
async def get_case_detail(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    사건 상세 조회

    - JWT 인증 필요
    - 같은 law_firm_id 소속만 조회 가능
    """
    print(f"📄 사건 상세 조회: case_id={case_id}, user_id={current_user.id}")

    try:
        case = db.query(Case).filter(Case.id == case_id).first()

        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

        # 소유권 검증
        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        print(f"✅ 사건 상세 조회 완료: {case.title}")
        print(f"   description: {case.description[:100] if case.description else '(비어있음)'}...")

        return case

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 사건 상세 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"사건 상세 조회 실패: {str(e)}")


# ==================== 사건 분석 API ====================

class CaseAnalyzeResponse(BaseModel):
    """사건 분석 응답"""
    summary: str
    facts: str
    claims: str


@router.post("/{case_id}/analyze", response_model=CaseAnalyzeResponse)
async def analyze_case(
    case_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    사건 내용(description) 분석

    - description 전문을 LLM으로 분석
    - summary(사건 요약), facts(사실관계), claims(청구 내용) 추출
    - JWT 인증 필요
    - force=true: 캐시 무시하고 재분석 후 덮어쓰기
    """
    print("=" * 50)
    print(f"🔍 사건 분석 요청: case_id={case_id}, force={force}")
    print("=" * 50)

    try:
        # 사건 조회
        case = db.query(Case).filter(Case.id == case_id).first()

        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

        # 소유권 검증
        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # 캐시 조회: case_summaries 테이블에서 먼저 확인 (force=true면 스킵)
        cached_summary = db.query(CaseSummary).filter(CaseSummary.case_id == case_id).first()
        if cached_summary and not force:
            print(f"✅ 캐시 히트: case_id={case_id}")
            return CaseAnalyzeResponse(
                summary=cached_summary.summary or "",
                facts=cached_summary.facts or "",
                claims=cached_summary.claims or ""
            )

        if force:
            print(f"🔄 강제 재분석 모드: 캐시 무시")

        print(f"📭 캐시 미스: LLM 분석 시작")

        # description이 없으면 기본값 반환
        if not case.description or not case.description.strip():
            print("⚠️ description이 비어있음 - 기본값 반환")
            return CaseAnalyzeResponse(
                summary=f"{case.title} 사건입니다.",
                facts="사실관계가 아직 입력되지 않았습니다.",
                claims="청구 내용이 아직 입력되지 않았습니다."
            )

        print(f"📝 분석할 텍스트 길이: {len(case.description)}자")

        # 시스템 프롬프트 (역할 및 금지 규칙)
        system_prompt = """역할:
너는 법률 사건 관리 시스템의 "사건 개요 요약 생성기"다.
변호사가 작성한 상담 원문(description)을 기반으로 사건 개요를 정리한다.
추측, 각색, 법적 판단 추가는 금지한다.

목표:
- 사건 요약 / 사실 관계 / 청구 내용을 "출시 가능한 품질"로 생성한다.
- 요약은 지나치게 축약하지 않고, 사건 원문을 2~4문장 수준으로 정리한다.

[금지 규칙]
- 원문에 없는 사실, 날짜, 인물, 금액, 죄명 추가 금지
- "추정된다", "보인다", "가능성이 있다" 등의 표현 사용 금지
- 법적 판단, 결론, 승소 가능성 언급 금지
- 한 줄 요약 수준의 과도한 축약 금지
- 반드시 유효한 JSON만 출력. 다른 설명, 인사말, 마크다운 코드블록(```) 포함 금지"""

        # 사용자 프롬프트 (출력 규칙 + 모범 예시 + 입력)
        user_prompt = f"""[출력 규칙]

사건 요약(summary):
- 사건 원문 전체를 2~4문장으로 요약한다.
- 한 줄 요약처럼 지나치게 축약하지 말 것.
- 사건의 유형, 행위 주체, 행위 내용, 문제 되는 핵심이 드러나야 한다.
- "~하고자 하는 사건이다" 같은 형식적인 문장은 사용하지 않는다.
- 법적 판단이나 결론은 포함하지 않는다.

사실 관계(facts):
- 시시비비가 갈리지 않는 객관적 사실만 정리한다.
- 평가, 의견, 감정, 추측은 금지한다.
- 날짜가 명확한 경우 반드시 날짜를 명시한다.
- 날짜가 없는 경우 억지로 만들어 쓰지 않는다.
- 시간 순서를 추론하지 않는다.
- 행위 + 장소/매체 + 대상 + 내용이 자연스럽게 드러나도록 서술한다.

청구 내용(claims):
- 청구 가능한 내용을 유형별로 구분하여 정리한다.
- 형사 / 민사 등으로 구분되는 경우 번호로 나눈다.
- 조문, 금액 등은 원문에 명시된 경우에만 포함한다.
- 원문에 없는 청구는 추가하지 않는다.

[모범 출력 예시]

사건 요약:
온라인 커뮤니티 및 직장 내에서 발생한 명예훼손 사건이다. 피고소인은 직장 동료 34명이 참여한 카카오톡 단체 채팅방에서 의뢰인에 대해 "업무 능력이 허접하다"는 폭언을 하였고, "회사 돈을 횡령했다"는 허위 사실을 유포하였다. 해당 발언과 게시 행위로 인해 의뢰인은 직장 내 평판과 사회적 평가에 상당한 영향을 받았다고 주장하고 있다.

사실 관계:
2025년 11월 15일부터 2026년 1월 10일까지 약 2개월간, 피고소인 박○○은 직장 동료 34명이 참여한 카카오톡 단체 채팅방에서 의뢰인을 지칭하며 "짐만 된다"는 등 모욕적인 발언을 반복하였다. 같은 기간 동안 피고소인은 의뢰인이 회사 자금을 횡령하였다는 취지의 허위 사실을 해당 채팅방에서 유포하였다.

청구 내용:
1. 형사: 명예훼손죄(형법 제307조) 및 모욕죄(형법 제311조)로 고소
2. 민사: 위 불법행위로 인한 위자료 5,000만 원 손해배상 청구

[입력 - 사건 제목]
{case.title}

[입력 - 상담 원문]
{case.description}

[출력 형식]
위 규칙과 모범 예시 수준의 품질로 작성한 후, 아래 JSON 형식으로 변환하여 출력하라:
{{"summary": "사건 요약 내용", "facts": "사실 관계 내용", "claims": "청구 내용"}}"""

        # OpenAI API 호출
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2,
            max_tokens=2500
        )

        result_text = response.choices[0].message.content.strip()

        # JSON 파싱
        # ```json ... ``` 형태로 올 수 있으므로 처리
        if result_text.startswith("```"):
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
        result_text = result_text.strip()

        parsed = json.loads(result_text)

        # 원본 값 추출
        summary_raw = parsed.get("summary", "")
        facts_raw = parsed.get("facts", "")
        claims_raw = parsed.get("claims", "")

        print(f"🔍 파싱된 타입: summary={type(summary_raw).__name__}, facts={type(facts_raw).__name__}, claims={type(claims_raw).__name__}")

        # 문자열로 변환하는 헬퍼 함수
        def to_string(value):
            if isinstance(value, str):
                return value
            elif isinstance(value, list):
                # 리스트인 경우 각 항목을 문자열로 변환 후 줄바꿈으로 연결
                result_items = []
                for item in value:
                    if isinstance(item, str):
                        result_items.append(item)
                    elif isinstance(item, dict):
                        # dict인 경우 읽기 좋게 변환
                        parts = []
                        for k, v in item.items():
                            parts.append(f"{k}: {v}")
                        result_items.append(", ".join(parts))
                    else:
                        result_items.append(str(item))
                return "\n".join(result_items)
            elif isinstance(value, dict):
                return json.dumps(value, ensure_ascii=False)
            else:
                return str(value) if value else ""

        # 모든 값을 문자열로 변환
        summary = to_string(summary_raw)
        facts = to_string(facts_raw)
        claims = to_string(claims_raw)

        print(f"✅ 사건 분석 완료")
        print(f"   summary: {summary[:80] if len(summary) > 80 else summary}...")
        print(f"   facts type: {type(facts).__name__}, length: {len(facts)}")

        # 분석 결과를 case_summaries 테이블에 저장 (기존 레코드 있으면 업데이트)
        if cached_summary:
            cached_summary.summary = summary
            cached_summary.facts = facts
            cached_summary.claims = claims
            print(f"💾 캐시 업데이트 완료: case_id={case_id}")
        else:
            new_summary = CaseSummary(
                case_id=case_id,
                summary=summary,
                facts=facts,
                claims=claims
            )
            db.add(new_summary)
            print(f"💾 캐시 신규 저장 완료: case_id={case_id}")
        db.commit()

        return CaseAnalyzeResponse(
            summary=summary,
            facts=facts,
            claims=claims
        )

    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 실패: {str(e)}")
        # 파싱 실패 시 기본값 반환
        return CaseAnalyzeResponse(
            summary=f"{case.title} 사건입니다.",
            facts=case.description[:500] if case.description else "",
            claims=""
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 사건 분석 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"사건 분석 실패: {str(e)}")


# ==================== 사건 수정 API ====================

class CaseUpdateRequest(BaseModel):
    """사건 원문(description) 수정 요청"""
    description: str


@router.put("/{case_id}", response_model=CaseResponse)
async def update_case(
    case_id: int,
    request: CaseUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    사건 원문(description) 수정

    - JWT 인증 필요
    - 같은 law_firm_id 소속만 수정 가능
    """
    print("=" * 50)
    print(f"📝 사건 원문 수정 요청: case_id={case_id}")
    print("=" * 50)

    try:
        case = db.query(Case).filter(Case.id == case_id).first()

        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # 원문 업데이트
        case.description = request.description
        db.commit()
        db.refresh(case)

        print(f"✅ 사건 원문 수정 완료: case_id={case_id}")

        return case

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 사건 원문 수정 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"사건 원문 수정 실패: {str(e)}")


# ==================== 사건 분석 결과 수정 API ====================

class CaseSummaryUpdateRequest(BaseModel):
    """AI 분석 결과 수정 요청"""
    summary: Optional[str] = None
    facts: Optional[str] = None
    claims: Optional[str] = None


class CaseSummaryResponse(BaseModel):
    """AI 분석 결과 응답"""
    case_id: int
    summary: Optional[str] = None
    facts: Optional[str] = None
    claims: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.put("/{case_id}/summary", response_model=CaseSummaryResponse)
async def update_case_summary(
    case_id: int,
    request: CaseSummaryUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    AI 분석 결과(summary, facts, claims) 수정

    - JWT 인증 필요
    - 같은 law_firm_id 소속만 수정 가능
    - 기존 case_summaries 레코드가 없으면 새로 생성
    """
    print("=" * 50)
    print(f"📝 AI 분석 결과 수정 요청: case_id={case_id}")
    print("=" * 50)

    try:
        # 사건 조회 및 권한 검증
        case = db.query(Case).filter(Case.id == case_id).first()

        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # 기존 분석 결과 조회
        case_summary = db.query(CaseSummary).filter(CaseSummary.case_id == case_id).first()

        if case_summary:
            # 기존 레코드 업데이트
            if request.summary is not None:
                case_summary.summary = request.summary
            if request.facts is not None:
                case_summary.facts = request.facts
            if request.claims is not None:
                case_summary.claims = request.claims
            print(f"✅ 기존 분석 결과 업데이트")
        else:
            # 새 레코드 생성
            case_summary = CaseSummary(
                case_id=case_id,
                summary=request.summary or "",
                facts=request.facts or "",
                claims=request.claims or ""
            )
            db.add(case_summary)
            print(f"✅ 새 분석 결과 생성")

        db.commit()
        db.refresh(case_summary)

        print(f"💾 AI 분석 결과 저장 완료: case_id={case_id}")

        return CaseSummaryResponse(
            case_id=case_summary.case_id,
            summary=case_summary.summary,
            facts=case_summary.facts,
            claims=case_summary.claims,
            updated_at=case_summary.updated_at
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ AI 분석 결과 수정 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI 분석 결과 수정 실패: {str(e)}")
