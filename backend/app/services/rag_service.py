"""
RAG 서비스 (Level 2: Multi-Source RAG)
- 판례, 법령 병렬 검색
- 결과 통합 및 리랭킹
- Grounded Generation
"""

import asyncio
import logging
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class RAGSource:
    """검색 결과 소스"""
    type: str  # "precedent" | "law"
    id: str  # case_number 또는 law_name + article_number
    title: str
    content: str
    score: float = 0.0
    metadata: dict = field(default_factory=dict)


@dataclass
class RAGContext:
    """RAG 컨텍스트 (검색 결과 통합)"""
    sources: list[RAGSource] = field(default_factory=list)
    query: str = ""

    def to_string(self) -> str:
        """LLM 프롬프트용 문자열 변환"""
        if not self.sources:
            return ""

        parts = []
        for source in self.sources:
            if source.type == "precedent":
                parts.append(
                    f"[판례] {source.id} ({source.metadata.get('court', '')}, {source.metadata.get('date', '')})\n"
                    f"{source.content[:500]}"
                )
            elif source.type == "law":
                parts.append(
                    f"[법령] {source.metadata.get('law_name', '')} 제{source.metadata.get('article_number', '')}조 ({source.metadata.get('article_title', '')})\n"
                    f"{source.content[:500]}"
                )

        return "\n\n---\n\n".join(parts)

    def to_cards(self) -> list[dict]:
        """프론트엔드 카드 데이터 변환"""
        cards = []
        for source in self.sources:
            if source.type == "precedent":
                # 유사도 점수 정규화 (RRF score는 1.0 초과 가능)
                raw_score = source.score
                normalized_score = min(raw_score / 10.0, 1.0) if raw_score > 1.0 else raw_score

                cards.append({
                    "type": "precedent",
                    "data": {
                        "case_number": source.id,
                        "court": source.metadata.get("court", ""),
                        "date": source.metadata.get("date", ""),
                        "similarity": normalized_score
                    }
                })
            elif source.type == "law":
                cards.append({
                    "type": "law",
                    "data": {
                        "law_name": source.metadata.get("law_name", ""),
                        "article_number": source.metadata.get("article_number", ""),
                        "article_title": source.metadata.get("article_title", ""),
                        "content": source.content
                    }
                })
        return cards


