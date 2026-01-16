from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.llm_service import LLMService

router = APIRouter()
llm_service = LLMService()

class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None

class ChatResponse(BaseModel):
    response: str
    conversation_id: str

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    LLM과 대화하는 엔드포인트
    """
    try:
        response = await llm_service.generate_response(
            message=request.message,
            conversation_id=request.conversation_id
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """
    대화 기록을 가져오는 엔드포인트
    """
    try:
        conversation = await llm_service.get_conversation(conversation_id)
        return conversation
    except Exception as e:
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다")

@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """
    대화 기록을 삭제하는 엔드포인트
    """
    try:
        await llm_service.delete_conversation(conversation_id)
        return {"message": "대화가 삭제되었습니다"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
