"""
법령 검색 API 라우터
사건 내용 기반 관련 법령 검색 엔드포인트 제공

v2.0: 2단계 파이프라인 (법적 쟁점 추출 → 법령 검색)
v2.1: 추출된 법적 쟁점 DB 캐싱
"""

import json
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.search_laws_service import SearchLawsService
from app.models.evidence import Case, CaseSummary
from tool.database import get_db


class SearchLawsRequest(BaseModel):
    query: str  # 사건 요약 + 사실관계
    limit: Optional[int] = 5
    score_threshold: Optional[float] = 0.3


class SearchLawsByCaseRequest(BaseModel):
    """사건 ID 기반 법령 검색 요청"""
    limit: Optional[int] = 8


router = APIRouter(prefix="/laws", tags=["laws"])

# 서비스 인스턴스
search_laws_service = SearchLawsService()


@router.post("/search")
async def search_laws(request: SearchLawsRequest):
    """
    관련 법령 검색

    - **query**: 검색할 텍스트 (사건 요약 + 사실관계)
    - **limit**: 반환할 최대 결과 수 (기본 5)
    - **score_threshold**: 최소 유사도 점수 (기본 0.3)
    """
    print("=" * 50)
    print(f"📜 법령 검색 요청")
    print(f"   쿼리: {request.query[:100]}..." if len(request.query) > 100 else f"   쿼리: {request.query}")
    print("=" * 50)
    try:
        results = search_laws_service.search_laws(
            query=request.query,
            limit=request.limit,
            score_threshold=request.score_threshold,
        )
        print(f"✅ 법령 검색 완료: {results.get('total', 0)}건")
        return results
    except Exception as e:
        import traceback
        print(f"❌ 법령 검색 오류: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"법령 검색 중 오류 발생: {str(e)}")


@router.post("/search-by-case/{case_id}")
async def search_laws_by_case(
    case_id: int,
    request: SearchLawsByCaseRequest = SearchLawsByCaseRequest(),
    db: Session = Depends(get_db),
):
    """
    사건 ID 기반 관련 법령 검색 (2단계 파이프라인)

    1단계: 사건 원문 + AI 요약에서 법적 쟁점/관련 법조문 추출
    2단계: 추출된 쟁점으로 법령 벡터 검색

    - **case_id**: 사건 ID
    - **limit**: 반환할 최대 결과 수 (기본 8)
    """
    print("=" * 50)
    print(f"📜 법령 검색 요청 (2단계 파이프라인): case_id={case_id}")
    print("=" * 50)

    try:
        # 사건 정보 조회
        case = db.query(Case).filter(Case.id == case_id).first()
        if not case:
            raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

        # 사건 분석 결과 조회 (있으면)
        case_summary = db.query(CaseSummary).filter(CaseSummary.case_id == case_id).first()

        description = case.description or ""
        summary = case_summary.summary if case_summary else None
        facts = case_summary.facts if case_summary else None
        case_type = case.case_type

        print(f"   원문 길이: {len(description)}자")
        print(f"   요약 존재: {'예' if summary else '아니오'}")
        print(f"   사실관계 존재: {'예' if facts else '아니오'}")
        print(f"   사건 유형: {case_type or '미지정'}")

        # 캐시된 법적 쟁점 확인
        cached_keywords = None
        cached_laws = None
        if case_summary and case_summary.legal_keywords:
            try:
                cached_keywords = json.loads(case_summary.legal_keywords)
                cached_laws = json.loads(case_summary.legal_laws) if case_summary.legal_laws else []
                print(f"   📦 캐시된 법적 쟁점 사용")
            except json.JSONDecodeError:
                pass

        if cached_keywords:
            # 캐시된 데이터로 검색
            results = search_laws_service.search_laws_with_cached_extraction(
                keywords=cached_keywords,
                laws=cached_laws,
                limit=request.limit,
            )
            extracted = {"keywords": cached_keywords, "laws": cached_laws}
            results["extracted"] = extracted
        else:
            # 2단계 파이프라인 실행
            results = search_laws_service.search_laws_with_extraction(
                description=description,
                summary=summary,
                facts=facts,
                case_type=case_type,
                limit=request.limit,
            )

            extracted = results.get("extracted", {})

            # 추출 결과 DB 저장
            if extracted.get("keywords") and case_summary:
                case_summary.legal_keywords = json.dumps(extracted.get("keywords", []), ensure_ascii=False)
                case_summary.legal_laws = json.dumps(extracted.get("laws", []), ensure_ascii=False)
                db.commit()
                print(f"   💾 법적 쟁점 저장 완료")

        print(f"✅ 법적 쟁점: {extracted.get('keywords', [])}")
        print(f"✅ 관련 법조문: {extracted.get('laws', [])}")
        print(f"✅ 법령 검색 완료: {results.get('total', 0)}건")

        return results

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"❌ 법령 검색 오류: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"법령 검색 중 오류 발생: {str(e)}")
