"""
키워드 기반 판례 수집 스크립트
API에서 키워드로 검색하여 판례를 수집합니다.
"""

import sys
import time
import asyncio
import argparse
import traceback
from pathlib import Path
from typing import List, Dict, Any, Optional

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from tool.law_api_client import LawAPIClient
from tool.qdrant_client import QdrantService
from scripts.base_collector import BaseCaseCollector


class CaseCollector(BaseCaseCollector):
    """키워드 기반 판례 수집기"""

    # 검색 키워드
    # [ "명예" , "명예훼손", "비방", "모욕", "성희롱","명예훼손 손해배상", "정신적 손해", "징계해고"] "부당해고" 399건 중 183건 수집
    KEYWORDS = ["허위사실"]

    # ==================== 고유 로직: API 검색 ====================

    async def fetch_case_list(self, keyword: str, max_pages: int = 100) -> List[Dict[str, Any]]:
        """키워드로 판례 목록 검색 (페이지네이션)"""
        all_cases = []

        async with LawAPIClient() as client:
            page = 1
            while page <= max_pages:
                result = await client.search_cases(
                    query=keyword,
                    display=100,
                    page=page
                )

                prec_search = result.get("PrecSearch", {})
                cases = prec_search.get("prec", [])

                if not cases:
                    break

                if isinstance(cases, dict):
                    cases = [cases]

                all_cases.extend(cases)
                total_cnt = int(prec_search.get("totalCnt", 0))

                if len(all_cases) >= total_cnt:
                    break

                page += 1
                time.sleep(0.5)

        return all_cases

    async def fetch_case_detail(self, case_id: str) -> Optional[Dict[str, Any]]:
        """판례 상세 정보 조회"""
        async with LawAPIClient() as client:
            try:
                result = await client.get_case_detail(case_id)
                return result.get("PrecService", {})
            except Exception as e:
                print(f"    - 판례 {case_id} 조회 실패: {e}")
                return None

    # ==================== 메인 수집 로직 ====================

    async def collect_all(self, skip_summary: bool = False):
        """모든 키워드로 판례 수집"""
        print(f"\n판례 수집 시작 (키워드: {', '.join(self.KEYWORDS)})")
        if skip_summary:
            print("  → 요약 생성 건너뜀 (--skip-summary)")

        if not self.qdrant_service.check_connection():
            print("에러: Qdrant 서버에 연결할 수 없습니다.")
            return

        # 컬렉션 생성
        self.qdrant_service.create_hybrid_collection(QdrantService.CASES_COLLECTION)
        if not skip_summary:
            self.qdrant_service.create_summaries_collection()

        # 기존 사건번호 로드 (중복 방지)
        self.load_existing_case_numbers()

        total_saved = 0
        total_cases = 0
        total_summaries = 0

        for keyword in self.KEYWORDS:
            print(f"\n[{keyword}] 수집 중...")

            try:
                case_list = await self.fetch_case_list(keyword)

                if not case_list:
                    print(f"[{keyword}] 검색 결과 없음")
                    continue

                print(f"[{keyword}] 총 {len(case_list)}건 검색됨")

                keyword_cases = 0
                keyword_saved = 0
                duplicates = 0

                for case in case_list:
                    case_number = case.get("사건번호", "")
                    case_id = case.get("판례일련번호", "")

                    # 중복 체크
                    if self.is_duplicate(case_number):
                        duplicates += 1
                        continue

                    # 상세 조회
                    detail = await self.fetch_case_detail(case_id)
                    if not detail:
                        continue

                    # 메타데이터 구성
                    case_info = {
                        "case_number": case_number,
                        "case_name": detail.get("사건명", ""),
                        "court_name": detail.get("법원명", ""),
                        "judgment_date": detail.get("선고일자", ""),
                        "case_type": detail.get("사건종류명", ""),
                        "judgment_type": detail.get("판결유형", ""),
                        "case_serial_number": detail.get("판례정보일련번호", ""),
                        "case_type_code": detail.get("사건종류코드", ""),
                        "court_type_code": detail.get("법원종류코드", ""),
                    }

                    # 공통 처리 (청킹 → 임베딩 → 저장 → 요약)
                    result = self.process_case(detail, case_info, keyword, skip_summary)

                    keyword_saved += result["chunks_saved"]
                    total_saved += result["chunks_saved"]
                    if result["summary_saved"]:
                        total_summaries += 1

                    keyword_cases += 1
                    total_cases += 1
                    print(f"  [{keyword}] {case_number} 저장 완료 ({keyword_cases}건째)")
                    time.sleep(0.3)

                if keyword_cases > 0:
                    print(f"[{keyword}] 완료: {keyword_cases}건 → {keyword_saved}개 청크 저장")
                elif duplicates > 0:
                    print(f"[{keyword}] {len(case_list)}건 검색, {duplicates}건 중복 → 스킵")

            except Exception as e:
                print(f"[{keyword}] 에러: {e}")
                traceback.print_exc()
                continue

        print(f"\n수집 완료! 총 {total_cases}건 → {total_saved}개 청크, {total_summaries}개 요약 저장")


async def main():
    parser = argparse.ArgumentParser(description="판례 데이터 수집")
    parser.add_argument("--skip-summary", action="store_true", help="요약 생성 건너뜀")
    args = parser.parse_args()

    collector = CaseCollector()
    await collector.collect_all(skip_summary=args.skip_summary)


if __name__ == "__main__":
    asyncio.run(main())
