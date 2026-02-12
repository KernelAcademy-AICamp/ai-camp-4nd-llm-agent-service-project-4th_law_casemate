"""
사건(Case) CRUD API
- POST /api/v1/cases: 사건 생성
- GET /api/v1/cases: 사건 목록 조회 (law_firm_id 기준)
- GET /api/v1/cases/{case_id}: 사건 상세 조회
- POST /api/v1/cases/{case_id}/analyze: 사건 분석 (summary, facts, claims + crime_names, legal_keywords, legal_laws 통합 추출)
"""

import os
import re
import json
import hashlib
import traceback
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from openai import OpenAI, AsyncOpenAI

from tool.database import get_db, SessionLocal
from tool.security import get_current_user
from app.models.user import User
from app.models.evidence import Case, CaseAnalysis, Evidence, CaseEvidenceMapping, EvidenceAnalysis
from app.services.timeline_service import TimeLineService
from app.services.relationship_service import RelationshipService
from app.models.timeline import TimeLine
from app.models.relationship import CasePerson, CaseRelationship

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
    opponent_name: Optional[str] = None
    opponent_role: Optional[str] = None


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
    opponent_name: Optional[str] = None
    opponent_role: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    analyzed_at: Optional[datetime] = None
    analysis_stale: Optional[bool] = False

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
            opponent_name=request.opponent_name,
            opponent_role=request.opponent_role,
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
    - availability='o' (open) 상태인 사건만 반환
    - 최신순 정렬
    """
    print(f"📋 사건 목록 조회: user_id={current_user.id}, firm_id={current_user.firm_id}")

    try:
        cases = db.query(Case).filter(
            Case.law_firm_id == current_user.firm_id,
            Case.availability == 'o'
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

        # 분석 캐시 존재 여부 + 원문 변경 감지
        cached = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()
        analyzed_at = cached.analyzed_at if cached else None

        # 원문이 분석 이후 변경되었는지 확인 (description_hash 비교)
        analysis_stale = False
        if cached and cached.description_hash and case.description:
            current_hash = hashlib.sha256(case.description.encode()).hexdigest()
            analysis_stale = cached.description_hash != current_hash

        print(f"✅ 사건 상세 조회 완료: {case.title}, analyzed_at={analyzed_at}, analysis_stale={analysis_stale}")

        # ORM → CaseResponse dict에 분석 상태 주입
        response = CaseResponse.model_validate(case)
        return response.model_dump() | {
            "analyzed_at": analyzed_at.isoformat() if analyzed_at else None,
            "analysis_stale": analysis_stale,
        }

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
    crime_names: list[str] = []
    legal_keywords: list[str] = []


async def reanalyze_case_evidences(db: Session, case_id: int) -> int:
    """
    사건의 모든 증거를 재분석하는 함수 (백그라운드 실행용)

    Args:
        db: 데이터베이스 세션
        case_id: 사건 ID

    Returns:
        재분석된 증거 개수
    """
    try:
        # 1. 사건 정보 조회
        case = db.query(Case).filter(Case.id == case_id).first()
        if not case:
            print(f"⚠️ [Evidence Reanalysis] 사건을 찾을 수 없음: case_id={case_id}")
            return 0

        # 2. 해당 사건의 모든 증거 조회
        evidence_mappings = db.query(CaseEvidenceMapping).filter(
            CaseEvidenceMapping.case_id == case_id
        ).all()

        if not evidence_mappings:
            print(f"⚠️ [Evidence Reanalysis] 연결된 증거 없음: case_id={case_id}")
            return 0

        print(f"📊 [Evidence Reanalysis] 재분석 대상: {len(evidence_mappings)}개 증거")

        # 3. AsyncOpenAI 클라이언트 생성
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print(f"❌ [Evidence Reanalysis] OPENAI_API_KEY 없음")
            return 0

        client = AsyncOpenAI(api_key=api_key)

        # 4. 사건 맥락 준비
        case_context = f"""
