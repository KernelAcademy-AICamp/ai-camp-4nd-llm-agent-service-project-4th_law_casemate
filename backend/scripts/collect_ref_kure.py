"""
참조판례 수집 스크립트 (KURE 로컬 + Supabase)

소스: precedents_backup 컬렉션의 reference_cases 필드
타겟:
  - Qdrant: precedents_kure (벡터 + 메타데이터, content 제외)
  - Supabase: precedents 테이블 (원문 저장)

- 임베딩: KURE-v1 로컬 모델
- 기존 청킹 로직 그대로 유지 (BaseCaseCollector 상속)
- 중단 후 재시작 시 자동으로 이어서 수집

사용법:
    # 테스트 (5건)
    python scripts/collect_ref_kure.py --limit 5

    # 전체 수집
    python scripts/collect_ref_kure.py

    # 백그라운드 실행
    nohup python scripts/collect_ref_kure.py > collect_ref_kure.log 2>&1 &

    # 진행 상황 확인
    tail -f collect_ref_kure.log

    # 처음부터 다시 수집
    python scripts/collect_ref_kure.py --reset

    # 다른 소스 컬렉션 지정
    python scripts/collect_ref_kure.py --source precedents
"""

import sys
import asyncio
import argparse
import re
import time
import hashlib
import json
from pathlib import Path
from typing import List, Dict, Any, Set
from datetime import datetime

from qdrant_client.http import models
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from tool.law_api_client import LawAPIClient
from tool.qdrant_client import QdrantService, get_qdrant_client
from tool.database import SessionLocal
from app.models.precedent import Precedent
from app.services.precedent_embedding_service import get_sparse_model
from app.config import EmbeddingConfig, CollectionConfig
from scripts.base_collector import BaseCaseCollector, RateLimiter


# ==================== 설정 ====================

TARGET_COLLECTION = "precedents_kure"  # 양자화 전 컬렉션
KURE_MODEL = EmbeddingConfig.KURE_MODEL
KURE_DIM = EmbeddingConfig.KURE_DIMENSION
BATCH_SIZE = 32


# ==================== 수집기 클래스 ====================

