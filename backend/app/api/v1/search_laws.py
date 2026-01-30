"""
법령 검색 API 라우터
사건 내용 기반 관련 법령 검색 엔드포인트 제공
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services.search_laws_service import SearchLawsService


class SearchLawsRequest(BaseModel):
    query: str  # 사건 요약 + 사실관계
    limit: Optional[int] = 5
    score_threshold: Optional[float] = 0.3


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
