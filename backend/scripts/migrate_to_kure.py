"""
KURE-v1 임베딩 마이그레이션 스크립트

기존 precedents_backup에서:
- sparse 벡터: 그대로 복사 (BM25 재사용)
- dense 벡터: KURE-v1로 새로 생성 (1024차원)
- payload: 그대로 복사
"""

import os
import sys
import time
import argparse
from typing import List, Dict, Any

# 프로젝트 루트 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer
from tqdm import tqdm


# 설정
SOURCE_COLLECTION = "precedents_backup"
TARGET_COLLECTION = "precedents_kure"
KURE_MODEL = "nlpai-lab/KURE-v1"
KURE_DIM = 1024
BATCH_SIZE = 32  # GPU 메모리에 맞게 조정


def create_target_collection(client: QdrantClient) -> bool:
    """KURE용 새 컬렉션 생성"""
    collections = [c.name for c in client.get_collections().collections]

    if TARGET_COLLECTION in collections:
        print(f"⚠️  {TARGET_COLLECTION} 컬렉션이 이미 존재합니다.")
        response = input("삭제하고 다시 생성할까요? (y/N): ")
        if response.lower() != 'y':
            return False
        client.delete_collection(TARGET_COLLECTION)
        print(f"  ✓ 기존 컬렉션 삭제")

    # 하이브리드 컬렉션 생성 (dense + sparse)
    client.create_collection(
        collection_name=TARGET_COLLECTION,
        vectors_config={
            "dense": models.VectorParams(
                size=KURE_DIM,
                distance=models.Distance.COSINE,
            )
        },
        sparse_vectors_config={
            "sparse": models.SparseVectorParams()
        },
    )
    print(f"✓ {TARGET_COLLECTION} 컬렉션 생성 완료 (dense: {KURE_DIM}차원)")
    return True


def load_kure_model() -> SentenceTransformer:
    """KURE-v1 모델 로드"""
    print(f"KURE-v1 모델 로딩 중... ({KURE_MODEL})")
    start = time.time()
    model = SentenceTransformer(KURE_MODEL)
    print(f"✓ 모델 로드 완료 ({time.time() - start:.1f}초)")

    # 디바이스 확인
    device = model.device
    print(f"  - Device: {device}")

    return model


def clean_for_embedding(text: str) -> str:
    """임베딩용 텍스트 정제 (파싱 토큰 제거)"""
    if not text:
        return " "
    # {{PARA}} 등 특수 토큰 제거
    cleaned = text.replace("{{PARA}}", " ")
    cleaned = " ".join(cleaned.split())  # 연속 공백 정리
    return cleaned if cleaned.strip() else " "


def migrate_batch(
    client: QdrantClient,
    model: SentenceTransformer,
    points: List[Any],
    slim: bool = True,
) -> int:
    """배치 단위 마이그레이션

    Args:
        slim: True면 경량화 (content 제외, 최소 메타데이터만 저장)
    """

    # content 추출 (임베딩용으로 정제)
    contents = []
    for point in points:
        content = point.payload.get("content", "")
        contents.append(clean_for_embedding(content))

    # KURE-v1 임베딩 생성
    dense_vectors = model.encode(
        contents,
        batch_size=BATCH_SIZE,
        show_progress_bar=False,
        normalize_embeddings=True,  # cosine similarity용
    )

    # Qdrant에 upsert할 포인트 생성
    new_points = []
    for i, point in enumerate(points):
        # 기존 sparse 벡터 가져오기
        sparse_vec = point.vector.get("sparse")

        # 경량화: 최소 메타데이터만 저장
        if slim:
            payload = {
                "case_number": point.payload.get("case_number", ""),
                "section": point.payload.get("section", ""),
                "chunk_index": point.payload.get("chunk_index", 0),
            }
        else:
            payload = point.payload

        new_point = models.PointStruct(
            id=point.id,
            vector={
                "dense": dense_vectors[i].tolist(),
                "sparse": models.SparseVector(
                    indices=sparse_vec.indices,
                    values=sparse_vec.values,
                ),
            },
            payload=payload,
        )
        new_points.append(new_point)

    # 새 컬렉션에 저장
    client.upsert(
        collection_name=TARGET_COLLECTION,
        points=new_points,
        wait=True,
    )

    return len(new_points)


