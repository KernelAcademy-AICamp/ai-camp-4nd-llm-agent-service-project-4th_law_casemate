"""
Qdrant 벡터 DB 클라이언트 서비스
법령 및 판례 데이터의 벡터 저장/검색을 담당합니다.
"""

import os
import threading
from typing import Optional, List, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams, SparseVectorParams, PointStruct
from dotenv import load_dotenv

load_dotenv()

# ==================== QdrantClient 싱글톤 ====================

_qdrant_client = None
_qdrant_lock = threading.Lock()


def get_qdrant_client():
    """QdrantClient 싱글톤 (thread-safe)"""
    global _qdrant_client
    if _qdrant_client is None:
        with _qdrant_lock:
            if _qdrant_client is None:
                host = os.getenv("QDRANT_HOST", "localhost")
                port = int(os.getenv("QDRANT_PORT", "6333"))
                _qdrant_client = QdrantClient(host=host, port=port)
    return _qdrant_client


class QdrantService:
    """Qdrant 벡터 DB 서비스"""

    # 컬렉션 이름 상수
    LAWS_COLLECTION = "laws"
    CASES_COLLECTION = "precedents"
    SUMMARIES_COLLECTION = "precedent_summaries"

    def __init__(self):
        """Qdrant 클라이언트 초기화 (싱글톤 사용)"""
        self.client = get_qdrant_client()

    def check_connection(self) -> bool:
        """Qdrant 서버 연결 확인"""
        try:
            self.client.get_collections()
            return True
        except Exception as e:
            print(f"Qdrant 연결 실패: {e}")
            return False

    # ==================== 컬렉션 관리 ====================

    def create_collection(
        self,
        collection_name: str,
        vector_size: int = 1536,  # OpenAI embedding 기본 차원
        distance: Distance = Distance.COSINE,
    ) -> bool:
        """
        컬렉션 생성

        Args:
            collection_name: 컬렉션 이름
            vector_size: 벡터 차원 수 (임베딩 모델에 따라 다름)
            distance: 거리 측정 방식 (COSINE, EUCLID, DOT)

        Returns:
            성공 여부
        """
        try:
            # 이미 존재하는지 확인
            collections = self.client.get_collections().collections
            exists = any(c.name == collection_name for c in collections)

            if exists:
                print(f"컬렉션 '{collection_name}'이 이미 존재합니다.")
                return True

            # 컬렉션 생성
            self.client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=vector_size,
                    distance=distance,
                ),
            )
            print(f"컬렉션 '{collection_name}' 생성 완료")
            return True

        except Exception as e:
            print(f"컬렉션 생성 실패: {e}")
            return False

    def create_hybrid_collection(
        self,
        collection_name: str,
        dense_size: int = 1536,
        distance: Distance = Distance.COSINE,
    ) -> bool:
        """
        하이브리드 검색용 컬렉션 생성 (Dense + Sparse 벡터)

        Args:
            collection_name: 컬렉션 이름
            dense_size: Dense 벡터 차원 수 (OpenAI: 1536)
            distance: 거리 측정 방식

        Returns:
            성공 여부
        """
        try:
            collections = self.client.get_collections().collections
            exists = any(c.name == collection_name for c in collections)

            if exists:
                print(f"컬렉션 '{collection_name}'이 이미 존재합니다.")
                return True

            self.client.create_collection(
                collection_name=collection_name,
                vectors_config={
                    "dense": VectorParams(size=dense_size, distance=distance),
                },
                sparse_vectors_config={
                    "sparse": SparseVectorParams(),
                },
            )
            print(f"하이브리드 컬렉션 '{collection_name}' 생성 완료")
            return True

        except Exception as e:
            print(f"하이브리드 컬렉션 생성 실패: {e}")
            return False

    def delete_collection(self, collection_name: str) -> bool:
        """컬렉션 삭제"""
        try:
            self.client.delete_collection(collection_name=collection_name)
            print(f"컬렉션 '{collection_name}' 삭제 완료")
            return True
        except Exception as e:
            print(f"컬렉션 삭제 실패: {e}")
            return False

    def list_collections(self) -> List[str]:
        """모든 컬렉션 목록 조회"""
        collections = self.client.get_collections().collections
        return [c.name for c in collections]

    def get_collection_info(self, collection_name: str) -> Optional[Dict[str, Any]]:
        """컬렉션 정보 조회"""
        try:
            info = self.client.get_collection(collection_name=collection_name)
            return {
                "name": collection_name,
                "points_count": info.points_count,
                "status": str(info.status),
            }
        except Exception as e:
            print(f"컬렉션 정보 조회 실패: {e}")
            return None

    def create_summaries_collection(self) -> bool:
        """
        판례 요약 저장용 하이브리드 컬렉션 생성 (Dense 3072 + Sparse)
        유사 판례 검색에서 요약 벡터를 활용하기 위해 text-embedding-3-large 차원 사용
        """
        try:
            collections = self.client.get_collections().collections
            exists = any(c.name == self.SUMMARIES_COLLECTION for c in collections)

            if exists:
                print(f"컬렉션 '{self.SUMMARIES_COLLECTION}'이 이미 존재합니다.")
                return True

            self.client.create_collection(
                collection_name=self.SUMMARIES_COLLECTION,
                vectors_config={
                    "dense": VectorParams(size=3072, distance=Distance.COSINE),
                },
                sparse_vectors_config={
                    "sparse": SparseVectorParams(),
                },
            )

            # case_number 필드에 인덱스 생성 (빠른 조회를 위해)
            self.client.create_payload_index(
                collection_name=self.SUMMARIES_COLLECTION,
                field_name="case_number",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )

            print(f"요약 컬렉션 '{self.SUMMARIES_COLLECTION}' 생성 완료 (Dense 3072 + Sparse)")
            return True

        except Exception as e:
            print(f"요약 컬렉션 생성 실패: {e}")
            return False

    def save_summary(
        self,
        case_number: str,
        summary: str,
        prompt_version: str,
        dense_vector: List[float] = None,
        sparse_vector: Dict[str, Any] = None,
        case_name: str = "",
        court_name: str = "",
        judgment_date: str = "",
    ) -> bool:
        """
        판례 요약 저장 (Dense + Sparse 벡터 포함)

        Args:
            case_number: 사건번호
            summary: 요약 텍스트
            prompt_version: 프롬프트 버전 (재생성 시 참고용)
            dense_vector: Dense 임베딩 벡터 (text-embedding-3-large, 3072차원)
            sparse_vector: Sparse 임베딩 벡터 (BM25) {"indices": [...], "values": [...]}
            case_name: 사건명
            court_name: 법원명
            judgment_date: 선고일자

        Returns:
            성공 여부
        """
        import uuid
        import time

        try:
            # 기존 요약이 있으면 삭제
            self.client.delete(
                collection_name=self.SUMMARIES_COLLECTION,
                points_selector=models.FilterSelector(
                    filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="case_number",
                                match=models.MatchValue(value=case_number),
                            )
                        ]
                    )
                ),
            )

            # 벡터 구성
            vector = {}
            if dense_vector:
                vector["dense"] = dense_vector
            if sparse_vector:
                vector["sparse"] = models.SparseVector(
                    indices=sparse_vector["indices"],
                    values=sparse_vector["values"],
                )

            # 새 요약 저장
            point = PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload={
                    "case_number": case_number,
                    "case_name": case_name,
                    "court_name": court_name,
                    "judgment_date": judgment_date,
                    "summary": summary,
                    "prompt_version": prompt_version,
                    "created_at": int(time.time()),
                },
            )

            self.client.upsert(
                collection_name=self.SUMMARIES_COLLECTION,
                points=[point],
            )
            return True

        except Exception as e:
            print(f"요약 저장 실패: {e}")
            return False

    def get_all_case_numbers(self) -> List[str]:
        """
        cases 컬렉션의 모든 고유 사건번호 조회
        (요약 재생성 시 사용)
        """
        try:
            case_numbers = set()
            offset = None

            while True:
                results, offset = self.client.scroll(
                    collection_name=self.CASES_COLLECTION,
                    limit=100,
                    offset=offset,
                    with_payload=["case_number"],
                    with_vectors=False,
                )

                for point in results:
                    if point.payload and "case_number" in point.payload:
                        case_numbers.add(point.payload["case_number"])

                if offset is None:
                    break

            return list(case_numbers)

        except Exception as e:
            print(f"사건번호 조회 실패: {e}")
            return []

    # ==================== 벡터 저장 ====================

    def upsert_hybrid_vectors(
        self,
        collection_name: str,
        points: List[Dict[str, Any]],
    ) -> bool:
        """
        하이브리드 벡터 저장 (Dense + Sparse)

        Args:
            collection_name: 컬렉션 이름
            points: 저장할 포인트 리스트
                [
                    {
                        "id": "unique_id",
                        "dense_vector": [0.1, 0.2, ...],
                        "sparse_vector": {"indices": [...], "values": [...]},
                        "payload": {"title": "...", "content": "..."}
                    },
                    ...
                ]

        Returns:
            성공 여부
        """
        try:
            point_structs = [
                PointStruct(
                    id=p["id"],
                    vector={
                        "dense": p["dense_vector"],
                        "sparse": models.SparseVector(
                            indices=p["sparse_vector"]["indices"],
                            values=p["sparse_vector"]["values"],
                        ),
                    },
                    payload=p.get("payload", {}),
                )
                for p in points
            ]

            self.client.upsert(
                collection_name=collection_name,
                points=point_structs,
            )
            return True

        except Exception as e:
            print(f"하이브리드 벡터 저장 실패: {e}")
            return False

    def upsert_hybrid_batch(
        self,
        collection_name: str,
        points: List[Dict[str, Any]],
        batch_size: int = 100,
    ) -> int:
        """
        대량 하이브리드 벡터 배치 저장

        Args:
            collection_name: 컬렉션 이름
            points: 저장할 포인트 리스트 (dense_vector, sparse_vector 포함)
            batch_size: 한 번에 저장할 개수

        Returns:
            저장된 포인트 수
        """
        total_saved = 0

        for i in range(0, len(points), batch_size):
            batch = points[i:i + batch_size]
            if self.upsert_hybrid_vectors(collection_name, batch):
                total_saved += len(batch)

        return total_saved

    # ==================== 초기 설정 ====================

    def setup_collections(self, vector_size: int = 1536) -> bool:
        """
        프로젝트에 필요한 컬렉션들을 초기 설정

        Args:
            vector_size: 벡터 차원 (임베딩 모델에 따라 설정)

        Returns:
            성공 여부
        """
        success = True

        # 법령 컬렉션
        if not self.create_collection(self.LAWS_COLLECTION, vector_size):
            success = False

        # 판례 컬렉션
        if not self.create_collection(self.CASES_COLLECTION, vector_size):
            success = False

        # 요약 컬렉션
        if not self.create_summaries_collection():
            success = False

        return success
