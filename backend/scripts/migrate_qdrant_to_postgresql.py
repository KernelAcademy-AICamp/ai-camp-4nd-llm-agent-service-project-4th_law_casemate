"""
Qdrant → PostgreSQL 마이그레이션 스크립트

1. Qdrant precedents 컬렉션에서 모든 청크 읽기
2. case_number별로 그룹핑
3. 청크 재조립하여 full_content 생성
4. PostgreSQL precedents 테이블에 저장
5. Qdrant summaries 컬렉션 → precedent_summaries 테이블 이전
"""

import os
import sys
from pathlib import Path
from typing import Dict, List, Any
from collections import defaultdict
from dotenv import load_dotenv

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

load_dotenv()

from qdrant_client import QdrantClient
from sqlalchemy.orm import Session
from tool.database import SessionLocal, engine, Base
from app.models.precedent import Precedent, PrecedentSummary


# Qdrant 설정
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
PRECEDENTS_COLLECTION = "precedents"
SUMMARIES_COLLECTION = "precedent_summaries"


def get_qdrant_client() -> QdrantClient:
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def merge_chunks_to_text(chunks: List[Dict[str, Any]]) -> str:
    """청크들을 정렬하여 전문 텍스트로 병합"""
    if not chunks:
        return ""

    # chunk_index로 정렬
    chunks.sort(key=lambda x: x.get("chunk_index", 0))

    content_parts = []
    current_section = None

    for chunk in chunks:
        section = chunk.get("section", "")
        content = chunk.get("content", "")

        # 섹션이 바뀌면 헤더 추가
        if section and section != current_section:
            if section in ["판시사항", "판결요지", "이유", "주문"]:
                content_parts.append(f"\n【{section}】\n")
            current_section = section

        content_parts.append(content)

    return "".join(content_parts).strip()


