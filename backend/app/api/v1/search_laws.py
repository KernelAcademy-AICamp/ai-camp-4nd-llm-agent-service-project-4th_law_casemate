"""
법령 검색 API 라우터
사건 내용 기반 관련 법령 검색 엔드포인트 제공

v2.0: 2단계 파이프라인 (법적 쟁점 추출 → 법령 검색)
v2.1: 추출된 법적 쟁점 DB 캐싱
"""

import asyncio
import json
import hashlib
import traceback
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.search_laws_service import SearchLawsService
from app.models.evidence import Case, CaseAnalysis
from tool.database import get_db


class SearchLawsRequest(BaseModel):
    query: str  # 사건 요약 + 사실관계
    limit: Optional[int] = 5
    score_threshold: Optional[float] = 0.3


class SearchLawsByCaseRequest(BaseModel):
    """사건 ID 기반 법령 검색 요청"""
    limit: Optional[int] = 8


class SearchTermRequest(BaseModel):
    """법률 용어 기반 조문 검색 요청 (BM25 로컬 검색, API 호출 없음)"""
    term: str  # 법률 용어 (예: "주거침입죄", "손해배상청구")
    limit: Optional[int] = 3


class GetArticleRequest(BaseModel):
    """조문 조회 요청"""
    law_name: str  # 법령명 (예: "형법")
    article_number: str  # 조문번호 (예: "307" 또는 "제307조")


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
        # 동기 함수를 스레드 풀에서 실행 (이벤트 루프 블로킹 방지)
        results = await asyncio.to_thread(
            search_laws_service.search_laws,
            query=request.query,
            limit=request.limit,
            score_threshold=request.score_threshold,
        )
        print(f"✅ 법령 검색 완료: {results.get('total', 0)}건")
        return results
    except Exception as e:
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
        case_summary = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()

        description = case.description or ""
        summary = case_summary.summary if case_summary else None
        facts = case_summary.facts if case_summary else None
        case_type = case.case_type

        print(f"   원문 길이: {len(description)}자")
        print(f"   요약 존재: {'예' if summary else '아니오'}")
        print(f"   사실관계 존재: {'예' if facts else '아니오'}")
        print(f"   사건 유형: {case_type or '미지정'}")

        # description_hash 검증: 원문이 변경되었으면 캐시 무효
        current_hash = hashlib.sha256(description.encode()).hexdigest() if description else None
        cache_valid = (
            case_summary
            and case_summary.description_hash
            and case_summary.description_hash == current_hash
        )
        print(f"   캐시 유효: {'예' if cache_valid else '아니오'} (hash match: {case_summary.description_hash[:8] if case_summary and case_summary.description_hash else 'N/A'} vs {current_hash[:8] if current_hash else 'N/A'})")

        # === 완전 캐시 히트: GPT 추출 + 벡터 검색 결과 모두 캐시됨 ===
        if cache_valid and case_summary.legal_search_results:
            try:
                cached_results = json.loads(case_summary.legal_search_results)
                cached_results["extracted"] = {
                    "crime_names": json.loads(case_summary.crime_names) if case_summary.crime_names else [],
                    "keywords": json.loads(case_summary.legal_keywords) if case_summary.legal_keywords else [],
                    "laws": json.loads(case_summary.legal_laws) if case_summary.legal_laws else [],
                }
                print(f"✅ 완전 캐시 히트: GPT+벡터 검색 결과 모두 캐시에서 반환")
                print(f"✅ 법령 검색 완료: {cached_results.get('total', 0)}건")
                return cached_results
            except json.JSONDecodeError:
                print(f"⚠️ 캐시 파싱 실패, 재검색 진행")

        # === 부분 캐시 히트: keywords만 캐시됨, 검색 결과는 없음 ===
        if cache_valid and case_summary and case_summary.legal_keywords:
            try:
                cached_keywords = json.loads(case_summary.legal_keywords)
                cached_laws = json.loads(case_summary.legal_laws) if case_summary.legal_laws else []
                print(f"   📦 부분 캐시 히트: 키워드 캐시 사용, 벡터 검색 실행")

                results = search_laws_service.search_laws_with_cached_extraction(
                    keywords=cached_keywords,
                    laws=cached_laws,
                    limit=request.limit,
                )
                cached_crime_names = json.loads(case_summary.crime_names) if case_summary.crime_names else []
                extracted = {"crime_names": cached_crime_names, "keywords": cached_keywords, "laws": cached_laws}
                results["extracted"] = extracted

                # 벡터 검색 결과도 캐시에 저장
                results_to_cache = {"total": results.get("total", 0), "results": results.get("results", [])}
                case_summary.legal_search_results = json.dumps(results_to_cache, ensure_ascii=False)
                db.commit()
                print(f"   💾 벡터 검색 결과 캐시 저장 완료")

                print(f"✅ 법적 쟁점: {extracted.get('keywords', [])}")
                print(f"✅ 관련 법조문: {extracted.get('laws', [])}")
                print(f"✅ 법령 검색 완료: {results.get('total', 0)}건")
                return results
            except json.JSONDecodeError:
                pass

        # === 캐시 미스: hash 불일치 or 최초 검색 → 전체 파이프라인 실행 ===
        if not cache_valid and case_summary:
            # hash 불일치 시 기존 캐시 모두 무효화
            case_summary.legal_keywords = None
            case_summary.legal_laws = None
            case_summary.crime_names = None
            case_summary.legal_search_results = None
            print(f"   🗑️ hash 불일치: 기존 법령 캐시 무효화")

        # 2단계 파이프라인 실행 (GPT 추출 + 벡터 검색)
        results = search_laws_service.search_laws_with_extraction(
            description=description,
            summary=summary,
            facts=facts,
            case_type=case_type,
            limit=request.limit,
        )

        extracted = results.get("extracted", {})

        # 추출 결과 + 검색 결과 DB 저장
        if extracted.get("keywords") and case_summary:
            case_summary.crime_names = json.dumps(extracted.get("crime_names", []), ensure_ascii=False)
            case_summary.legal_keywords = json.dumps(extracted.get("keywords", []), ensure_ascii=False)
            case_summary.legal_laws = json.dumps(extracted.get("laws", []), ensure_ascii=False)
            results_to_cache = {"total": results.get("total", 0), "results": results.get("results", [])}
            case_summary.legal_search_results = json.dumps(results_to_cache, ensure_ascii=False)
            db.commit()
            print(f"   💾 법적 쟁점 + 검색 결과 저장 완료")

        print(f"✅ 법적 쟁점: {extracted.get('keywords', [])}")
        print(f"✅ 관련 법조문: {extracted.get('laws', [])}")
        print(f"✅ 법령 검색 완료: {results.get('total', 0)}건")

        return results

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 법령 검색 오류: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"법령 검색 중 오류 발생: {str(e)}")


