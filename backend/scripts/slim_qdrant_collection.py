"""
Qdrant 컬렉션 경량화 스크립트 (안전한 마이그레이션)

플로우:
1. precedents → precedents_backup 복제
2. precedents 삭제
3. 새 precedents 생성 (경량화된 구조)
4. precedents_backup에서 필요한 필드만 복사

유지 필드: case_number, section, chunk_index (+ 벡터)
제거 필드: case_name, court_name, judgment_date, case_type, content

롤백: precedents_backup을 precedents로 복원 가능
"""

import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models

load_dotenv()

QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

ORIGINAL_COLLECTION = "precedents"
BACKUP_COLLECTION = "precedents_backup"

# 유지할 필드
FIELDS_TO_KEEP = ["case_number", "section", "chunk_index"]


def get_collection_config(client: QdrantClient, name: str) -> dict:
    """컬렉션 설정 조회"""
    info = client.get_collection(name)
    return {
        "vectors_config": info.config.params.vectors,
        "sparse_vectors_config": info.config.params.sparse_vectors,
        "points_count": info.points_count,
    }


def copy_collection_structure(client: QdrantClient, source: str, target: str):
    """컬렉션 구조만 복사 (데이터 제외)"""
    config = get_collection_config(client, source)

    client.create_collection(
        collection_name=target,
        vectors_config=config["vectors_config"],
        sparse_vectors_config=config["sparse_vectors_config"],
    )
    print(f"  ✓ {target} 컬렉션 생성 완료")


def migrate_with_slim_payload(client: QdrantClient, source: str, target: str):
    """소스에서 타겟으로 데이터 복사 (필요한 필드만)"""
    offset = None
    batch_count = 0
    total_migrated = 0

    while True:
        # 배치 읽기
        results, offset = client.scroll(
            collection_name=source,
            limit=500,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )

        if not results:
            break

        # 경량화된 포인트 생성
        points = []
        for point in results:
            # 필요한 필드만 추출
            slim_payload = {
                key: point.payload.get(key)
                for key in FIELDS_TO_KEEP
                if point.payload.get(key) is not None
            }

            points.append(models.PointStruct(
                id=point.id,
                vector=point.vector,
                payload=slim_payload,
            ))

        # 타겟에 삽입
        client.upsert(
            collection_name=target,
            points=points,
            wait=True,
        )

        batch_count += 1
        total_migrated += len(points)
        print(f"    배치 {batch_count}: {total_migrated:,}개 완료")

        if offset is None:
            break

    return total_migrated