**사건 맥락:**
- 사건명: {case.title}
- 사건 유형: {case.case_type if case.case_type else '미분류'}
- 의뢰인: {case.client_name} ({case.client_role})
- 상대방: {case.opponent_name} ({case.opponent_role})
- 사건 설명: {case.description[:300] if case.description else '없음'}
"""

        analyzed_count = 0

        # 5. 각 증거에 대해 재분석 수행
        for idx, mapping in enumerate(evidence_mappings):
            try:
                # 증거 조회
                evidence = db.query(Evidence).filter(
                    Evidence.id == mapping.evidence_id
                ).first()

                if not evidence or not evidence.content or len(evidence.content.strip()) < 20:
                    print(f"  [{idx+1}/{len(evidence_mappings)}] 건너뜀: evidence_id={mapping.evidence_id} (내용 없음)")
                    continue

                print(f"  [{idx+1}/{len(evidence_mappings)}] 분석 중: {evidence.file_name}")

                # GPT 프롬프트
                prompt = f"""당신은 법률 전문가입니다. 다음 증거 자료를 특정 사건의 맥락에서 분석해주세요.

**파일명:** {evidence.file_name}
**문서 유형:** {evidence.doc_type if evidence.doc_type else '미분류'}
{case_context}
**증거 내용:**
{evidence.content}

---

다음 형식으로 JSON 응답을 작성해주세요:

```json
{{
  "summary": "증거 내용을 3-5문장으로 요약",
  "legal_relevance": "이 사건에서 이 증거가 법적으로 어떤 의미를 가지는지, 어떤 주장을 뒷받침하는지 분석 (3-5문장)",
  "risk_level": "high, medium, low 중 하나 (상대방에게 불리한 정도)"
}}
```

