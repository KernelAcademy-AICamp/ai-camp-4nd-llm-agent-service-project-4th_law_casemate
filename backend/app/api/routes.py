from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.services.llm_service import LLMService
from app.models.user import User
from tool.database import SessionLocal

router = APIRouter()
llm_service = LLMService()

# DB 세션 의존성
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None

class ChatResponse(BaseModel):
    response: str
    conversation_id: str

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str | None = None

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    message: str
    user_id: int | None = None
    email: str | None = None

# @router.post("/signup", response_model=AuthResponse)
# async def signup(request: SignupRequest, db: Session = Depends(get_db)):
#     """
#     회원가입 엔드포인트
#     """
#     try:
#         # 이메일 중복 확인
#         existing_user = db.query(User).filter(User.email == request.email).first()
#         if existing_user:
#             raise HTTPException(status_code=400, detail="이미 존재하는 이메일입니다")

#         # 새 사용자 생성 (실제로는 비밀번호를 해시해서 저장해야 함)
#         new_user = User(
#             name=request.name,
#             email=request.email,
#             password=request.password,  # TODO: 해시 처리 필요
#             role=request.role
#         )
#         db.add(new_user)
#         db.commit()
#         db.refresh(new_user)

#         return AuthResponse(
#             message="회원가입이 완료되었습니다",
#             user_id=new_user.id,
#             email=new_user.email
#         )
#     except HTTPException:
#         raise
#     except Exception as e:
#         db.rollback()
#         raise HTTPException(status_code=500, detail=str(e))

# @router.post("/login", response_model=AuthResponse)
# async def login(request: LoginRequest, db: Session = Depends(get_db)):
#     """
#     로그인 엔드포인트
#     """
#     try:
#         # 사용자 찾기
#         user = db.query(User).filter(User.email == request.email).first()
#         if not user:
#             raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")

#         # 비밀번호 확인 (실제로는 해시 비교 필요)
#         if user.password != request.password:
#             raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")

#         return AuthResponse(
#             message="로그인 성공",
#             user_id=user.id,
#             email=user.email
#         )
#     except HTTPException:
#         raise
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

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
