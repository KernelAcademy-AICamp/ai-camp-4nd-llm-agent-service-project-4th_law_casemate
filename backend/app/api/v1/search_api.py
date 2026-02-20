"""
검색 API 라우터
판례/법령 검색 엔드포인트 제공
"""

import asyncio
import logging
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session

from app.services.precedent_search_service import PrecedentSearchService
from app.services.precedent_similar_service import PrecedentSimilarService
from app.services.precedent_summary_service import SummaryService
from app.services.comparison_service import ComparisonService
from app.models.evidence import Case, CaseAnalysis
from app.models.user import User
from tool.database import get_db
from tool.security import get_current_user

logger = logging.getLogger(__name__)


class SummarizeRequest(BaseModel):
    content: str
    case_number: Optional[str] = None  # 사건번호 (있으면 저장된 요약 우선 조회)
    # 메타데이터 (새 요약 저장 시 사용)
    case_name: Optional[str] = None
    court_name: Optional[str] = None
    judgment_date: Optional[str] = None


class SimilarCasesRequest(BaseModel):
    case_id: Optional[int] = None  # 사건 ID (DB에서 summary, facts, claims 조회)
    query: Optional[str] = None  # 직접 쿼리 (case_id 없을 때 사용)
    exclude_case_number: Optional[str] = None  # 현재 판례 제외


class CompareRequest(BaseModel):
    origin_facts: str  # 현재 사건의 사실관계
    origin_claims: str  # 현재 사건의 청구내용
    target_case_number: str  # 비교할 유사 판례 사건번호


router = APIRouter(prefix="/search", tags=["search"])

# 서비스 인스턴스
search_service = PrecedentSearchService()
similar_search_service = PrecedentSimilarService()
summary_service = SummaryService()
comparison_service = ComparisonService()


