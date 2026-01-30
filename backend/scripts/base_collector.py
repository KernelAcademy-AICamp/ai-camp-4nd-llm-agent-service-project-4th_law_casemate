"""
판례 수집 Base Class
공통 로직을 모아놓은 기본 클래스
"""

import os
import sys
import json
import hashlib
import time
import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
from dotenv import load_dotenv
from openai import OpenAI
from fastembed import SparseTextEmbedding

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from tool.qdrant_client import QdrantService
from app.services.summary_service import SummaryService
from app.prompts.summary_prompt import PROMPT_VERSION

load_dotenv()


class BaseCaseCollector:
    """판례 수집 공통 로직"""

    # 청킹 설정
    MAX_CHARS = 900           # 청크 상한 (약 570~990토큰)
    MIN_CHARS = 300           # 이하면 다음 청크와 병합
    MIN_SECTION_CHARS = 300   # 이하면 다음 섹션과 병합

    # 법률 문서 번호 패턴
    NUMBER_PATTERNS = [
        r'(?:^|\n)\s*(\d+)\.\s',           # 1. 2. 3.
        r'(?:^|\n)\s*([가-힣])\.\s',        # 가. 나. 다.
        r'(?:^|\n)\s*\((\d+)\)\s',          # (1) (2) (3)
        r'(?:^|\n)\s*([①②③④⑤⑥⑦⑧⑨⑩])\s',  # ① ② ③
    ]

    def __init__(self):
        """공통 초기화"""
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_service = QdrantService()
        self.summary_service = SummaryService()
        self.data_dir = Path(__file__).parent.parent / "data" / "cases"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.collected_case_numbers: Set[str] = set()

        print("Sparse 임베딩 모델 로딩 중...")
        self.sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")

    # ==================== 전문 구성 ====================

    def build_full_text(self, detail: Dict[str, Any]) -> str:
        """사건명/판시사항/판결요지/참조조문/참조판례 + 판례내용을 합쳐서 전체 텍스트 구성"""
        parts = []

        # 사건명 추가 (검색 시 case_name 매칭용)
        if detail.get("사건명"):
            parts.append(f"【사건명】\n{detail.get('사건명')}")

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

    # ==================== 청킹 ====================

    def chunk_full_text(self, full_text: str, case_info: Dict[str, Any]) -> List[Dict[str, Any]]:
        """판례 전문 청킹: 섹션 → 번호 단위 → 병합 → 문장 단위"""
        if not full_text:
            return []

        # HTML 태그 제거
        full_text = re.sub(r'<br\s*/?>', '\n', full_text)
        full_text = re.sub(r'<[^>]+>', '', full_text)

        chunks = []
        global_index = 0

        # 1차: 【】 섹션으로 분리
        sections = self._split_by_sections(full_text)

        # 2차: 짧은 섹션 병합
        sections = self._merge_short_sections(sections)

        for section_name, section_content in sections:
            if not section_content:
                continue

            # 3차: 번호 단위로 분리
            numbered_parts = self._split_by_numbers(section_content)

            # 4차: 작은 파트들을 MAX_CHARS까지 병합
            merged_parts = self._merge_small_parts(numbered_parts)

            # 5차: MAX_CHARS 초과 시 문장 단위로 분할
            section_chunks = []
            for part in merged_parts:
                if len(part) > self.MAX_CHARS:
                    part_chunks = self._split_by_sentences(part)
                    section_chunks.extend(part_chunks)
                else:
                    section_chunks.append(part)

            for chunk_content in section_chunks:
                chunks.append({
                    "section": section_name,
                    "chunk_index": global_index,
                    "content": chunk_content,
                    **case_info
                })
                global_index += 1

        # 최종 후처리: MIN_CHARS 미만 청크 병합
        final = []
        carry = None

        for chunk in chunks:
            if carry:
                chunk["content"] = carry["content"] + "\n" + chunk["content"]
                chunk["section"] = carry["section"] + "/" + chunk["section"]
                carry = None

            if len(chunk["content"]) < self.MIN_CHARS:
                carry = chunk
            else:
                final.append(chunk)

        if carry:
            if final:
                final[-1]["content"] = final[-1]["content"] + "\n" + carry["content"]
                final[-1]["section"] = final[-1]["section"] + "/" + carry["section"]
            else:
                final.append(carry)

        for i, chunk in enumerate(final):
            chunk["chunk_index"] = i

        return final

    def _split_by_sections(self, text: str) -> List[tuple]:
        """【】 섹션 단위로 분리"""
        pattern = r'【([^】]+)】'
        parts = re.split(pattern, text)

        sections = []

        if parts[0].strip():
            sections.append(("기본정보", parts[0].strip()))

        for i in range(1, len(parts), 2):
            if i + 1 < len(parts):
                section_name = parts[i].strip()
                section_content = parts[i + 1].strip()
                sections.append((section_name, section_content))

        if not sections:
            sections.append(("전문", text.strip()))

        return sections

    def _merge_short_sections(self, sections: List[tuple]) -> List[tuple]:
        """MIN_SECTION_CHARS 미만인 섹션들을 다음 섹션과 병합"""
        if not sections:
            return sections

        merged = []
        buffer_names = []
        buffer_content = ""

        for section_name, section_content in sections:
            section_text = f"【{section_name}】{section_content}" if section_content else f"【{section_name}】"
            section_len = len(section_content)

            if section_len < self.MIN_SECTION_CHARS:
                buffer_names.append(section_name)
                buffer_content = buffer_content + "\n" + section_text if buffer_content else section_text
            else:
                if buffer_content:
                    combined = buffer_content + "\n" + section_text
                    if len(combined) <= self.MAX_CHARS:
                        buffer_names.append(section_name)
                        merged.append(("/".join(buffer_names), combined))
                    else:
                        merged.append(("/".join(buffer_names), buffer_content))
                        merged.append((section_name, section_text))
                    buffer_names = []
                    buffer_content = ""
                else:
                    merged.append((section_name, section_text))

        if buffer_content:
            merged.append(("/".join(buffer_names), buffer_content))

        return merged

    def _split_by_numbers(self, text: str) -> List[str]:
        """번호 단위(1., 가., (1), ①)로 분리"""
        split_positions = [0]

        for pattern in self.NUMBER_PATTERNS:
            for match in re.finditer(pattern, text):
                pos = match.start()
                if pos > 0:
                    split_positions.append(pos)

        split_positions = sorted(set(split_positions))
        split_positions.append(len(text))

        parts = []
        for i in range(len(split_positions) - 1):
            part = text[split_positions[i]:split_positions[i + 1]].strip()
            if part:
                parts.append(part)

        return parts if parts else [text]

    def _merge_small_parts(self, parts: List[str]) -> List[str]:
        """MIN_CHARS 이하인 파트들을 MAX_CHARS까지 병합"""
        if not parts:
            return parts

        merged = []
        current = ""

        for part in parts:
            if len(current) + len(part) + 1 <= self.MAX_CHARS:
                current = current + "\n" + part if current else part
            else:
                if current:
                    merged.append(current)
                current = part

        if current:
            merged.append(current)

        # 후처리: MIN_CHARS 미만 청크를 뒤 청크에 강제 병합
        final = []
        carry = ""

        for chunk in merged:
            if carry:
                chunk = carry + "\n" + chunk
                carry = ""

            if len(chunk) < self.MIN_CHARS:
                carry = chunk
            else:
                final.append(chunk)

        if carry:
            if final:
                final[-1] = final[-1] + "\n" + carry
            else:
                final.append(carry)

        return final

    def _split_by_sentences(self, text: str) -> List[str]:
        """문장 단위로 MAX_CHARS 이내로 분할"""
        if len(text) <= self.MAX_CHARS:
            return [text]

        sentences = re.split(r'(?<=(?:다|음|함|됨|임)\.)\s+|\n', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks = []
        current_chunk = []
        current_len = 0

        for sentence in sentences:
            sentence_len = len(sentence)

            if sentence_len > self.MAX_CHARS:
                if current_chunk:
                    chunks.append(' '.join(current_chunk))
                    current_chunk = []
                    current_len = 0

                for i in range(0, sentence_len, self.MAX_CHARS):
                    chunks.append(sentence[i:i + self.MAX_CHARS])
                continue

            if current_len + sentence_len + 1 <= self.MAX_CHARS:
                current_chunk.append(sentence)
                current_len += sentence_len + 1
            else:
                current_chunk.append(sentence)
                chunks.append(' '.join(current_chunk))
                current_chunk = []
                current_len = 0

        if current_chunk:
            last_chunk = ' '.join(current_chunk)
            if len(last_chunk) < self.MIN_CHARS and chunks:
                chunks[-1] = chunks[-1] + ' ' + last_chunk
            else:
                chunks.append(last_chunk)

        return chunks if chunks else [text]

    # ==================== 임베딩 ====================

    def create_embeddings(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """청크들의 Dense + Sparse 임베딩 생성"""
        if not chunks:
            return []

        results = []
        batch_size = 20

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            texts = [c.get('content', '') for c in batch]

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

    # ==================== Qdrant 저장 ====================

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
                    "source": chunk.get("source", "search"),
                    "ref_from": chunk.get("ref_from", ""),
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

    # ==================== 요약 저장 ====================

    def save_summary(
        self,
        case_number: str,
        full_text: str,
        case_info: Dict[str, Any],
    ) -> bool:
        """요약 생성 및 저장"""
        try:
            summary = self.summary_service.summarize(full_text)

            # 요약 텍스트의 Dense 임베딩 (text-embedding-3-large)
            summary_dense_resp = self.openai_client.embeddings.create(
                model="text-embedding-3-large",
                input=summary,
            )
            summary_dense_vector = summary_dense_resp.data[0].embedding

            # 요약 텍스트의 Sparse 임베딩 (BM25)
            summary_sparse_emb = list(self.sparse_model.embed([summary]))[0]
            summary_sparse_vector = {
                "indices": summary_sparse_emb.indices.tolist(),
                "values": summary_sparse_emb.values.tolist(),
            }

            return self.qdrant_service.save_summary(
                case_number=case_number,
                summary=summary,
                prompt_version=PROMPT_VERSION,
                dense_vector=summary_dense_vector,
                sparse_vector=summary_sparse_vector,
                case_name=case_info.get("case_name", ""),
                court_name=case_info.get("court_name", ""),
                judgment_date=case_info.get("judgment_date", ""),
            )

        except Exception as e:
            print(f"    - 요약 생성/저장 실패 ({case_number}): {e}")
            return False

    # ==================== 로컬 백업 ====================

    def save_local_backup(self, case_number: str, detail: Dict[str, Any], keyword: str) -> None:
        """로컬 JSON 파일로 백업 (keyword 포함)"""
        backup_path = self.data_dir / f"{case_number.replace('/', '_')}.json"

        # 원본 + 메타데이터 추가
        backup_data = {
            **detail,
            "_keyword": keyword,  # 수집 키워드
        }

        with open(backup_path, "w", encoding="utf-8") as f:
            json.dump(backup_data, f, ensure_ascii=False, indent=2)

    # ==================== 공통 처리 플로우 ====================

    def process_case(
        self,
        detail: Dict[str, Any],
        case_info: Dict[str, Any],
        keyword: str,
        skip_summary: bool = False,
    ) -> Dict[str, Any]:
        """
        판례 상세정보 → 청킹 → 임베딩 → 저장 → 요약

        Args:
            detail: API에서 받은 판례 상세 정보
            case_info: 메타데이터 (case_number, case_name 등)
            keyword: 검색 키워드
            skip_summary: 요약 생성 건너뛰기

        Returns:
            {"chunks_saved": int, "summary_saved": bool}
        """
        case_number = case_info.get("case_number", "")

        # 1. 전문 구성
        full_text = self.build_full_text(detail)

        # 2. 청킹
        chunks = self.chunk_full_text(full_text, case_info)
        if not chunks:
            return {"chunks_saved": 0, "summary_saved": False}

        # 3. 임베딩 생성
        chunks_with_vectors = self.create_embeddings(chunks)

        # 4. Qdrant 저장
        chunks_saved = 0
        if chunks_with_vectors:
            chunks_saved = self.save_to_qdrant(chunks_with_vectors, keyword)

        # 5. 요약 생성 및 저장
        summary_saved = False
        if not skip_summary:
            summary_saved = self.save_summary(case_number, full_text, case_info)

        # 6. 로컬 백업
        self.save_local_backup(case_number, detail, keyword)

        return {"chunks_saved": chunks_saved, "summary_saved": summary_saved}

    # ==================== 중복 체크 ====================

    def is_duplicate(self, case_number: str) -> bool:
        """사건번호로 중복 체크"""
        if case_number in self.collected_case_numbers:
            return True
        self.collected_case_numbers.add(case_number)
        return False

    def load_existing_case_numbers(self) -> None:
        """DB에 이미 수집된 사건번호 로드"""
        existing = self.qdrant_service.get_all_case_numbers()
        if existing:
            self.collected_case_numbers.update(existing)
            print(f"  → DB 기존 판례: {len(existing)}건 (중복 수집 건너뜀)")
