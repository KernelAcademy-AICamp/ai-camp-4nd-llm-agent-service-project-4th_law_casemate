"""
검색 서비스
Qdrant 벡터 DB를 활용한 판례 검색
"""

import os
import re
import logging
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models
from fastembed import SparseTextEmbedding
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

# Sparse 임베딩 모델 (싱글톤으로 한 번만 로드)
_sparse_model = None

def get_sparse_model():
    global _sparse_model
    if _sparse_model is None:
        logger.info("Sparse 임베딩 모델 로딩 중...")
        _sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_model


# OpenAI 클라이언트 (싱글톤)
_openai_client = None

def get_openai_client():
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _openai_client


# Dense 임베딩 캐싱 (최대 500개 검색어, 약 3MB)
@lru_cache(maxsize=500)
def create_dense_embedding_cached(text: str) -> Tuple[float, ...]:
    """Dense 임베딩 생성 (캐싱됨)"""
    client = get_openai_client()
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    # lru_cache는 list를 캐싱할 수 없어서 tuple로 변환
    return tuple(response.data[0].embedding)


def get_embedding_cache_info():
    """임베딩 캐시 상태 확인"""
    return create_dense_embedding_cached.cache_info()


@dataclass
class SearchResult:
    """검색 결과 데이터 클래스"""
    case_number: str
    case_name: str
    court_name: str
    judgment_date: str
    content: str
    section: str
    score: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_number": self.case_number,
            "case_name": self.case_name,
            "court_name": self.court_name,
            "judgment_date": self.judgment_date,
            "content": self.content,
            "section": self.section,
            "score": self.score,
        }