def slim_collection():
    """Qdrant 컬렉션 경량화 실행"""
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    print("\n" + "=" * 60)
    print("Qdrant 컬렉션 경량화 (안전한 마이그레이션)")
    print("=" * 60)

    # 1. 현재 상태 확인
    try:
        config = get_collection_config(client, ORIGINAL_COLLECTION)
        print(f"\n[현재 상태]")
        print(f"  - 컬렉션: {ORIGINAL_COLLECTION}")
        print(f"  - 포인트 수: {config['points_count']:,}")
    except Exception as e:
        print(f"컬렉션 연결 실패: {e}")
        return

    # 2. 백업 컬렉션 존재 확인
    collections = [c.name for c in client.get_collections().collections]
    if BACKUP_COLLECTION in collections:
        print(f"\n⚠️  {BACKUP_COLLECTION} 컬렉션이 이미 존재합니다.")
        action = input("삭제하고 계속할까요? (yes/no): ")
        if action.lower() != "yes":
            print("작업이 취소되었습니다.")
            return
        client.delete_collection(BACKUP_COLLECTION)
        print(f"  ✓ 기존 {BACKUP_COLLECTION} 삭제 완료")

    # 3. 작업 확인
    print(f"\n[작업 계획]")
    print(f"  1. {ORIGINAL_COLLECTION} → {BACKUP_COLLECTION} 전체 복제")
    print(f"  2. {ORIGINAL_COLLECTION} 삭제")
    print(f"  3. 새 {ORIGINAL_COLLECTION} 생성 (경량화)")
    print(f"  4. {BACKUP_COLLECTION}에서 필요한 필드만 복사")
    print(f"\n[유지 필드] {', '.join(FIELDS_TO_KEEP)}")
    print(f"[제거 필드] case_name, court_name, judgment_date, case_type, content")

    confirm = input("\n계속하시겠습니까? (yes/no): ")
    if confirm.lower() != "yes":
        print("작업이 취소되었습니다.")
        return

    # 4. Step 1: 백업 컬렉션으로 전체 복제
    print(f"\n[Step 1/4] {ORIGINAL_COLLECTION} → {BACKUP_COLLECTION} 복제")
    copy_collection_structure(client, ORIGINAL_COLLECTION, BACKUP_COLLECTION)

    print(f"  - 데이터 복사 중...")
    offset = None
    batch_count = 0

    while True:
        results, offset = client.scroll(
            collection_name=ORIGINAL_COLLECTION,
            limit=500,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )

        if not results:
            break

        points = [
            models.PointStruct(
                id=point.id,
                vector=point.vector,
                payload=point.payload,
            )
            for point in results
        ]

        client.upsert(
            collection_name=BACKUP_COLLECTION,
            points=points,
            wait=True,
        )

        batch_count += 1
        print(f"    배치 {batch_count}: {len(results)}개")

        if offset is None:
            break

    backup_count = client.get_collection(BACKUP_COLLECTION).points_count
    print(f"  ✓ 백업 완료: {backup_count:,}개")

    # 5. Step 2: 기존 컬렉션 삭제
    print(f"\n[Step 2/4] {ORIGINAL_COLLECTION} 삭제")
    client.delete_collection(ORIGINAL_COLLECTION)
    print(f"  ✓ 삭제 완료")

    # 6. Step 3: 새 컬렉션 생성
    print(f"\n[Step 3/4] 새 {ORIGINAL_COLLECTION} 생성 (경량화)")
    copy_collection_structure(client, BACKUP_COLLECTION, ORIGINAL_COLLECTION)

    # 7. Step 4: 경량화된 데이터 복사
    print(f"\n[Step 4/4] 경량화 데이터 마이그레이션")
    migrated = migrate_with_slim_payload(client, BACKUP_COLLECTION, ORIGINAL_COLLECTION)

    # 8. 결과 확인
    new_count = client.get_collection(ORIGINAL_COLLECTION).points_count
    print(f"\n[완료]")
    print(f"  - 원본 (백업): {BACKUP_COLLECTION} ({backup_count:,}개)")
    print(f"  - 경량화: {ORIGINAL_COLLECTION} ({new_count:,}개)")

    # 샘플 확인
    sample = client.scroll(
        collection_name=ORIGINAL_COLLECTION,
        limit=1,
        with_payload=True,
        with_vectors=False,
    )

    if sample[0]:
        print(f"\n[샘플 payload 필드]")
        for key, value in sample[0][0].payload.items():
            print(f"  - {key}: {str(value)[:50]}...")

    print("\n" + "=" * 60)
    print("경량화 완료!")
    print(f"롤백 필요 시: {BACKUP_COLLECTION} → {ORIGINAL_COLLECTION} 복원")
    print("=" * 60)


def rollback():
    """롤백: 백업에서 원본 복원"""
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    print("\n[롤백 시작]")

    collections = [c.name for c in client.get_collections().collections]
    if BACKUP_COLLECTION not in collections:
        print(f"백업 컬렉션 {BACKUP_COLLECTION}이 없습니다.")
        return

    # 현재 precedents 삭제
    if ORIGINAL_COLLECTION in collections:
        client.delete_collection(ORIGINAL_COLLECTION)
        print(f"  ✓ {ORIGINAL_COLLECTION} 삭제")

    # 백업에서 복원
    copy_collection_structure(client, BACKUP_COLLECTION, ORIGINAL_COLLECTION)

    offset = None
    while True:
        results, offset = client.scroll(
            collection_name=BACKUP_COLLECTION,
            limit=500,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )

        if not results:
            break

        points = [
            models.PointStruct(id=p.id, vector=p.vector, payload=p.payload)
            for p in results
        ]
        client.upsert(collection_name=ORIGINAL_COLLECTION, points=points, wait=True)

        if offset is None:
            break

    print(f"  ✓ {ORIGINAL_COLLECTION} 복원 완료")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "rollback":
        rollback()
    else:
        slim_collection()