**주의사항:**
- summary: 핵심 내용만 간결하게 요약
- legal_relevance: 사건 맥락을 고려하여 법적 쟁점, 증거 가치, 활용 방안을 구체적으로 작성
- risk_level: 상대방 입장에서 불리한 정도를 평가 (높을수록 우리에게 유리)
"""

                # GPT 호출
                response = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "당신은 법률 증거 분석 전문가입니다."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3,
                    max_tokens=1500
                )

                content = response.choices[0].message.content or ""

                # JSON 파싱
                try:
                    json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
                    if json_match:
                        json_str = json_match.group(1)
                    else:
                        json_str = content

                    parsed = json.loads(json_str)
                    summary = parsed.get("summary", "")
                    legal_relevance = parsed.get("legal_relevance", "")
                    risk_level = parsed.get("risk_level", "medium")
                except (json.JSONDecodeError, AttributeError) as e:
                    print(f"    ⚠️ JSON 파싱 실패: {str(e)}")
                    summary = content[:500]
                    legal_relevance = "자동 분석 실패"
                    risk_level = "medium"

                # DB 저장 (기존 분석 업데이트 또는 생성)
                existing_analysis = db.query(EvidenceAnalysis).filter(
                    EvidenceAnalysis.evidence_id == evidence.id,
                    EvidenceAnalysis.case_id == case_id
                ).first()

                if existing_analysis:
                    existing_analysis.summary = summary
                    existing_analysis.legal_relevance = legal_relevance
                    existing_analysis.risk_level = risk_level
                    existing_analysis.ai_model = "gpt-4o-mini"
                    existing_analysis.created_at = datetime.now()
                else:
                    new_analysis = EvidenceAnalysis(
                        evidence_id=evidence.id,
                        case_id=case_id,
                        summary=summary,
                        legal_relevance=legal_relevance,
                        risk_level=risk_level,
                        ai_model="gpt-4o-mini"
                    )
                    db.add(new_analysis)

                db.commit()
                analyzed_count += 1
                print(f"    ✅ 완료: risk_level={risk_level}")

            except Exception as e:
                print(f"    ❌ 증거 분석 실패 (evidence_id={mapping.evidence_id}): {str(e)}")
                db.rollback()
                continue

        return analyzed_count

    except Exception as e:
        print(f"❌ [Evidence Reanalysis] 전체 실패: {str(e)}")
        print(traceback.format_exc())
        return 0


async def generate_timeline_and_relationships_background(case_id: int):
    """
    백그라운드에서 타임라인과 관계도를 자동 생성하는 함수
    AI 분석이 완료된 후 자동으로 호출됨
    """
    db = SessionLocal()
    try:
        print(f"\n{'='*80}")
        print(f"[Background Task] 타임라인 및 관계도 자동 생성 시작: case_id={case_id}")
        print(f"{'='*80}\n")

        # 1. 기존 타임라인 삭제
        deleted_timeline_count = db.query(TimeLine).filter(
            TimeLine.case_id == case_id
        ).delete()
        db.commit()
        print(f"[Background Task] 기존 타임라인 삭제: {deleted_timeline_count}개")

        # 2. 타임라인 생성
        print(f"[Background Task] 타임라인 생성 시작...")
        timeline_service = TimeLineService(db=db, case_id=case_id)
        generated_timelines = await timeline_service.generate_timeline_auto()
        print(f"[Background Task] 타임라인 생성 완료: {len(generated_timelines)}개")

        # 3. 기존 관계도 삭제
        deleted_rel_count = db.query(CaseRelationship).filter(
            CaseRelationship.case_id == case_id
        ).delete()
        deleted_person_count = db.query(CasePerson).filter(
            CasePerson.case_id == case_id
        ).delete()
        db.commit()
        print(f"[Background Task] 기존 관계도 삭제: {deleted_person_count}명, {deleted_rel_count}개 관계")

        # 4. 관계도 생성
        print(f"[Background Task] 관계도 생성 시작...")
        relationship_service = RelationshipService(db=db, case_id=case_id)
        relationship_data = await relationship_service.generate_relationship()
        print(f"[Background Task] 관계도 생성 완료: {len(relationship_data['persons'])}명, {len(relationship_data['relationships'])}개 관계")

        # 5. 증거 재분석 (사건 맥락 기반)
        print(f"[Background Task] 증거 재분석 시작...")
        evidence_count = await reanalyze_case_evidences(db, case_id)
        print(f"[Background Task] 증거 재분석 완료: {evidence_count}개")

        print(f"\n{'='*80}")
        print(f"[Background Task] 타임라인, 관계도, 증거 분석 완료")
        print(f"{'='*80}\n")

    except Exception as e:
        print(f"[Background Task] 에러 발생: {type(e).__name__} - {str(e)}")
        print(f"[Background Task] 트레이스백:\n{traceback.format_exc()}")
        db.rollback()
    finally:
        db.close()


@router.post("/{case_id}/analyze", response_model=CaseAnalyzeResponse)
async def analyze_case(
    case_id: int,
    background_tasks: BackgroundTasks,
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
    - 분석 완료 후 백그라운드에서 타임라인과 관계도 자동 생성
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

        # 캐시 조회: case_analyses 테이블에서 먼저 확인 (force=true면 스킵)
        cached_summary = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()
        if cached_summary and cached_summary.summary and not force:
            print(f"✅ 캐시 히트: case_id={case_id}")
            cached_crime = json.loads(cached_summary.crime_names) if cached_summary.crime_names else []
            cached_keywords = json.loads(cached_summary.legal_keywords) if cached_summary.legal_keywords else []
            return CaseAnalyzeResponse(
                summary=cached_summary.summary or "",
                facts=cached_summary.facts or "",
                claims=cached_summary.claims or "",
                crime_names=cached_crime,
                legal_keywords=cached_keywords,
            )

        if force:
            print(f"🔄 강제 재분석 모드: 캐시 무시")
            # 하위 캐시 초기화 (재분석 후 법령 검색도 다시 해야 하므로)
            if cached_summary:
                cached_summary.legal_keywords = None
                cached_summary.legal_laws = None
                cached_summary.crime_names = None
                cached_summary.legal_search_results = None

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

        # 시스템 프롬프트 (역할/페르소나/금지 규칙)
        system_prompt = """역할:
