"""
판례 요약 서비스
GPT를 활용한 판례 요약 생성 및 저장된 요약 조회
"""

import os
import time
import logging
from typing import Optional, Dict, Any
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models
from dotenv import load_dotenv

from app.prompts.summary_prompt import SUMMARY_SYSTEM_PROMPT, PROMPT_VERSION

logger = logging.getLogger(__name__)

load_dotenv()


class SummaryService:
    """판례 요약 서비스"""

    SUMMARIES_COLLECTION = "case_summaries"

    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "localhost"),
            port=int(os.getenv("QDRANT_PORT", "6333"))
        )

    def summarize(self, content: str) -> str:
        """
        판례 내용을 구조화된 형식으로 요약 (GPT 호출)

        Args:
            content: 요약할 텍스트 (전체 판례 내용)

        Returns:
            구조화된 요약 텍스트
        """
        if not content or len(content.strip()) < 10:
            return "요약할 내용이 없습니다."

        start_time = time.time()

        response = self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": SUMMARY_SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": f"다음 판례 내용을 요약해주세요:\n\n{content}"
                }
            ],
            temperature=0.3,
            max_tokens=1500,
        )

        elapsed_time = time.time() - start_time
        logger.info(f"요약 완료 - 소요 시간: {elapsed_time:.2f}초")

        return response.choices[0].message.content

    def get_saved_summary(self, case_number: str) -> Optional[str]:
        """
        저장된 요약 조회

        Args:
            case_number: 사건번호

        Returns:
            저장된 요약 텍스트, 없으면 None
        """
        try:
            results = self.qdrant_client.scroll(
                collection_name=self.SUMMARIES_COLLECTION,
                scroll_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="case_number",
                            match=models.MatchValue(value=case_number)
                        )
                    ]
                ),
                limit=1,
                with_payload=True,
                with_vectors=False,
            )

            if results[0]:
                return results[0][0].payload.get("summary")
            return None

        except Exception as e:
            logger.error(f"요약 조회 실패: {e}")
            return None

    def get_or_generate_summary(self, case_number: str, content: str) -> Dict[str, Any]:
        """
        저장된 요약이 있으면 반환, 없으면 생성

        Args:
            case_number: 사건번호
            content: 판례 내용 (요약 생성 시 사용)

        Returns:
            {"summary": str, "cached": bool}
        """
        # 먼저 저장된 요약 확인
        saved_summary = self.get_saved_summary(case_number)
        if saved_summary:
            return {"summary": saved_summary, "cached": True}

        # 없으면 새로 생성
        summary = self.summarize(content)
        return {"summary": summary, "cached": False}
