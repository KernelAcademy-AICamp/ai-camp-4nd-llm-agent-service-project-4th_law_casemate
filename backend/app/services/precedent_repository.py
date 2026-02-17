"""
판례 데이터 저장소
Qdrant 벡터 검색 + PostgreSQL 원문 조회
"""

import re
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from qdrant_client.http import models

from tool.qdrant_client import get_qdrant_client
from tool.database import SessionLocal
from app.models.precedent import Precedent

logger = logging.getLogger(__name__)


# ==================== 데이터 클래스 ====================

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


# ==================== 저장소 클래스 ====================

class PrecedentRepository:
    """판례 데이터 저장소"""

    CASES_COLLECTION = "precedents"

    def __init__(self):
        self.qdrant_client = get_qdrant_client()

    # ==================== 헬퍼 함수 ====================

    def _merge_chunks_to_text(self, chunks: List[Dict], include_section_header: bool = True) -> str:
        """
        청크 리스트를 정렬하고 텍스트로 병합 (오버랩 중복 제거)

        Args:
            chunks: [{"section": str, "chunk_index": int, "content": str}, ...]
            include_section_header: 섹션 헤더 포함 여부

        Returns:
            병합된 텍스트
        """
        if not chunks:
            return ""

        chunks.sort(key=lambda x: x.get("chunk_index", 0))

        content_parts = []
        current_section = None
        prev_content = ""

        for chunk in chunks:
            if include_section_header and chunk.get("section") != current_section:
                current_section = chunk.get("section")
                content_parts.append(f"\n[{current_section}]")

            content = chunk.get("content", "")

            # 오버랩 중복 제거: 이전 청크 끝과 현재 청크 시작의 공통 부분 찾기
            if prev_content and content:
                content = self._remove_overlap(prev_content, content)

            content_parts.append(content)
            prev_content = chunk.get("content", "")  # 원본 저장 (제거 전)

        return " ".join(content_parts)

    def _remove_overlap(self, prev_text: str, curr_text: str, max_overlap: int = 150) -> str:
        """
        이전 텍스트 끝과 현재 텍스트 시작의 중복 부분 제거

        Args:
            prev_text: 이전 청크 텍스트
            curr_text: 현재 청크 텍스트
            max_overlap: 최대 오버랩 검사 길이

        Returns:
            중복 제거된 현재 텍스트
        """
        if not prev_text or not curr_text:
            return curr_text

        # 이전 텍스트의 끝 부분 (최대 max_overlap 글자)
        prev_suffix = prev_text[-max_overlap:] if len(prev_text) > max_overlap else prev_text

        # 현재 텍스트의 시작 부분이 이전 텍스트 끝에 포함되는지 확인
        for i in range(min(len(prev_suffix), len(curr_text)), 0, -1):
            if prev_suffix.endswith(curr_text[:i]):
                # 중복 부분 제거
                return curr_text[i:].lstrip()

        return curr_text

    def _format_headers(self, text: str) -> str:
        """
        【헤더】를 독립된 줄로 변환하고 연속 줄바꿈 정리

        Args:
            text: 원본 텍스트

        Returns:
            헤더가 정리된 텍스트
        """
        if not text:
            return ""

        parts = re.split(r'(【[^】]+】)', text)
        cleaned = []
        for part in parts:
            if re.match(r'^【[^】]+】$', part):
                cleaned.append('\n' + part + '\n')
            elif part.strip():
                cleaned.append(part)

        result = ''.join(cleaned)
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()

    def _restore_paragraphs(self, text: str) -> str:
        """
        문단 마커({{PARA}})를 줄바꿈으로 복원

        Args:
            text: 마커가 포함된 텍스트

        Returns:
            문단 구조가 복원된 텍스트
        """
        if not text:
            return ""

        # {{PARA}} 마커를 줄바꿈 2개로 복원
        result = text.replace('{{PARA}}', '\n\n')
        # 연속 줄바꿈 정리
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()

    def _remove_section(self, text: str, section_name: str) -> str:
        """
        특정 섹션을 텍스트에서 제거

        Args:
            text: 원본 텍스트
            section_name: 제거할 섹션명 (예: "사건명")

        Returns:
            섹션이 제거된 텍스트
        """
        if not text or not section_name:
            return text

        # 【섹션명】부터 다음 【】까지 또는 텍스트 끝까지 제거
        pattern = rf'【{re.escape(section_name)}】.*?(?=【|$)'
        result = re.sub(pattern, '', text, flags=re.DOTALL)
        # 연속 줄바꿈 정리
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()

    def _reorder_sections(self, text: str) -> str:
        """
        섹션 순서 재배열: 참조조문, 참조판례를 전문 앞으로 이동

        표시 순서: 판시사항 → 판결요지 → 참조조문 → 참조판례 → 전문
        """
        if not text:
            return ""

        # 섹션별로 분리
        sections = {}
        current_section = None
        current_content = []

        for line in text.split('\n'):
            # 【섹션명】 패턴 찾기
            match = re.match(r'^【([^】]+)】$', line.strip())
            if match:
                # 이전 섹션 저장
                if current_section:
                    sections[current_section] = '\n'.join(current_content)
                current_section = match.group(1)
                current_content = [line]
            else:
                current_content.append(line)

        # 마지막 섹션 저장
        if current_section:
            sections[current_section] = '\n'.join(current_content)

        # 원하는 순서로 재배열
        ordered_sections = ['판시사항', '판결요지', '참조조문', '참조판례', '전문']
        result_parts = []

        for section_name in ordered_sections:
            if section_name in sections:
                result_parts.append(sections[section_name])

        # 나머지 섹션 추가 (순서에 없는 것들)
        for section_name, content in sections.items():
            if section_name not in ordered_sections:
                result_parts.append(content)

        result = '\n\n'.join(result_parts)
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()

    def _clean_html_tags(self, text: str) -> str:
        """
        HTML 태그를 텍스트로 변환
        - <br/>, <br>, <br /> → 줄바꿈
        - 기타 HTML 태그 제거
        - 【헤더】를 독립된 줄로 변환
        """
        if not text:
            return ""

        # <br> 태그들을 줄바꿈으로 변환
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)

        # 기타 HTML 태그 제거
        text = re.sub(r'<[^>]+>', '', text)

        # 【헤더】를 독립된 줄로 변환
        return self._format_headers(text)

    # ==================== 판례 전문 조회 (PostgreSQL) ====================

    def get_full_case_content(self, case_number: str) -> str:
        """
        PostgreSQL에서 판례 전문 조회
        """
        db = SessionLocal()
        try:
            precedent = db.query(Precedent).filter(
                Precedent.case_number == case_number
            ).first()

            if precedent and precedent.full_content:
                return precedent.full_content
            return ""
        finally:
            db.close()

    def get_full_case_contents_batch(self, case_numbers: List[str]) -> Dict[str, str]:
        """
        PostgreSQL에서 여러 판례의 전문을 일괄 조회

        Args:
            case_numbers: 조회할 사건번호 리스트

        Returns:
            {case_number: full_content} 딕셔너리
        """
        if not case_numbers:
            return {}

        db = SessionLocal()
        try:
            precedents = db.query(Precedent).filter(
                Precedent.case_number.in_(case_numbers)
            ).all()

            return {
                p.case_number: p.full_content or ""
                for p in precedents
            }
        finally:
            db.close()

    # ==================== 판례 상세 조회 (PostgreSQL) ====================

    def get_case_detail(self, case_number: str) -> Optional[Dict[str, Any]]:
        """
        PostgreSQL에서 판례 상세 정보 조회

        Args:
            case_number: 사건번호 (예: "대법원 2020다12345")

        Returns:
            판례 상세 정보 딕셔너리
        """
        db = SessionLocal()
        try:
            precedent = db.query(Precedent).filter(
                Precedent.case_number == case_number
            ).first()

            if not precedent:
                return None

            # 전문 텍스트 후처리
            full_text = precedent.full_content or ""

            # 【헤더】를 독립 줄로 변환 (프론트 섹션 파싱용)
            full_text = self._format_headers(full_text)

            # 【사건명】 섹션 제거 (상단 메타데이터로 이미 표시됨)
            full_text = self._remove_section(full_text, "사건명")

            # 섹션 순서 재배열: 참조조문, 참조판례를 전문 앞으로
            full_text = self._reorder_sections(full_text)

            # 문단 마커({{PARA}})를 줄바꿈으로 복원
            full_text = self._restore_paragraphs(full_text)

            return {
                "case_number": precedent.case_number,
                "case_name": precedent.case_name or "",
                "court_name": precedent.court_name or "",
                "judgment_date": precedent.judgment_date or "",
                "case_type": precedent.case_type or "",
                "full_text": full_text,
            }
        finally:
            db.close()

    # ==================== 메타데이터 조회 (PostgreSQL) ====================

    def get_metadata_batch(self, case_numbers: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        PostgreSQL에서 여러 판례의 메타데이터를 일괄 조회

        Args:
            case_numbers: 조회할 사건번호 리스트

        Returns:
            {case_number: {case_name, court_name, judgment_date, case_type}} 딕셔너리
        """
        if not case_numbers:
            return {}

        db = SessionLocal()
        try:
            precedents = db.query(Precedent).filter(
                Precedent.case_number.in_(case_numbers)
            ).all()

            return {
                p.case_number: {
                    "case_name": p.case_name or "",
                    "court_name": p.court_name or "",
                    "judgment_date": p.judgment_date or "",
                    "case_type": p.case_type or "",
                    "full_content": p.full_content or "",
                }
                for p in precedents
            }
        finally:
            db.close()

    def extract_preview(self, full_content: str, query: str, context_chars: int = 100) -> str:
        """
        전문에서 검색어 주변 텍스트 추출 (미리보기용)

        Args:
            full_content: 전체 텍스트
            query: 검색어
            context_chars: 검색어 앞뒤로 포함할 문자 수

        Returns:
            검색어 주변 텍스트
        """
        if not full_content:
            return ""

        idx = full_content.find(query)
        if idx == -1:
            # 검색어 못 찾으면 앞부분 반환
            return full_content[:200] + "..." if len(full_content) > 200 else full_content

        start = max(0, idx - context_chars)
        end = min(len(full_content), idx + len(query) + context_chars)

        preview = full_content[start:end]
        if start > 0:
            preview = "..." + preview
        if end < len(full_content):
            preview = preview + "..."

        return preview

    # ==================== 키워드 검색 (PostgreSQL) ====================

    def search_by_keywords(
        self,
        keywords: List[str],
        match_all: bool = False,
        limit: int = 200
    ) -> List[str]:
        """
        PostgreSQL에서 키워드가 포함된 판례의 case_number 검색

        Args:
            keywords: 검색할 키워드 리스트
            match_all: True면 모든 키워드 포함, False면 하나라도 포함
            limit: 최대 결과 수

        Returns:
            case_number 리스트
        """
        if not keywords:
            return []

        db = SessionLocal()
        try:
            from sqlalchemy import or_, and_

            # 키워드별 LIKE 조건 생성
            conditions = [
                Precedent.full_content.ilike(f"%{kw}%")
                for kw in keywords
            ]

            if match_all:
                # 모든 키워드 포함 (AND)
                query = db.query(Precedent.case_number).filter(and_(*conditions))
            else:
                # 하나라도 포함 (OR)
                query = db.query(Precedent.case_number).filter(or_(*conditions))

            results = query.limit(limit).all()
            return [r[0] for r in results]

        finally:
            db.close()

    def search_by_keywords_with_count(
        self,
        keywords: List[str],
        limit: int = 200
    ) -> List[tuple]:
        """
        PostgreSQL에서 키워드가 포함된 판례 검색 (매칭 키워드 수 포함)

        Args:
            keywords: 검색할 키워드 리스트
            limit: 최대 결과 수

        Returns:
            [(case_number, matched_keyword_count), ...] 매칭 수 내림차순
        """
        if not keywords:
            return []

        db = SessionLocal()
        try:
            from sqlalchemy import or_, case, func

            # 각 키워드별 매칭 여부를 카운트
            match_cases = [
                case(
                    (Precedent.full_content.ilike(f"%{kw}%"), 1),
                    else_=0
                )
                for kw in keywords
            ]

            # 매칭 키워드 수 합계
            match_count = sum(match_cases)

            # 하나라도 매칭되는 것만 필터
            conditions = [
                Precedent.full_content.ilike(f"%{kw}%")
                for kw in keywords
            ]

            results = db.query(
                Precedent.case_number,
                match_count.label("match_count")
            ).filter(
                or_(*conditions)
            ).order_by(
                match_count.desc()
            ).limit(limit).all()

            return [(r[0], r[1]) for r in results]

        finally:
            db.close()

    # ==================== 최신 판례 조회 (PostgreSQL) ====================

    def get_recent_cases(self, limit: int = 50) -> Dict[str, Any]:
        """
        PostgreSQL에서 최신 판례 목록 조회 (judgment_date 내림차순)

        Args:
            limit: 반환할 최대 결과 수

        Returns:
            최신 판례 목록
        """
        db = SessionLocal()
        try:
            precedents = db.query(Precedent).order_by(
                Precedent.judgment_date.desc()
            ).limit(limit).all()

            cases = [
                {
                    "case_number": p.case_number,
                    "case_name": p.case_name or "",
                    "court_name": p.court_name or "",
                    "judgment_date": p.judgment_date or "",
                    "content": (p.full_content or "")[:200] + "...",
                    "score": 0,
                }
                for p in precedents
            ]

            return {
                "total": len(cases),
                "results": cases,
            }
        finally:
            db.close()

    # ==================== 응답 포맷팅 ====================

    def _format_case_response(self, data: Dict[str, Any], from_api: bool = False) -> Dict[str, Any]:
        """
        판례 응답 데이터를 프론트엔드 형식으로 포맷팅
        """
        full_text = data.get("full_text", "")
        full_text = self._clean_html_tags(full_text)

        return {
            "case_number": data.get("case_number", ""),
            "case_name": data.get("case_name", ""),
            "court_name": data.get("court_name", ""),
            "judgment_date": data.get("judgment_date", ""),
            "case_type": data.get("case_type", ""),
            "full_text": full_text,
            "from_api": from_api,
        }

    def _build_full_text_from_api(self, detail: Dict[str, Any]) -> str:
        """
        법령 API 응답을 full_text 형식으로 변환
        표시 순서: 판시사항 → 판결요지 → 참조조문 → 참조판례 → 전문
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

    # ==================== 법령 API 연동 ====================

    async def fetch_from_law_api(self, case_number: str) -> Dict[str, Any] | None:
        """
        법령 API에서 판례 조회

        1. search_cases(사건번호)로 검색하여 ID 추출
        2. get_case_detail(ID)로 상세 정보 조회
        3. 프론트엔드 형식으로 변환하여 반환
        """
        from tool.law_api_client import LawAPIClient

        try:
            async with LawAPIClient() as client:
                search_result = await client.search_cases(query=case_number, display=20)

                prec_list = search_result.get("PrecSearch", {}).get("prec", [])
                if not prec_list:
                    logger.info(f"법령 API 검색 결과 없음: {case_number}")
                    return None

                if isinstance(prec_list, dict):
                    prec_list = [prec_list]

                case_id = None
                for prec in prec_list:
                    prec_case_number = prec.get("사건번호", "").replace(" ", "")
                    if prec_case_number == case_number.replace(" ", ""):
                        case_id = prec.get("판례일련번호")
                        break

                if not case_id:
                    logger.info(f"정확히 일치하는 판례 없음: {case_number}")
                    return None

                detail_result = await client.get_case_detail(case_id=case_id)
                detail = detail_result.get("PrecService", {})

                if not detail:
                    logger.info(f"상세 정보 없음: {case_number}")
                    return None

                full_text = self._build_full_text_from_api(detail)

                return {
                    "case_number": detail.get("사건번호", case_number),
                    "case_name": detail.get("사건명", ""),
                    "court_name": detail.get("법원명", ""),
                    "judgment_date": detail.get("선고일자", ""),
                    "case_type": detail.get("사건종류명", ""),
                    "full_text": full_text,
                }

        except Exception as e:
            logger.error(f"법령 API 조회 오류: {e}")
            return None

    # ==================== 통합 조회 ====================

    async def get_case_detail_with_fallback(self, case_number: str) -> Dict[str, Any] | None:
        """
        판례 상세 조회 (Qdrant 우선, 없으면 법령 API에서 조회)

        Args:
            case_number: 사건번호

        Returns:
            포맷팅된 판례 상세 정보 또는 None
        """
        # 1. Qdrant에서 먼저 검색
        result = self.get_case_detail(case_number=case_number)
        if result is not None:
            return self._format_case_response(result, from_api=False)

        # 2. Qdrant에 없으면 법령 API에서 가져오기
        logger.info(f"Qdrant에 없음, 법령 API 조회: {case_number}")
        result = await self.fetch_from_law_api(case_number)

        if result is not None:
            return self._format_case_response(result, from_api=True)

        return None