너는 법률 사건 관리 시스템의 "사건 분석기"다.
변호사가 작성한 상담 원문을 기반으로 사건 개요를 정리하고, 적용 가능한 죄명·법적 쟁점·관련 법조문을 추출한다.

[JSON 출력 규칙] ★필수★
- facts 필드: 반드시 문자열 배열 ["사실1", "사실2", ...] 형태로 출력
- facts를 하나의 문자열로 합치면 안 됨. 반드시 배열로 분리
- 배열 항목 개수: 최소 8개 이상

[마크다운 형식 규칙] ★중요★
- summary, facts, claims의 내용을 마크다운 형식으로 작성
- 중요한 단어나 핵심 개념은 **굵게** 표시
- 법률 용어나 죄명은 **굵게** 표시 (예: **명예훼손**, **손해배상**)
- 인물명은 강조 표시 (예: **김OO**, **박OO**)
- 날짜는 `YYYY-MM-DD` 형식으로 표시
- 금액은 **굵게** 표시 (예: **5,000만원**)

[법적 분석 규칙]
- crime_names: 사건의 핵심 법적 근거 (1~5개). 사건 유형에 따라 다름:
  - 형사 사건 → 정식 죄명 (예: "명예훼손죄", "주거침입죄", "사기죄")
  - 민사 사건 → 청구원인/소인 (예: "손해배상청구", "부당이득반환청구", "소유권이전등기청구")
  - 형사·민사 혼합이면 둘 다 포함
- legal_keywords: 위 핵심 근거 외 부수적 법적 쟁점/개념 (3~7개) (예: "인격권 침해", "불법행위", "위자료", "과실상계")
- legal_laws: 관련 법조문 (3~7개). "법령명 제N조" 형식 (예: "형법 제307조", "민법 제750조")
  - 확실하지 않은 것은 제외, 명확히 관련된 것만 포함

[금지 규칙]
- 원문에 없는 사실, 날짜, 인물, 금액, 죄명 추가 금지
- "추정된다", "보인다", "가능성이 있다" 등 추측 표현 금지
- 법적 판단, 결론, 승소 가능성, 법리 해석 금지
- 반드시 유효한 JSON만 출력. 설명, 인사말, 마크다운 코드블록 금지"""

        # 사용자 프롬프트 (품질/방향성만)
        user_prompt = f"""[품질 기준]

사건 요약(summary):
- 2~3문장으로 핵심만 압축
- 핵심 쟁점 + 피해/결과/현재상태
- 장황한 배경 설명 제외, 법적 쟁점이 될 핵심 행위와 피해만 기술
- "~사건이다", "~하고자 한다" 같은 형식적 문장 금지
- 마크다운 형식: 핵심 키워드와 법률 용어는 **굵게** 표시

사실 관계(facts) ★최우선 규칙★:
- ★ 원문의 모든 사실을 최대한 추출. 누락 금지 ★
- 최소 5개 이상, 평균 5~10개, 원문이 길고 자세하면 15개까지
- 1문장 = 1사실. 복합문장은 반드시 분리
- ★★ 모든 문장에 주어+목적어 필수 ★★
  - "누가 누구에게/무엇을 어떻게 했는지" 완전한 문장으로 작성
  - 금지: "모욕적인 발언을 게시함" (주어 없음)
  - 허용: "박대리가 오픈채팅방에 모욕적인 발언을 게시함"
