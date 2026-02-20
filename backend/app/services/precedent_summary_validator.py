"""
요약 팩트 검증 서비스

요약에서 추출한 팩트(금액, 날짜, 사건번호, 법조문 등)가
원문에 존재하는지 검증하여 할루시네이션을 탐지합니다.
"""

import re
import json
import os
from datetime import datetime
from typing import List, Dict, Tuple, Set, Optional
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class ValidationResult:
    """검증 결과"""
    score: float  # 0.0 ~ 1.0 (매칭률)
    total_facts: int  # 추출된 총 팩트 수
    matched_facts: int  # 원문에서 발견된 팩트 수
    unmatched_facts: List[str]  # 원문에 없는 팩트 목록
    is_valid: bool  # score >= threshold
    details: Dict[str, Dict]  # 카테고리별 상세 정보


class SummaryValidator:
    """요약 팩트 검증기"""

    # 검증 통과 기준
    VALIDITY_THRESHOLD = 0.7

    def __init__(self):
        # 팩트 추출 패턴
        self.patterns = {
            "금액": [
                r'\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:원|만원|억원|천원|만 원|억 원)',
                r'\d+(?:만|억|천)?\s*원',
                r'금\s*\d{1,3}(?:,\d{3})*원',
            ],
            "날짜": [
                r'\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}[일]?',
                r'\d{4}[.\-/년]\s*\d{1,2}[월]',
                r'\d{4}년',
            ],
            "사건번호": [
                r'\d{2,4}[가-힣]{1,4}\d+',  # 2020가합12345
                r'\d{2,4}\s*[가-힣]{1,4}\s*\d+',
            ],
            "법조문": [
                r'제\d+조(?:의\d+)?(?:\s*제\d+항)?(?:\s*제\d+호)?',
                r'(?:민법|형법|상법|민사소송법|형사소송법|헌법)\s*제\d+조',
            ],
            "판결결과": [
                r'원고\s*(?:일부\s*)?(?:승소|패소|승|패)',
                r'피고\s*(?:일부\s*)?(?:승소|패소|승|패)',
                r'(?:전부|일부)\s*(?:인용|기각|각하)',
                r'청구(?:를|가)?\s*(?:인용|기각|각하)',
                r'항소(?:를|가)?\s*(?:기각|인용|각하)',
                r'상고(?:를|가)?\s*(?:기각|인용|각하|파기)',
                r'파기(?:환송|자판)',
            ],
        }

    def extract_facts(self, text: str) -> Dict[str, Set[str]]:
        """텍스트에서 팩트 추출"""
        facts = {category: set() for category in self.patterns}

        for category, patterns in self.patterns.items():
            for pattern in patterns:
                matches = re.findall(pattern, text, re.IGNORECASE)
                for match in matches:
                    # 정규화: 공백 제거, 소문자 변환
                    normalized = re.sub(r'\s+', '', match.lower())
                    facts[category].add(normalized)

        return facts

    def normalize_for_comparison(self, text: str) -> str:
        """비교를 위한 텍스트 정규화"""
        # 공백, 특수문자 제거
        normalized = re.sub(r'\s+', '', text)
        # 콤마 제거 (금액 비교용)
        normalized = normalized.replace(',', '')
        return normalized.lower()

    def fact_exists_in_source(self, fact: str, source_normalized: str) -> bool:
        """팩트가 원문에 존재하는지 확인"""
        fact_normalized = self.normalize_for_comparison(fact)

        # 직접 매칭
        if fact_normalized in source_normalized:
            return True

        # 금액의 경우 다양한 형식 체크
        # 예: "5000만원" = "5,000만원" = "5000만 원"
        if any(c.isdigit() for c in fact):
            # 숫자만 추출하여 비교
            fact_numbers = re.findall(r'\d+', fact)
            if fact_numbers:
                # 원문에서 같은 숫자 패턴 찾기
                for num in fact_numbers:
                    if len(num) >= 3 and num in source_normalized:
                        return True

        return False

    def validate(self, summary: str, source: str) -> ValidationResult:
        """
        요약과 원문을 비교하여 팩트 검증

        Args:
            summary: 생성된 요약
            source: 원문 (판례 전문)

        Returns:
            ValidationResult: 검증 결과
        """
        # 팩트 추출
        summary_facts = self.extract_facts(summary)
        source_normalized = self.normalize_for_comparison(source)

        # 카테고리별 검증
        details = {}
        total_facts = 0
        matched_facts = 0
        unmatched_facts = []

        for category, facts in summary_facts.items():
            category_matched = 0
            category_unmatched = []

            for fact in facts:
                total_facts += 1
                if self.fact_exists_in_source(fact, source_normalized):
                    matched_facts += 1
                    category_matched += 1
                else:
                    unmatched_facts.append(f"[{category}] {fact}")
                    category_unmatched.append(fact)

            details[category] = {
                "total": len(facts),
                "matched": category_matched,
                "unmatched": category_unmatched,
            }

        # 점수 계산
        score = matched_facts / total_facts if total_facts > 0 else 1.0
        is_valid = score >= self.VALIDITY_THRESHOLD

        return ValidationResult(
            score=score,
            total_facts=total_facts,
            matched_facts=matched_facts,
            unmatched_facts=unmatched_facts,
            is_valid=is_valid,
            details=details,
        )

    def validate_with_report(self, summary: str, source: str) -> Tuple[ValidationResult, str]:
        """검증 결과와 리포트 반환"""
        result = self.validate(summary, source)

        # 리포트 생성
        report_lines = [
            f"=== 팩트 검증 결과 ===",
            f"점수: {result.score:.1%} ({'통과' if result.is_valid else '실패'})",
            f"총 팩트: {result.total_facts}개, 매칭: {result.matched_facts}개",
            "",
        ]

        # 카테고리별 상세
        for category, info in result.details.items():
            if info["total"] > 0:
                status = "✓" if info["matched"] == info["total"] else "✗"
                report_lines.append(
                    f"{status} {category}: {info['matched']}/{info['total']}"
                )
                if info["unmatched"]:
                    for fact in info["unmatched"]:
                        report_lines.append(f"   - 미확인: {fact}")

        if result.unmatched_facts:
            report_lines.append("")
            report_lines.append("⚠️ 할루시네이션 의심:")
            for fact in result.unmatched_facts:
                report_lines.append(f"  - {fact}")

        report = "\n".join(report_lines)
        return result, report


