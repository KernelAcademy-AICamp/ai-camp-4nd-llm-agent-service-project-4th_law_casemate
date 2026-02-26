"""
판례 비교 분석 서비스
현재 사건과 유사 판례를 비교하여 전략적 인사이트 제공 (RAG)
"""

import re
import time
import logging
from typing import Dict, Any, Optional

from app.prompts.comparison_prompt import (
    COMPARISON_SYSTEM_PROMPT_V3,
    COMPARISON_USER_TEMPLATE_V3,
    COMPARISON_PROMPT_VERSION_V3,
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

        # 2. V2 프롬프트 생성
        system_prompt = COMPARISON_SYSTEM_PROMPT_V3
        user_prompt = COMPARISON_USER_TEMPLATE_V3.format(
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
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=2000,
                response_format={"type": "json_object"},
            )

            raw_response = response.choices[0].message.content

            elapsed_time = time.time() - start_time
            logger.info(f"비교 분석 완료 - 소요 시간: {elapsed_time:.2f}초")

            # 4. 결과 파싱
            analysis = raw_response
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
                "prompt_version": COMPARISON_PROMPT_VERSION_V3,
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
        분석 결과를 JSON으로 파싱

        Args:
            analysis: GPT 응답 (JSON 형식)

        Returns:
            {"case_overview": "...", "precedent_summary": "...", "similarities": "...", "differences": "...", "strategy_points": "..."}
        """
        result = {
            "case_overview": "",
            "precedent_summary": "",
            "similarities": "",
            "differences": "",
            "strategy_points": "",
        }

        try:
            # JSON 코드 블록 제거 (```json ... ```)
            json_str = analysis.strip()
            if json_str.startswith("```"):
                # 첫 번째 줄 제거 (```json)
                json_str = "\n".join(json_str.split("\n")[1:])
            if json_str.endswith("```"):
                json_str = json_str[:-3]
            json_str = json_str.strip()

            import json
            data = json.loads(json_str)

            # 필드 매핑
            result["case_overview"] = data.get("case_overview", "")
            result["precedent_summary"] = data.get("precedent_summary", "")

            # 배열 필드는 줄바꿈으로 연결
            issue_analysis = data.get("issue_analysis", [])
            if isinstance(issue_analysis, list):
                result["similarities"] = "\n".join(f"- {item}" for item in issue_analysis)
            else:
                result["similarities"] = str(issue_analysis)

            differences = data.get("differences", [])
            if isinstance(differences, list):
                result["differences"] = "\n".join(f"- {item}" for item in differences)
            else:
                result["differences"] = str(differences)

            strategy_points = data.get("strategy_points", [])
            if isinstance(strategy_points, list):
                result["strategy_points"] = "\n".join(f"- {item}" for item in strategy_points)
            else:
                result["strategy_points"] = str(strategy_points)

        except Exception as e:
            logger.error(f"JSON 파싱 실패, 마크다운 파싱 시도: {e}")
            # JSON 파싱 실패 시 기존 마크다운 파싱으로 폴백
            result = self._parse_markdown_fallback(analysis)

        return result

    def _parse_markdown_fallback(self, analysis: str) -> Dict[str, str]:
        """마크다운 형식 파싱 (폴백용)"""
        result = {
            "case_overview": "",
            "precedent_summary": "",
            "similarities": "",
            "differences": "",
            "strategy_points": "",
        }

        sections = {
            "case_overview": ["현재 사건 개요"],
            "precedent_summary": ["유사 판례 요약"],
            "similarities": ["핵심 쟁점별 유사점", "유사점"],
            "differences": ["차이점"],
            "strategy_points": ["전략 포인트"],
        }

        lines = analysis.split("\n")
        current_section = None
        current_content = []

        for line in lines:
            line_stripped = line.strip()
            line_cleaned = re.sub(r'^[#*_\s]+', '', line_stripped).strip()
            line_cleaned = re.sub(r'[*_]+$', '', line_cleaned).strip()

            found_section = None
            for section_key, markers in sections.items():
                for marker in markers:
                    if line_cleaned.startswith(marker):
                        found_section = section_key
                        break
                if found_section:
                    break

            if found_section:
                if current_section and current_content:
                    result[current_section] = "\n".join(current_content).strip()
                current_section = found_section
                current_content = []
            elif current_section:
                current_content.append(line)

        if current_section and current_content:
            result[current_section] = "\n".join(current_content).strip()

        return result