class RAGService:
    """Multi-Source RAG 서비스"""

    def __init__(self):
        self._precedent_service = None
        self._law_service = None

    @property
    def precedent_service(self):
        """Lazy loading for precedent service"""
        if self._precedent_service is None:
            from app.services.precedent_search_service import PrecedentSearchService
            self._precedent_service = PrecedentSearchService()
        return self._precedent_service

    @property
    def law_service(self):
        """Lazy loading for law service"""
        if self._law_service is None:
            from app.services.search_laws_service import SearchLawsService
            self._law_service = SearchLawsService()
        return self._law_service

    async def retrieve(
        self,
        query: str,
        keyword: Optional[str] = None,
        sources: list[str] = None,
        precedent_limit: int = 5,
        law_limit: int = 3
    ) -> RAGContext:
        """
        멀티소스 병렬 검색

        Args:
            query: 원본 질문
            keyword: 검색 키워드 (의도 분류에서 추출)
            sources: 검색할 소스 리스트 ["precedent", "law"]
            precedent_limit: 판례 검색 개수
            law_limit: 법령 검색 개수

        Returns:
            RAGContext: 통합된 검색 결과
        """
        if sources is None:
            sources = ["precedent", "law"]

        # keyword + query 조합으로 검색 (세부 조건도 반영)
        search_query = f"{keyword} {query}" if keyword else query
        logger.info(f"[RAG] 병렬 검색 시작: query='{search_query[:50]}...', sources={sources}")

        # 병렬 검색 태스크 생성
        tasks = []
        task_names = []

        if "precedent" in sources:
            tasks.append(self._search_precedents(search_query, precedent_limit))
            task_names.append("precedent")

        if "law" in sources:
            tasks.append(self._search_laws(search_query, law_limit))
            task_names.append("law")

        # 병렬 실행
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 결과 통합
        all_sources = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"[RAG] {task_names[i]} 검색 실패: {result}")
                continue
            all_sources.extend(result)

        logger.info(f"[RAG] 병렬 검색 완료: {len(all_sources)}건")

        return RAGContext(sources=all_sources, query=query)

    async def _search_precedents(self, query: str, limit: int) -> list[RAGSource]:
        """판례 검색 (동기 함수를 비동기로 래핑)"""
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            lambda: self.precedent_service.search_cases(query=query, limit=limit)
        )

        sources = []
        for p in results.get("results", []):
            content = p.get("content", "") or p.get("case_name", "") or ""
            sources.append(RAGSource(
                type="precedent",
                id=p.get("case_number", ""),
                title=p.get("case_name", ""),
                content=content,
                score=p.get("score", 0),
                metadata={
                    "court": p.get("court_name", ""),
                    "date": p.get("judgment_date", ""),
                }
            ))

        logger.info(f"[RAG] 판례 검색 완료: {len(sources)}건")
        return sources

    async def _search_laws(self, query: str, limit: int) -> list[RAGSource]:
        """법령 검색 (동기 함수를 비동기로 래핑)"""
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            lambda: self.law_service.search_laws(query=query, limit=limit)
        )

        sources = []
        for law in results.get("results", []):
            content = law.get("content", "") or ""
            sources.append(RAGSource(
                type="law",
                id=f"{law.get('law_name', '')} 제{law.get('article_number', '')}조",
                title=law.get("article_title", ""),
                content=content,
                score=law.get("score", 0),
                metadata={
                    "law_name": law.get("law_name", ""),
                    "article_number": law.get("article_number", ""),
                    "article_title": law.get("article_title", ""),
                }
            ))

        logger.info(f"[RAG] 법령 검색 완료: {len(sources)}건")
        return sources

    def get_full_article(self, law_name: str, article_number: str) -> Optional[dict]:
        """전체 조문 내용 조회"""
        try:
            return self.law_service.get_article(law_name, article_number)
        except Exception as e:
            logger.warning(f"[RAG] 조문 조회 실패: {law_name} 제{article_number}조 - {e}")
            return None

    def filter_sources_by_citation(
        self,
        answer: str,
        context: RAGContext
    ) -> list[RAGSource]:
        """
        LLM 응답에서 인용된 출처만 필터링
        같은 조문은 하나로 합쳐서 전체 내용 조회

        Args:
            answer: LLM 응답 텍스트
            context: 검색 결과 컨텍스트

        Returns:
            인용된 출처만 필터링된 소스 리스트
        """
        if not context.sources:
            return []

        filtered = []
        seen_law_articles = set()

        for source in context.sources:
            if source.type == "precedent":
                # 판례: 사건번호로 매칭
                if source.id and source.id in answer:
                    filtered.append(source)

            elif source.type == "law":
                law_name = source.metadata.get("law_name", "")
                article_number = source.metadata.get("article_number", "")

                if law_name and article_number:
                    # 다양한 형식 매칭
                    patterns = [
                        f"{law_name} 제{article_number}조",
                        f"{law_name} {article_number}조",
                        f"제{article_number}조",
                    ]
                    if any(p in answer for p in patterns):
                        article_key = (law_name, article_number)
                        if article_key not in seen_law_articles:
                            seen_law_articles.add(article_key)
                            # 전체 조문 내용 조회
                            full_article = self.get_full_article(law_name, article_number)
                            if full_article:
                                source.content = full_article.get("content", source.content)
                                source.metadata["article_title"] = full_article.get("article_title", source.metadata.get("article_title", ""))
                            filtered.append(source)

        return filtered