- 원문의 행위, 대화, 상황, 피해 내역을 개별 사실로 쪼개기
- 시간 순서대로 나열
- 금액, 날짜, 장소, 인물, 횟수 등 구체적 정보 포함
- 논점/다툼 포인트, 양측 주장/행위 모두 포함
- 평가/추측/감정 금지
- 마크다운 형식: 인물명, 금액, 핵심 행위는 **굵게** 표시
[날짜 규칙 - 타임라인 정확도용]
- 날짜가 명확한 사실: "[ YYYY-MM-DD ] 내용" 형식. 날짜 뒤에 "부터/까지" 붙이지 말 것.
  - 금지: "[ 2026-01-01 ] 부터 A가 B를 함"
  - 허용: "[ 2026-01-01 ] **A**가 **B**를 시작함"
- 날짜 불명확/추론 필요: 날짜 없이 바로 사실 서술. 억지로 날짜 생성 금지.

청구 내용(claims) ★구조 규칙★:
- 카테고리별 구분 (민사/형사/행정/가정/가사/기타)
- ★★ 형사와 민사 모두 검토 필수 ★★
  - 피해(재산적/정신적)가 있으면 → 민사: 손해배상 청구
  - 범죄행위(명예훼손, 폭행, 사기 등)가 있으면 → 형사: 고소
  - 대부분의 사건은 형사+민사 양쪽 모두 해당됨
- 각 카테고리 아래에 구체적인 청구 내용을 개별 항목으로 나열
- 각 문장은 주어/상대방(목적어)/요구내용이 명확해야 함
  - 예: "고소인 **A**는 피고소인 **B**에 대해 **○○ 혐의**로 고소 검토함"
  - 예: "원고 **A**는 피고 **B**를 상대로 **정신적 손해배상** 청구함"
- 여러 청구를 하나의 문장으로 합치지 않음
- "검토함 / 청구함 / 요구함 / 주장함" 톤 유지
- 마크다운 형식: 인물명, 죄명, 청구 내용은 **굵게** 표시

[입력]
제목: {case.title}
원문: {case.description}