class RefCaseCollectorKure(BaseCaseCollector):
    """
    참조판례 수집기 (KURE 로컬 + Supabase)

    BaseCaseCollector 상속:
    - 청킹 로직 (chunk_full_text, _split_top_level_sections 등)
    - 메타데이터 추출 (extract_reference_metadata)
    - API Rate Limiting

    오버라이드:
    - create_embeddings: KURE 로컬 사용
    - save_to_qdrant: content 제외
    - save_to_supabase: 원문 저장 추가
    """

    # 참조판례 소스 컬렉션
    SOURCE_COLLECTION = "precedents_kure"

    def __init__(self):
        super().__init__()

        self.qdrant_client = get_qdrant_client()
        self.api_client: LawAPIClient | None = None

        # KURE 모델 로드
        print(f"\n{'='*60}")
        print(f"KURE-v1 모델 로딩 중... ({KURE_MODEL})")
        start = time.time()
        self.kure_model = SentenceTransformer(KURE_MODEL)
        print(f"✓ 모델 로드 완료 ({time.time() - start:.1f}초)")
        print(f"  - Device: {self.kure_model.device}")
        print(f"{'='*60}\n")

        # 진행 상태 파일
        self.progress_file = self.data_dir.parent / "collect_ref_kure_progress.json"
        self.progress: Dict[str, Any] = self._load_progress()

        # 실패 로그 파일 (날짜별)
        today = datetime.now().strftime("%y%m%d")
        self.fail_log_file = self.data_dir.parent / f"{today}_fail_ref_precedents.json"
        self.fail_log: List[Dict[str, Any]] = self._load_fail_log()

    # ==================== 실패 로그 관리 ====================

    def _load_fail_log(self) -> List[Dict[str, Any]]:
        """실패 로그 로드"""
        if self.fail_log_file.exists():
            try:
                with open(self.fail_log_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except:
                pass
        return []

    def _save_fail_log(self):
        """실패 로그 저장"""
        try:
            with open(self.fail_log_file, "w", encoding="utf-8") as f:
                json.dump(self.fail_log, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"⚠️ 실패 로그 저장 실패: {e}")

    def _log_failure(self, case_number: str, reason: str, detail: str = ""):
        """실패 기록 추가"""
        self.fail_log.append({
            "case_number": case_number,
            "reason": reason,
            "detail": detail,
            "timestamp": datetime.now().isoformat(),
        })
        # 10건마다 저장
        if len(self.fail_log) % 10 == 0:
            self._save_fail_log()

    # ==================== 진행 상태 관리 ====================

    def _load_progress(self) -> Dict[str, Any]:
        """진행 상태 로드"""
        if self.progress_file.exists():
            try:
                with open(self.progress_file, "r", encoding="utf-8") as f:
                    progress = json.load(f)
                    print(f"✓ 진행 상태 로드: {len(progress.get('collected', []))}건 완료됨")
                    return progress
            except Exception as e:
                print(f"⚠️ 진행 상태 로드 실패: {e}")
        return {"collected": [], "failed": [], "last_keyword": None}

    def _save_progress(self):
        """진행 상태 저장"""
        try:
            with open(self.progress_file, "w", encoding="utf-8") as f:
                json.dump(self.progress, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"⚠️ 진행 상태 저장 실패: {e}")

    def _mark_collected(self, case_number: str):
        """수집 완료 표시"""
        if case_number not in self.progress["collected"]:
            self.progress["collected"].append(case_number)
            # 100건마다 저장
            if len(self.progress["collected"]) % 100 == 0:
                self._save_progress()

    def _is_collected(self, case_number: str) -> bool:
        """이미 수집됐는지 확인"""
        return case_number in self.progress["collected"]

    # ==================== Supabase 저장 ====================

    def save_to_supabase(self, case_info: Dict[str, Any], full_content: str) -> bool:
        """원문을 Supabase에 저장"""
        db = SessionLocal()
        try:
            existing = db.query(Precedent).filter(
                Precedent.case_number == case_info["case_number"]
            ).first()

            if existing:
                existing.case_name = case_info.get("case_name")
                existing.court_name = case_info.get("court_name")
                existing.case_type = case_info.get("case_type")
                existing.judgment_date = case_info.get("judgment_date")
                existing.full_content = full_content
                existing.updated_at = datetime.utcnow()
            else:
                precedent = Precedent(
                    case_number=case_info["case_number"],
                    case_name=case_info.get("case_name"),
                    court_name=case_info.get("court_name"),
                    case_type=case_info.get("case_type"),
                    judgment_date=case_info.get("judgment_date"),
                    full_content=full_content,
                )
                db.add(precedent)

            db.commit()
            return True
        except Exception as e:
            db.rollback()
            print(f"    ❌ Supabase 저장 실패: {e}")
            return False
        finally:
            db.close()

    # ==================== 임베딩 (KURE 로컬) ====================

    def create_embeddings(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """KURE Dense + BM25 Sparse 임베딩 생성 (기존 메서드 오버라이드)"""
        if not chunks:
            return []

        texts = [c.get("content", "") for c in chunks]

        # KURE Dense 임베딩 (배치)
        dense_embeddings = self.kure_model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False
        )

        # BM25 Sparse 임베딩
        sparse_embeddings = list(self.sparse_model.embed(texts))

        results = []
        for i, chunk in enumerate(chunks):
            chunk_with_vector = chunk.copy()
            chunk_with_vector["dense_vector"] = dense_embeddings[i].tolist()
            chunk_with_vector["sparse_vector"] = {
                "indices": sparse_embeddings[i].indices.tolist(),
                "values": sparse_embeddings[i].values.tolist(),
            }
            results.append(chunk_with_vector)

        return results

    # ==================== Qdrant 저장 (기존 precedents_kure와 동일) ====================

    def save_to_qdrant(self, chunks_with_vectors: List[Dict[str, Any]], keyword: str) -> int:
        """Qdrant에 저장 (기존 precedents_kure와 동일한 payload 구조)"""
        if not chunks_with_vectors:
            return 0

        points = []
        for chunk in chunks_with_vectors:
            id_string = f"case_{chunk.get('case_number', '')}_{chunk.get('section', '')}_{chunk.get('chunk_index', 0)}"
            hash_hex = hashlib.md5(id_string.encode()).hexdigest()[:16]
            point_id = int(hash_hex, 16)

            # judgment_date를 int로 변환 (기존 형식)
            judgment_date = chunk.get("judgment_date", "")
            if isinstance(judgment_date, str) and judgment_date.isdigit():
                judgment_date = int(judgment_date)

            points.append(models.PointStruct(
                id=point_id,
                vector={
                    "dense": chunk["dense_vector"],
                    "sparse": models.SparseVector(
                        indices=chunk["sparse_vector"]["indices"],
                        values=chunk["sparse_vector"]["values"],
                    ),
                },
                payload={
                    "case_number": chunk.get("case_number", ""),
                    "section": chunk.get("section", ""),
                    "chunk_index": chunk.get("chunk_index", 0),
                    "court_name": chunk.get("court_name", ""),
                    "case_type": chunk.get("case_type", ""),
                    "judgment_date": judgment_date,
                    "reference_cases": chunk.get("reference_cases", []),
                    "reference_laws": chunk.get("reference_laws", []),
                },
            ))

        # 배치 upsert
        self.qdrant_client.upsert(
            collection_name=TARGET_COLLECTION,
            points=points,
        )

        return len(points)

    # ==================== 참조판례 추출 ====================

    def get_ref_case_numbers(self) -> Dict[str, Set[str]]:
        """
        precedents_backup에서 reference_cases 필드 추출

        Returns:
            {원본_사건번호: {참조판례_사건번호들}}
        """
        print(f"\n[{self.SOURCE_COLLECTION}] reference_cases 필드 조회 중...")

        ref_map: Dict[str, Set[str]] = {}
        seen_case_numbers = set()  # 중복 원본 판례 방지
        offset = None

        while True:
            results, offset = self.qdrant_client.scroll(
                collection_name=self.SOURCE_COLLECTION,
                limit=1000,
                offset=offset,
                with_payload=["case_number", "reference_cases"],
                with_vectors=False
            )

            for point in results:
                case_number = point.payload.get("case_number", "")
                reference_cases = point.payload.get("reference_cases", [])

                # 이미 처리한 사건번호면 스킵 (청크 중복 방지)
                if case_number in seen_case_numbers:
                    continue
                seen_case_numbers.add(case_number)

                # reference_cases가 있으면 추가
                if reference_cases and isinstance(reference_cases, list):
                    if case_number not in ref_map:
                        ref_map[case_number] = set()
                    ref_map[case_number].update(reference_cases)

            if offset is None:
                break

        # 통계
        unique_refs = set()
        for refs in ref_map.values():
            unique_refs.update(refs)

        print(f"  → {len(seen_case_numbers)}개 원본 판례 조회됨")
        print(f"  → {len(ref_map)}개 판례에서 {len(unique_refs)}개 고유 참조판례 추출됨")

        return ref_map

    # ==================== 중복 체크 (Qdrant + Progress) ====================

    def load_existing_case_numbers(self):
        """이미 수집된 사건번호 로드 (Qdrant + Progress 파일)"""
        print("기존 수집된 사건번호 로드 중...")

        # 1) Progress 파일에서
        for case_num in self.progress.get("collected", []):
            self.collected_case_numbers.add(case_num)

        # 2) Qdrant에서
        try:
            offset = None
            while True:
                results, offset = self.qdrant_client.scroll(
                    collection_name=TARGET_COLLECTION,
                    limit=1000,
                    offset=offset,
                    with_payload=["case_number"],
                    with_vectors=False,
                )

                for point in results:
                    case_number = point.payload.get("case_number", "")
                    if case_number:
                        self.collected_case_numbers.add(case_number)

                if offset is None:
                    break
        except Exception as e:
            print(f"  ⚠️ Qdrant 조회 실패: {e}")

        print(f"  → {len(self.collected_case_numbers)}개 사건번호 로드됨")

    # ==================== 사건번호로 검색 ====================

    async def search_case_by_number(self, case_number: str) -> tuple[Dict[str, Any] | None, str]:
        """
        사건번호로 판례 검색 (nb 파라미터 사용)

        Returns:
            (상세정보, 실패사유) - 성공 시 실패사유는 ""
        """
        # nb 파라미터로 사건번호 직접 검색
        result = await self.api_call_with_retry(
            self._search_by_case_number,
            case_number,
            case_number=case_number,
            keyword="reference",
        )

        if result is None:
            return None, "API 호출 실패"

        prec_search = result.get("PrecSearch", {})
        cases = prec_search.get("prec", [])

        if not cases:
            return None, "검색 결과 없음"

        if isinstance(cases, dict):
            cases = [cases]

        # 정확히 일치하는 사건번호 찾기
        case = None
        found_cases = []
        for c in cases:
            found_case_number = c.get("사건번호", "").replace(" ", "")
            found_cases.append(c.get("사건번호", ""))
            if found_case_number == case_number.replace(" ", ""):
                case = c
                break

        if not case:
            return None, f"일치하는 사건번호 없음 (총 {len(cases)}건, 샘플: {found_cases[:3]})"

        case_id = case.get("판례일련번호", "")
        if not case_id:
            return None, "판례일련번호 없음"

        detail_result = await self.api_call_with_retry(
            self.api_client.get_case_detail,
            case_id,
            case_number=case_number,
            keyword="reference",
        )

        if detail_result:
            return detail_result.get("PrecService", {}), ""
        else:
            return None, "상세 조회 실패"

    async def _search_by_case_number(self, case_number: str) -> Dict[str, Any]:
        """nb 파라미터로 사건번호 직접 검색"""
        params = {
            "OC": self.api_client.api_key,
            "target": "prec",
            "type": "JSON",
            "nb": case_number,  # 사건번호 직접 검색
        }

        response = await self.api_client.client.get(
            "https://www.law.go.kr/DRF/lawSearch.do",
            params=params,
        )
        response.raise_for_status()
        return response.json()

    # ==================== 메인 수집 로직 ====================

    async def collect(self, limit: int = None):
        """참조판례 수집 실행"""
        print(f"\n{'='*60}")
        print(f"참조판례 수집 (KURE 로컬 + Supabase)")
        print(f"소스: {self.SOURCE_COLLECTION} → reference_cases 필드")
        print(f"타겟: {TARGET_COLLECTION}")
        if limit:
            print(f"제한: {limit}건")
        print(f"{'='*60}")

        # 컬렉션 확인
        collections = [c.name for c in self.qdrant_client.get_collections().collections]
        if TARGET_COLLECTION not in collections:
            print(f"❌ {TARGET_COLLECTION} 컬렉션이 없습니다. 먼저 생성하세요.")
            return
        if self.SOURCE_COLLECTION not in collections:
            print(f"❌ {self.SOURCE_COLLECTION} 컬렉션이 없습니다.")
            return

        # 기존 수집된 사건번호 로드
        self.load_existing_case_numbers()

        total_collected = 0
        total_chunks = 0
        total_skipped = 0
        total_failed = 0

        try:
            async with LawAPIClient() as client:
                self.api_client = client

                # 1. 참조판례 사건번호 추출 (precedents_backup의 reference_cases 필드)
                ref_map = self.get_ref_case_numbers()

                # 2. 모든 참조판례 사건번호 수집
                all_ref_numbers = set()
                ref_from_map = {}  # 참조판례 → 원본 판례 매핑

                for origin_case, ref_cases in ref_map.items():
                    for ref_case in ref_cases:
                        all_ref_numbers.add(ref_case)
                        if ref_case not in ref_from_map:
                            ref_from_map[ref_case] = []
                        ref_from_map[ref_case].append(origin_case)

                # 3. 중복 제외
                new_refs = all_ref_numbers - self.collected_case_numbers

                if limit:
                    new_refs = set(list(new_refs)[:limit])

                print(f"\n새로 수집: {len(new_refs)}건 (기존 {len(all_ref_numbers) - len(new_refs)}건 제외)")

                # 4. 수집
                pbar = tqdm(list(new_refs), desc="수집 중")
                for ref_number in pbar:
                    pbar.set_postfix({"case": ref_number[:15]})

                    # 이미 수집됐으면 스킵
                    if self._is_collected(ref_number):
                        total_skipped += 1
                        continue

                    # API 조회
                    detail, fail_reason = await self.search_case_by_number(ref_number)

                    if not detail:
                        total_failed += 1
                        self._log_failure(ref_number, fail_reason)
                        continue

                    actual_case_number = detail.get("사건번호", ref_number)

                    # 중복 체크
                    if self.is_duplicate(actual_case_number):
                        total_skipped += 1
                        self._mark_collected(actual_case_number)
                        continue

                    # 메타데이터
                    case_info = {
                        "case_number": actual_case_number,
                        "case_name": detail.get("사건명", ""),
                        "court_name": detail.get("법원명", ""),
                        "judgment_date": detail.get("선고일자", ""),
                        "case_type": detail.get("사건종류명", ""),
                        "judgment_type": detail.get("판결유형", ""),
                        "case_serial_number": detail.get("판례정보일련번호", ""),
                        "case_type_code": detail.get("사건종류코드", ""),
                        "court_type_code": detail.get("법원종류코드", ""),
                        "source": "reference",
                        "ref_from": ",".join(ref_from_map.get(ref_number, [])),
                    }

                    # 참조 메타데이터 추출 (기존 로직)
                    ref_metadata = self.extract_reference_metadata(detail)
                    case_info.update(ref_metadata)

                    # 전문 구성 (기존 로직)
                    full_text = self.build_full_text(detail)

                    # 1) Supabase에 원문 저장
                    self.save_to_supabase(case_info, full_text)

                    # 2) 청킹 (기존 로직 그대로)
                    chunks = self.chunk_full_text(full_text, case_info)

                    # 3) 임베딩 생성 (KURE 로컬)
                    chunks_with_vectors = self.create_embeddings(chunks)

                    # 4) Qdrant에 저장 (content 제외)
                    saved = self.save_to_qdrant(chunks_with_vectors, keyword="reference")

                    total_collected += 1
                    total_chunks += saved
                    self.collected_case_numbers.add(actual_case_number)
                    self._mark_collected(actual_case_number)

        except KeyboardInterrupt:
            print(f"\n\n⚠️ 중단됨 (Ctrl+C)")
        finally:
            # 진행 상태 저장
            self._save_progress()
            self._save_fail_log()

        # 결과 출력
        print(f"\n{'='*60}")
        print(f"수집 완료!")
        print(f"  - 수집: {total_collected}건")
        print(f"  - 청크: {total_chunks}개")
        print(f"  - 스킵(중복): {total_skipped}건")
        print(f"  - 실패: {total_failed}건")
        if self.fail_log:
            print(f"  - 실패 로그: {self.fail_log_file}")
        print(f"  - 진행 상태: {self.progress_file}")
        print(f"{'='*60}")


async def main():
    parser = argparse.ArgumentParser(description="참조판례 수집 (KURE 로컬 + Supabase)")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="수집할 최대 판례 수 (테스트용)"
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="진행 상태 초기화 (처음부터 다시 수집)"
    )
    parser.add_argument(
        "--source",
        type=str,
        default=None,
        help="소스 컬렉션 이름 (기본: precedents_backup)"
    )
    args = parser.parse_args()

    collector = RefCaseCollectorKure()

    if args.reset:
        collector.progress = {"collected": [], "failed": []}
        collector._save_progress()
        print("✓ 진행 상태 초기화됨")

    if args.source:
        collector.SOURCE_COLLECTION = args.source

    await collector.collect(limit=args.limit)


if __name__ == "__main__":
    asyncio.run(main())
