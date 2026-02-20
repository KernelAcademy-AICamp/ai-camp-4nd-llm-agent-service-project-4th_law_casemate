"""
국가법령정보 Open API 클라이언트
https://open.law.go.kr 에서 제공하는 API를 사용하여 법령 및 판례 데이터를 조회합니다.
"""

import os
import httpx
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from dotenv import load_dotenv

load_dotenv()


@dataclass
class LawInfo:
    """법령 정보 데이터 클래스"""
    law_id: str              # 법령 ID
    law_name: str            # 법령명
    law_type: str            # 법령 종류 (법률, 시행령 등)
    proclamation_date: str   # 공포일자
    proclamation_number: str # 공포번호
    enforcement_date: str    # 시행일자
    mst: str                 # 법령 일련번호 (상세조회용)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class LawDetail:
    """법령 상세 정보 데이터 클래스"""
    law_id: str
    law_name: str
    articles: List[Dict[str, Any]]  # 조문 리스트
    addendum: Optional[str] = None  # 부칙

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CaseInfo:
    """판례 정보 데이터 클래스"""
    case_id: str             # 판례 ID
    case_name: str           # 사건명
    case_number: str         # 사건번호
    judgment_date: str       # 선고일자
    court_name: str          # 법원명
    case_type: str           # 사건종류
    judgment_type: str       # 판결유형

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CaseDetail:
    """판례 상세 정보 데이터 클래스"""
    case_id: str
    case_name: str
    case_number: str
    judgment_date: str
    court_name: str
    case_type: str
    judgment_summary: str    # 판시사항
    judgment_reason: str     # 판결요지
    full_text: Optional[str] = None  # 전문 (있는 경우)
    reference_articles: Optional[List[str]] = None  # 참조조문
    reference_cases: Optional[List[str]] = None     # 참조판례

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class LawAPIClient:
    """국가법령정보 API 클라이언트 (JSON 응답)"""

    BASE_URL = "https://www.law.go.kr/DRF"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("LAW_API_KEY")
        if not self.api_key:
            raise ValueError("LAW_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.")

        self.client = httpx.AsyncClient(timeout=30.0)

    async def close(self):
        """HTTP 클라이언트 종료"""
        await self.client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    # ==================== 법령 API ====================

    async def search_laws(
        self,
        query: Optional[str] = None,
        law_type: Optional[str] = None,
        page: int = 1,
        display: int = 20,
        sort: str = "공포일자",
        is_current: str = "Y"  # Y: 현행법령만
    ) -> Dict[str, Any]:
        """
        법령 목록 검색

        Args:
            query: 검색어 (법령명)
            law_type: 법령 종류 (법률, 대통령령, 총리령, 부령 등)
            page: 페이지 번호
            display: 한 페이지당 결과 수 (최대 100)
            sort: 정렬 기준
            is_current: 현행법령 여부 (Y/N)

        Returns:
            JSON 응답 딕셔너리
        """
        params = {
            "OC": self.api_key,
            "target": "law",
            "type": "JSON",
            "page": page,
            "display": display,
            "sort": sort,
        }

        if query:
            params["query"] = query
        if law_type:
            params["lsClsCd"] = self._get_law_type_code(law_type)
        if is_current:
            params["efYd"] = is_current

        response = await self.client.get(
            f"{self.BASE_URL}/lawSearch.do",
            params=params
        )
        response.raise_for_status()

        return response.json()

    async def get_law_detail(self, mst: str) -> Dict[str, Any]:
        """
        법령 상세 조회 (조문 포함)

        Args:
            mst: 법령 일련번호 (search_laws에서 얻은 MST 값)

        Returns:
            JSON 응답 딕셔너리
        """
        params = {
            "OC": self.api_key,
            "target": "law",
            "type": "JSON",
            "MST": mst,
        }

        response = await self.client.get(
            f"{self.BASE_URL}/lawService.do",
            params=params
        )
        response.raise_for_status()

        return response.json()

    # ==================== 판례 API ====================

    async def search_cases(
        self,
        query: Optional[str] = None,
        court_type: Optional[str] = None,
        case_type: Optional[str] = None,
        page: int = 1,
        display: int = 20,
        sort: str = "선고일자",
        search_type: int = 2,  # 1=판례명만, 2=본문검색 (기본값: 본문검색)
    ) -> Dict[str, Any]:
        """
        판례 목록 검색

        Args:
            query: 검색어
            court_type: 법원 종류 (대법원, 헌법재판소, 각급법원)
            case_type: 사건 종류 (민사, 형사, 행정 등)
            page: 페이지 번호
            display: 한 페이지당 결과 수
            sort: 정렬 기준
            search_type: 검색범위 (1=판례명만, 2=본문검색)

        Returns:
            JSON 응답 딕셔너리
        """
        params = {
            "OC": self.api_key,
            "target": "prec",
            "type": "JSON",
            "page": page,
            "display": display,
            "sort": sort,
            "search": search_type,  # 본문검색 활성화
        }

        if query:
            params["query"] = query
        if court_type:
            params["courtTypeCd"] = self._get_court_type_code(court_type)
        if case_type:
            params["caseTypeCd"] = self._get_case_type_code(case_type)

        response = await self.client.get(
            f"{self.BASE_URL}/lawSearch.do",
            params=params
        )
        response.raise_for_status()

        return response.json()

    async def get_case_detail(self, case_id: str) -> Dict[str, Any]:
        """
        판례 상세 조회

        Args:
            case_id: 판례 일련번호 (search_cases에서 얻은 ID)

        Returns:
            JSON 응답 딕셔너리
        """
        params = {
            "OC": self.api_key,
            "target": "prec",
            "type": "JSON",
            "ID": case_id,
        }

        response = await self.client.get(
            f"{self.BASE_URL}/lawService.do",
            params=params
        )
        response.raise_for_status()

        return response.json()

    # ==================== 조문 조회 ====================

    async def get_article(
        self,
        law_name: str,
        article_number: str,
    ) -> Optional[Dict[str, Any]]:
        """
        특정 조문 조회 (법령명 + 조문번호)

        1. 법령명으로 검색하여 MST(법령 일련번호) 획득
        2. 법령 상세 조회하여 조문 목록에서 해당 조문 찾기

        Args:
            law_name: 법령명 (예: "형법", "민법")
            article_number: 조문번호 (예: "307", "750", "70의2")

        Returns:
            조문 정보 딕셔너리 또는 None
        """
        import re

        try:
            # 법령명 정제: 장(章) 정보 제거
            # 예: "노동조합 및 노동관계조정법 제4장 쟁의행위" → "노동조합 및 노동관계조정법"
            law_name_clean = re.sub(r'\s*제\d+장[^제]*$', '', law_name).strip()
            if law_name_clean != law_name:
                print(f"법령명 정제: {law_name} → {law_name_clean}")
                law_name = law_name_clean
            # 1. 법령명으로 검색
            search_result = await self.search_laws(query=law_name, display=10)

            law_list = search_result.get("LawSearch", {}).get("law", [])
            if not law_list:
                print(f"법령 검색 결과 없음: {law_name}")
                return None

            # 단일 결과인 경우 리스트로 변환
            if isinstance(law_list, dict):
                law_list = [law_list]

            # 정확히 일치하는 법령 찾기
            mst = None
            matched_law_name = None
            for law in law_list:
                name = law.get("법령명한글", "")
                # 정확히 일치하거나 검색어가 법령명에 포함된 경우
                if name == law_name or law_name in name or name in law_name:
                    mst = law.get("법령일련번호")
                    matched_law_name = name
                    print(f"법령 매칭: {law_name} → {matched_law_name}")
                    break

            if not mst:
                # 정확한 매칭 실패 시 첫 번째 결과 사용
                mst = law_list[0].get("법령일련번호")
                matched_law_name = law_list[0].get("법령명한글", law_name)
                print(f"법령 매칭 (폴백): {law_name} → {matched_law_name}")

            # 2. 법령 상세 조회
            detail_result = await self.get_law_detail(mst=mst)
            law_service = detail_result.get("법령", {})

            if not law_service:
                print(f"법령 상세 조회 실패: {matched_law_name}")
                return None

            # 조문 목록 추출
            articles = law_service.get("조문", {}).get("조문단위", [])
            if isinstance(articles, dict):
                articles = [articles]

            # 조문번호 정규화: "제70조의2" → ("70", "2"), "제307조" → ("307", None)
            target_match = re.match(r"제?(\d+)(?:조)?(?:의(\d+))?", str(article_number))
            if target_match:
                target_base = target_match.group(1)
                target_sub = target_match.group(2)  # "의X"가 있으면 X, 없으면 None
            else:
                target_base = re.sub(r"[^0-9]", "", str(article_number))
                target_sub = None

            print(f"찾는 조문: 제{target_base}조" + (f"의{target_sub}" if target_sub else ""))

            # 해당 조문 찾기
            for article in articles:
                jo_num_raw = str(article.get("조문번호", ""))

                # API 응답의 조문번호 파싱
                jo_match = re.match(r"제?(\d+)(?:조)?(?:의(\d+))?", jo_num_raw)
                if jo_match:
                    jo_base = jo_match.group(1)
                    jo_sub = jo_match.group(2)
                else:
                    jo_base = re.sub(r"[^0-9]", "", jo_num_raw)
                    jo_sub = None

                # 정확한 매칭: 기본 번호와 "의X" 모두 일치해야 함
                if jo_base == target_base and jo_sub == target_sub:
                    # 조문 내용 구성
                    content_parts = []

                    # 조문 제목
                    jo_title = article.get("조문제목", "")

                    # 조문 내용
                    jo_content = article.get("조문내용", "")
                    if jo_content:
                        content_parts.append(jo_content)

                    # 항 내용
                    hangs = article.get("항", [])
                    if isinstance(hangs, dict):
                        hangs = [hangs]

                    for hang in hangs:
                        hang_content = hang.get("항내용", "")
                        if hang_content:
                            content_parts.append(hang_content)

                    full_content = "\n".join(content_parts)

                    result_article_num = f"{target_base}의{target_sub}" if target_sub else target_base
                    print(f"조문 찾음: {matched_law_name} 제{result_article_num}조 ({jo_title})")

                    return {
                        "law_name": matched_law_name,
                        "article_number": result_article_num,
                        "article_title": jo_title,
                        "content": full_content,
                    }

            print(f"조문 없음: {matched_law_name} 제{target_base}조" + (f"의{target_sub}" if target_sub else ""))
            return None

        except Exception as e:
            print(f"조문 조회 API 오류: {e}")
            import traceback
            traceback.print_exc()
            return None

    # ==================== 코드 변환 헬퍼 ====================

    def _get_law_type_code(self, law_type: str) -> str:
        """법령 종류를 API 코드로 변환"""
        type_map = {
            "헌법": "010000",
            "법률": "020000",
            "대통령령": "030000",
            "총리령": "040000",
            "부령": "050000",
            "국회규칙": "060100",
            "대법원규칙": "060200",
            "헌법재판소규칙": "060300",
            "중앙선거관리위원회규칙": "060400",
            "조약": "100000",
        }
        return type_map.get(law_type, "")

    def _get_court_type_code(self, court_type: str) -> str:
        """법원 종류를 API 코드로 변환"""
        type_map = {
            "대법원": "400201",
            "헌법재판소": "400202",
            "각급법원": "400203",
        }
        return type_map.get(court_type, "")

    def _get_case_type_code(self, case_type: str) -> str:
        """사건 종류를 API 코드로 변환"""
        type_map = {
            "민사": "010001",
            "형사": "010002",
            "행정": "010003",
            "가사": "010004",
            "특허": "010005",
        }
        return type_map.get(case_type, "")


# ==================== 사용 예시 ====================

async def example_usage():
    """API 사용 예시"""
    import json

    async with LawAPIClient() as client:
        # 법령 검색
        print("=== 민법 검색 ===")
        result = await client.search_laws(query="민법", law_type="법률", display=3)
        print(json.dumps(result, indent=2, ensure_ascii=False))

        # 판례 검색
        print("\n=== 대법원 판례 검색 ===")
        cases = await client.search_cases(court_type="대법원", display=3)
        print(json.dumps(cases, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    import asyncio
    asyncio.run(example_usage())
