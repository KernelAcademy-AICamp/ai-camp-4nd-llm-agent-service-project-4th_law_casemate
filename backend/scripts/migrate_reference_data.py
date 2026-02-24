"""
precedents_backup → precedents_kure_q 마이그레이션 스크립트
reference_cases, reference_laws 필드 복사
"""

import logging
from qdrant_client import QdrantClient
from qdrant_client.http import models
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Qdrant 설정
QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
SOURCE_COLLECTION = "precedents_backup"
TARGET_COLLECTION = "precedents_kure_q"

def get_client():
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def extract_reference_data(client) -> dict:
    """
    precedents_backup에서 case_number별 reference 데이터 추출

    Returns:
        {case_number: {"reference_cases": [...], "reference_laws": [...]}}
    """
    logger.info(f"[1/3] {SOURCE_COLLECTION}에서 reference 데이터 추출 중...")

    reference_map = defaultdict(lambda: {"reference_cases": [], "reference_laws": []})

    offset = None
    total_count = 0
    has_reference_count = 0

    while True:
        result = client.scroll(
            collection_name=SOURCE_COLLECTION,
            limit=100,
            offset=offset,
            with_payload=True,
            with_vectors=False
        )

        points, next_offset = result

        if not points:
            break

        for point in points:
            payload = point.payload
            case_number = payload.get("case_number")

            if not case_number:
                continue

            total_count += 1

            ref_cases = payload.get("reference_cases", [])
            ref_laws = payload.get("reference_laws", [])

            if ref_cases or ref_laws:
                has_reference_count += 1
                # 기존 데이터에 추가 (중복 제거)
                existing = reference_map[case_number]
                existing["reference_cases"] = list(set(existing["reference_cases"] + (ref_cases or [])))
                existing["reference_laws"] = list(set(existing["reference_laws"] + (ref_laws or [])))

        offset = next_offset

        if next_offset is None:
            break

    logger.info(f"  - 총 {total_count}개 포인트 스캔")
    logger.info(f"  - reference 데이터 있는 포인트: {has_reference_count}개")
    logger.info(f"  - 고유 case_number: {len(reference_map)}개")

    return dict(reference_map)


def update_target_collection(client, reference_map: dict):
    """
    precedents_kure_q에 reference 데이터 업데이트
    """
    logger.info(f"[2/3] {TARGET_COLLECTION} 업데이트 중...")

    offset = None
    updated_count = 0
    skipped_count = 0
    not_found_count = 0

    # case_number → point_ids 매핑 (precedents_kure_q는 청크 단위라 여러 포인트 가능)
    case_to_points = defaultdict(list)

    # 먼저 target collection 스캔해서 매핑 생성
    logger.info("  - target collection 스캔 중...")
    while True:
        result = client.scroll(
            collection_name=TARGET_COLLECTION,
            limit=100,
            offset=offset,
            with_payload=["case_number"],
            with_vectors=False
        )

        points, next_offset = result

        if not points:
            break

        for point in points:
            case_number = point.payload.get("case_number")
            if case_number:
                case_to_points[case_number].append(point.id)

        offset = next_offset

        if next_offset is None:
            break

    logger.info(f"  - target에서 {len(case_to_points)}개 case_number 발견")

    # 업데이트 수행
    logger.info("  - payload 업데이트 중...")
    for case_number, ref_data in reference_map.items():
        point_ids = case_to_points.get(case_number, [])

        if not point_ids:
            not_found_count += 1
            continue

        # reference 데이터가 비어있으면 스킵
        if not ref_data["reference_cases"] and not ref_data["reference_laws"]:
            skipped_count += 1
            continue

        # 해당 case_number의 모든 포인트 업데이트
        try:
            client.set_payload(
                collection_name=TARGET_COLLECTION,
                payload={
                    "reference_cases": ref_data["reference_cases"],
                    "reference_laws": ref_data["reference_laws"]
                },
                points=point_ids
            )
            updated_count += len(point_ids)
        except Exception as e:
            logger.error(f"  - {case_number} 업데이트 실패: {e}")

    logger.info(f"  - 업데이트 완료: {updated_count}개 포인트")
    logger.info(f"  - 스킵 (빈 데이터): {skipped_count}개")
    logger.info(f"  - 매칭 안됨: {not_found_count}개")


def verify_migration(client):
    """
    마이그레이션 결과 검증
    """
    logger.info(f"[3/3] 마이그레이션 검증 중...")

    # 샘플 확인
    result = client.scroll(
        collection_name=TARGET_COLLECTION,
        limit=10,
        with_payload=True,
        with_vectors=False,
        scroll_filter=models.Filter(
            must=[
                models.FieldCondition(
                    key="reference_laws",
                    match=models.MatchAny(any=["민법 제763조", "형법 제307조", "민법 제750조"])
                )
            ]
        )
    )

    points = result[0]

    if points:
        logger.info(f"  - reference_laws가 있는 샘플 {len(points)}개 확인:")
        for point in points[:3]:
            payload = point.payload
            logger.info(f"    {payload.get('case_number')}: laws={payload.get('reference_laws')}, cases={payload.get('reference_cases')}")
    else:
        # 필터 없이 다시 확인
        result = client.scroll(
            collection_name=TARGET_COLLECTION,
            limit=5,
            with_payload=["case_number", "reference_cases", "reference_laws"],
            with_vectors=False
        )
        for point in result[0]:
            payload = point.payload
            if payload.get("reference_laws") or payload.get("reference_cases"):
                logger.info(f"    {payload.get('case_number')}: laws={payload.get('reference_laws')}, cases={payload.get('reference_cases')}")


def main():
    logger.info("=" * 50)
    logger.info("Reference 데이터 마이그레이션 시작")
    logger.info(f"Source: {SOURCE_COLLECTION} → Target: {TARGET_COLLECTION}")
    logger.info("=" * 50)

    client = get_client()

    # 1. Source에서 reference 데이터 추출
    reference_map = extract_reference_data(client)

    if not reference_map:
        logger.warning("마이그레이션할 reference 데이터가 없습니다.")
        return

    # 2. Target에 업데이트
    update_target_collection(client, reference_map)

    # 3. 검증
    verify_migration(client)

    logger.info("=" * 50)
    logger.info("마이그레이션 완료!")
    logger.info("=" * 50)


if __name__ == "__main__":
    main()
