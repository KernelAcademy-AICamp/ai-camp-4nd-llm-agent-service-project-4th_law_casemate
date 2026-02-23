"""
검색 API 라우터
판례/법령 검색 엔드포인트 제공
"""

import asyncio
import json
import logging
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from app.services.precedent_search_service import PrecedentSearchService
from app.services.precedent_similar_service import PrecedentSimilarService
from app.services.precedent_summary_service import SummaryService
from app.services.comparison_service import ComparisonService
from app.models.evidence import Case, CaseAnalysis
from app.models.precedent import SimilarPrecedent
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
    force: bool = False  # True면 캐시 무시하고 새로 검색


class CompareRequest(BaseModel):
    case_id: Optional[int] = None  # 사건 ID (비교 분석 결과 저장용)
    origin_facts: str  # 현재 사건의 사실관계
    origin_claims: str  # 현재 사건의 청구내용
    target_case_number: str  # 비교할 유사 판례 사건번호
    force: bool = False  # True면 캐시 무시하고 새로 분석


router = APIRouter(prefix="/search", tags=["search"])


def _parse_comparison_json(summary: str) -> dict:
    """비교 분석 JSON을 parsed 형태로 변환"""
    try:
        data = json.loads(summary)
        return {
            "case_overview": data.get("case_overview", ""),
            "precedent_summary": data.get("precedent_summary", ""),
            "similarities": "\n".join(f"- {item}" for item in data.get("issue_analysis", [])) if isinstance(data.get("issue_analysis"), list) else str(data.get("issue_analysis", "")),
            "differences": "\n".join(f"- {item}" for item in data.get("differences", [])) if isinstance(data.get("differences"), list) else str(data.get("differences", "")),
            "strategy_points": "\n".join(f"- {item}" for item in data.get("strategy_points", [])) if isinstance(data.get("strategy_points"), list) else str(data.get("strategy_points", "")),
        }
    except json.JSONDecodeError:
        return {"case_overview": "", "precedent_summary": "", "similarities": "", "differences": "", "strategy_points": ""}