[출력 형식] ★★ 반드시 이 형식 준수 ★★
{{
  "summary": "**핵심 키워드**를 포함한 요약 문장 (마크다운 형식)",
  "facts": [
    "[ YYYY-MM-DD ] **A**가 **B**에게 ~함",
    "**A**가 ~를 함",
    "**B**가 ~를 주장함",
    "... (최소 5개 이상, 원문이 길면 10~15개까지. 인물명과 핵심 행위는 **굵게**)"
  ],
  "claims": {{
    "형사": ["의뢰인 **A**가 상대방 **B**를 **~혐의**로 고소 검토함"],
    "민사": ["의뢰인 **A**가 상대방 **B**에게 **손해배상** 청구함"]
  }},
  "crime_names": ["명예훼손죄", "모욕죄"],
  "legal_keywords": ["인격권 침해", "불법행위", "위자료"],
  "legal_laws": ["형법 제307조", "민법 제750조"]
}}
★ facts는 반드시 JSON 배열(Array)로 출력. 문자열 금지.
★ 형사/민사 양쪽 모두 검토하여 해당되면 출력.
★ 모든 텍스트는 마크다운 형식으로 작성 (중요 단어는 **굵게**).
★ crime_names, legal_keywords, legal_laws는 반드시 문자열 배열로 출력."""

        # OpenAI API 호출
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2,
            max_tokens=3000
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

        # 법적 분석 결과 추출
        crime_names = parsed.get("crime_names", [])
        legal_keywords = parsed.get("legal_keywords", [])
        legal_laws = parsed.get("legal_laws", [])
        print(f"🔍 법적 분석: crime_names={crime_names}, keywords={legal_keywords}, laws={legal_laws}")

        print(f"🔍 파싱된 타입: summary={type(summary_raw).__name__}, facts={type(facts_raw).__name__}, claims={type(claims_raw).__name__}")
        print(f"🔍 facts_raw 내용: {facts_raw}")
        print(f"🔍 claims_raw 내용: {claims_raw}")

        # facts가 문자열이면 배열로 변환
        if isinstance(facts_raw, str) and facts_raw.strip():
            # 문장 단위로 분리 (마침표, 함, 됨, 음, 임 등으로 끝나는 부분)
            sentences = re.split(r'(?<=[.함됨음임])\s+', facts_raw.strip())
            facts_raw = [s.strip() for s in sentences if s.strip()]
            print(f"🔄 facts 문자열→배열 변환: {len(facts_raw)}개 항목")

        # 마크다운 형식으로 변환하는 헬퍼 함수
        def to_markdown(value, is_claims=False):
            if isinstance(value, str):
                return value
            elif isinstance(value, list):
                # 리스트 → 마크다운 불렛 리스트
                result_items = []
                for item in value:
                    if isinstance(item, str):
                        result_items.append(f"- {item}")
                    elif isinstance(item, dict):
                        parts = []
                        for k, v in item.items():
                            parts.append(f"{k}: {v}")
                        result_items.append(f"- {', '.join(parts)}")
                    else:
                        result_items.append(f"- {str(item)}")
                return "\n".join(result_items)
            elif isinstance(value, dict):
                # claims 객체 → 마크다운 중첩 리스트
                result_lines = []
                for category, items in value.items():
                    result_lines.append(f"**{category}**")
                    if isinstance(items, list):
                        for item in items:
                            result_lines.append(f"- {item}")
                    result_lines.append("")  # 카테고리 간 빈 줄
                return "\n".join(result_lines).strip()
            else:
                return str(value) if value else ""

        # 모든 값을 마크다운 형식으로 변환
        summary = to_markdown(summary_raw)
        facts = to_markdown(facts_raw)
        claims = to_markdown(claims_raw, is_claims=True)

        # 후처리 없이 원본 그대로 반환 (포맷은 프론트엔드에서 처리)

        print(f"✅ 사건 분석 완료")
        print(f"   summary: {summary[:80] if len(summary) > 80 else summary}...")
        print(f"   facts type: {type(facts).__name__}, length: {len(facts)}")

        # description_hash 계산
        description_hash = hashlib.sha256(case.description.encode()).hexdigest()

        # 법적 분석 결과 JSON 직렬화
        crime_names_json = json.dumps(crime_names, ensure_ascii=False) if crime_names else None
        legal_keywords_json = json.dumps(legal_keywords, ensure_ascii=False) if legal_keywords else None
        legal_laws_json = json.dumps(legal_laws, ensure_ascii=False) if legal_laws else None

        # 분석 결과를 case_analyses 테이블에 저장 (기존 레코드 있으면 업데이트)
        if cached_summary:
            cached_summary.summary = summary
            cached_summary.facts = facts
            cached_summary.claims = claims
            cached_summary.description_hash = description_hash
            cached_summary.analyzed_at = datetime.now()
            cached_summary.crime_names = crime_names_json
            cached_summary.legal_keywords = legal_keywords_json
            cached_summary.legal_laws = legal_laws_json
            cached_summary.legal_search_results = None  # 법령 검색 결과는 별도 호출 시 재생성
            print(f"💾 캐시 업데이트 완료: case_id={case_id}")
        else:
            new_summary = CaseAnalysis(
                case_id=case_id,
                summary=summary,
                facts=facts,
                claims=claims,
                description_hash=description_hash,
                analyzed_at=datetime.now(),
                crime_names=crime_names_json,
                legal_keywords=legal_keywords_json,
                legal_laws=legal_laws_json,
            )
            db.add(new_summary)
            print(f"💾 캐시 신규 저장 완료: case_id={case_id}")
        db.commit()

        # 백그라운드에서 타임라인과 관계도 자동 생성
        print(f"🚀 타임라인 및 관계도 자동 생성 예약: case_id={case_id}")
        background_tasks.add_task(generate_timeline_and_relationships_background, case_id)

        return CaseAnalyzeResponse(
            summary=summary,
            facts=facts,
            claims=claims,
            crime_names=crime_names,
            legal_keywords=legal_keywords,
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
    """사건 정보 수정 요청 (전달된 필드만 업데이트)"""
    title: Optional[str] = None
    client_name: Optional[str] = None
    client_role: Optional[str] = None
    opponent_name: Optional[str] = None
    opponent_role: Optional[str] = None
    case_type: Optional[str] = None
    incident_date: Optional[date] = None
    incident_date_end: Optional[date] = None
    notification_date: Optional[date] = None
    notification_date_end: Optional[date] = None
    deadline_at: Optional[date] = None
    deadline_at_end: Optional[date] = None
    description: Optional[str] = None


@router.put("/{case_id}", response_model=CaseResponse)
async def update_case(
    case_id: int,
    request: CaseUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    사건 정보 수정

    - JWT 인증 필요
    - 같은 law_firm_id 소속만 수정 가능
    - 전달된 필드만 업데이트 (None이 아닌 필드)
    """
    print("=" * 50)
    print(f"📝 사건 정보 수정 요청: case_id={case_id}")
    print("=" * 50)

    try:
        case = db.query(Case).filter(Case.id == case_id).first()

        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # 전달된 필드만 업데이트
        update_data = request.model_dump(exclude_none=True)
        for field, value in update_data.items():
            setattr(case, field, value)

        db.commit()
        db.refresh(case)

        # 분석 stale 여부 계산
        cached = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()
        analysis_stale = False
        if cached and cached.description_hash and case.description:
            current_hash = hashlib.sha256(case.description.encode()).hexdigest()
            analysis_stale = cached.description_hash != current_hash

        print(f"✅ 사건 정보 수정 완료: case_id={case_id}, 수정 필드: {list(update_data.keys())}, analysis_stale={analysis_stale}")

        response_data = CaseResponse.model_validate(case).model_dump()
        analyzed_at = cached.analyzed_at if cached else None
        response_data["analyzed_at"] = analyzed_at.isoformat() if analyzed_at else None
        response_data["analysis_stale"] = analysis_stale
        return response_data

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 사건 원문 수정 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"사건 원문 수정 실패: {str(e)}")