def get_existing_ids(client: QdrantClient) -> set:
    """이미 마이그레이션된 포인트 ID 목록 조회"""
    existing_ids = set()

    try:
        collection_info = client.get_collection(TARGET_COLLECTION)
        if collection_info.points_count == 0:
            return existing_ids

        print(f"기존 포인트 ID 로딩 중... ({collection_info.points_count:,}개)")

        offset = None
        while True:
            result = client.scroll(
                collection_name=TARGET_COLLECTION,
                limit=1000,
                offset=offset,
                with_payload=False,
                with_vectors=False,
            )

            for point in result[0]:
                existing_ids.add(point.id)

            offset = result[1]
            if offset is None:
                break

        print(f"✓ 기존 포인트 {len(existing_ids):,}개 로드 완료")

    except Exception as e:
        print(f"기존 포인트 조회 실패 (새로 시작): {e}")

    return existing_ids


def migrate(limit: int = None, skip_existing: bool = True, slim: bool = True):
    """
    메인 마이그레이션 함수

    Args:
        limit: 마이그레이션할 최대 개수 (None이면 전체)
        skip_existing: 이미 존재하는 포인트 스킵
        slim: True면 경량화 (content 제외)
    """
    client = QdrantClient(host="localhost", port=6333)

    # 소스 컬렉션 확인
    source_info = client.get_collection(SOURCE_COLLECTION)
    total_points = source_info.points_count
    print(f"\n=== 마이그레이션 정보 ===")
    print(f"소스: {SOURCE_COLLECTION} ({total_points:,}개)")
    print(f"대상: {TARGET_COLLECTION}")
    print(f"제한: {limit if limit else '전체'}")

    # 기존 포인트 확인 (이어하기용)
    existing_ids = set()
    try:
        target_info = client.get_collection(TARGET_COLLECTION)
        if target_info.points_count > 0 and skip_existing:
            existing_ids = get_existing_ids(client)
            print(f"→ {len(existing_ids):,}개 스킵 예정 (이어하기 모드)")
    except:
        # 컬렉션 없으면 새로 생성
        if not create_target_collection(client):
            print("마이그레이션 취소됨")
            return

    # KURE 모델 로드
    model = load_kure_model()

    # 마이그레이션 시작
    print(f"\n=== 마이그레이션 시작 ===")

    offset = None
    migrated = 0
    skipped = 0
    scroll_limit = min(BATCH_SIZE * 4, 500)  # 한 번에 가져올 개수

    remaining = total_points - len(existing_ids)
    target_count = min(limit, remaining) if limit else remaining
    pbar = tqdm(total=target_count, desc="마이그레이션")

    start_time = time.time()

    while True:
        # 소스에서 데이터 가져오기
        result = client.scroll(
            collection_name=SOURCE_COLLECTION,
            limit=scroll_limit,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )

        points = result[0]
        if not points:
            break

        # 이미 처리된 포인트 제외
        if existing_ids:
            new_points = [p for p in points if p.id not in existing_ids]
            skipped += len(points) - len(new_points)
            points = new_points

        if not points:
            offset = result[1]
            if offset is None:
                break
            continue

        # 배치 처리
        for i in range(0, len(points), BATCH_SIZE):
            batch = points[i:i + BATCH_SIZE]
            count = migrate_batch(client, model, batch, slim=slim)
            migrated += count
            pbar.update(count)

            if limit and migrated >= limit:
                break

        if limit and migrated >= limit:
            break

        offset = result[1]
        if offset is None:
            break

    pbar.close()
    elapsed = time.time() - start_time

    # 결과 확인
    target_info = client.get_collection(TARGET_COLLECTION)

    print(f"\n=== 마이그레이션 완료 ===")
    print(f"소스: {SOURCE_COLLECTION} ({total_points:,}개)")
    print(f"대상: {TARGET_COLLECTION} ({target_info.points_count:,}개)")
    if skipped > 0:
        print(f"스킵: {len(existing_ids):,}개 (이미 처리됨)")
    print(f"신규 처리: {migrated:,}개")
    print(f"소요 시간: {elapsed:.1f}초")
    if migrated > 0:
        print(f"처리 속도: {migrated / elapsed:.1f}개/초")


