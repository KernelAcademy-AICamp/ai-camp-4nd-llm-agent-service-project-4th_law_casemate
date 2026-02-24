"""
채팅 오케스트레이터 서비스
- 의도 분류 결과에 따라 적절한 에이전트를 호출
- 응답을 통합 포맷으로 변환
"""

import os
import json
import logging
from typing import Optional, List
from dataclasses import dataclass
from openai import AsyncOpenAI

from app.prompts.chat_intent_prompt import (
    CHAT_INTENT_SYSTEM_PROMPT,
    CHAT_INTENT_USER_PROMPT,
)
from app.prompts.rag_prompt import (
    RAG_SYSTEM_PROMPT,
    RAG_USER_PROMPT,
    NO_RESULT_RESPONSE,
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# OpenAI 클라이언트 (lazy loading)
_openai_client = None


def get_openai_client():
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _openai_client


# ==================== 데이터 클래스 ====================

@dataclass
class ChatContext:
    """채팅 맥락 정보"""
    current_page: str = "/"
    case_id: Optional[int] = None
    precedent_id: Optional[str] = None
    conversation_id: Optional[str] = None


@dataclass
class IntentResult:
    """의도 분류 결과"""
    intent: str
    confidence: float
    slots: dict
    requires_case_context: bool
    requires_precedent_context: bool
    action_type: str  # navigate, execute, search, ask


@dataclass
class ChatCard:
    """리치 카드 데이터"""
    type: str  # precedent, case, document, law
    data: dict


@dataclass
class ChatAction:
    """프론트엔드 액션"""
    type: str  # navigate, show_card, confirm
    url: Optional[str] = None
    data: Optional[dict] = None


@dataclass
class ChatResponse:
    """통합 채팅 응답"""
    response: str
    intent: str
    action: Optional[ChatAction] = None
    cards: Optional[List[ChatCard]] = None
    suggestions: Optional[List[str]] = None


# ==================== 오케스트레이터 서비스 ====================

class ChatOrchestratorService:
    """
    채팅 메시지를 처리하고 적절한 에이전트로 라우팅
    """

    def __init__(self, db):
        self.db = db
        self.rag_service = RAGService()

    async def process_message(
        self,
        message: str,
        context: ChatContext,
        user_id: int
    ) -> ChatResponse:
        """
        메시지 처리 메인 로직

        1. 의도 분류
        2. 맥락 검증
        3. 에이전트 라우팅
        4. 응답 생성
        """
        # 1. 의도 분류
        intent_result = await self._classify_intent(message, context)
        logger.info(f"[Chat] 의도 분류 결과: {intent_result.intent} (confidence: {intent_result.confidence}), slots: {intent_result.slots}")

        # 1-1. 후처리 보정: 슬롯 기반 의도 교정
        intent_result = self._correct_intent(intent_result, message)

        # 2. 맥락 검증 - 필요한 맥락이 없으면 clarification
        # 단, case_title 슬롯이 있거나 특정 의도는 사건명으로 직접 검색하므로 예외
        skip_intents = ("case_navigate", "my_case_search", "case_analyze", "document_generate", "general_question")
        has_case_title = intent_result.slots.get("case_title")
        skip_case_context_check = intent_result.intent in skip_intents or has_case_title
        if intent_result.requires_case_context and not context.case_id and not skip_case_context_check:
            return self._ask_for_case_selection(intent_result, message)

        if intent_result.requires_precedent_context and not context.precedent_id:
            return self._ask_for_precedent_selection(intent_result, message)

        # 3. 에이전트 라우팅
        intent = intent_result.intent
        if intent == "case_analyze":
            return await self._handle_case_analyze(context, intent_result.slots, user_id)
        elif intent == "precedent_search":
            return await self._handle_precedent_search(intent_result.slots, context, user_id)
        elif intent == "precedent_compare":
            return await self._handle_precedent_compare(context, intent_result.slots, user_id)
        elif intent == "document_generate":
            return await self._handle_document_generate(context, intent_result.slots, user_id)
        elif intent == "law_search":
            return await self._handle_law_search(context, intent_result.slots, user_id, message)
        elif intent == "timeline_generate":
            return await self._handle_timeline_generate(context, intent_result.slots, user_id)
        elif intent == "relationship_generate":
            return await self._handle_relationship_generate(context, intent_result.slots, user_id)
        elif intent == "case_navigate":
            return await self._handle_case_navigate(intent_result.slots, user_id)
        elif intent == "case_create":
            return self._handle_case_create()
        elif intent == "case_list":
            return self._handle_case_list()
        elif intent == "my_case_search":
            return await self._handle_my_case_search(intent_result.slots, user_id)
        elif intent == "clarification_needed":
            return self._handle_clarification(message)
        else:
            # 의도 분류에서 추출한 keyword를 RAG에 전달
            keyword = intent_result.slots.get("keyword")
            return await self._handle_general_question(message, context, keyword)

    # ==================== 의도 분류 ====================

    async def _classify_intent(self, message: str, context: ChatContext) -> IntentResult:
        """LLM을 사용한 의도 분류"""
        try:
            user_prompt = CHAT_INTENT_USER_PROMPT.format(
                message=message,
                case_id=context.case_id or "없음",
                precedent_id=context.precedent_id or "없음"
            )

            client = get_openai_client()
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": CHAT_INTENT_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0,
                response_format={"type": "json_object"}
            )

            result = json.loads(response.choices[0].message.content)

            return IntentResult(
                intent=result.get("intent", "general_question"),
                confidence=result.get("confidence", 0.5),
                slots=result.get("slots", {}),
                requires_case_context=result.get("requires_case_context", False),
                requires_precedent_context=result.get("requires_precedent_context", False),
                action_type=result.get("action_type", "execute")
            )

        except Exception as e:
            logger.error(f"[Chat] 의도 분류 실패: {e}")
            return IntentResult(
                intent="general_question",
                confidence=0.5,
                slots={},
                requires_case_context=False,
                requires_precedent_context=False,
                action_type="execute"
            )

    # ==================== 에이전트 핸들러 ====================

    async def _handle_case_analyze(
        self,
        context: ChatContext,
        slots: dict,
        user_id: int
    ) -> ChatResponse:
        """사건 분석 에이전트 호출 - case_title 슬롯이 있으면 사건 검색 후 분석"""
        from sqlalchemy import or_
        from app.models.evidence import Case, CaseAnalysis
        from app.models.user import User

        case_title = slots.get("case_title")
        target_case_id = context.case_id

        # case_title 슬롯이 있으면 사건 검색
        if case_title:
            user = self.db.query(User).filter(User.id == user_id).first()
            firm_filter = Case.law_firm_id == user.firm_id if user else True

            search_term = f"%{case_title}%"
            cases = self.db.query(Case).filter(
                firm_filter,
                Case.availability == 'o',
                or_(
                    Case.title.ilike(search_term),
                    Case.client_name.ilike(search_term),
                    Case.opponent_name.ilike(search_term)
                )
            ).limit(5).all()

            if not cases:
                return ChatResponse(
                    response=f"**{case_title}** 관련 사건을 찾을 수 없습니다.",
                    intent="case_analyze",
                    suggestions=["새 사건 등록하기", "사건 목록 보기"]
                )

            if len(cases) == 1:
                target_case_id = cases[0].id
            else:
                # 여러 개 있으면 선택 요청
                cards = [
                    ChatCard(
                        type="case",
                        data={
                            "id": c.id,
                            "title": c.title,
                            "client_name": c.client_name,
                            "case_type": c.case_type
                        }
                    )
                    for c in cases
                ]
                return ChatResponse(
                    response=f"**{case_title}** 관련 사건이 {len(cases)}건 있어요. 어떤 사건을 분석할까요?",
                    intent="case_analyze",
                    cards=cards
                )

        if not target_case_id:
            return ChatResponse(
                response="분석할 사건을 선택해주세요.",
                intent="case_analyze",
                suggestions=["사건 목록 보여줘"]
            )

        case = self.db.query(Case).filter(Case.id == target_case_id).first()
        if not case:
            return ChatResponse(
                response="사건을 찾을 수 없습니다.",
                intent="case_analyze"
            )

        # 사건 페이지로 이동
        return ChatResponse(
            response=f"**{case.title}** 사건 페이지로 이동할게요.",
            intent="case_analyze",
            action=ChatAction(
                type="navigate",
                url=f"/cases/{target_case_id}"
            ),
            suggestions=["유사 판례 찾아줘", "타임라인 만들어줘", "고소장 작성해줘"]
        )

    async def _handle_precedent_search(
        self,
        slots: dict,
        context: ChatContext,
        user_id: int
    ) -> ChatResponse:
        """판례 검색 - 페이지 이동"""
        keyword = slots.get("keyword", "")

        if not keyword and context.case_id:
            # 키워드 없이 사건 맥락이 있으면 유사 판례 검색
            return ChatResponse(
                response="현재 사건과 유사한 판례를 검색할게요.",
                intent="precedent_search",
                action=ChatAction(
                    type="navigate",
                    url=f"/cases/{context.case_id}/precedents"
                )
            )

        # 키워드 검색 - 판례 검색 페이지로 이동
        return ChatResponse(
            response=f"**{keyword}** 관련 판례를 검색할게요.",
            intent="precedent_search",
            action=ChatAction(
                type="navigate",
                url=f"/precedents?q={keyword}"
            )
        )

    async def _handle_precedent_compare(
        self,
        context: ChatContext,
        slots: dict,
        user_id: int
    ) -> ChatResponse:
        """판례 비교 분석"""
        if not context.precedent_id:
            return ChatResponse(
                response="어떤 판례와 비교할까요? 판례를 선택해주세요.",
                intent="precedent_compare"
            )

        if not context.case_id:
            return ChatResponse(
                response="어떤 사건과 비교할까요? 사건을 선택해주세요.",
                intent="precedent_compare"
            )

        # 비교 분석 페이지로 이동
        return ChatResponse(
            response="판례 비교 분석을 시작할게요.",
            intent="precedent_compare",
            action=ChatAction(
                type="navigate",
                url=f"/cases/{context.case_id}/precedents/{context.precedent_id}/compare"
            )
        )

    async def _handle_document_generate(
        self,
        context: ChatContext,
        slots: dict,
        user_id: int
    ) -> ChatResponse:
        """문서 생성 - case_title 슬롯이 있으면 사건 검색 후 문서 생성"""
        from sqlalchemy import or_
        from app.models.evidence import Case
        from app.models.user import User

        doc_type = slots.get("document_type", "criminal_complaint")
        case_title = slots.get("case_title")

        doc_type_names = {
            "criminal_complaint": "고소장",
            "civil_complaint": "소장",
            "demand_letter": "내용증명"
        }
        doc_name = doc_type_names.get(doc_type, "문서")

        # case_title 슬롯이 있으면 사건 검색
        target_case_id = context.case_id
        case_name = None

        if case_title:
            # 사용자의 firm_id 조회
            user = self.db.query(User).filter(User.id == user_id).first()
            firm_filter = Case.law_firm_id == user.firm_id if user else True

            # 사건 검색
            search_term = f"%{case_title}%"
            cases = self.db.query(Case).filter(
                firm_filter,
                Case.availability == 'o',
                or_(
                    Case.title.ilike(search_term),
                    Case.client_name.ilike(search_term),
                    Case.opponent_name.ilike(search_term)
                )
            ).limit(5).all()

            if not cases:
                return ChatResponse(
                    response=f"**{case_title}** 관련 사건을 찾을 수 없습니다.",
                    intent="document_generate",
                    suggestions=["새 사건 등록하기", "사건 목록 보기"]
                )

            if len(cases) == 1:
                target_case_id = cases[0].id
                case_name = cases[0].title
            else:
                # 여러 개 있으면 선택 요청
                cards = [
                    ChatCard(
                        type="case",
                        data={
                            "id": c.id,
                            "title": c.title,
                            "client_name": c.client_name,
                            "case_type": c.case_type
                        }
                    )
                    for c in cases
                ]
                return ChatResponse(
                    response=f"**{case_title}** 관련 사건이 {len(cases)}건 있어요. 어떤 사건의 {doc_name}을 작성할까요?",
                    intent="document_generate",
                    cards=cards
                )

        if not target_case_id:
            return ChatResponse(
                response=f"{doc_name}을 작성할 사건을 선택해주세요.",
                intent="document_generate",
                suggestions=["사건 목록 보여줘"]
            )

        # 문서 탭으로 이동 + 자동 생성
        response_text = f"**{case_name or '해당 사건'}**의 **{doc_name}** 초안을 생성할게요."

        return ChatResponse(
            response=response_text,
            intent="document_generate",
            action=ChatAction(
                type="navigate",
                url=f"/cases/{target_case_id}?tab=documents&type={doc_type}&autoGenerate=true"
            )
        )

    async def _handle_law_search(
        self,
        context: ChatContext,
        slots: dict,
        user_id: int,
        message: str = ""
    ) -> ChatResponse:
        """법령 검색"""
        import re
        from app.services.search_laws_service import SearchLawsService

        keyword = slots.get("keyword") or ""

        # keyword가 비어있으면 메시지에서 법령+조문 패턴 추출 시도
        if not keyword and message:
            law_pattern = r"(형법|민법|상법|헌법|행정법|민사소송법|형사소송법|.+법)\s*제?(\d+)조?"
            law_match = re.search(law_pattern, message)
            if law_match:
                keyword = f"{law_match.group(1)} 제{law_match.group(2)}조"

        if context.case_id and not keyword:
            # 사건 맥락이 있으면 사건 기반 법령 검색
            return ChatResponse(
                response="현재 사건과 관련된 법조문을 검색할게요.",
                intent="law_search",
                action=ChatAction(
                    type="navigate",
                    url=f"/cases/{context.case_id}?tab=laws"
                )
            )

        # 특정 조문 요청인지 확인 (예: "형법 제307조", "민법 750조")
        article_pattern = r"(.+?)\s*제?(\d+)조?"
        match = re.match(article_pattern, keyword)

        if match:
            law_name = match.group(1).strip()
            article_number = match.group(2)

            try:
                search_service = SearchLawsService()
                result = await search_service.get_article_with_fallback(
                    law_name=law_name,
                    article_number=article_number
                )

                if result:
                    # 조문 내용을 카드로 반환
                    return ChatResponse(
                        response=f"**{law_name} 제{article_number}조**를 찾았어요.",
                        intent="law_search",
                        cards=[
                            ChatCard(
                                type="law",
                                data={
                                    "law_name": result.get("law_name"),
                                    "article_number": result.get("article_number"),
                                    "article_title": result.get("article_title", ""),
                                    "content": result.get("content", ""),
                                    "paragraphs": result.get("paragraphs", [])
                                }
                            )
                        ]
                    )
            except Exception as e:
                logger.warning(f"조문 조회 실패: {law_name} 제{article_number}조 - {e}")

        # 조문을 못 찾으면 검색 페이지로 이동
        return ChatResponse(
            response=f"**{keyword}** 관련 법조문을 검색할게요.",
            intent="law_search",
            action=ChatAction(
                type="navigate",
                url=f"/laws?q={keyword}"
            )
        )

    async def _handle_timeline_generate(
        self,
        context: ChatContext,
        slots: dict,
        user_id: int
    ) -> ChatResponse:
        """타임라인 탭으로 이동"""
        from app.models.evidence import Case

        case_id = await self._resolve_case_id(context, slots, user_id)
        if isinstance(case_id, ChatResponse):
            return case_id  # 에러 응답

        case = self.db.query(Case).filter(Case.id == case_id).first()
        return ChatResponse(
            response=f"**{case.title}** 사건의 타임라인으로 이동할게요.",
            intent="timeline_generate",
            action=ChatAction(
                type="navigate",
                url=f"/cases/{case_id}?tab=timeline"
            )
        )

    async def _handle_relationship_generate(
        self,
        context: ChatContext,
        slots: dict,
        user_id: int
    ) -> ChatResponse:
        """관계도 탭으로 이동"""
        from app.models.evidence import Case

        case_id = await self._resolve_case_id(context, slots, user_id)
        if isinstance(case_id, ChatResponse):
            return case_id  # 에러 응답

        case = self.db.query(Case).filter(Case.id == case_id).first()
        return ChatResponse(
            response=f"**{case.title}** 사건의 관계도로 이동할게요.",
            intent="relationship_generate",
            action=ChatAction(
                type="navigate",
                url=f"/cases/{case_id}?tab=relations"
            )
        )

    async def _handle_case_navigate(
        self,
        slots: dict,
        user_id: int
    ) -> ChatResponse:
        """사건 페이지로 이동"""
        from sqlalchemy import or_
        from app.models.evidence import Case
        from app.models.user import User

        case_title = slots.get("case_title", "")
        target_section = slots.get("target_section", "")

        if not case_title:
            return ChatResponse(
                response="어떤 사건을 확인할까요?",
                intent="case_navigate"
            )

        # 사용자의 firm_id 조회
        user = self.db.query(User).filter(User.id == user_id).first()
        firm_filter = Case.law_firm_id == user.firm_id if user else True

        # 사건 검색 (제목, 의뢰인, 상대방, 설명에서 검색)
        search_term = f"%{case_title}%"
        cases = self.db.query(Case).filter(
            firm_filter,
            or_(
                Case.title.ilike(search_term),
                Case.client_name.ilike(search_term),
                Case.opponent_name.ilike(search_term),
                Case.description.ilike(search_term)
            )
        ).limit(5).all()

        if not cases:
            return ChatResponse(
                response=f"**{case_title}** 관련 사건을 찾을 수 없습니다.",
                intent="case_navigate",
                suggestions=["새 사건 등록하기", "사건 목록 보기"]
            )

        if len(cases) == 1:
            # 하나만 있으면 바로 이동
            case = cases[0]
            url = f"/cases/{case.id}"
            if target_section:
                url += f"?tab={target_section}"

            return ChatResponse(
                response=f"**{case.title}** 사건으로 이동할게요.",
                intent="case_navigate",
                action=ChatAction(type="navigate", url=url)
            )

        # 여러 개 있으면 카드로 표시
        cards = [
            ChatCard(
                type="case",
                data={
                    "id": c.id,
                    "title": c.title,
                    "client_name": c.client_name,
                    "case_type": c.case_type,
                    "created_at": c.created_at.isoformat() if c.created_at else None
                }
            )
            for c in cases
        ]

        return ChatResponse(
            response=f"**{case_title}** 관련 사건이 {len(cases)}건 있어요. 어떤 사건을 확인할까요?",
            intent="case_navigate",
            cards=cards
        )

    def _handle_case_create(self) -> ChatResponse:
        """새 사건 등록 페이지로 이동"""
        return ChatResponse(
            response="새 사건 등록 페이지로 이동할게요.",
            intent="case_create",
            action=ChatAction(
                type="navigate",
                url="/new-case"
            )
        )

    def _handle_case_list(self) -> ChatResponse:
        """사건 목록 페이지로 이동"""
        return ChatResponse(
            response="사건 목록으로 이동할게요.",
            intent="case_list",
            action=ChatAction(
                type="navigate",
                url="/cases"
            )
        )

    async def _handle_my_case_search(
        self,
        slots: dict,
        user_id: int
    ) -> ChatResponse:
        """내 사건 중 검색"""
        from app.models.evidence import Case, CaseAnalysis
        from app.models.user import User

        keyword = slots.get("keyword", "")

        if not keyword:
            return ChatResponse(
                response="어떤 키워드로 검색할까요?",
                intent="my_case_search"
            )

        # 사용자의 firm_id로 사건 검색
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return ChatResponse(
                response="사용자 정보를 찾을 수 없습니다.",
                intent="my_case_search"
            )

        # 제목, 설명, 의뢰인명, 사건유형 + 분석결과(요약, 사실관계, 청구내용, 죄명)에서 검색
        from sqlalchemy import or_
        cases = self.db.query(Case).outerjoin(
            CaseAnalysis, Case.id == CaseAnalysis.case_id
        ).filter(
            Case.law_firm_id == user.firm_id,
            or_(
                # Case 테이블
                Case.title.ilike(f"%{keyword}%"),
                Case.description.ilike(f"%{keyword}%"),
                Case.client_name.ilike(f"%{keyword}%"),
                Case.case_type.ilike(f"%{keyword}%"),
                # CaseAnalysis 테이블
                CaseAnalysis.summary.ilike(f"%{keyword}%"),
                CaseAnalysis.facts.ilike(f"%{keyword}%"),
                CaseAnalysis.claims.ilike(f"%{keyword}%"),
                CaseAnalysis.crime_names.ilike(f"%{keyword}%")
            )
        ).order_by(Case.incident_date.desc().nullslast()).limit(10).all()

        if not cases:
            return ChatResponse(
                response=f"**{keyword}** 관련 수임 사건을 찾을 수 없습니다.",
                intent="my_case_search",
                suggestions=["다른 키워드로 검색해볼까요?"]
            )

        cards = [
            ChatCard(
                type="case",
                data={
                    "id": c.id,
                    "title": c.title,
                    "client_name": c.client_name,
                    "case_type": c.case_type,
                    "incident_date": c.incident_date.isoformat() if c.incident_date else None,
                    "created_at": c.created_at.isoformat() if c.created_at else None
                }
            )
            for c in cases
        ]

        return ChatResponse(
            response=f"**{keyword}** 관련 사건 {len(cases)}건을 찾았어요.",
            intent="my_case_search",
            cards=cards
        )

    async def _handle_general_question(
        self,
        message: str,
        context: ChatContext,
        intent_keyword: str = None
    ) -> ChatResponse:
        """
        일반 법률 질문 처리 (Grounded RAG with RAGService)

        1. RAGService로 판례/법령 병렬 검색
        2. 검색 결과 기반 답변 생성
        3. 인용된 출처만 카드로 필터링
        """
        try:
            # 1. RAGService로 병렬 검색 (키워드 우선, 없으면 전체 메시지)
            rag_context = await self.rag_service.retrieve(
                query=message,
                keyword=intent_keyword,
                sources=["precedent", "law"],
                precedent_limit=5,
                law_limit=3
            )

            # 2. 검색 결과가 없으면 안내 메시지 반환
            context_text = rag_context.to_string()
            if not context_text.strip():
                return ChatResponse(
                    response=NO_RESULT_RESPONSE,
                    intent="general_question",
                    suggestions=["판례 검색해줘", "사건 분석해줘", "법조문 검색해줘"]
                )

            # 3. Grounded RAG: 검색 결과만 사용해서 답변 생성
            client = get_openai_client()
            user_prompt = RAG_USER_PROMPT.format(
                context=context_text,
                question=message
            )
            logger.info(f"[RAG] 컨텍스트 미리보기: {context_text[:300]}...")

            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": RAG_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,
                max_tokens=800
            )

            answer = response.choices[0].message.content
            logger.info(f"[RAG] LLM 응답: {answer[:100]}...")

            # 4. LLM이 인용한 출처만 필터링
            filtered_sources = self.rag_service.filter_sources_by_citation(answer, rag_context)

            # 5. RAGContext의 카드 변환 (필터링된 소스로)
            from app.services.rag_service import RAGContext
            filtered_context = RAGContext(sources=filtered_sources, query=message)
            cards_data = filtered_context.to_cards()

            # ChatCard로 변환
            filtered_cards = [
                ChatCard(type=card["type"], data=card["data"])
                for card in cards_data
            ]
            logger.info(f"[RAG] 카드 필터링: {len(rag_context.sources)}개 → {len(filtered_cards)}개")

            return ChatResponse(
                response=answer,
                intent="general_question",
                cards=filtered_cards if filtered_cards else None,
                suggestions=["더 자세히 알려줘", "관련 판례 찾아줘"]
            )

        except Exception as e:
            logger.error(f"[RAG] 일반 질문 처리 실패: {e}")
            return ChatResponse(
                response="죄송합니다. 답변을 생성하지 못했어요. 다시 시도해주세요.",
                intent="general_question"
            )

    def _handle_clarification(self, message: str) -> ChatResponse:
        """추가 정보 요청"""
        return ChatResponse(
            response="좀 더 구체적으로 말씀해주시겠어요? 어떤 사건에 대해 알고 싶으신가요?",
            intent="clarification_needed",
            suggestions=["사건 목록 보여줘", "최근 사건 확인할게"]
        )

    def _ask_for_case_selection(self, intent_result: IntentResult, message: str) -> ChatResponse:
        """사건 선택 요청"""
        return ChatResponse(
            response="어떤 사건에 대해 작업할까요? 사건을 선택하거나 사건명을 말씀해주세요.",
            intent=intent_result.intent,
            suggestions=["최근 사건", "사건 목록 보여줘"]
        )

    def _ask_for_precedent_selection(self, intent_result: IntentResult, message: str) -> ChatResponse:
        """판례 선택 요청"""
        return ChatResponse(
            response="어떤 판례를 선택할까요? 판례 검색 페이지에서 선택해주세요.",
            intent=intent_result.intent,
            action=ChatAction(
                type="navigate",
                url="/precedents"
            )
        )

    # ==================== 헬퍼 함수 ====================

    async def _resolve_case_id(
        self,
        context: ChatContext,
        slots: dict,
        user_id: int
    ):
        """
        context.case_id 또는 slots.case_title로 사건 ID 확인
        반환: case_id (int) 또는 ChatResponse (에러)
        """
        from sqlalchemy import or_
        from app.models.evidence import Case
        from app.models.user import User

        # 1. context에 case_id가 있으면 사용
        if context.case_id:
            return context.case_id

        # 2. slots에서 case_title로 검색
        case_title = slots.get("case_title")
        if not case_title:
            return ChatResponse(
                response="어떤 사건을 확인할까요?",
                intent="clarification_needed",
                suggestions=["사건 목록 보기"]
            )

        # 사용자의 firm_id 조회
        user = self.db.query(User).filter(User.id == user_id).first()
        firm_filter = Case.law_firm_id == user.firm_id if user else True

        # 사건 검색
        search_term = f"%{case_title}%"
        cases = self.db.query(Case).filter(
            firm_filter,
            Case.availability == 'o',
            or_(
                Case.title.ilike(search_term),
                Case.client_name.ilike(search_term),
                Case.opponent_name.ilike(search_term)
            )
        ).limit(5).all()

        if not cases:
            return ChatResponse(
                response=f"**{case_title}** 관련 사건을 찾을 수 없습니다.",
                intent="clarification_needed",
                suggestions=["새 사건 등록하기", "사건 목록 보기"]
            )

        if len(cases) == 1:
            return cases[0].id

        # 여러 개 있으면 선택 요청
        cards = [
            ChatCard(
                type="case",
                data={
                    "id": c.id,
                    "title": c.title,
                    "client_name": c.client_name,
                    "case_type": c.case_type
                }
            )
            for c in cases
        ]
        return ChatResponse(
            response=f"**{case_title}** 관련 사건이 {len(cases)}건 있어요. 어떤 사건을 확인할까요?",
            intent="clarification_needed",
            cards=cards
        )

    # ==================== 후처리 검증 ====================

    def _correct_intent(self, intent_result: IntentResult, message: str) -> IntentResult:
        """
        슬롯 및 메시지 기반 의도 검증
        LLM 분류 결과를 존중하되, clarification_needed인 경우에만 복구 시도

        우선순위 원칙:
        1. 문서 생성 키워드 (작성, 만들어, 고소장, 소장) → document_generate 유지
        2. 분석 키워드 (분석, 요약, 쟁점) → case_analyze 유지
        3. 검색 키워드 (찾아, 검색) → precedent_search/law_search 유지
        4. 이동 키워드 (열어, 보여, 이동, 가줘) → case_navigate
        """
        original_intent = intent_result.intent
        msg_lower = message.lower()

        # 행위 키워드 정의 (우선순위 순)
        document_keywords = ["작성", "만들어", "초안", "고소장", "소장", "내용증명"]
        analyze_keywords = ["분석", "요약", "쟁점", "정리해"]
        search_keywords = ["찾아", "검색"]
        navigate_keywords = ["열어", "보여", "이동", "가줘", "확인할게"]

        # 규칙 1: clarification_needed인 경우에만 복구 시도
        if intent_result.intent == "clarification_needed":
            # 문서 생성 키워드 확인
            if any(kw in msg_lower for kw in document_keywords):
                intent_result.intent = "document_generate"
                intent_result.action_type = "execute"
                logger.info(f"[Chat] 의도 복구: {original_intent} → document_generate")
            # 분석 키워드 확인
            elif any(kw in msg_lower for kw in analyze_keywords):
                intent_result.intent = "case_analyze"
                intent_result.action_type = "execute"
                logger.info(f"[Chat] 의도 복구: {original_intent} → case_analyze")
            # 검색 키워드 확인
            elif any(kw in msg_lower for kw in search_keywords):
                if "판례" in msg_lower or "판결" in msg_lower:
                    intent_result.intent = "precedent_search"
                else:
                    intent_result.intent = "law_search"
                intent_result.action_type = "search"
                logger.info(f"[Chat] 의도 복구: {original_intent} → {intent_result.intent}")
            # 이동 키워드 확인
            elif any(kw in msg_lower for kw in navigate_keywords):
                intent_result.intent = "case_navigate"
                intent_result.action_type = "navigate"
                logger.info(f"[Chat] 의도 복구: {original_intent} → case_navigate")
            # 타임라인/관계도
            elif "타임라인" in msg_lower or "시간순" in msg_lower:
                intent_result.intent = "timeline_generate"
                intent_result.action_type = "execute"
                logger.info(f"[Chat] 의도 복구: {original_intent} → timeline_generate")
            elif "관계도" in msg_lower or "인물 관계" in msg_lower:
                intent_result.intent = "relationship_generate"
                intent_result.action_type = "execute"
                logger.info(f"[Chat] 의도 복구: {original_intent} → relationship_generate")

        # 규칙 2: case_title 슬롯이 없으면 메시지에서 직접 파싱 시도
        if not intent_result.slots.get("case_title"):
            import re
            # "홍길동 사건", "이다희 건" 등의 패턴 매칭
            case_pattern = re.search(r'(.+?)\s*(사건|건)\s', message)
            if case_pattern:
                extracted_title = case_pattern.group(1).strip()
                # 너무 긴 경우 (문장 전체가 매칭된 경우) 제외
                if len(extracted_title) <= 20:
                    intent_result.slots["case_title"] = extracted_title
                    logger.info(f"[Chat] case_title 슬롯 추출: '{extracted_title}'")

        # 규칙 3: case_title 슬롯이 있으면 requires_case_context를 false로 (검색으로 해결)
        if intent_result.slots.get("case_title"):
            if intent_result.requires_case_context:
                intent_result.requires_case_context = False
                logger.info(f"[Chat] case_title 슬롯 존재 → requires_case_context = False")

        return intent_result