# ==================== 사건 분석 결과 수정 API ====================

class CaseAnalysisUpdateRequest(BaseModel):
    """AI 분석 결과 수정 요청"""
    summary: Optional[str] = None
    facts: Optional[str] = None
    claims: Optional[str] = None


class CaseAnalysisResponse(BaseModel):
    """AI 분석 결과 응답"""
    case_id: int
    summary: Optional[str] = None
    facts: Optional[str] = None
    claims: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.put("/{case_id}/summary", response_model=CaseAnalysisResponse)
async def update_case_summary(
    case_id: int,
    request: CaseAnalysisUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    AI 분석 결과(summary, facts, claims) 수정

    - JWT 인증 필요
    - 같은 law_firm_id 소속만 수정 가능
    - 기존 case_analyses 레코드가 없으면 새로 생성
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
        case_summary = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()

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
            case_summary = CaseAnalysis(
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

        return CaseAnalysisResponse(
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


@router.delete("/{case_id}")
async def delete_case(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    사건 삭제 (소프트 삭제)

    - JWT 인증 필요
    - 같은 law_firm_id 소속만 삭제 가능
    - 실제로 DB에서 삭제하지 않고 availability를 'c'(closed)로 변경
    """
    print("=" * 50)
    print(f"🗑️  사건 삭제 요청: case_id={case_id}, user_id={current_user.id}")
    print("=" * 50)

    try:
        # 사건 조회 및 권한 검증
        case = db.query(Case).filter(Case.id == case_id).first()

        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

        if case.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

        # 소프트 삭제: availability를 'c'로 변경
        case.availability = 'c'
        db.commit()

        print(f"✅ 사건 삭제 완료: case_id={case_id}, title={case.title}")

        return {
            "message": "사건이 삭제되었습니다",
            "case_id": case_id
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 사건 삭제 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"사건 삭제 실패: {str(e)}")
