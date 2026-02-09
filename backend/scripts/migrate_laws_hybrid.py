"""
법령(laws) 컬렉션 하이브리드 검색 마이그레이션 스크립트

기존 Dense-only 컬렉션을 Dense + Sparse 하이브리드 컬렉션으로 변환합니다.

실행 방법:
    cd backend
    python scripts/migrate_laws_hybrid.py
"""

import os
import sys
from typing import List, Dict, Any
from tqdm import tqdm
from dotenv import load_dotenv

# backend 경로 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qdrant_client import QdrantClient
from qdrant_client.http import models
from fastembed import SparseTextEmbedding

load_dotenv()

# 설정
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
OLD_COLLECTION = "laws"
NEW_COLLECTION = "laws_hybrid"
BATCH_SIZE = 100


def get_sparse_model():
    """BM25 Sparse 임베딩 모델 로드"""
    print("Sparse 임베딩 모델 로딩 중...")
    return SparseTextEmbedding(model_name="Qdrant/bm25")


def create_hybrid_collection(client: QdrantClient, collection_name: str):
    """하이브리드 검색용 컬렉션 생성"""
    print(f"새 컬렉션 생성: {collection_name}")

    client.recreate_collection(
        collection_name=collection_name,
        vectors_config={
            "dense": models.VectorParams(
                size=1536,
                distance=models.Distance.COSINE,
            ),
        },
        sparse_vectors_config={
            "sparse": models.SparseVectorParams(
                modifier=models.Modifier.IDF,
            ),
        },
    )
    print(f"컬렉션 생성 완료: {collection_name}")


def migrate_data(client: QdrantClient, sparse_model: SparseTextEmbedding):
    """기존 데이터를 새 컬렉션으로 마이그레이션"""

    # 기존 데이터 모두 가져오기
    print(f"기존 컬렉션에서 데이터 로드 중: {OLD_COLLECTION}")

    all_points = []
    offset = None

    while True:
        results, offset = client.scroll(
            collection_name=OLD_COLLECTION,
            limit=BATCH_SIZE,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )

        if not results:
            break

        all_points.extend(results)

        if offset is None:
            break

    print(f"총 {len(all_points)}개 포인트 로드 완료")

    # 배치 단위로 Sparse 임베딩 생성 및 업로드
    print("Sparse 임베딩 생성 및 업로드 중...")

    for i in tqdm(range(0, len(all_points), BATCH_SIZE)):
        batch = all_points[i:i + BATCH_SIZE]

        # 텍스트 추출 (content 필드 사용)
        texts = [p.payload.get("content", "") for p in batch]

        # Sparse 임베딩 생성
        sparse_embeddings = list(sparse_model.embed(texts))

        # 새 포인트 생성
        new_points = []
        for j, point in enumerate(batch):
            sparse_emb = sparse_embeddings[j]

            # 기존 벡터는 unnamed → "dense"로 변환
            dense_vector = point.vector
            if isinstance(dense_vector, dict):
                dense_vector = dense_vector.get("", dense_vector)

            new_points.append(models.PointStruct(
                id=point.id,
                vector={
                    "dense": dense_vector,
                    "sparse": models.SparseVector(
                        indices=sparse_emb.indices.tolist(),
                        values=sparse_emb.values.tolist(),
                    ),
                },
                payload=point.payload,
            ))

        # 새 컬렉션에 업로드
        client.upsert(
            collection_name=NEW_COLLECTION,
            points=new_points,
        )

    print("마이그레이션 완료!")


def verify_migration(client: QdrantClient):
    """마이그레이션 검증"""
    old_info = client.get_collection(OLD_COLLECTION)
    new_info = client.get_collection(NEW_COLLECTION)

    print("\n=== 마이그레이션 검증 ===")
    print(f"기존 컬렉션 ({OLD_COLLECTION}): {old_info.points_count}개 포인트")
    print(f"새 컬렉션 ({NEW_COLLECTION}): {new_info.points_count}개 포인트")

    if old_info.points_count == new_info.points_count:
        print("✓ 포인트 수 일치!")
    else:
        print("✗ 포인트 수 불일치!")
        return False

    # 샘플 검색 테스트
    print("\n샘플 하이브리드 검색 테스트...")

    # 테스트 쿼리
    test_query = "손해배상 청구"

    # Dense 임베딩 생성 (OpenAI)
    from openai import OpenAI
    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=test_query
    )
    dense_vector = response.data[0].embedding

    # Sparse 임베딩 생성
    sparse_emb = list(sparse_model.embed([test_query]))[0]
    sparse_vector = models.SparseVector(
        indices=sparse_emb.indices.tolist(),
        values=sparse_emb.values.tolist(),
    )

    # 하이브리드 검색
    results = client.query_points(
        collection_name=NEW_COLLECTION,
        prefetch=[
            models.Prefetch(query=dense_vector, using="dense", limit=10),
            models.Prefetch(query=sparse_vector, using="sparse", limit=10),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=5,
    )

    print(f"검색 결과: {len(results.points)}개")
    for i, r in enumerate(results.points, 1):
        law_name = r.payload.get("law_name", "")
        article = r.payload.get("article_number", "")
        print(f"  {i}. {law_name} {article} (score: {r.score:.4f})")

    return True


def swap_collections(client: QdrantClient):
    """컬렉션 교체 (선택적)"""
    print("\n=== 컬렉션 교체 ===")
    print("주의: 이 작업은 기존 'laws' 컬렉션을 삭제합니다!")

    confirm = input("진행하시겠습니까? (yes/no): ")
    if confirm.lower() != "yes":
        print("교체 취소됨. 새 컬렉션은 'laws_hybrid'로 유지됩니다.")
        print("서비스 코드에서 LAWS_COLLECTION = 'laws_hybrid'로 변경하세요.")
        return

    # 기존 컬렉션 삭제
    print(f"기존 컬렉션 삭제: {OLD_COLLECTION}")
    client.delete_collection(OLD_COLLECTION)

    # 새 컬렉션 이름 변경 (Qdrant는 rename 미지원, 재생성 필요)
    print("참고: Qdrant는 컬렉션 이름 변경을 지원하지 않습니다.")
    print(f"'{NEW_COLLECTION}' 컬렉션을 그대로 사용하거나,")
    print("서비스 코드에서 LAWS_COLLECTION = 'laws_hybrid'로 변경하세요.")


if __name__ == "__main__":
    print("=" * 50)
    print("법령 컬렉션 하이브리드 검색 마이그레이션")
    print("=" * 50)

    # 클라이언트 연결
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    # Sparse 모델 로드
    sparse_model = get_sparse_model()

    # 새 컬렉션 생성
    create_hybrid_collection(client, NEW_COLLECTION)

    # 데이터 마이그레이션
    migrate_data(client, sparse_model)

    # 검증
    if verify_migration(client):
        swap_collections(client)
    else:
        print("마이그레이션 검증 실패. 수동 확인 필요.")
