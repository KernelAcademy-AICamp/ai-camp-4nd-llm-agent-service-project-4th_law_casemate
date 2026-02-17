"""
판례 비교 분석 서비스
현재 사건과 유사 판례를 비교하여 전략적 인사이트 제공 (RAG)
"""

import time
import logging
from typing import Dict, Any, Optional

from app.prompts.comparison_prompt import (
    COMPARISON_SYSTEM_PROMPT_V2,
    COMPARISON_USER_TEMPLATE_V2,
    COMPARISON_PROMPT_VERSION_V2,
)
from app.services.precedent_embedding_service import get_openai_client
from app.services.precedent_repository import PrecedentRepository

logger = logging.getLogger(__name__)


class ComparisonService:
    """판례 비교 분석 서비스"""

    def __init__(self):
        self.openai_client = get_openai_client()  # 싱글톤 사용
        self.repository = PrecedentRepository()

    def _get_precedent_content(self, case_number: str) -> Optional[Dict[str, Any]]:
        """
        PostgreSQL에서 판례 원문 및 메타데이터 조회

        Args:
            case_number: 사건번호

        Returns:
            판례 정보 딕셔너리 또는 None
        """
        try:
            # PostgreSQL에서 판례 상세 정보 조회
            detail = self.repository.get_case_detail(case_number)

            if not detail:
                return None

            return {
                "case_number": detail.get("case_number", ""),
                "case_name": detail.get("case_name", ""),
                "court_name": detail.get("court_name", ""),
                "judgment_date": detail.get("judgment_date", ""),
                "content": detail.get("full_text", ""),
            }

        except Exception as e:
            logger.error(f"판례 조회 실패: {e}")
            return None

    def compare(
        self,
        origin_facts: str,
        origin_claims: str,
        target_case_number: str,
    ) -> Dict[str, Any]:
        """
        현재 사건과 유사 판례 비교 분석

        Args:
            origin_facts: 현재 사건의 사실관계
            origin_claims: 현재 사건의 청구내용
            target_case_number: 비교할 유사 판례 사건번호

        Returns:
            비교 분석 결과 딕셔너리
        """
        start_time = time.time()

        # 1. 유사 판례 원문 조회
        precedent = self._get_precedent_content(target_case_number)
        if not precedent:
            return {
                "success": False,
                "error": f"판례를 찾을 수 없습니다: {target_case_number}",
            }

        # 2. 프롬프트 생성 (V2: 핵심 쟁점 키워드 중심 분석)
        user_prompt = COMPARISON_USER_TEMPLATE_V2.format(
            origin_facts=origin_facts,
            origin_claims=origin_claims,
            precedent_case_number=precedent["case_number"],
            precedent_case_name=precedent["case_name"],
            precedent_court_name=precedent["court_name"],
            precedent_judgment_date=precedent["judgment_date"],
            precedent_content=precedent["content"],
        )

        # 3. GPT 호출
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": COMPARISON_SYSTEM_PROMPT_V2},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
            )

            analysis = response.choices[0].message.content

            elapsed_time = time.time() - start_time
            logger.info(f"비교 분석 완료 - 소요 시간: {elapsed_time:.2f}초")

            # 4. 결과 파싱 (섹션별 분리)
            parsed = self._parse_analysis(analysis)

            return {
                "success": True,
                "analysis": analysis,
                "parsed": parsed,
                "precedent_info": {
                    "case_number": precedent["case_number"],
                    "case_name": precedent["case_name"],
                    "court_name": precedent["court_name"],
                    "judgment_date": precedent["judgment_date"],
                },
                "prompt_version": COMPARISON_PROMPT_VERSION_V2,
                "elapsed_time": round(elapsed_time, 2),
            }

        except Exception as e:
            logger.error(f"비교 분석 실패: {e}")
            return {
                "success": False,
                "error": f"비교 분석 중 오류 발생: {str(e)}",
            }

    def _parse_analysis(self, analysis: str) -> Dict[str, str]:
        """
        분석 결과를 섹션별로 파싱

        Args:
            analysis: GPT 응답 전체 텍스트

        Returns:
            {"similarities": "...", "differences": "...", "strategy_points": "..."}
        """
        result = {
            "case_overview": "",
            "precedent_summary": "",
            "similarities": "",
            "differences": "",
            "strategy_points": "",
        }

        # 섹션 구분자 패턴 (V2: 핵심 쟁점별 유사점 추가)
        sections = {
            "case_overview": ["# 현재 사건 개요", "## 현재 사건 개요", "현재 사건 개요"],
            "precedent_summary": ["# 유사 판례 요약", "## 유사 판례 요약", "유사 판례 요약"],
            "similarities": ["# 핵심 쟁점별 유사점", "## 핵심 쟁점별 유사점", "핵심 쟁점별 유사점", "# 유사점", "## 유사점", "유사점"],
            "differences": ["# 차이점", "## 차이점", "차이점"],
            "strategy_points": ["# 전략 포인트", "## 전략 포인트", "전략 포인트"],
        }

        lines = analysis.split("\n")
        current_section = None
        current_content = []

        for line in lines:
            line_stripped = line.strip()

            # 새로운 섹션 시작 감지
            found_section = None
            for section_key, markers in sections.items():
                for marker in markers:
                    if line_stripped.startswith(marker):
                        found_section = section_key
                        break
                if found_section:
                    break

            if found_section:
                # 이전 섹션 저장
                if current_section and current_content:
                    result[current_section] = "\n".join(current_content).strip()

                current_section = found_section
                current_content = []
            elif current_section:
                current_content.append(line)

        # 마지막 섹션 저장
        if current_section and current_content:
            result[current_section] = "\n".join(current_content).strip()

        return result
