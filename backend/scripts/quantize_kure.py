"""
KURE 컬렉션 Scalar Quantization 적용 스크립트

precedents_kure → precedents_kure_q (양자화 버전)
- Scalar (INT8) 양자화: 용량 4배 절감
- rescore=True: recall 99% 유지
"""

import time
import argparse
from tqdm import tqdm

from qdrant_client import QdrantClient
from qdrant_client.http import models


# 설정
SOURCE_COLLECTION = "precedents_kure"
TARGET_COLLECTION = "precedents_kure_q"
BATCH_SIZE = 500


def create_quantized_collection(client: QdrantClient, overwrite: bool = False, incremental: bool = False) -> bool:
    """양자화 설정이 포함된 새 컬렉션 생성"""
    collections = [c.name for c in client.get_collections().collections]

    if TARGET_COLLECTION in collections:
        if incremental:
            print(f"{TARGET_COLLECTION} 이미 존재. 증분 마이그레이션 진행.")
            return True
        elif overwrite:
            client.delete_collection(TARGET_COLLECTION)
            print(f"기존 {TARGET_COLLECTION} 삭제")
        else:
            print(f"{TARGET_COLLECTION} 이미 존재. --overwrite 또는 --incremental 옵션 사용하세요.")
            return False

    # 소스 컬렉션 설정 가져오기
    source_info = client.get_collection(SOURCE_COLLECTION)

    # 양자화 설정 포함해서 새 컬렉션 생성
    # on_disk=True: 원본 벡터는 디스크, 양자화 벡터만 RAM (메모리 절감)
    client.create_collection(
        collection_name=TARGET_COLLECTION,
        vectors_config={
            "dense": models.VectorParams(
                size=1024,  # KURE-v1
                distance=models.Distance.COSINE,
                on_disk=True,  # 원본 벡터 디스크 저장
            )
        },
        sparse_vectors_config={
            "sparse": models.SparseVectorParams()
        },
        quantization_config=models.ScalarQuantization(
            scalar=models.ScalarQuantizationConfig(
                type=models.ScalarType.INT8,
                quantile=0.99,  # 상위 1% 이상치 제외
                always_ram=True,  # 양자화 벡터만 RAM 유지
            )
        ),
    )

    print(f"'{TARGET_COLLECTION}' 생성 완료 (Scalar INT8 양자화)")
    return True


def get_existing_ids(client: QdrantClient) -> set:
    """타겟 컬렉션의 기존 포인트 ID 조회"""
    collections = [c.name for c in client.get_collections().collections]
    if TARGET_COLLECTION not in collections:
        return set()

    existing_ids = set()
    offset = None

    while True:
        result = client.scroll(
            collection_name=TARGET_COLLECTION,
            limit=10000,
            offset=offset,
            with_payload=False,
            with_vectors=False,
        )
        points = result[0]
        if not points:
            break

        for p in points:
            existing_ids.add(p.id)

        offset = result[1]
        if offset is None:
            break

    return existing_ids


def copy_data(client: QdrantClient, incremental: bool = False):
    """소스에서 타겟으로 데이터 복사"""
    source_info = client.get_collection(SOURCE_COLLECTION)
    total = source_info.points_count

    # 증분 모드: 기존 ID 조회
    existing_ids = set()
    if incremental:
        print("기존 포인트 ID 조회 중...")
        existing_ids = get_existing_ids(client)
        print(f"타겟에 이미 {len(existing_ids):,}개 존재")

    print(f"\n데이터 복사: {SOURCE_COLLECTION} → {TARGET_COLLECTION}")
    print(f"소스 총 {total:,}개 포인트")

    offset = None
    copied = 0
    skipped = 0
    pbar = tqdm(total=total, desc="처리 중")

    start_time = time.time()

    while True:
        # 소스에서 데이터 가져오기
        result = client.scroll(
            collection_name=SOURCE_COLLECTION,
            limit=BATCH_SIZE,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )

        points = result[0]
        if not points:
            break

        # 포인트 변환 (중복 제외)
        new_points = []
        for p in points:
            if incremental and p.id in existing_ids:
                skipped += 1
                continue

            sparse_vec = p.vector.get("sparse")
            dense_vec = p.vector.get("dense")

            new_point = models.PointStruct(
                id=p.id,
                vector={
                    "dense": dense_vec,
                    "sparse": models.SparseVector(
                        indices=sparse_vec.indices,
                        values=sparse_vec.values,
                    ),
                },
                payload=p.payload,
            )
            new_points.append(new_point)

        # 새 포인트가 있을 때만 저장
        if new_points:
            client.upsert(
                collection_name=TARGET_COLLECTION,
                points=new_points,
                wait=True,
            )
            copied += len(new_points)

        pbar.update(len(points))

        offset = result[1]
        if offset is None:
            break

    pbar.close()
    elapsed = time.time() - start_time

    print(f"\n복사 완료: {copied:,}개 신규 추가 ({elapsed:.1f}초)")
    if incremental:
        print(f"건너뜀: {skipped:,}개 (이미 존재)")
    if elapsed > 0:
        print(f"속도: {(copied + skipped) / elapsed:.1f}개/초")


