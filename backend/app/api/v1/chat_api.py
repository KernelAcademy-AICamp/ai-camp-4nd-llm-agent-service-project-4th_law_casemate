"""
통합 채팅 API
- POST /api/v1/chat: 채팅 메시지 처리
- 의도 분류 → 에이전트 라우팅 → 응답 반환
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from tool.database import get_db
from tool.security import get_current_user
from app.models.user import User
from app.services.chat_orchestrator_service import (
    ChatOrchestratorService,
    ChatContext,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Chat"])


# ==================== Request/Response 스키마 ====================

class ChatContextRequest(BaseModel):
    """채팅 맥락 정보"""
    current_page: str = "/"
    case_id: Optional[int] = None
    precedent_id: Optional[str] = None
    conversation_id: Optional[str] = None


class ChatRequest(BaseModel):
    """채팅 요청"""
    message: str
    context: Optional[ChatContextRequest] = None


class ChatActionResponse(BaseModel):
    """프론트엔드 액션"""
    type: str  # navigate, show_card, confirm
    url: Optional[str] = None
    data: Optional[dict] = None


class ChatCardResponse(BaseModel):
    """리치 카드"""
    type: str  # precedent, case, document, law
    data: dict


class ChatResponse(BaseModel):
    """채팅 응답"""
    response: str
    intent: str
    action: Optional[ChatActionResponse] = None
    cards: Optional[list[ChatCardResponse]] = None
    suggestions: Optional[list[str]] = None


# ==================== API 엔드포인트 ====================

@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    채팅 메시지 처리

    - 의도 분류 (LLM)
    - 적절한 에이전트로 라우팅
    - 통합 응답 반환

    Response:
    - response: AI 응답 텍스트
    - intent: 분류된 의도
    - action: 프론트엔드 액션 (navigate 등)
    - cards: 리치 카드 데이터 (검색 결과 등)
    - suggestions: 후속 질문 제안
    """
    logger.info(f"[Chat] 메시지 수신: user_id={current_user.id}, message={request.message[:50]}...")

    try:
        # 맥락 변환
        ctx = ChatContext(
            current_page=request.context.current_page if request.context else "/",
            case_id=request.context.case_id if request.context else None,
            precedent_id=request.context.precedent_id if request.context else None,
            conversation_id=request.context.conversation_id if request.context else None,
        )

        # 오케스트레이터 호출
        orchestrator = ChatOrchestratorService(db)
        result = await orchestrator.process_message(
            message=request.message,
            context=ctx,
            user_id=current_user.id
        )

        # 응답 변환
        response = ChatResponse(
            response=result.response,
            intent=result.intent,
            action=ChatActionResponse(
                type=result.action.type,
                url=result.action.url,
                data=result.action.data
            ) if result.action else None,
            cards=[
                ChatCardResponse(type=c.type, data=c.data)
                for c in result.cards
            ] if result.cards else None,
            suggestions=result.suggestions
        )

        logger.info(f"[Chat] 응답 생성 완료: intent={result.intent}, action={result.action}, response={result.response[:50] if result.response else None}...")
        return response

    except Exception as e:
        logger.error(f"[Chat] 처리 실패: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="채팅 처리 중 오류가 발생했습니다."
        )
