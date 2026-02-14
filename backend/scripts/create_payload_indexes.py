"""
Qdrant Payload Index 생성 스크립트 (1회성)

필터링 성능 개선을 위해 자주 사용되는 필드에 인덱스 추가
- 기존 데이터에 영향 없음
- 검색 속도만 개선됨
"""

import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models

load_dotenv()

QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
COLLECTION_NAME = "precedents"


def create_indexes():
    """precedents 컬렉션에 payload index 생성"""
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    # 연결 확인
    try:
        info = client.get_collection(COLLECTION_NAME)
        print(f"컬렉션 '{COLLECTION_NAME}' 연결 확인: {info.points_count}개 포인트")
    except Exception as e:
        print(f"컬렉션 연결 실패: {e}")
        return

    # 생성할 인덱스 목록
    indexes = [
        ("case_number", models.PayloadSchemaType.KEYWORD, "사건번호 정확 검색"),
        ("court_name", models.PayloadSchemaType.TEXT, "법원명 필터"),
        ("case_type", models.PayloadSchemaType.KEYWORD, "사건 종류 필터"),
        ("judgment_date", models.PayloadSchemaType.KEYWORD, "기간 필터"),
        ("section", models.PayloadSchemaType.KEYWORD, "섹션 필터 (유사판례 검색)"),
    ]

    print(f"\n{'='*50}")
    print("Payload Index 생성 시작")
    print(f"{'='*50}\n")

    for field_name, schema_type, description in indexes:
        try:
            client.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field_name,
                field_schema=schema_type,
            )
            print(f"✓ {field_name} ({schema_type.name}) - {description}")
        except Exception as e:
            # 이미 존재하는 경우 등
            print(f"✗ {field_name} - {e}")

    print(f"\n{'='*50}")
    print("완료!")
    print(f"{'='*50}")

    # 결과 확인
    info = client.get_collection(COLLECTION_NAME)
    print(f"\n현재 인덱스 상태:")
    if info.payload_schema:
        for field, schema in info.payload_schema.items():
            print(f"  - {field}: {schema}")
    else:
        print("  (인덱스 정보 없음)")


if __name__ == "__main__":
    create_indexes()