@router.post("/search-term")
async def search_term(request: SearchTermRequest):
    """
    법률 용어 기반 관련 조문 검색 (BM25 로컬 검색 — 외부 API 호출 없음)

    죄명("주거침입죄"), 청구유형("손해배상청구") 등 법률 용어를
    BM25 키워드 매칭으로 관련 조문을 검색합니다.
    FastEmbed 로컬 실행이므로 과금이 발생하지 않습니다.

    - **term**: 법률 용어 (예: "주거침입죄", "손해배상청구")
    - **limit**: 반환할 최대 결과 수 (기본 3)
    """
    print(f"📜 법률 용어 검색 (BM25): {request.term}")

    try:
        results = await asyncio.to_thread(
            search_laws_service.search_by_term,
            term=request.term,
            limit=request.limit,
        )

        if results["total"] == 0:
            raise HTTPException(
                status_code=404,
                detail=f"관련 법조항을 찾을 수 없습니다: {request.term}",
            )

        print(f"✅ 법률 용어 검색 완료: {results['total']}건")
        return results

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 법률 용어 검색 오류: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"법률 용어 검색 중 오류 발생: {str(e)}")


@router.post("/article")
async def get_article(request: GetArticleRequest):
    """
    특정 조문 조회 (하이브리드: DB 우선 → API Fallback → 캐싱)

    - **law_name**: 법령명 (예: "형법")
    - **article_number**: 조문번호 (예: "307" 또는 "제307조")

    Returns:
        조문 전체 내용 + 항별 분리 데이터
    """
    print(f"📜 조문 조회: {request.law_name} 제{request.article_number}조")

    try:
        # 하이브리드 조회: DB 우선, 없으면 API에서 가져와서 캐싱
        result = await search_laws_service.get_article_with_fallback(
            law_name=request.law_name,
            article_number=request.article_number,
        )

        if not result:
            raise HTTPException(
                status_code=404,
                detail=f"조문을 찾을 수 없습니다: {request.law_name} 제{request.article_number}조"
            )

        print(f"✅ 조문 조회 완료: {result.get('law_name')} 제{result.get('article_number')}조")
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 조문 조회 오류: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"조문 조회 중 오류 발생: {str(e)}")
