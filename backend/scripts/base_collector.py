"""
판례 수집 Base Class
공통 로직을 모아놓은 기본 클래스

청킹 전략:
- 판시사항/판결요지: ≤2000자 단독 유지, 초과 시 청킹
- 전문: 사건명/참조조문/참조판례/판례내용 포함, 최대 1000자, 오버랩 100자, 문장 경계 존중
- 표시: 【】 헤더로 섹션 구분 (프론트엔드에서 파싱)
"""

import sys
import json
import hashlib
import time
import re
import asyncio
import openai
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Set, Tuple
from dotenv import load_dotenv

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from tool.qdrant_client import QdrantService
from app.services.precedent_embedding_service import get_openai_client, get_sparse_model
from app.config import EmbeddingConfig, CollectionConfig

load_dotenv()


# ==================== API Rate Limiter ====================

class RateLimiter:
    """API 호출 속도 제한기 (토큰 버킷 알고리즘)"""

    def __init__(self, calls_per_second: int = 50):
        self.calls_per_second = calls_per_second
        self.min_interval = 1.0 / calls_per_second
        self.last_call_time = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self):
        """다음 API 호출 전 대기"""
        async with self._lock:
            now = time.time()
            elapsed = now - self.last_call_time
            if elapsed < self.min_interval:
                await asyncio.sleep(self.min_interval - elapsed)
            self.last_call_time = time.time()


