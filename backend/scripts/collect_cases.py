import os
import sys
import json
import asyncio
import hashlib
import time
import re
import traceback
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
from dotenv import load_dotenv
from openai import OpenAI
from fastembed import SparseTextEmbedding

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.law_api_service import LawAPIClient
from app.services.qdrant_service import QdrantService
from app.services.summary_service import SummaryService
from app.prompts.summary_prompt import PROMPT_VERSION

load_dotenv()


class CaseCollector:
    """판례 데이터 수집기"""

    # 검색 키워드
    KEYWORDS = ["명예훼손 손해배상", "명예훼손", "모욕", "명예 침해", "공연성", "허위사실", "비방"]

    # 청킹 설정
    MAX_CHARS = 1100  # 약 400토큰 (한글 기준 보수적으로)
    MIN_CHARS = 200   # 이하면 다음 청크와 병합

    # 법률 문서 번호 패턴
    NUMBER_PATTERNS = [
        r'(?:^|\n)\s*(\d+)\.\s',           # 1. 2. 3.
        r'(?:^|\n)\s*([가-힣])\.\s',        # 가. 나. 다.
        r'(?:^|\n)\s*\((\d+)\)\s',          # (1) (2) (3)
        r'(?:^|\n)\s*([①②③④⑤⑥⑦⑧⑨⑩])\s',  # ① ② ③
    ]

    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_service = QdrantService()
        self.summary_service = SummaryService()
        self.data_dir = Path(__file__).parent.parent / "data" / "cases"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.collected_case_numbers: Set[str] = set()

        # Sparse 임베딩 모델 (BM25)
        print("Sparse 임베딩 모델 로딩 중...")
        self.sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")

    # ==================== 1. 판례 목록 검색 ====================

    async def fetch_case_list(self, keyword: str, max_pages: int = 100) -> List[Dict[str, Any]]:
        """키워드로 판례 목록 검색 (페이지네이션)"""
        all_cases = []

        async with LawAPIClient() as client:
            page = 1
            while page <= max_pages:
                result = await client.search_cases(
                    query=keyword,
                    display=100,
                    page=page
                )

                prec_search = result.get("PrecSearch", {})
                cases = prec_search.get("prec", [])

                if not cases:
                    break

                if isinstance(cases, dict):
                    cases = [cases]

                all_cases.extend(cases)
                total_cnt = int(prec_search.get("totalCnt", 0))

                if len(all_cases) >= total_cnt:
                    break

                page += 1
                time.sleep(0.5)

        return all_cases

    # ==================== 2. 판례 상세 조회 ====================

    async def fetch_case_detail(self, case_id: str) -> Optional[Dict[str, Any]]:
        """판례 상세 정보 조회"""
        async with LawAPIClient() as client:
            try:
                result = await client.get_case_detail(case_id)
                return result.get("PrecService", {})
            except Exception as e:
                print(f"    - 판례 {case_id} 조회 실패: {e}")
                return None

    # ==================== 3. 전체 텍스트 구성 ====================

    def _build_full_text(self, detail: Dict[str, Any]) -> str:
        """
        판시사항/판결요지/참조조문/참조판례 + 판례내용을 합쳐서 전체 텍스트 구성
        """
        parts = []

        if detail.get("판시사항"):
            parts.append(f"【판시사항】\n{detail.get('판시사항')}")

        if detail.get("판결요지"):
            parts.append(f"【판결요지】\n{detail.get('판결요지')}")

        if detail.get("참조조문"):
            parts.append(f"【참조조문】\n{detail.get('참조조문')}")

        if detail.get("참조판례"):
            parts.append(f"【참조판례】\n{detail.get('참조판례')}")

        if detail.get("판례내용"):
            parts.append(f"【전문】\n{detail.get('판례내용')}")

        return "\n\n".join(parts)

    # ==================== 4. 청킹 (섹션 → 번호 → 문장) ====================

    def chunk_full_text(self, full_text: str, case_info: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        판례 전문 청킹: 섹션 → 번호 단위 → 병합 → 문장 단위

        Args:
            full_text: 판례 전문
            case_info: 판례 기본 정보

        Returns:
            청크 리스트 (전역 인덱스로 원문 순서 유지)
        """
        if not full_text:
            return []

        # HTML 태그 제거
        full_text = re.sub(r'<br\s*/?>', '\n', full_text)
        full_text = re.sub(r'<[^>]+>', '', full_text)

        chunks = []
        global_index = 0  # 전역 청크 인덱스 (원문 순서 유지)

        # 1차: 【】 섹션으로 분리
        sections = self._split_by_sections(full_text)

        for section_name, section_content in sections:
            # 빈 섹션인 경우 섹션명만 저장
            if not section_content:
                chunks.append({
                    "section": section_name,
                    "chunk_index": global_index,
                    "content": f"[{section_name}]",
                    **case_info
                })
                global_index += 1
                continue

            # 2차: 번호 단위로 분리
            numbered_parts = self._split_by_numbers(section_content)

            # 3차: 작은 파트들을 MAX_CHARS까지 병합
            merged_parts = self._merge_small_parts(numbered_parts)

            # 4차: MAX_CHARS 초과 시 문장 단위로 분할
            section_chunks = []
            for part in merged_parts:
                if len(part) > self.MAX_CHARS:
                    part_chunks = self._split_by_sentences(part)
                    section_chunks.extend(part_chunks)
                else:
                    section_chunks.append(part)

            # 전역 인덱스로 부여
            for chunk_content in section_chunks:
                chunks.append({
                    "section": section_name,
                    "chunk_index": global_index,
                    "content": chunk_content,
                    **case_info
                })
                global_index += 1

        return chunks

    def _merge_small_parts(self, parts: List[str]) -> List[str]:
        """
        MIN_CHARS 이하인 파트들을 MAX_CHARS까지 병합

        Args:
            parts: 번호 단위로 분리된 파트들

        Returns:
            병합된 파트 리스트
        """
        if not parts:
            return parts

        merged = []
        current = ""

        for part in parts:
            # 현재 + 새 파트가 MAX_CHARS 이내면 병합
            if len(current) + len(part) + 1 <= self.MAX_CHARS:
                current = current + "\n" + part if current else part
            else:
                # 현재 청크 저장
                if current:
                    merged.append(current)
                current = part

        # 마지막 청크 처리
        if current:
            # 마지막 청크가 MIN_CHARS 이하이고 이전 청크가 있으면 병합 시도
            if len(current) <= self.MIN_CHARS and merged:
                last = merged[-1]
                if len(last) + len(current) + 1 <= self.MAX_CHARS:
                    merged[-1] = last + "\n" + current
                else:
                    merged.append(current)
            else:
                merged.append(current)

        return merged

    def _split_by_sections(self, text: str) -> List[tuple]:
        pattern = r'【([^】]+)】' # 】 섹션 단위로 분리 (빈 섹션도 포함)
        parts = re.split(pattern, text)

        sections = []

        # 【】 이전 내용 → "기본정보"로 저장
        if parts[0].strip():
            sections.append(("기본정보", parts[0].strip()))

        # 【섹션명】내용 순서대로 추출 (빈 섹션도 포함)
        for i in range(1, len(parts), 2):
            if i + 1 < len(parts):
                section_name = parts[i].strip()
                section_content = parts[i + 1].strip()
                sections.append((section_name, section_content))  # 빈 섹션도 저장

        # 【】가 전혀 없으면 전체를 "전문"으로
        if not sections:
            sections.append(("전문", text.strip()))

        return sections

    def _split_by_numbers(self, text: str) -> List[str]:
        """번호 단위(1., 가., (1), ①)로 분리"""
        # 모든 번호 패턴 위치 찾기
        split_positions = [0]

        for pattern in self.NUMBER_PATTERNS:
            for match in re.finditer(pattern, text):
                pos = match.start()
                if pos > 0:
                    split_positions.append(pos)

        split_positions = sorted(set(split_positions))
        split_positions.append(len(text))

        # 위치 기준으로 분리
        parts = []
        for i in range(len(split_positions) - 1):
            part = text[split_positions[i]:split_positions[i + 1]].strip()
            if part:
                parts.append(part)

        return parts if parts else [text]

    def _split_by_sentences(self, text: str) -> List[str]:
        """문장 단위로 MAX_CHARS 이내로 분할"""
        if len(text) <= self.MAX_CHARS:
            return [text]

        # 문장 종결 패턴으로 분리
        sentences = re.split(r'(?<=[.다요함임음됨])\s+', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks = []
        current_chunk = []
        current_len = 0

        for sentence in sentences:
            sentence_len = len(sentence)

            # 단일 문장이 MAX_CHARS 초과 시 강제 분할
            if sentence_len > self.MAX_CHARS:
                if current_chunk:
                    chunks.append(' '.join(current_chunk))
                    current_chunk = []
                    current_len = 0

                # 긴 문장을 MAX_CHARS 단위로 분할
                for i in range(0, sentence_len, self.MAX_CHARS):
                    chunks.append(sentence[i:i + self.MAX_CHARS])
                continue

            # 현재 청크에 추가 가능한 경우
            if current_len + sentence_len + 1 <= self.MAX_CHARS:
                current_chunk.append(sentence)
                current_len += sentence_len + 1
            else:
                # 현재 청크 저장 후 새 청크 시작
                if current_chunk:
                    chunks.append(' '.join(current_chunk))
                current_chunk = [sentence]
                current_len = sentence_len

        if current_chunk:
            chunks.append(' '.join(current_chunk))

        return chunks if chunks else [text]

    # ==================== 4. 임베딩 생성 (Dense + Sparse) ====================

    def create_embeddings(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """청크들의 Dense + Sparse 임베딩 생성"""
        if not chunks:
            return []

        results = []
        batch_size = 20

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]

            texts = [
                f"[{c.get('case_number', '')}] {c.get('case_name', '')}\n"
                f"[{c.get('section', '')}]\n"
                f"{c.get('content', '')}"
                for c in batch
            ]

            try:
                # Dense 임베딩 (OpenAI)
                response = self.openai_client.embeddings.create(
                    model="text-embedding-3-small",
                    input=texts
                )

                # Sparse 임베딩 (BM25)
                sparse_embeddings = list(self.sparse_model.embed(texts))

                for j, chunk in enumerate(batch):
                    chunk_with_vector = chunk.copy()
                    chunk_with_vector["dense_vector"] = response.data[j].embedding

                    # Sparse vector 변환
                    sparse_emb = sparse_embeddings[j]
                    chunk_with_vector["sparse_vector"] = {
                        "indices": sparse_emb.indices.tolist(),
                        "values": sparse_emb.values.tolist(),
                    }
                    results.append(chunk_with_vector)

            except Exception as e:
                print(f"    - 임베딩 생성 실패: {e}")
                continue

            time.sleep(1)

        return results

    # ==================== 5. Qdrant 저장 (하이브리드) ====================

    def save_to_qdrant(self, chunks_with_vectors: List[Dict[str, Any]], keyword: str) -> int:
        """하이브리드 벡터 데이터를 Qdrant에 저장"""
        if not chunks_with_vectors:
            return 0

        points = []
        for chunk in chunks_with_vectors:
            id_string = f"case_{chunk.get('case_number', '')}_{chunk.get('section', '')}_{chunk.get('chunk_index', 0)}"
            hash_hex = hashlib.md5(id_string.encode()).hexdigest()[:16]
            point_id = int(hash_hex, 16)

            points.append({
                "id": point_id,
                "dense_vector": chunk["dense_vector"],
                "sparse_vector": chunk["sparse_vector"],
                "payload": {
                    "case_number": chunk.get("case_number", ""),
                    "case_name": chunk.get("case_name", ""),
                    "court_name": chunk.get("court_name", ""),
                    "judgment_date": chunk.get("judgment_date", ""),
                    "case_type": chunk.get("case_type", ""),
                    "judgment_type": chunk.get("judgment_type", ""),
                    "case_serial_number": chunk.get("case_serial_number", ""),
                    "case_type_code": chunk.get("case_type_code", ""),
                    "court_type_code": chunk.get("court_type_code", ""),
                    "section": chunk.get("section", ""),
                    "chunk_index": chunk.get("chunk_index", 0),
                    "content": chunk.get("content", ""),
                    "keyword": keyword,
                    "type": "case",
                    "id_string": id_string,
                }
            })

        saved = self.qdrant_service.upsert_hybrid_batch(
            collection_name=QdrantService.CASES_COLLECTION,
            points=points,
            batch_size=100
        )

        return saved

    # ==================== 6. 중복 체크 ====================

    def is_duplicate(self, case_number: str) -> bool:
        """사건번호로 중복 체크"""
        if case_number in self.collected_case_numbers:
            return True
        self.collected_case_numbers.add(case_number)
        return False

    # ==================== 메인 실행 ====================

    async def collect_all(self):
        """모든 키워드로 판례 수집"""
        print(f"\n판례 수집 시작 (키워드: {', '.join(self.KEYWORDS)})")

        if not self.qdrant_service.check_connection():
            print("에러: Qdrant 서버에 연결할 수 없습니다.")
            return

        # cases 컬렉션 없으면 하이브리드 컬렉션으로 생성
        self.qdrant_service.create_hybrid_collection(QdrantService.CASES_COLLECTION)

        # 요약 컬렉션 생성
        self.qdrant_service.create_summaries_collection()

        total_saved = 0
        total_cases = 0
        total_summaries = 0

        for keyword in self.KEYWORDS:
            print(f"\n[{keyword}] 수집 중...")

            try:
                case_list = await self.fetch_case_list(keyword)

                if not case_list:
                    print(f"[{keyword}] 검색 결과 없음")
                    continue

                keyword_chunks = []
                keyword_cases = 0
                duplicates = 0

                for case in case_list:
                    case_number = case.get("사건번호", "")
                    case_id = case.get("판례일련번호", "")

                    if self.is_duplicate(case_number):
                        duplicates += 1
                        continue

                    detail = await self.fetch_case_detail(case_id)
                    if not detail:
                        continue

                    case_info = {
                        "case_number": case_number,
                        "case_name": detail.get("사건명", ""),
                        "court_name": detail.get("법원명", ""),
                        "judgment_date": detail.get("선고일자", ""),
                        "case_type": detail.get("사건종류명", ""),
                        "judgment_type": detail.get("판결유형", ""),
                        "case_serial_number": detail.get("판례정보일련번호", ""),
                        "case_type_code": detail.get("사건종류코드", ""),
                        "court_type_code": detail.get("법원종류코드", ""),
                    }

                    # 전체 텍스트 구성 (판시사항/판결요지/참조조문/참조판례 + 판례내용)
                    full_text = self._build_full_text(detail)
                    chunks = self.chunk_full_text(full_text, case_info)

                    if chunks:
                        keyword_chunks.extend(chunks)

                    # 요약 생성 및 저장
                    try:
                        summary = self.summary_service.summarize(full_text)
                        if self.qdrant_service.save_summary(
                            case_number=case_number,
                            summary=summary,
                            prompt_version=PROMPT_VERSION,
                        ):
                            total_summaries += 1
                    except Exception as e:
                        print(f"    - 요약 생성/저장 실패 ({case_number}): {e}")

                    backup_path = self.data_dir / f"{case_number.replace('/', '_')}.json"
                    with open(backup_path, "w", encoding="utf-8") as f:
                        json.dump(detail, f, ensure_ascii=False, indent=2)

                    keyword_cases += 1
                    total_cases += 1
                    time.sleep(0.3)

                if keyword_chunks:
                    chunks_with_vectors = self.create_embeddings(keyword_chunks)

                    if chunks_with_vectors:
                        saved = self.save_to_qdrant(chunks_with_vectors, keyword)
                        total_saved += saved
                        print(f"[{keyword}] 완료: {keyword_cases}건 → {saved}개 청크 저장")
                else:
                    if duplicates > 0:
                        print(f"[{keyword}] {len(case_list)}건 검색, {duplicates}건 중복 → 스킵")

            except Exception as e:
                print(f"[{keyword}] 에러: {e}")
                traceback.print_exc()
                continue

        print(f"\n수집 완료! 총 {total_cases}건 → {total_saved}개 청크, {total_summaries}개 요약 저장")


async def main():
    collector = CaseCollector()
    await collector.collect_all()


if __name__ == "__main__":
    asyncio.run(main())