def _cleanup_old_comparisons(db: Session, case_id: int, max_count: int = 10):
    """
    오래된 비교 분석 정리
    - 10개 초과 시, 현재 유사 판례 목록에 없는 것 중 오래된 것부터 삭제
    """
    try:
        # 1. 해당 사건의 비교 분석 개수 확인
        total = db.query(SimilarPrecedent).filter(
            SimilarPrecedent.case_id == case_id
        ).count()

        if total <= max_count:
            return

        # 2. 현재 유사 판례 목록 가져오기
        case_analysis = db.query(CaseAnalysis).filter(
            CaseAnalysis.case_id == case_id
        ).first()

        current_case_numbers = set()
        if case_analysis and case_analysis.similar_precedents:
            try:
                cached = json.loads(case_analysis.similar_precedents)
                current_case_numbers = {c.get("case_number") for c in cached if c.get("case_number")}
            except json.JSONDecodeError:
                pass

        # 3. 현재 목록에 없는 것 중 오래된 것부터 삭제
        delete_count = total - max_count
        if current_case_numbers:
            old_records = db.query(SimilarPrecedent).filter(
                SimilarPrecedent.case_id == case_id,
                SimilarPrecedent.case_number.notin_(current_case_numbers)
            ).order_by(SimilarPrecedent.created_at.asc()).limit(delete_count).all()
        else:
            # 현재 목록이 없으면 그냥 오래된 순으로 삭제
            old_records = db.query(SimilarPrecedent).filter(
                SimilarPrecedent.case_id == case_id
            ).order_by(SimilarPrecedent.created_at.asc()).limit(delete_count).all()

        for record in old_records:
            db.delete(record)

        if old_records:
            db.commit()
            logger.info(f"[비교 분석 정리] case_id={case_id}, {len(old_records)}개 삭제")

    except Exception as e:
        logger.warning(f"[비교 분석 정리] 실패: {e}")
        db.rollback()


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
    - **force**: True면 캐시 무시하고 새로 검색
    """
    try:
        case_analysis = None

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

            # 캐시 확인 (force=False이고 캐시가 있으면 반환)
            if not request.force and case_analysis.similar_precedents:
                logger.info(f"[유사 판례 검색] case_id={request.case_id} 캐시 반환")
                try:
                    cached = json.loads(case_analysis.similar_precedents)
                    return {"results": cached, "cached": True}
                except json.JSONDecodeError:
                    logger.warning(f"[유사 판례 검색] 캐시 JSON 파싱 실패, 새로 검색")

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

        # case_id가 있으면 결과를 case_analyses.similar_precedents에 JSON 저장
        if case_analysis and results.get("results"):
            try:
                case_analysis.similar_precedents = json.dumps(results["results"], ensure_ascii=False)
                db.commit()
                logger.info(f"[유사 판례 검색] case_id={request.case_id} 결과 캐시 저장 완료")
            except Exception as e:
                logger.warning(f"[유사 판례 검색] 캐시 저장 실패: {e}")
                db.rollback()

        results["cached"] = False
        return results
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"유사 판례 검색 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="유사 판례 검색 중 오류가 발생했습니다")


@router.post("/cases/compare")
async def compare_cases(
    request: CompareRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    현재 사건과 유사 판례 비교 분석 (RAG)

    - **case_id**: 사건 ID (비교 분석 결과 저장용)
    - **origin_facts**: 현재 사건의 사실관계
    - **origin_claims**: 현재 사건의 청구내용
    - **target_case_number**: 비교할 유사 판례 사건번호
    - **force**: True면 캐시 무시하고 새로 분석
    """
    try:
        # 캐시 확인 (case_id가 있고 force=False일 때)
        if request.case_id and not request.force:
            cached = db.query(SimilarPrecedent).filter(
                SimilarPrecedent.case_id == request.case_id,
                SimilarPrecedent.case_number == request.target_case_number,
                SimilarPrecedent.summary.isnot(None),
            ).first()
            if cached:
                logger.info(f"[비교 분석] case_id={request.case_id}, 판례={request.target_case_number} 캐시 반환")
                return {
                    "success": True,
                    "analysis": cached.summary,
                    "parsed": _parse_comparison_json(cached.summary),
                    "cached": True,
                }

        # 동기 함수를 스레드 풀에서 실행 (이벤트 루프 블로킹 방지)
        result = await asyncio.to_thread(
            comparison_service.compare,
            origin_facts=request.origin_facts,
            origin_claims=request.origin_claims,
            target_case_number=request.target_case_number,
        )

        if not result.get("success"):
            raise HTTPException(status_code=404, detail=result.get("error"))

        # case_id가 있으면 비교 분석 결과 저장
        if request.case_id and result.get("analysis"):
            try:
                # 기존 레코드 확인
                existing = db.query(SimilarPrecedent).filter(
                    SimilarPrecedent.case_id == request.case_id,
                    SimilarPrecedent.case_number == request.target_case_number,
                ).first()

                if existing:
                    # 기존 레코드 업데이트
                    existing.summary = result["analysis"]
                else:
                    # 새 레코드 생성
                    new_record = SimilarPrecedent(
                        case_id=request.case_id,
                        case_number=request.target_case_number,
                        summary=result["analysis"],
                    )
                    db.add(new_record)

                db.commit()
                logger.info(f"[비교 분석] case_id={request.case_id}, 판례={request.target_case_number} 저장 완료")

                # 오래된 비교 분석 정리 (10개 초과 시)
                _cleanup_old_comparisons(db, request.case_id)

            except Exception as e:
                logger.warning(f"[비교 분석] 저장 실패: {e}")
                db.rollback()

        result["cached"] = False
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"비교 분석 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="비교 분석 중 오류가 발생했습니다")
