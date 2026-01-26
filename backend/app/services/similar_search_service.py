"""
유사 판례 검색 서비스
Dense 벡터 유사도 기반 의미적 유사 판례 검색
"""

import os
import logging
from typing import List, Dict, Any
from dataclasses import dataclass
from openai import OpenAI
from qdrant_client import QdrantClient
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()


@dataclass
class SimilarCaseResult:
    """유사 판례 검색 결과"""
    case_number: str
    case_name: str
    court_name: str
    judgment_date: str
    score: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_number": self.case_number,
            "case_name": self.case_name,
            "court_name": self.court_name,
            "judgment_date": self.judgment_date,
            "score": self.score,
        }


class SimilarSearchService:
    """유사 판례 검색 서비스 (HyDE + Dense 벡터 유사도)"""

    CASES_COLLECTION = "cases"

    # HyDE 프롬프트: 가상의 유사 판례 생성
    HYDE_SYSTEM_PROMPT = """당신은 한국 법률 전문가입니다.
주어진 사건 정보를 바탕으로, 이와 유사한 가상의 판례 요약을 작성해주세요.

작성 형식:
- 사건 유형과 핵심 쟁점
- 주요 사실관계
- 법원의 판단 요지
- 적용 법률

실제 판례처럼 법률 용어를 사용하여 2-3문단으로 작성하세요."""

    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "localhost"),
            port=int(os.getenv("QDRANT_PORT", "6333"))
        )

    def _generate_hypothetical_document(self, query: str) -> str:
        """HyDE: 쿼리를 기반으로 가상의 판례 문서 생성"""
        response = self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": self.HYDE_SYSTEM_PROMPT},
                {"role": "user", "content": f"다음 사건과 유사한 판례를 작성해주세요:\n\n{query}"}
            ],
            temperature=0.7,
            max_tokens=500,
        )
        return response.choices[0].message.content

    def _create_dense_embedding(self, text: str) -> List[float]:
        """Dense 임베딩 생성 (OpenAI)"""
        response = self.openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding

    def search_similar_cases(
        self,
        query: str,
        exclude_case_number: str = None,
        limit: int = 3
    ) -> Dict[str, Any]:
        """
        유사 판례 검색 (HyDE + Dense 벡터 유사도)

        Args:
            query: 검색 쿼리 (AI 요약의 결과요약 + 사실관계)
            exclude_case_number: 제외할 판례 사건번호 (현재 보고 있는 판례)
            limit: 반환할 유사 판례 수 (기본 3개)

        Returns:
            유사 판례 목록
        """
        if not query or len(query.strip()) < 10:
            return {"total": 0, "results": []}

        # HyDE: 가상의 유사 판례 문서 생성
        hypothetical_doc = self._generate_hypothetical_document(query)
        logger.info(f"HyDE 가상 문서 생성 완료 ({len(hypothetical_doc)}자)")

        # 가상 문서를 임베딩 (쿼리 대신)
        dense_vector = self._create_dense_embedding(hypothetical_doc)

        # Dense 벡터 유사도 검색
        search_limit = (limit + 1) * 10

        results = self.qdrant_client.query_points(
            collection_name=self.CASES_COLLECTION,
            query=dense_vector,
            using="dense",
            limit=search_limit,
        )

        # 결과 처리 (자기 자신 제외, 청크 병합)
        case_scores = {}
        case_metadata = {}

        for result in results.points:
            payload = result.payload
            case_num = payload.get("case_number", "")

            # 현재 판례 제외
            if exclude_case_number and case_num == exclude_case_number:
                continue

            # 같은 판례는 가장 높은 점수만 유지
            if case_num not in case_scores or result.score > case_scores[case_num]:
                case_scores[case_num] = result.score
                case_metadata[case_num] = {
                    "case_name": payload.get("case_name", ""),
                    "court_name": payload.get("court_name", ""),
                    "judgment_date": payload.get("judgment_date", ""),
                }

        # 결과 생성
        similar_cases = []
        for case_num, score in case_scores.items():
            metadata = case_metadata[case_num]
            similar_cases.append(SimilarCaseResult(
                case_number=case_num,
                case_name=metadata["case_name"],
                court_name=metadata["court_name"],
                judgment_date=metadata["judgment_date"],
                score=score,
            ))

        # 점수순 정렬 후 limit 적용
        similar_cases.sort(key=lambda x: x.score, reverse=True)
        similar_cases = similar_cases[:limit]

        return {
            "total": len(similar_cases),
            "results": [r.to_dict() for r in similar_cases]
        }
