"""
검색 API 라우터
판례/법령 검색 엔드포인트 제공
"""

import logging
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services.precedent_search_service import PrecedentSearchService
from app.services.similar_search_service import SimilarSearchService
from app.services.precedent_summary_service import SummaryService
from app.services.comparison_service import ComparisonService

logger = logging.getLogger(__name__)


class SummarizeRequest(BaseModel):
    content: str
    case_number: Optional[str] = None  # 사건번호 (있으면 저장된 요약 우선 조회)
    # 메타데이터 (새 요약 저장 시 사용)
    case_name: Optional[str] = None
    court_name: Optional[str] = None
    judgment_date: Optional[str] = None


class SimilarCasesRequest(BaseModel):
    query: str  # AI 요약의 결과요약 + 사실관계
    exclude_case_number: Optional[str] = None  # 현재 판례 제외


class CompareRequest(BaseModel):
    origin_facts: str  # 현재 사건의 사실관계
    origin_claims: str  # 현재 사건의 청구내용
    target_case_number: str  # 비교할 유사 판례 사건번호


router = APIRouter(prefix="/search", tags=["search"])

# 서비스 인스턴스
search_service = PrecedentSearchService()
similar_search_service = SimilarSearchService()
summary_service = SummaryService()
comparison_service = ComparisonService()


@router.get("/cases")
async def search_cases(
    query: str = Query(..., description="검색 키워드", min_length=1),
    limit: int = Query(30, description="결과 개수", ge=1, le=100),
    merge_chunks: bool = Query(True, description="같은 판례 청크 병합"),
):
    """
    판례 검색 (하이브리드: 의미 + 키워드)

    - **query**: 검색할 키워드 (필수)
    - **limit**: 반환할 최대 결과 수 (기본 30, 최대 100)
    - **merge_chunks**: 같은 판례의 청크를 하나로 병합 (기본 True)
    """
    try:
        results = search_service.search_cases(
            query=query,
            limit=limit,
            merge_chunks=merge_chunks,
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"검색 중 오류 발생: {str(e)}")


@router.get("/cases/recent")
async def get_recent_cases(
    limit: int = Query(10, description="결과 개수", ge=1, le=100),
):
    """
    최신 판례 목록 조회 (판결일 기준 내림차순)

    - **limit**: 반환할 최대 결과 수 (기본 10, 최대 100)
    """
    try:
        results = search_service.get_recent_cases(limit=limit)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 중 오류 발생: {str(e)}")


@router.get("/cases/{case_number:path}")
async def get_case_detail(case_number: str):
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
        raise HTTPException(status_code=500, detail=f"조회 중 오류 발생: {str(e)}")


@router.post("/summarize")
async def summarize(request: SummarizeRequest):
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
            result = summary_service.get_or_generate_summary(
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
            summary = summary_service.summarize(content=request.content)
            return {"summary": summary, "cached": False, "saved": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"요약 중 오류 발생: {str(e)}")


@router.post("/cases/similar")
async def search_similar_cases(request: SimilarCasesRequest):
    """
    유사 판례 검색 (하이브리드: 의미 + 키워드)

    - **query**: 검색 쿼리 (AI 요약의 결과요약 + 사실관계)
    - **exclude_case_number**: 제외할 판례 사건번호 (현재 보고 있는 판례)
    """
    try:
        results = similar_search_service.search_similar_cases(
            query=request.query,
            exclude_case_number=request.exclude_case_number,
            limit=3,
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"유사 판례 검색 중 오류 발생: {str(e)}")


@router.post("/cases/compare")
async def compare_cases(request: CompareRequest):
    """
    현재 사건과 유사 판례 비교 분석 (RAG)

    - **origin_facts**: 현재 사건의 사실관계
    - **origin_claims**: 현재 사건의 청구내용
    - **target_case_number**: 비교할 유사 판례 사건번호
    """
    try:
        result = comparison_service.compare(
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
        raise HTTPException(status_code=500, detail=f"비교 분석 중 오류 발생: {str(e)}")