def migrate_precedents(qdrant: QdrantClient, db: Session) -> int:
    """판례 데이터 마이그레이션"""
    print("\n" + "=" * 60)
    print("판례 데이터 마이그레이션 시작")
    print("=" * 60)

    # 1. Qdrant에서 모든 청크 읽기
    print("\n[1/4] Qdrant에서 청크 읽는 중...")
    all_chunks = []
    offset = None
    batch_count = 0

    while True:
        results, offset = qdrant.scroll(
            collection_name=PRECEDENTS_COLLECTION,
            limit=1000,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        if not results:
            break

        all_chunks.extend(results)
        batch_count += 1
        print(f"  - 배치 {batch_count}: {len(all_chunks)}개 청크 로드됨")

        if offset is None:
            break

    print(f"  → 총 {len(all_chunks)}개 청크 로드 완료")

    # 2. case_number별로 그룹핑
    print("\n[2/4] case_number별 그룹핑 중...")
    case_chunks: Dict[str, List[Dict]] = defaultdict(list)

    for point in all_chunks:
        payload = point.payload
        case_number = payload.get("case_number", "")
        if case_number:
            case_chunks[case_number].append({
                "section": payload.get("section", ""),
                "chunk_index": payload.get("chunk_index", 0),
                "content": payload.get("content", ""),
                "case_name": payload.get("case_name", ""),
                "court_name": payload.get("court_name", ""),
                "case_type": payload.get("case_type", ""),
                "judgment_date": payload.get("judgment_date", ""),
            })

    print(f"  → {len(case_chunks)}개 판례로 그룹핑 완료")

    # 3. PostgreSQL에 저장
    print("\n[3/4] PostgreSQL에 저장 중...")
    saved_count = 0
    error_count = 0

    for case_number, chunks in case_chunks.items():
        try:
            # 첫 번째 청크에서 메타데이터 추출
            first_chunk = chunks[0]

            # 청크 병합하여 전문 생성
            full_content = merge_chunks_to_text(chunks)

            # 기존 레코드 확인
            existing = db.query(Precedent).filter(
                Precedent.case_number == case_number
            ).first()

            if existing:
                # 업데이트
                existing.case_name = first_chunk["case_name"]
                existing.court_name = first_chunk["court_name"]
                existing.case_type = first_chunk["case_type"]
                existing.judgment_date = first_chunk["judgment_date"]
                existing.full_content = full_content
            else:
                # 새로 생성
                precedent = Precedent(
                    case_number=case_number,
                    case_name=first_chunk["case_name"],
                    court_name=first_chunk["court_name"],
                    case_type=first_chunk["case_type"],
                    judgment_date=first_chunk["judgment_date"],
                    full_content=full_content,
                )
                db.add(precedent)

            saved_count += 1

            if saved_count % 500 == 0:
                db.commit()
                print(f"  - {saved_count}/{len(case_chunks)} 저장됨")

        except Exception as e:
            error_count += 1
            print(f"  ✗ {case_number} 저장 실패: {e}")

    db.commit()
    print(f"  → {saved_count}개 판례 저장 완료 (오류: {error_count}개)")

    # 4. 검증
    print("\n[4/4] 검증 중...")
    db_count = db.query(Precedent).count()
    print(f"  - PostgreSQL precedents 테이블: {db_count}개")
    print(f"  - Qdrant 고유 판례 수: {len(case_chunks)}개")

    if db_count == len(case_chunks):
        print("  ✓ 검증 성공!")
    else:
        print("  ⚠ 개수 불일치 - 확인 필요")

    return saved_count


def migrate_summaries(qdrant: QdrantClient, db: Session) -> int:
    """요약 데이터 마이그레이션"""
    print("\n" + "=" * 60)
    print("요약 데이터 마이그레이션 시작")
    print("=" * 60)

    # Qdrant에서 요약 읽기
    print("\n[1/2] Qdrant에서 요약 읽는 중...")

    try:
        # 컬렉션 존재 확인
        qdrant.get_collection(SUMMARIES_COLLECTION)
    except Exception:
        print("  - summaries 컬렉션 없음, 스킵")
        return 0

    all_summaries = []
    offset = None

    while True:
        results, offset = qdrant.scroll(
            collection_name=SUMMARIES_COLLECTION,
            limit=500,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        if not results:
            break

        all_summaries.extend(results)

        if offset is None:
            break

    print(f"  → {len(all_summaries)}개 요약 로드 완료")

    # PostgreSQL에 저장
    print("\n[2/2] PostgreSQL에 저장 중...")
    saved_count = 0

    for point in all_summaries:
        payload = point.payload
        case_number = payload.get("case_number", "")

        if not case_number:
            continue

        try:
            existing = db.query(PrecedentSummary).filter(
                PrecedentSummary.case_number == case_number
            ).first()

            if existing:
                existing.summary = payload.get("summary", "")
                existing.prompt_version = payload.get("prompt_version", "")
            else:
                summary = PrecedentSummary(
                    case_number=case_number,
                    summary=payload.get("summary", ""),
                    prompt_version=payload.get("prompt_version", ""),
                )
                db.add(summary)

            saved_count += 1

        except Exception as e:
            print(f"  ✗ {case_number} 요약 저장 실패: {e}")

    db.commit()
    print(f"  → {saved_count}개 요약 저장 완료")

    return saved_count


def main():
    print("\n" + "=" * 60)
    print("Qdrant → PostgreSQL 마이그레이션")
    print("=" * 60)

    # 연결
    qdrant = get_qdrant_client()
    db = SessionLocal()

    try:
        # 테이블 생성 확인
        print("\n테이블 생성 확인 중...")
        Base.metadata.create_all(bind=engine)
        print("  ✓ 테이블 준비 완료")

        # 판례 마이그레이션
        precedent_count = migrate_precedents(qdrant, db)

        # 요약 마이그레이션
        summary_count = migrate_summaries(qdrant, db)

        # 최종 결과
        print("\n" + "=" * 60)
        print("마이그레이션 완료!")
        print("=" * 60)
        print(f"  - 판례: {precedent_count}개")
        print(f"  - 요약: {summary_count}개")
        print("=" * 60)

    except Exception as e:
        print(f"\n오류 발생: {e}")
        import traceback
        traceback.print_exc()

    finally:
        db.close()


if __name__ == "__main__":
    main()
