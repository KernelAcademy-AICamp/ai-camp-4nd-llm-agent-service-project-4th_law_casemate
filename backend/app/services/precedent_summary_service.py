"""
판례 요약 서비스
GPT를 활용한 판례 요약 생성 및 저장된 요약 조회
"""

import os
import re
import time
import logging
from typing import Optional, Dict, Any
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models
from dotenv import load_dotenv

from app.prompts.summary_prompt import SUMMARY_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

load_dotenv()


class SummaryService:
    """판례 요약 서비스"""

    SUMMARIES_COLLECTION = "case_summaries"

    # 긴 판례 기준 (청크 개수 대신 문자 수로 판단)
    LONG_CONTENT_THRESHOLD = 30000  # 약 300청크 * 100자

    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "localhost"),
            port=int(os.getenv("QDRANT_PORT", "6333"))
        )

    # ==================== 섹션 파싱 ====================

    def _parse_sections(self, full_text: str) -> Dict[str, str]:
        """
        판례 전문에서 섹션별 내용 추출

        Args:
            full_text: 판례 전문

        Returns:
            {"판시사항": "...", "판결요지": "...", "이유": "...", ...}
        """
        sections = {}

        # 【섹션명】 패턴으로 분리
        pattern = r'【([^】]+)】'
        parts = re.split(pattern, full_text)

        # parts: [앞부분, 섹션명1, 내용1, 섹션명2, 내용2, ...]
        for i in range(1, len(parts) - 1, 2):
            section_name = parts[i].strip()
            section_content = parts[i + 1].strip()
            sections[section_name] = section_content

        return sections

    def _get_summary_source(self, full_text: str) -> str:
        """
        요약용 소스 텍스트 추출 (긴 판례 최적화)

        우선순위:
        1. 판시사항 + 판결요지 (있으면 가장 효율적)
        2. 이유 섹션 (앞부분)
        3. 전문 앞뒤 샘플링

        Args:
            full_text: 판례 전문

        Returns:
            요약에 사용할 텍스트
        """
        # 짧은 판례는 전문 사용
        if len(full_text) < self.LONG_CONTENT_THRESHOLD:
            return full_text

        logger.info(f"긴 판례 감지 ({len(full_text):,}자) - 섹션 기반 요약 적용")

        sections = self._parse_sections(full_text)

        # 1순위: 판시사항 + 판결요지
        priority_parts = []
        if sections.get("판시사항"):
            priority_parts.append(f"【판시사항】\n{sections['판시사항']}")
        if sections.get("판결요지"):
            priority_parts.append(f"【판결요지】\n{sections['판결요지']}")

        if priority_parts:
            logger.info("요약 소스: 판시사항/판결요지 사용")
            return "\n\n".join(priority_parts)

        # 2순위: 이유 섹션 (앞부분 15000자)
        if sections.get("이유"):
            logger.info("요약 소스: 이유 섹션 사용")
            reason_text = sections["이유"]
            if len(reason_text) > 15000:
                return f"【이유】\n{reason_text[:15000]}\n\n(이하 생략)"
            return f"【이유】\n{reason_text}"

        # 3순위: 전문 앞뒤 샘플링
        logger.info("요약 소스: 전문 앞뒤 샘플링 사용")
        front = full_text[:10000]
        back = full_text[-5000:]
        return f"{front}\n\n... (중략) ...\n\n{back}"

    def summarize(self, content: str) -> str:
        """
        판례 내용을 구조화된 형식으로 요약 (GPT 호출)

        긴 판례(30,000자 이상)의 경우:
        1. 판시사항/판결요지가 있으면 해당 섹션만 사용
        2. 없으면 이유 섹션 사용
        3. 둘 다 없으면 앞뒤 샘플링

        Args:
            content: 요약할 텍스트 (전체 판례 내용)

        Returns:
            구조화된 요약 텍스트
        """
        if not content or len(content.strip()) < 10:
            return "요약할 내용이 없습니다."

        start_time = time.time()

        # 긴 판례는 요약용 소스 추출
        summary_source = self._get_summary_source(content)
        logger.info(f"요약 소스 길이: {len(summary_source):,}자 (원본: {len(content):,}자)")

        response = self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": SUMMARY_SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": f"다음 판례 내용을 요약해주세요:\n\n{summary_source}"
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