class SearchService:
    """벡터 검색 서비스"""

    CASES_COLLECTION = "cases"

    def __init__(self):
        # Qdrant 클라이언트
        self.qdrant_client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "localhost"),
            port=int(os.getenv("QDRANT_PORT", "6333"))
        )

        # Sparse 임베딩 모델 (하이브리드 검색용)
        self.sparse_model = get_sparse_model()

    # ==================== 임베딩 생성 ====================

    def _create_dense_embedding(self, text: str) -> List[float]:
        """텍스트를 Dense 임베딩 벡터로 변환 (캐싱됨)"""
        # 캐싱된 함수 사용 (tuple → list 변환)
        return list(create_dense_embedding_cached(text))

    def _create_sparse_embedding(self, text: str) -> models.SparseVector:
        """텍스트를 Sparse 임베딩 벡터로 변환 (BM25)"""
        sparse_emb = list(self.sparse_model.embed([text]))[0]
        return models.SparseVector(
            indices=sparse_emb.indices.tolist(),
            values=sparse_emb.values.tolist(),
        )

    def _create_embeddings_parallel(self, text: str) -> Tuple[List[float], models.SparseVector]:
        """Dense와 Sparse 임베딩을 병렬로 생성"""
        with ThreadPoolExecutor(max_workers=2) as executor:
            dense_future = executor.submit(self._create_dense_embedding, text)
            sparse_future = executor.submit(self._create_sparse_embedding, text)

            dense_vector = dense_future.result()
            sparse_vector = sparse_future.result()

        return dense_vector, sparse_vector

    # ==================== 사건번호 패턴 감지 ====================

    def _is_case_number(self, query: str) -> bool:
        """
        검색어가 사건번호 패턴인지 확인

        패턴 예시:
        - 2006도4486
        - 2020다12345
        - 2019나1234
        - 대법원 2006도4486
        """
        # 사건번호 패턴: 연도(4자리) + 사건종류(한글) + 번호
        pattern = r'\d{2,4}[가-힣]{1,2}\d+'
        return bool(re.search(pattern, query))

    def _search_by_case_number(self, query: str, limit: int = 30) -> Dict[str, Any]:
        """
        사건번호로 정확 검색 (필터 기반)
        """
        # 사건번호 패턴 추출
        pattern = r'(\d{2,4}[가-힣]{1,2}\d+)'
        match = re.search(pattern, query)

        if not match:
            return {"query": query, "total": 0, "results": []}

        case_number_pattern = match.group(1)

        # Qdrant 필터 검색 (case_number 필드에서 매칭)
        results = self.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="case_number",
                        match=models.MatchText(text=case_number_pattern)
                    )
                ]
            ),
            limit=limit * 5,
            with_payload=True,
            with_vectors=False,
        )

        # 결과 처리
        case_scores = {}
        case_metadata = {}

        for point in results[0]:
            payload = point.payload
            case_num = payload.get("case_number", "")

            if case_num not in case_scores:
                case_scores[case_num] = 1.0  # 정확 매칭이므로 점수는 1.0
                case_metadata[case_num] = {
                    "case_name": payload.get("case_name", ""),
                    "court_name": payload.get("court_name", ""),
                    "judgment_date": payload.get("judgment_date", ""),
                }

        # 결과 생성
        search_results = []
        for case_num, score in case_scores.items():
            full_content = self._get_full_case_content(case_num)
            metadata = case_metadata[case_num]

            search_results.append(SearchResult(
                case_number=case_num,
                case_name=metadata["case_name"],
                court_name=metadata["court_name"],
                judgment_date=metadata["judgment_date"],
                content=full_content,
                section="전문",
                score=score,
            ))

        return {
            "query": query,
            "total": len(search_results),
            "results": [r.to_dict() for r in search_results[:limit]]
        }

    # ==================== 판례 검색 (하이브리드) ====================

    def search_cases(
        self,
        query: str,
        limit: int = 30,
        merge_chunks: bool = True
    ) -> Dict[str, Any]:
        """
        판례 하이브리드 검색 (Dense + Sparse + RRF)
        - 사건번호 패턴이면 필터 검색
        - 일반 키워드면 하이브리드 검색

        Args:
            query: 검색 쿼리
            limit: 반환할 최대 결과 수
            merge_chunks: 같은 판례의 청크 병합 여부

        Returns:
            검색 결과 딕셔너리
        """
        # 사건번호 패턴 감지 시 필터 검색
        if self._is_case_number(query):
            return self._search_by_case_number(query, limit)

        # Dense + Sparse 임베딩 병렬 생성
        dense_vector, sparse_vector = self._create_embeddings_parallel(query)

        # 하이브리드 검색 (RRF 융합)
        search_limit = limit * 5 if merge_chunks else limit

        results = self.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            prefetch=[
                models.Prefetch(
                    query=dense_vector,
                    using="dense",
                    limit=search_limit,
                ),
                models.Prefetch(
                    query=sparse_vector,
                    using="sparse",
                    limit=search_limit,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=search_limit,
        )

        # 결과 변환
        search_results = []
        for result in results.points:
            payload = result.payload
            search_results.append(SearchResult(
                case_number=payload.get("case_number", ""),
                case_name=payload.get("case_name", ""),
                court_name=payload.get("court_name", ""),
                judgment_date=payload.get("judgment_date", ""),
                content=payload.get("content", ""),
                section=payload.get("section", ""),
                score=result.score,
            ))

        # 같은 판례 청크 병합
        if merge_chunks:
            search_results = self._merge_case_chunks(search_results)

        # limit 적용
        search_results = search_results[:limit]

        return {
            "query": query,
            "total": len(search_results),
            "results": [r.to_dict() for r in search_results]
        }

    def _merge_case_chunks(self, results: List[SearchResult]) -> List[SearchResult]:
        """
        같은 판례의 여러 청크를 병합

        - 같은 case_number의 결과를 하나로 합침
        - 가장 높은 score 사용
        - 한 번의 쿼리로 모든 판례의 청크를 조회하여 병합 (최적화)
        """
        # 고유 case_number와 최고 점수 추출
        case_scores = {}
        case_metadata = {}

        for result in results:
            case_num = result.case_number
            if case_num not in case_scores or result.score > case_scores[case_num]:
                case_scores[case_num] = result.score
                case_metadata[case_num] = {
                    "case_name": result.case_name,
                    "court_name": result.court_name,
                    "judgment_date": result.judgment_date,
                }

        # 모든 판례의 청크를 한 번에 조회 (최적화)
        case_numbers = list(case_scores.keys())
        all_contents = self._get_full_case_contents_batch(case_numbers)

        # 결과 생성
        merged_results = []
        for case_num, score in case_scores.items():
            metadata = case_metadata[case_num]
            full_content = all_contents.get(case_num, "")

            merged_results.append(SearchResult(
                case_number=case_num,
                case_name=metadata["case_name"],
                court_name=metadata["court_name"],
                judgment_date=metadata["judgment_date"],
                content=full_content,
                section="전문",
                score=score,
            ))

        # 점수순 정렬
        merged_results.sort(key=lambda x: x.score, reverse=True)

        return merged_results

    def _get_full_case_contents_batch(self, case_numbers: List[str]) -> Dict[str, str]:
        """
        여러 판례의 전체 내용을 한 번의 쿼리로 조회 (최적화)

        Args:
            case_numbers: 조회할 사건번호 리스트

        Returns:
            {case_number: full_content} 딕셔너리
        """
        if not case_numbers:
            return {}

        # should 필터로 여러 case_number를 OR 조건으로 조회
        results = self.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=models.Filter(
                should=[
                    models.FieldCondition(
                        key="case_number",
                        match=models.MatchValue(value=case_num)
                    )
                    for case_num in case_numbers
                ]
            ),
            limit=len(case_numbers) * 100,  # 판례당 최대 100개 청크
            with_payload=True,
            with_vectors=False,
        )

        # case_number별로 청크 그룹화
        case_chunks: Dict[str, List[Dict]] = {cn: [] for cn in case_numbers}

        for point in results[0]:
            payload = point.payload
            case_num = payload.get("case_number", "")
            if case_num in case_chunks:
                case_chunks[case_num].append({
                    "section": payload.get("section", ""),
                    "chunk_index": payload.get("chunk_index", 0),
                    "content": payload.get("content", ""),
                })

        # 각 판례의 청크를 정렬하고 내용 합치기
        all_contents = {}
        for case_num, chunks in case_chunks.items():
            chunks.sort(key=lambda x: x["chunk_index"])

            content_parts = []
            current_section = None
            for chunk in chunks:
                if chunk["section"] != current_section:
                    current_section = chunk["section"]
                    content_parts.append(f"\n[{current_section}]")
                content_parts.append(chunk["content"])

            all_contents[case_num] = "\n".join(content_parts)

        return all_contents

    def _get_full_case_content(self, case_number: str) -> str:
        """
        특정 판례의 모든 청크를 조회하여 전체 내용 반환
        """
        results = self.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="case_number",
                        match=models.MatchValue(value=case_number)
                    )
                ]
            ),
            limit=100,  # 충분히 큰 값
            with_payload=True,
            with_vectors=False,
        )

        # chunk_index로 정렬하여 내용 합치기 (전역 인덱스이므로 원문 순서 복원)
        chunks = []
        for point in results[0]:
            payload = point.payload
            chunks.append({
                "section": payload.get("section", ""),
                "chunk_index": payload.get("chunk_index", 0),
                "content": payload.get("content", ""),
            })

        # chunk_index만으로 정렬 (원문 순서대로)
        chunks.sort(key=lambda x: x["chunk_index"])

        # 내용 합치기
        content_parts = []
        current_section = None
        for chunk in chunks:
            if chunk["section"] != current_section:
                current_section = chunk["section"]
                content_parts.append(f"\n[{current_section}]")
            content_parts.append(chunk["content"])

        return "\n".join(content_parts)

    # ==================== 판례 상세 조회 ====================

    def get_case_detail(self, case_number: str) -> Dict[str, Any]:
        """
        판례 상세 정보 조회

        Args:
            case_number: 사건번호 (예: "대법원 2020다12345")

        Returns:
            판례 상세 정보 딕셔너리
        """
        # 해당 case_number의 모든 청크 조회
        results = self.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="case_number",
                        match=models.MatchValue(value=case_number)
                    )
                ]
            ),
            limit=100,
            with_payload=True,
            with_vectors=False,
        )

        chunks = results[0]
        if not chunks:
            return None

        # 메타데이터 추출 (첫 번째 청크에서)
        first_payload = chunks[0].payload
        metadata = {
            "case_number": first_payload.get("case_number", ""),
            "case_name": first_payload.get("case_name", ""),
            "court_name": first_payload.get("court_name", ""),
            "judgment_date": first_payload.get("judgment_date", ""),
            "case_type": first_payload.get("case_type", ""),
        }

        # 청크들을 chunk_index로 정렬하여 전문 구성
        chunk_list = []
        for point in chunks:
            payload = point.payload
            chunk_list.append({
                "section": payload.get("section", ""),
                "chunk_index": payload.get("chunk_index", 0),
                "content": payload.get("content", ""),
            })

        chunk_list.sort(key=lambda x: x["chunk_index"])

        # 전문 텍스트 합치기
        content_parts = []
        current_section = None
        for chunk in chunk_list:
            if chunk["section"] != current_section:
                current_section = chunk["section"]
                if current_section:
                    content_parts.append(f"\n【{current_section}】")
            content_parts.append(chunk["content"])

        full_text = "\n".join(content_parts)

        return {
            **metadata,
            "full_text": full_text,
        }

    # ==================== 최신 판례 조회 ====================

    def get_recent_cases(self, limit: int = 10) -> Dict[str, Any]:
        """
        최신 판례 목록 조회 (judgment_date 내림차순)

        Args:
            limit: 반환할 최대 결과 수

        Returns:
            최신 판례 목록
        """
        # 모든 판례의 첫 번째 청크만 조회 (chunk_index=0)
        results = self.qdrant_client.scroll(
            collection_name=self.CASES_COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="chunk_index",
                        match=models.MatchValue(value=0)
                    )
                ]
            ),
            limit=1000,
            with_payload=True,
            with_vectors=False,
        )

        # judgment_date로 정렬 (내림차순 = 최신순)
        cases = []
        for point in results[0]:
            payload = point.payload
            cases.append({
                "case_number": payload.get("case_number", ""),
                "case_name": payload.get("case_name", ""),
                "court_name": payload.get("court_name", ""),
                "judgment_date": payload.get("judgment_date", ""),
                "content": payload.get("content", ""),
                "score": 0,
            })

        # 최신순 정렬
        cases.sort(key=lambda x: x["judgment_date"], reverse=True)

        # limit 적용
        cases = cases[:limit]

        return {
            "total": len(cases),
            "results": cases,
        }