def test_search(query: str = "손해배상 청구"):
    """마이그레이션 후 검색 테스트"""
    client = QdrantClient(host="localhost", port=6333)
    model = load_kure_model()

    print(f"\n=== 검색 테스트: '{query}' ===")

    # 쿼리 임베딩 (정제 적용)
    cleaned_query = clean_for_embedding(query)
    query_vector = model.encode(cleaned_query, normalize_embeddings=True).tolist()

    # Dense 검색 (qdrant-client 1.16+)
    results = client.query_points(
        collection_name=TARGET_COLLECTION,
        query=query_vector,
        using="dense",
        limit=5,
        with_payload=True,
    )

    print(f"\n[KURE-v1 Dense 검색 결과]")
    for i, hit in enumerate(results.points, 1):
        case_num = hit.payload.get("case_number", "?")
        content = hit.payload.get("content", "")[:80].replace("{{PARA}}", " ")
        print(f"{i}. [{hit.score:.3f}] {case_num}")
        print(f"   {content}...")


def compare_search(query: str = "손해배상 청구"):
    """KURE-v1 vs OpenAI 임베딩 검색 품질 비교"""
    import os
    from openai import OpenAI

    # 타임아웃 늘린 클라이언트
    client = QdrantClient(host="localhost", port=6333, timeout=60)
    kure_model = load_kure_model()
    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    print(f"\n{'='*60}")
    print(f"검색 품질 비교: '{query}'")
    print(f"{'='*60}")

    # 1. KURE-v1 검색
    cleaned_query = clean_for_embedding(query)
    kure_vector = kure_model.encode(cleaned_query, normalize_embeddings=True).tolist()

    kure_results = client.query_points(
        collection_name=TARGET_COLLECTION,
        query=kure_vector,
        using="dense",
        limit=5,
        with_payload=True,
    )

    print(f"\n[KURE-v1] (precedents_kure)")
    kure_case_numbers = []
    for i, hit in enumerate(kure_results.points, 1):
        case_num = hit.payload.get("case_number", "?")
        kure_case_numbers.append(case_num)
        section = hit.payload.get("section", "")
        print(f"  {i}. [{hit.score:.3f}] {case_num} ({section})")

    # 2. OpenAI 검색 (기존 컬렉션)
    openai_resp = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=query,
    )
    openai_vector = openai_resp.data[0].embedding

    openai_results = client.query_points(
        collection_name=SOURCE_COLLECTION,
        query=openai_vector,
        using="dense",
        limit=5,
        with_payload=True,
    )

    print(f"\n[OpenAI text-embedding-3-small] (precedents_backup)")
    openai_case_numbers = []
    for i, hit in enumerate(openai_results.points, 1):
        case_num = hit.payload.get("case_number", "?")
        openai_case_numbers.append(case_num)
        section = hit.payload.get("section", "")
        print(f"  {i}. [{hit.score:.3f}] {case_num} ({section})")

    # 3. 결과 비교
    print(f"\n[비교 분석]")
    overlap = set(kure_case_numbers) & set(openai_case_numbers)
    print(f"  - 공통 결과: {len(overlap)}개 / 5개")
    print(f"  - KURE만: {set(kure_case_numbers) - set(openai_case_numbers)}")
    print(f"  - OpenAI만: {set(openai_case_numbers) - set(kure_case_numbers)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KURE-v1 임베딩 마이그레이션")
    parser.add_argument("--limit", type=int, default=None, help="마이그레이션할 개수 (미지정시 전체)")
    parser.add_argument("--test", action="store_true", help="마이그레이션 없이 검색 테스트만")
    parser.add_argument("--compare", action="store_true", help="KURE vs OpenAI 검색 품질 비교")
    parser.add_argument("--query", type=str, default="손해배상 청구", help="테스트 검색 쿼리")
    parser.add_argument("--full", action="store_true", help="전체 payload 저장 (기본: 경량화)")

    args = parser.parse_args()

    if args.compare:
        from dotenv import load_dotenv
        load_dotenv()
        compare_search(args.query)
    elif args.test:
        test_search(args.query)
    else:
        migrate(limit=args.limit, slim=not args.full)
        print("\n" + "="*50)
        test_search(args.query)