@router.get("/cases")
async def search_cases(
    query: str = Query(..., description="검색 키워드", min_length=1),
    limit: int = Query(50, description="결과 개수", ge=1, le=500),
    offset: int = Query(0, description="건너뛸 결과 수 (페이지네이션용)", ge=0),
    sort: str = Query("relevance", description="정렬 순서 (relevance=관련순, latest=최신순)"),
    merge_chunks: bool = Query(True, description="같은 판례 청크 병합"),
    court_type: Optional[str] = Query(None, description="법원 유형 (대법원, 고등법원, 지방법원)"),
    case_type: Optional[str] = Query(None, description="사건 종류 (민사, 형사, 일반행정, 가사)"),
    period: Optional[str] = Query(None, description="기간 (1y, 3y, 5y, 10y)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    판례 검색 (하이브리드: 의미 + 키워드)

    - **query**: 검색할 키워드 (필수)
    - **limit**: 반환할 최대 결과 수 (기본 50, 최대 500)
    - **offset**: 건너뛸 결과 수 (기본 0, 페이지네이션용)
    - **sort**: 정렬 순서 (relevance=관련순, latest=최신순)
    - **merge_chunks**: 같은 판례의 청크를 하나로 병합 (기본 True)
    - **court_type**: 법원 유형 필터 (대법원, 고등법원, 지방법원)
    - **case_type**: 사건 종류 필터 (민사, 형사, 일반행정, 가사)
    - **period**: 기간 필터 (1y=최근1년, 3y=최근3년, 5y=최근5년, 10y=최근10년)
    """
    try:
        # 필터 구성
        filters = {}
        if court_type:
            filters["court_type"] = court_type
        if case_type:
            filters["case_type"] = case_type
        if period:
            filters["period"] = period

        results = search_service.search_cases(
            query=query,
            limit=limit,
            offset=offset,
            sort=sort,
            merge_chunks=merge_chunks,
            filters=filters if filters else None,
        )
        return results
    except Exception as e:
        logger.error(f"검색 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="검색 중 오류가 발생했습니다")


@router.get("/cases/recent")
async def get_recent_cases(
    limit: int = Query(10, description="결과 개수", ge=1, le=100),
    current_user: User = Depends(get_current_user),
):
    """
    최신 판례 목록 조회 (판결일 기준 내림차순)

    - **limit**: 반환할 최대 결과 수 (기본 10, 최대 100)
    """
    try:
        results = search_service.get_recent_cases(limit=limit)
        return results
    except Exception as e:
        logger.error(f"최신 판례 조회 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="조회 중 오류가 발생했습니다")


@router.get("/cases/{case_number:path}")
async def get_case_detail(case_number: str, current_user: User = Depends(get_current_user)):
    """
    판례 상세 조회

    - **case_number**: 사건번호 (예: 대법원 2020다12345)
    - Qdrant에 없으면 법령 API에서 실시간 조회
    """
    try:
        # Qdrant 우선 조회, 없으면 법령 API fallback (서비스 레이어 통합)
        result = await search_service.get_case_detail_with_fallback(case_number)

        if result is None:
            raise HTTPException(status_code=404, detail="판례를 찾을 수 없습니다.")

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"판례 상세 조회 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="조회 중 오류가 발생했습니다")


@router.post("/summarize")
async def summarize(request: SummarizeRequest, current_user: User = Depends(get_current_user)):
    """
    판례/법령 내용 요약

    - **content**: 요약할 텍스트 (필수)
    - **case_number**: 사건번호 (선택, 있으면 저장된 요약 우선 조회)
    - **case_name**: 사건명 (선택, 새 요약 저장 시 사용)
    - **court_name**: 법원명 (선택, 새 요약 저장 시 사용)
    - **judgment_date**: 선고일자 (선택, 새 요약 저장 시 사용)
    """
    try:
        if request.case_number:
            # 메타데이터 구성 (새 요약 저장 시 사용)
            case_info = {
                "case_name": request.case_name or "",
                "court_name": request.court_name or "",
                "judgment_date": request.judgment_date or "",
            }

            # 사건번호가 있으면 저장된 요약 우선 조회, 없으면 생성 후 저장
            # 동기 함수를 스레드 풀에서 실행 (이벤트 루프 블로킹 방지)
            result = await asyncio.to_thread(
                summary_service.get_or_generate_summary,
                case_number=request.case_number,
                content=request.content,
                case_info=case_info,
            )
            return {
                "summary": result["summary"],
                "cached": result["cached"],
                "saved": result.get("saved", False),
            }
        else:
            # 사건번호 없으면 바로 생성 (저장 안함)
            # 동기 함수를 스레드 풀에서 실행
            summary = await asyncio.to_thread(
                summary_service.summarize,
                content=request.content,
            )
            return {"summary": summary, "cached": False, "saved": False}
    except Exception as e:
        logger.error(f"요약 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="요약 중 오류가 발생했습니다")


@router.post("/cases/similar")
async def search_similar_cases(
    request: SimilarCasesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    유사 판례 검색 (하이브리드: 의미 + 키워드)

    - **case_id**: 사건 ID (DB에서 summary, facts, claims 조회)
    - **query**: 직접 쿼리 (case_id 없을 때 사용)
    - **exclude_case_number**: 제외할 판례 사건번호 (현재 보고 있는 판례)
    """
    try:
        # case_id가 있으면 DB에서 조회
        if request.case_id:
            case = db.query(Case).filter(Case.id == request.case_id).first()
            if not case:
                raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")
            if case.law_firm_id != current_user.firm_id:
                raise HTTPException(status_code=403, detail="해당 사건에 접근할 권한이 없습니다")

            case_analysis = db.query(CaseAnalysis).filter(
                CaseAnalysis.case_id == request.case_id
            ).first()

            if not case_analysis:
                raise HTTPException(status_code=404, detail="사건 분석 결과를 찾을 수 없습니다. 먼저 사건 분석을 진행해주세요.")

            # summary + facts + claims 조합
            query_parts = []
            if case_analysis.summary:
                query_parts.append(case_analysis.summary)
            if case_analysis.facts:
                query_parts.append(case_analysis.facts)
            if case_analysis.claims:
                query_parts.append(case_analysis.claims)

            query = " ".join(query_parts)
            logger.info(f"[유사 판례 검색] case_id={request.case_id}에서 쿼리 조회, 길이={len(query)}")
        elif request.query:
            query = request.query
        else:
            raise HTTPException(status_code=400, detail="case_id 또는 query가 필요합니다.")

        # 동기 함수를 스레드 풀에서 실행 (이벤트 루프 블로킹 방지)
        results = await asyncio.to_thread(
            similar_search_service.search_similar_cases,
            query=query,
            exclude_case_number=request.exclude_case_number,
            limit=5,
        )
        return results
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"유사 판례 검색 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="유사 판례 검색 중 오류가 발생했습니다")


@router.post("/cases/compare")
async def compare_cases(request: CompareRequest, current_user: User = Depends(get_current_user)):
    """
    현재 사건과 유사 판례 비교 분석 (RAG)

    - **origin_facts**: 현재 사건의 사실관계
    - **origin_claims**: 현재 사건의 청구내용
    - **target_case_number**: 비교할 유사 판례 사건번호
    """
    try:
        # 동기 함수를 스레드 풀에서 실행 (이벤트 루프 블로킹 방지)
        result = await asyncio.to_thread(
            comparison_service.compare,
            origin_facts=request.origin_facts,
            origin_claims=request.origin_claims,
            target_case_number=request.target_case_number,
        )

        if not result.get("success"):
            raise HTTPException(status_code=404, detail=result.get("error"))

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"비교 분석 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="비교 분석 중 오류가 발생했습니다")