def verify_and_compare(client: QdrantClient):
    """양자화 결과 확인 및 비교"""
    print("\n=== 결과 확인 ===")

    source_info = client.get_collection(SOURCE_COLLECTION)
    target_info = client.get_collection(TARGET_COLLECTION)

    print(f"\n{SOURCE_COLLECTION}:")
    print(f"  포인트: {source_info.points_count:,}개")
    print(f"  양자화: {source_info.config.quantization_config}")

    print(f"\n{TARGET_COLLECTION}:")
    print(f"  포인트: {target_info.points_count:,}개")
    print(f"  양자화: {target_info.config.quantization_config}")

    # 포인트 수 일치 확인
    if source_info.points_count == target_info.points_count:
        print(f"\n포인트 수 일치")
    else:
        print(f"\n포인트 수 불일치!")


def test_search(client: QdrantClient, query: str = "손해배상 청구"):
    """검색 테스트 (rescore 비교)"""
    from sentence_transformers import SentenceTransformer

    print(f"\n=== 검색 테스트: '{query}' ===")

    # KURE 모델 로드
    model = SentenceTransformer("nlpai-lab/KURE-v1")
    query_vector = model.encode(query, normalize_embeddings=True).tolist()

    # 1. 원본 검색 (양자화 없음)
    original_results = client.query_points(
        collection_name=SOURCE_COLLECTION,
        query=query_vector,
        using="dense",
        limit=5,
        with_payload=True,
    )

    # 2. 양자화 검색 (rescore 없음)
    quantized_results = client.query_points(
        collection_name=TARGET_COLLECTION,
        query=query_vector,
        using="dense",
        limit=5,
        with_payload=True,
        search_params=models.SearchParams(
            quantization=models.QuantizationSearchParams(
                rescore=False,
            )
        ),
    )

    # 3. 양자화 + rescore (권장)
    rescore_results = client.query_points(
        collection_name=TARGET_COLLECTION,
        query=query_vector,
        using="dense",
        limit=5,
        with_payload=True,
        search_params=models.SearchParams(
            quantization=models.QuantizationSearchParams(
                rescore=True,
                oversampling=2.0,  # 2배 후보 선별 후 재정렬
            )
        ),
    )

    print(f"\n[원본 - {SOURCE_COLLECTION}]")
    orig_cases = []
    for i, hit in enumerate(original_results.points, 1):
        case_num = hit.payload.get("case_number", "?")
        orig_cases.append(case_num)
        print(f"  {i}. [{hit.score:.4f}] {case_num}")

    print(f"\n[양자화 (rescore=False) - {TARGET_COLLECTION}]")
    q_cases = []
    for i, hit in enumerate(quantized_results.points, 1):
        case_num = hit.payload.get("case_number", "?")
        q_cases.append(case_num)
        match = "✓" if case_num in orig_cases else "✗"
        print(f"  {i}. [{hit.score:.4f}] {case_num} {match}")

    print(f"\n[양자화 + rescore=True - {TARGET_COLLECTION}] (권장)")
    r_cases = []
    for i, hit in enumerate(rescore_results.points, 1):
        case_num = hit.payload.get("case_number", "?")
        r_cases.append(case_num)
        match = "✓" if case_num in orig_cases else "✗"
        print(f"  {i}. [{hit.score:.4f}] {case_num} {match}")

    # Recall 계산
    q_recall = len(set(q_cases) & set(orig_cases)) / len(orig_cases) * 100
    r_recall = len(set(r_cases) & set(orig_cases)) / len(orig_cases) * 100

    print(f"\n[Recall@5]")
    print(f"  양자화 (rescore=False): {q_recall:.0f}%")
    print(f"  양자화 + rescore=True:  {r_recall:.0f}%")


def main():
    parser = argparse.ArgumentParser(description="KURE 컬렉션 양자화")
    parser.add_argument("--overwrite", action="store_true", help="기존 컬렉션 덮어쓰기")
    parser.add_argument("--incremental", action="store_true", help="증분 마이그레이션 (중복 건너뜀)")
    parser.add_argument("--test-only", action="store_true", help="검색 테스트만 실행")
    parser.add_argument("--query", type=str, default="손해배상 청구", help="테스트 검색 쿼리")

    args = parser.parse_args()

    client = QdrantClient(host="localhost", port=6333)

    if args.test_only:
        test_search(client, args.query)
        return

    # 1. 양자화 컬렉션 생성 (또는 기존 유지)
    if not create_quantized_collection(client, args.overwrite, args.incremental):
        return

    # 2. 데이터 복사 (증분 모드 지원)
    copy_data(client, args.incremental)

    # 3. 결과 확인
    verify_and_compare(client)

    # 4. 검색 테스트
    test_search(client, args.query)

    print("\n" + "=" * 50)
    print("양자화 완료!")
    print(f"새 컬렉션: {TARGET_COLLECTION}")
    print("검색 시 rescore=True 옵션 사용 권장")


if __name__ == "__main__":
    main()
