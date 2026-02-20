"""
참조판례 수집 스크립트
Qdrant에 저장된 판례의 참조판례 섹션에서 사건번호를 추출하여 수집합니다.
"""

import sys
import asyncio
import argparse
import re
from pathlib import Path
from typing import List, Dict, Any, Set

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from tool.law_api_client import LawAPIClient
from tool.qdrant_client import QdrantService
from scripts.base_collector import BaseCaseCollector


class RefCaseCollector(BaseCaseCollector):
    """참조판례 수집기 (BaseCaseCollector 상속)"""

    # 참조판례를 수집할 키워드 목록
    # "비방", "모욕", "정신적 손해", "성희롱" -> 요약 수집 안함
    # "명예" -> 요약 수집함
    KEYWORDS = ["ref:명예"]

    def __init__(self):
        super().__init__()
        from tool.qdrant_client import get_qdrant_client
        self.qdrant_client = get_qdrant_client()  # 싱글톤 사용
        self.api_client: LawAPIClient | None = None

    # ==================== 고유 로직: Qdrant에서 참조판례 추출 ====================

    def get_ref_case_numbers(self, keyword: str) -> Dict[str, Set[str]]:
        """
        Qdrant에서 특정 keyword 판례들의 참조판례 사건번호 추출

        Args:
            keyword: 검색 키워드 (예: "명예")

        Returns:
            {원본_사건번호: {참조판례_사건번호들}} 형태의 딕셔너리
        """
        print(f"\n[{keyword}] Qdrant에서 참조판례 정보 조회 중...")

        # keyword가 일치하는 모든 chunk 조회
        all_points = []
        offset = None

        while True:
            results, offset = self.qdrant_client.scroll(
                collection_name='precedents',
                scroll_filter=Filter(
                    must=[
                        FieldCondition(key="keyword", match=MatchValue(value=keyword))
                    ]
                ),
                limit=1000,
                offset=offset,
                with_payload=True,
                with_vectors=False
            )
            all_points.extend(results)

            if offset is None:
                break

        print(f"  → 총 {len(all_points)}개 청크 조회됨")

        # section에 "참조판례" 포함된 것만 필터링
        ref_chunks = [p for p in all_points if '참조판례' in p.payload.get('section', '')]
        print(f"  → 참조판례 섹션 포함: {len(ref_chunks)}개 청크")

        # 원본 판례별로 참조판례 사건번호 추출
        ref_map: Dict[str, Set[str]] = {}

        for chunk in ref_chunks:
            origin_case = chunk.payload.get('case_number', '')
            content = chunk.payload.get('content', '')

            # 【참조판례】 이후 내용에서 사건번호 추출
            # 패턴: 2012도13607, 2019다12345, 98다10472 등
            case_numbers = re.findall(r'\d{2,4}[가-힣]+\d+', content)

            if origin_case not in ref_map:
                ref_map[origin_case] = set()
            ref_map[origin_case].update(case_numbers)

        unique_refs = set()
        for refs in ref_map.values():
            unique_refs.update(refs)

        print(f"  → {len(ref_map)}개 판례에서 {len(unique_refs)}개 고유 참조판례 추출됨")

        return ref_map

    # ==================== 고유 로직: 사건번호로 API 검색 ====================

    async def search_case_by_number(self, case_number: str, keyword: str = "") -> Dict[str, Any] | None:
        """
        사건번호로 판례 검색 후 상세 정보 조회 (Rate Limit + Retry 적용)

        Args:
            case_number: 사건번호 (예: "2012도13607")
            keyword: 검색 키워드 (실패 기록용)

        Returns:
            판례 상세 정보 또는 None
        """
        # 1. 사건번호로 검색 (Rate Limit + Retry)
        result = await self.api_call_with_retry(
            self.api_client.search_cases,
            query=case_number,
            display=50,
            case_number=case_number,
            keyword=keyword,
        )

        if result is None:
            return None

        prec_search = result.get("PrecSearch", {})
        cases = prec_search.get("prec", [])

        if not cases:
            return None

        if isinstance(cases, dict):
            cases = [cases]

        # 정확히 일치하는 사건번호 찾기
        for case in cases:
            if case.get("사건번호", "").replace(" ", "") == case_number.replace(" ", ""):
                case_id = case.get("판례일련번호", "")
                if case_id:
                    # 2. 상세 조회 (Rate Limit + Retry)
                    detail_result = await self.api_call_with_retry(
                        self.api_client.get_case_detail,
                        case_id,
                        case_number=case_number,
                        keyword=keyword,
                    )
                    if detail_result:
                        return detail_result.get("PrecService", {})

        return None

    # ==================== 메인 수집 로직 ====================

    async def collect(self, skip_summary: bool = False):
        """참조판례 수집 실행"""
        print(f"\n참조판례 수집 시작 (키워드: {', '.join(self.KEYWORDS)})")
        if skip_summary:
            print("  → 요약 생성 건너뜀 (--skip-summary)")

        if not self.qdrant_service.check_connection():
            print("에러: Qdrant 서버에 연결할 수 없습니다.")
            return

        # 이미 수집된 사건번호 로드
        self.load_existing_case_numbers()

        total_collected = 0
        total_saved = 0
        total_skipped = 0
        total_failed = 0
        total_summaries = 0

        # API 클라이언트 세션 유지 (전체 수집 동안 재사용)
        async with LawAPIClient() as client:
            self.api_client = client

            for keyword in self.KEYWORDS:
                # 1. 해당 키워드 판례들의 참조판례 사건번호 추출
                ref_map = self.get_ref_case_numbers(keyword)

                # 2. 모든 참조판례 사건번호 수집 (중복 제거)
                all_ref_numbers = set()
                ref_from_map = {}  # 참조판례 → 원본 판례 매핑

                for origin_case, ref_cases in ref_map.items():
                    for ref_case in ref_cases:
                        all_ref_numbers.add(ref_case)
                        if ref_case not in ref_from_map:
                            ref_from_map[ref_case] = []
                        ref_from_map[ref_case].append(origin_case)

                # 3. 이미 수집된 것 제외
                new_refs = all_ref_numbers - self.collected_case_numbers
                print(f"\n[{keyword}] 새로 수집할 참조판례: {len(new_refs)}건 (기존 {len(all_ref_numbers) - len(new_refs)}건 제외)")

                # 4. 각 참조판례 수집
                for i, ref_number in enumerate(new_refs, 1):
                    print(f"  [{i}/{len(new_refs)}] {ref_number} 수집 중...", end=" ")

                    # API로 상세 조회 (Rate Limit + Retry 적용)
                    detail = await self.search_case_by_number(ref_number, keyword=keyword)

                    if not detail:
                        print("→ 조회 실패")
                        total_failed += 1
                        continue

                    actual_case_number = detail.get("사건번호", ref_number)

                    # 이미 수집된 경우 스킵
                    if self.is_duplicate(actual_case_number):
                        print("→ 이미 존재")
                        total_skipped += 1
                        continue

                    # 메타데이터 구성 (참조판례 고유 필드 포함)
                    case_info = {
                        "case_number": actual_case_number,
                        "case_name": detail.get("사건명", ""),
                        "court_name": detail.get("법원명", ""),
                        "judgment_date": detail.get("선고일자", ""),
                        "case_type": detail.get("사건종류명", ""),
                        "judgment_type": detail.get("판결유형", ""),
                        "case_serial_number": detail.get("판례정보일련번호", ""),
                        "case_type_code": detail.get("사건종류코드", ""),
                        "court_type_code": detail.get("법원종류코드", ""),
                        "source": "reference",  # 참조판례 구분
                        "ref_from": ",".join(ref_from_map.get(ref_number, [])),
                    }

                    # 공통 처리 (청킹 → 임베딩 → 저장 → 요약)
                    ref_keyword = f"ref:{keyword}"
                    result = self.process_case(detail, case_info, ref_keyword, skip_summary)

                    total_saved += result["chunks_saved"]
                    if result["summary_saved"]:
                        total_summaries += 1

                    total_collected += 1
                    print(f"→ 완료 ({result['chunks_saved']}청크)")

        # 실패 케이스 저장
        self.save_failed_cases()

        print(f"\n수집 완료!")
        print(f"  - 수집: {total_collected}건")
        print(f"  - 저장: {total_saved}개 청크")
        print(f"  - 요약: {total_summaries}개")
        print(f"  - 스킵(중복): {total_skipped}건")
        print(f"  - 실패: {total_failed}건")
        if self.get_failed_cases_count() > 0:
            print(f"  - API 실패 기록: {self.get_failed_cases_count()}건 (failed_cases.json 참고)")


async def main():
    parser = argparse.ArgumentParser(description="참조판례 수집")
    parser.add_argument(
        "--skip-summary",
        action="store_true",
        help="요약 생성 건너뜀"
    )
    args = parser.parse_args()

    collector = RefCaseCollector()
    await collector.collect(skip_summary=args.skip_summary)


if __name__ == "__main__":
    asyncio.run(main())
