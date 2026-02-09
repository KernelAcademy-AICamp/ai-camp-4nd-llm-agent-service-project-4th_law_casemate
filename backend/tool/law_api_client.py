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
        sort: str = "선고일자"
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