class BaseCaseCollector:
    """판례 수집 공통 로직"""

    # ==================== 청킹 설정 ====================

    # 섹션별 처리 방식
    SECTION_NO_CHUNK = {"판시사항", "판결요지"}  # 기본 단독 유지 (2000자 이하)
    SECTION_MAX_NO_CHUNK = 2000                  # 초과 시 청킹

    # 청킹 파라미터 (config.py에서 가져옴)
    MAX_CHUNK_SIZE = CollectionConfig.MAX_CHUNK_SIZE
    MIN_LAST_CHUNK = CollectionConfig.MIN_LAST_CHUNK
    OVERLAP_SIZE = CollectionConfig.OVERLAP_SIZE

    # 메타데이터 추출 패턴
    CASE_NUMBER_PATTERN = re.compile(r'(\d{2,4}[가-힣]{1,2}\d+)')
    LAW_ARTICLE_PATTERN = re.compile(r'([가-힣]+(?:법|령|규칙))\s*제(\d+)조')

    # API 설정
    API_RATE_LIMIT = 50  # 초당 최대 호출 수
    MAX_RETRIES = 3      # 최대 재시도 횟수
    RETRY_DELAY = 2      # 재시도 대기 시간 (초)

    def __init__(self):
        """공통 초기화"""
        self.openai_client = get_openai_client()  # 싱글톤 사용
        self.qdrant_service = QdrantService()
        self.data_dir = Path(__file__).parent.parent / "data" / "cases"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.collected_case_numbers: Set[str] = set()

        # API Rate Limiter
        self.rate_limiter = RateLimiter(calls_per_second=self.API_RATE_LIMIT)

        # 메타데이터 파일 경로
        self.metadata_path = self.data_dir.parent / "collection_metadata.json"
        self.failed_cases_path = self.data_dir.parent / "failed_cases.json"

        # 실패 케이스 목록 (세션 내)
        self.failed_cases: List[Dict[str, Any]] = []

        # Sparse 임베딩 모델 (싱글톤)
        self.sparse_model = get_sparse_model()

    # ==================== 메타데이터 추출 ====================

    def extract_reference_metadata(self, detail: Dict[str, Any]) -> Dict[str, Any]:
        """참조조문/참조판례에서 구조화된 메타데이터 추출"""
        metadata = {
            "reference_cases": [],
            "reference_laws": [],
            "sentence_type": detail.get("선고", ""),
            "original_case": detail.get("원심판결", ""),
        }

        # 참조판례 추출
        ref_cases_text = detail.get("참조판례", "")
        if ref_cases_text:
            matches = self.CASE_NUMBER_PATTERN.findall(ref_cases_text)
            metadata["reference_cases"] = list(set(matches))

        # 참조조문 추출
        ref_laws_text = detail.get("참조조문", "")
        if ref_laws_text:
            matches = self.LAW_ARTICLE_PATTERN.findall(ref_laws_text)
            # ("민법", "750") -> "민법 제750조" 형태로 변환
            metadata["reference_laws"] = list(set(
                f"{law} 제{article}조" for law, article in matches
            ))

        return metadata

    # ==================== 전문 구성 ====================

    def build_full_text(self, detail: Dict[str, Any]) -> str:
        """판시사항/판결요지 + 전문(사건명/참조/판례내용)을 합쳐서 전체 텍스트 구성

        - 판시사항/판결요지: 상위 섹션으로 분리 (단독 유지 또는 청킹)
        - 전문: 사건명/참조조문/참조판례/판례내용을 포함하여 함께 청킹 (용량 효율)
        - 표시 시: 【】 헤더로 각 섹션 구분 가능
        """
        parts = []

        # 판시사항/판결요지는 별도 상위 섹션
        if detail.get("판시사항"):
            parts.append(f"【판시사항】\n{detail.get('판시사항')}")

        if detail.get("판결요지"):
            parts.append(f"【판결요지】\n{detail.get('판결요지')}")

        # 전문 섹션: 사건명, 참조조문, 참조판례, 판례내용을 함께 포함
        jeonmun_content = []
        if detail.get("사건명"):
            jeonmun_content.append(f"【사건명】\n{detail.get('사건명')}")
        if detail.get("참조조문"):
            jeonmun_content.append(f"【참조조문】\n{detail.get('참조조문')}")
        if detail.get("참조판례"):
            jeonmun_content.append(f"【참조판례】\n{detail.get('참조판례')}")
        if detail.get("판례내용"):
            jeonmun_content.append(detail.get('판례내용'))

        if jeonmun_content:
            parts.append(f"【전문】\n" + "\n\n".join(jeonmun_content))

        return "\n\n".join(parts)

    # ==================== 청킹 ====================

    # 상위 섹션만 분리 (전문 내부 【】는 분리 안함)
    # 사건명/참조조문/참조판례는 전문에 포함되어 함께 청킹됨
    TOP_LEVEL_SECTIONS = {"판시사항", "판결요지", "전문"}

    def chunk_full_text(self, full_text: str, case_info: Dict[str, Any]) -> List[Dict[str, Any]]:
        """판례 전문 청킹 (새로운 전략 적용)

        - 판시사항/판결요지: ≤2000자 단독, 초과 시 청킹
        - 전문: 최대 1000자, 오버랩 100자 (사건명/참조조문/참조판례 포함, 내부 【】 분리 안함)
        """
        if not full_text:
            return []

        # HTML 태그 제거
        full_text = re.sub(r'<br\s*/?>', '\n', full_text)
        full_text = re.sub(r'<[^>]+>', '', full_text)

        # 번호 패턴 앞에 문단 구분 추가 (단일 <br/>도 문단 분리되도록)
        # 단, 헤더(】) 직후 번호 패턴은 제외 (헤더와 내용 사이 간격 방지)
        # (?<!\d): 앞에 숫자가 없어야 함 (2025. 같은 날짜 제외)
        full_text = re.sub(r'(?<!】)\n\s*(\[\d+\])', r'\n\n\1', full_text)  # [1], [2] 등
        full_text = re.sub(r'(?<!】)\n\s*(?<!\d)([1-9]\d?[\.\)])', r'\n\n\1', full_text)  # 1. 2) 등 (날짜 제외)
        full_text = re.sub(r'(?<!】)\n\s*([가-힣][\.\)])', r'\n\n\1', full_text)  # 가. 나) 등
        full_text = re.sub(r'(?<!】)\n\s*(\(\d+\))', r'\n\n\1', full_text)  # (1), (2) 등
        full_text = re.sub(r'(?<!】)\n\s*([①-⑳])', r'\n\n\1', full_text)  # ①, ② 등

        # 문단 구분(빈 줄) 보존: \n\n+ → {{PARA}} 마커
        full_text = re.sub(r'\n{2,}', ' {{PARA}} ', full_text)

        chunks = []
        global_index = 0

        # 상위 섹션만 분리 (전문 내부 【】는 유지)
        sections = self._split_top_level_sections(full_text)

        for section_name, section_content in sections:
            if not section_content:
                continue

            # 섹션별 청킹 처리
            section_chunks = self._process_section(section_name, section_content)

            for i, chunk_content in enumerate(section_chunks):
                # 섹션의 첫 번째 청크에만 【섹션명】 헤더 추가
                if i == 0:
                    chunk_content = f"【{section_name}】\n{chunk_content}"

                # 전문인 경우: 청크 내 【】 섹션명 추출해서 section에 추가
                if section_name == "전문":
                    internal_sections = self._extract_internal_sections(chunk_content)
                    if internal_sections:
                        full_section_name = "전문/" + "/".join(internal_sections)
                    else:
                        full_section_name = "전문"
                else:
                    full_section_name = section_name

                chunks.append({
                    "section": full_section_name,
                    "chunk_index": global_index,
                    "content": chunk_content,
                    **case_info
                })
                global_index += 1

        # 최종 인덱스 재정렬
        for i, chunk in enumerate(chunks):
            chunk["chunk_index"] = i

        return chunks

    def _extract_internal_sections(self, content: str) -> List[str]:
        """청크 내 【】 섹션명 추출"""
        matches = re.findall(r'【([^】]+)】', content)
        # 공백 제거하고 중복 제거 (순서 유지)
        seen = set()
        result = []
        for m in matches:
            m_clean = m.replace(" ", "")
            if m_clean not in seen:
                seen.add(m_clean)
                result.append(m_clean)
        return result

    def _process_section(self, section_name: str, content: str) -> List[str]:
        """섹션별 청킹 처리"""
        content = content.strip()
        if not content:
            return []

        # 판시사항/판결요지: 조건부 단독 유지
        if any(s in section_name for s in self.SECTION_NO_CHUNK):
            if len(content) <= self.SECTION_MAX_NO_CHUNK:
                return [content]
            # 2000자 초과 시 청킹
            return self._chunk_with_overlap(content)

        # 전문 및 기타: 청킹 + 오버랩
        return self._chunk_with_overlap(content)

    def _chunk_with_overlap(self, content: str) -> List[str]:
        """오버랩을 적용한 청킹 (문장 경계 존중)"""
        if len(content) <= self.MAX_CHUNK_SIZE:
            return [content]

        # 문장 단위로 분리
        sentences = self._split_into_sentences(content)
        if not sentences:
            return [content]

        chunks = []
        current_chunk = []
        current_len = 0

        for sentence in sentences:
            sentence_len = len(sentence)

            # 문장 하나가 MAX_CHUNK_SIZE 초과하는 경우
            if sentence_len > self.MAX_CHUNK_SIZE:
                # 현재 청크 저장
                if current_chunk:
                    chunks.append(' '.join(current_chunk))
                    current_chunk = []
                    current_len = 0
                # 긴 문장은 강제 분할
                for i in range(0, sentence_len, self.MAX_CHUNK_SIZE):
                    chunks.append(sentence[i:i + self.MAX_CHUNK_SIZE])
                continue

            # 현재 청크에 추가 가능한지 확인
            if current_len + sentence_len + 1 <= self.MAX_CHUNK_SIZE:
                current_chunk.append(sentence)
                current_len += sentence_len + 1
            else:
                # 현재 청크 저장
                if current_chunk:
                    chunks.append(' '.join(current_chunk))

                # 오버랩 적용: 이전 청크 끝부분에서 오버랩 텍스트 가져오기
                overlap_text = self._get_overlap_text(current_chunk)
                if overlap_text:
                    current_chunk = [overlap_text, sentence]
                    current_len = len(overlap_text) + sentence_len + 1
                else:
                    current_chunk = [sentence]
                    current_len = sentence_len

        # 마지막 청크 처리
        if current_chunk:
            last_chunk = ' '.join(current_chunk)

            # 마지막 청크가 MIN_LAST_CHUNK 미만이면 이전 청크에 병합
            if len(last_chunk) < self.MIN_LAST_CHUNK and chunks:
                chunks[-1] = chunks[-1] + ' ' + last_chunk
            else:
                chunks.append(last_chunk)

        return chunks if chunks else [content]

    def _split_into_sentences(self, text: str) -> List[str]:
        """문장 단위로 분리 (법률 문서 특화)

        - 문장 종결 패턴(다/음/함/됨/임.) 뒤에서만 분리
        - 패턴 자체는 유지
        - 번호 패턴(1. 가. (1) ① 등)은 다음 내용과 합침
        """
        if not text:
            return []

        # 종결어미(다/음/함/됨/임) + 마침표 뒤 공백에서만 분리
        raw_sentences = re.split(r'(?<=(?:다|음|함|됨|임)\.)\s+', text)
        raw_sentences = [s.strip() for s in raw_sentences if s.strip()]

        # 번호 패턴(가. 나. 다. 1. 2. (1) ① 등)은 다음 문장과 합침
        number_pattern = re.compile(r'^([가-힣]\.?|[1-9]\d?[\.\)]|\(\d+\)|[①-⑳])$')
        sentences = []
        i = 0
        while i < len(raw_sentences):
            current = raw_sentences[i]
            # 번호 패턴이면 다음 문장과 합침
            if number_pattern.match(current) and i + 1 < len(raw_sentences):
                sentences.append(current + ' ' + raw_sentences[i + 1])
                i += 2
            else:
                sentences.append(current)
                i += 1

        return sentences

    def _get_overlap_text(self, chunk_sentences: List[str]) -> str:
        """청크의 마지막 부분에서 오버랩 텍스트 추출"""
        if not chunk_sentences:
            return ""

        # 마지막 문장들을 합쳐서 OVERLAP_SIZE에 맞춤
        overlap_parts = []
        current_len = 0

        for sentence in reversed(chunk_sentences):
            if current_len + len(sentence) <= self.OVERLAP_SIZE:
                overlap_parts.insert(0, sentence)
                current_len += len(sentence) + 1
            else:
                break

        return ' '.join(overlap_parts) if overlap_parts else ""

    def _split_top_level_sections(self, text: str) -> List[Tuple[str, str]]:
        """상위 섹션만 분리 (전문 내부 【】는 유지)

        사건명, 판시사항, 판결요지, 전문만 분리하고
        전문 안의 【원심판결】, 【주문】, 【이유】 등은 분리하지 않음
        """
        sections = []

        # 상위 섹션 위치 찾기
        top_section_pattern = r'【(' + '|'.join(self.TOP_LEVEL_SECTIONS) + r')】'
        matches = list(re.finditer(top_section_pattern, text))

        if not matches:
            # 상위 섹션이 없으면 전체를 전문으로
            return [("전문", text.strip())]

        # 첫 섹션 이전 내용
        if matches[0].start() > 0:
            pre_content = text[:matches[0].start()].strip()
            if pre_content:
                sections.append(("기본정보", pre_content))

        # 각 상위 섹션 처리
        for i, match in enumerate(matches):
            section_name = match.group(1)

            # 다음 상위 섹션까지 또는 끝까지
            if i + 1 < len(matches):
                section_content = text[match.end():matches[i + 1].start()]
            else:
                section_content = text[match.end():]

            section_content = section_content.strip()
            if section_content:
                sections.append((section_name, section_content))

        return sections

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

            for attempt in range(3):
                try:
                    # Dense 임베딩 (OpenAI)
                    response = self.openai_client.embeddings.create(
                        model=EmbeddingConfig.CHUNK_MODEL,
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
                    break  # 성공 시 루프 탈출

                except openai.RateLimitError:
                    print(f"    - Rate limit 도달, 5초 대기 후 재시도 ({attempt + 1}/3)")
                    time.sleep(5)
                except Exception as e:
                    print(f"    - 임베딩 생성 실패: {e}")
                    break

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
                    # 기본 메타데이터
                    "case_number": chunk.get("case_number", ""),
                    "case_name": chunk.get("case_name", ""),
                    "court_name": chunk.get("court_name", ""),
                    "judgment_date": chunk.get("judgment_date", ""),
                    "case_type": chunk.get("case_type", ""),
                    "judgment_type": chunk.get("judgment_type", ""),
                    "case_serial_number": chunk.get("case_serial_number", ""),
                    "case_type_code": chunk.get("case_type_code", ""),
                    "court_type_code": chunk.get("court_type_code", ""),
                    # 추가 메타데이터
                    "sentence_type": chunk.get("sentence_type", ""),
                    "original_case": chunk.get("original_case", ""),
                    "reference_cases": chunk.get("reference_cases", []),
                    "reference_laws": chunk.get("reference_laws", []),
                    # 청크 정보
                    "section": chunk.get("section", ""),
                    "chunk_index": chunk.get("chunk_index", 0),
                    "content": chunk.get("content", ""),
                    # 수집 정보
                    "keyword": keyword,
                    "collected_date": datetime.now().strftime("%Y-%m-%d"),
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
    ) -> Dict[str, Any]:
        """
        판례 상세정보 → 청킹 → 임베딩 → 저장

        Args:
            detail: API에서 받은 판례 상세 정보
            case_info: 메타데이터 (case_number, case_name 등)
            keyword: 검색 키워드

        Returns:
            {"chunks_saved": int}
        """
        case_number = case_info.get("case_number", "")

        # 1. 참조 메타데이터 추출 (참조조문, 참조판례, 선고, 원심판결)
        ref_metadata = self.extract_reference_metadata(detail)
        case_info.update(ref_metadata)

        # 2. 전문 구성 (참조조문/참조판례 제외)
        full_text = self.build_full_text(detail)

        # 3. 청킹
        chunks = self.chunk_full_text(full_text, case_info)
        if not chunks:
            return {"chunks_saved": 0}

        # 4. 임베딩 생성
        chunks_with_vectors = self.create_embeddings(chunks)

        # 5. Qdrant 저장
        chunks_saved = 0
        if chunks_with_vectors:
            chunks_saved = self.save_to_qdrant(chunks_with_vectors, keyword)

        # 6. 로컬 백업
        self.save_local_backup(case_number, detail, keyword)

        return {"chunks_saved": chunks_saved}

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
            print(f"  -> DB existing: {len(existing)} cases (skip duplicates)")

    # ==================== Collection Metadata ====================

    def load_collection_metadata(self) -> Dict[str, Any]:
        """Load collection metadata from local file"""
        if self.metadata_path.exists():
            with open(self.metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {
            "keywords_collected": [],
            "last_collected_date": None,
            "total_cases_collected": 0,
            "collection_history": [],
        }

    def save_collection_metadata(
        self,
        keywords: List[str],
        cases_collected: int,
        summaries_collected: int = 0,
    ) -> None:
        """Save collection metadata to local file + Qdrant"""
        today = datetime.now().strftime("%Y-%m-%d")

        # 1. Load and update local metadata
        metadata = self.load_collection_metadata()

        # Update keywords list (no duplicates)
        existing_keywords = set(metadata.get("keywords_collected", []))
        existing_keywords.update(keywords)
        metadata["keywords_collected"] = sorted(list(existing_keywords))

        # Update date and stats
        metadata["last_collected_date"] = today
        metadata["total_cases_collected"] = metadata.get("total_cases_collected", 0) + cases_collected

        # Add collection history
        metadata["collection_history"].append({
            "date": today,
            "keywords": keywords,
            "cases_collected": cases_collected,
            "summaries_collected": summaries_collected,
        })

        # Save to local file
        with open(self.metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        print(f"  -> Metadata saved: {self.metadata_path}")

        # 2. Save to Qdrant
        self._save_qdrant_collection_metadata(metadata)

    def _save_qdrant_collection_metadata(self, metadata: Dict[str, Any]) -> None:
        """Save metadata to Qdrant as a special point"""
        try:
            metadata_point_id = 0  # Fixed ID for metadata

            # Dummy vectors (for metadata-only point)
            dummy_dense = [0.0] * 1536
            dummy_sparse = {"indices": [0], "values": [0.0]}

            point = {
                "id": metadata_point_id,
                "dense_vector": dummy_dense,
                "sparse_vector": dummy_sparse,
                "payload": {
                    "type": "_collection_metadata",
                    "keywords_collected": metadata["keywords_collected"],
                    "last_collected_date": metadata["last_collected_date"],
                    "total_cases_collected": metadata["total_cases_collected"],
                }
            }

            self.qdrant_service.upsert_hybrid_batch(
                collection_name=QdrantService.CASES_COLLECTION,
                points=[point],
                batch_size=1
            )
            print(f"  -> Qdrant metadata saved")

        except Exception as e:
            print(f"  -> Qdrant metadata save failed: {e}")

    # ==================== Failed Cases Tracking ====================

    def record_failed_case(
        self,
        case_number: str,
        keyword: str,
        error: str,
        case_id: str = "",
    ) -> None:
        """Record a failed case"""
        failed_record = {
            "case_number": case_number,
            "case_id": case_id,
            "keyword": keyword,
            "error": str(error),
            "timestamp": datetime.now().isoformat(),
        }
        self.failed_cases.append(failed_record)

    def save_failed_cases(self) -> None:
        """Save failed cases list to file"""
        if not self.failed_cases:
            return

        # Load existing failures
        existing_failures = []
        if self.failed_cases_path.exists():
            with open(self.failed_cases_path, "r", encoding="utf-8") as f:
                existing_failures = json.load(f)

        # Append new failures
        existing_failures.extend(self.failed_cases)

        # Save
        with open(self.failed_cases_path, "w", encoding="utf-8") as f:
            json.dump(existing_failures, f, ensure_ascii=False, indent=2)

        print(f"  -> Failed cases saved ({len(self.failed_cases)}): {self.failed_cases_path}")

    def get_failed_cases_count(self) -> int:
        """Get failed cases count in current session"""
        return len(self.failed_cases)

    # ==================== API Retry Logic ====================

    async def api_call_with_retry(
        self,
        api_func,
        *args,
        case_number: str = "",
        keyword: str = "",
        **kwargs
    ) -> Optional[Any]:
        """
        API call with rate limit + retry

        Args:
            api_func: async function to call
            case_number: for error recording
            keyword: for error recording

        Returns:
            API response or None (on failure)
        """
        last_error = None

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                # Rate limit wait
                await self.rate_limiter.acquire()

                # API call
                result = await api_func(*args, **kwargs)
                return result

            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Check if retryable error
                retryable = any(kw in error_str for kw in [
                    "timeout", "connection", "rate limit", "429", "503", "502", "500"
                ])

                if retryable and attempt < self.MAX_RETRIES:
                    wait_time = self.RETRY_DELAY * attempt  # Exponential backoff
                    print(f"    - API error (attempt {attempt}/{self.MAX_RETRIES}), retry in {wait_time}s: {e}")
                    await asyncio.sleep(wait_time)
                else:
                    break

        # Final failure
        if case_number:
            self.record_failed_case(
                case_number=case_number,
                keyword=keyword,
                error=str(last_error),
            )
        return None