class HallucinationFlagManager:
    """할루시네이션 의심 항목 관리"""

    DEFAULT_PATH = Path(__file__).parent.parent.parent / "data" / "hallucination_flags.json"

    def __init__(self, file_path: Optional[Path] = None):
        self.file_path = file_path or self.DEFAULT_PATH
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        """파일 및 디렉토리 생성"""
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.file_path.exists():
            self._save_data({"flags": [], "stats": {"total": 0, "reviewed": 0}})

    def _load_data(self) -> Dict:
        """JSON 파일 로드"""
        with open(self.file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save_data(self, data: Dict):
        """JSON 파일 저장"""
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def add_flag(
        self,
        case_number: str,
        score: float,
        unmatched_facts: List[str],
        summary: str,
        details: Dict = None,
    ):
        """할루시네이션 의심 항목 추가"""
        data = self._load_data()

        flag = {
            "case_number": case_number,
            "score": round(score, 3),
            "unmatched_facts": unmatched_facts,
            "summary_preview": summary[:200] + "..." if len(summary) > 200 else summary,
            "details": details,
            "created_at": datetime.now().isoformat(),
            "reviewed": False,
            "review_notes": None,
        }

        data["flags"].append(flag)
        data["stats"]["total"] = len(data["flags"])
        self._save_data(data)

    def get_all_flags(self, only_unreviewed: bool = False) -> List[Dict]:
        """모든 플래그 조회"""
        data = self._load_data()
        flags = data.get("flags", [])

        if only_unreviewed:
            flags = [f for f in flags if not f.get("reviewed")]

        return flags

    def mark_reviewed(self, case_number: str, notes: str = None):
        """플래그 검토 완료 처리"""
        data = self._load_data()

        for flag in data["flags"]:
            if flag["case_number"] == case_number:
                flag["reviewed"] = True
                flag["review_notes"] = notes
                flag["reviewed_at"] = datetime.now().isoformat()

        data["stats"]["reviewed"] = len([f for f in data["flags"] if f.get("reviewed")])
        self._save_data(data)

    def get_stats(self) -> Dict:
        """통계 조회"""
        data = self._load_data()
        flags = data.get("flags", [])

        return {
            "total": len(flags),
            "reviewed": len([f for f in flags if f.get("reviewed")]),
            "pending": len([f for f in flags if not f.get("reviewed")]),
            "avg_score": sum(f["score"] for f in flags) / len(flags) if flags else 0,
        }

    def clear_all(self):
        """모든 플래그 삭제"""
        self._save_data({"flags": [], "stats": {"total": 0, "reviewed": 0}})


# 싱글톤 인스턴스
_validator = None
_flag_manager = None


def get_validator() -> SummaryValidator:
    """검증기 싱글톤"""
    global _validator
    if _validator is None:
        _validator = SummaryValidator()
    return _validator


def get_flag_manager() -> HallucinationFlagManager:
    """플래그 매니저 싱글톤"""
    global _flag_manager
    if _flag_manager is None:
        _flag_manager = HallucinationFlagManager()
    return _flag_manager
