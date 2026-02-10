"""
판례 사실관계 생성 스크립트
기존 수집된 판례에서 핵심 사실관계를 추출하여 저장합니다.
"""

import sys
import argparse
import time
from pathlib import Path
from typing import List, Set

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from tool.qdrant_client import QdrantService, get_qdrant_client
from app.services.fact_extraction_service import FactExtractionService


def get_all_case_numbers() -> List[dict]:
    """
    precedents 컬렉션에서 모든 고유 판례 정보 조회
    """
    qdrant_client = get_qdrant_client()
    case_info_map = {}
    offset = None

    print("판례 목록 조회 중...")

    while True:
        results, offset = qdrant_client.scroll(
            collection_name=QdrantService.CASES_COLLECTION,
            limit=100,
            offset=offset,
            with_payload=["case_number", "case_name", "court_name", "judgment_date"],
            with_vectors=False,
        )

        for point in results:
            case_number = point.payload.get("case_number", "")
            if case_number and case_number not in case_info_map:
                case_info_map[case_number] = {
                    "case_number": case_number,
                    "case_name": point.payload.get("case_name", ""),
                    "court_name": point.payload.get("court_name", ""),
                    "judgment_date": point.payload.get("judgment_date", ""),
                }

        if offset is None:
            break

    print(f"  → 총 {len(case_info_map)}개 판례 발견")
    return list(case_info_map.values())


def get_existing_fact_case_numbers() -> Set[str]:
    """
    precedent_facts 컬렉션에 이미 저장된 사건번호 조회
    """
    qdrant_client = get_qdrant_client()
    existing = set()
    offset = None

    try:
        # 컬렉션 존재 여부 확인
        collections = qdrant_client.get_collections().collections
        if not any(c.name == QdrantService.FACTS_COLLECTION for c in collections):
            return existing

        while True:
            results, offset = qdrant_client.scroll(
                collection_name=QdrantService.FACTS_COLLECTION,
                limit=100,
                offset=offset,
                with_payload=["case_number"],
                with_vectors=False,
            )

            for point in results:
                case_number = point.payload.get("case_number", "")
                if case_number:
                    existing.add(case_number)

            if offset is None:
                break

    except Exception as e:
        print(f"기존 사실관계 조회 실패: {e}")

    return existing


def main():
    parser = argparse.ArgumentParser(description="판례 사실관계 추출")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="처리할 최대 판례 수 (기본: 전체)"
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="이미 사실관계가 있는 판례 건너뜀"
    )
    parser.add_argument(
        "--case-number",
        type=str,
        default=None,
        help="특정 사건번호만 처리"
    )
    args = parser.parse_args()

    print("\n=== 판례 사실관계 추출 시작 ===\n")

    # Qdrant 연결 확인
    qdrant_service = QdrantService()
    if not qdrant_service.check_connection():
        print("에러: Qdrant 서버에 연결할 수 없습니다.")
        return

    # facts 컬렉션 생성
    qdrant_service.create_facts_collection()

    # 서비스 초기화
    extraction_service = FactExtractionService()

    # 특정 사건번호만 처리
    if args.case_number:
        print(f"특정 사건번호 처리: {args.case_number}")
        result = extraction_service.extract_and_save_facts(
            case_number=args.case_number,
        )
        if result:
            print(f"\n추출된 사실관계:\n{result}")
        else:
            print("\n사실관계 추출 실패")
        return

    # 전체 판례 목록 조회
    all_cases = get_all_case_numbers()

    if not all_cases:
        print("처리할 판례가 없습니다.")
        return

    # 기존 사실관계 제외
    if args.skip_existing:
        existing = get_existing_fact_case_numbers()
        print(f"이미 처리된 판례: {len(existing)}개")
        all_cases = [c for c in all_cases if c["case_number"] not in existing]
        print(f"새로 처리할 판례: {len(all_cases)}개")

    # 처리 수 제한
    if args.limit:
        all_cases = all_cases[:args.limit]
        print(f"처리 제한: {args.limit}건")

    print(f"\n총 {len(all_cases)}건 처리 예정\n")

    # 처리 시작
    success_count = 0
    fail_count = 0
    start_time = time.time()

    for i, case_info in enumerate(all_cases, 1):
        case_number = case_info["case_number"]
        print(f"[{i}/{len(all_cases)}] {case_number} 처리 중...", end=" ")

        try:
            result = extraction_service.extract_and_save_facts(
                case_number=case_number,
                case_name=case_info.get("case_name", ""),
                court_name=case_info.get("court_name", ""),
                judgment_date=case_info.get("judgment_date", ""),
            )

            if result:
                print(f"→ 완료")
                success_count += 1
            else:
                print(f"→ 실패")
                fail_count += 1

        except Exception as e:
            print(f"→ 에러: {e}")
            fail_count += 1

        # Rate limit 방지
        time.sleep(0.5)

    # 결과 출력
    elapsed = time.time() - start_time
    print(f"\n=== 처리 완료 ===")
    print(f"성공: {success_count}건")
    print(f"실패: {fail_count}건")
    print(f"소요 시간: {elapsed:.1f}초")


if __name__ == "__main__":
    main()
