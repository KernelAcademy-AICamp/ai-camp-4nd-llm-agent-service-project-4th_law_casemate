from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.models.user import User
from tool.database import SessionLocal
from tool.security import get_password_hash, verify_password, create_access_token
import schemas, models
from security import get_current_user

router = APIRouter(
    tags=["Authentication"]
)

# DB 세션 의존성
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 요청/응답 스키마
class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str | None = None

class SignupResponse(BaseModel):
    message: str
    user_id: int | None = None
    email: str | None = None

class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user_id: int
    email: str

@router.post("/signup", response_model=SignupResponse)
def signup(request: SignupRequest, db: Session = Depends(get_db)):
    """
    회원가입 엔드포인트 - DB에 사용자 정보 저장
    """

    print("=" * 50)
    print(f"🎉 Signup endpoint called!")
    print(f"Name: {request.name}")
    print(f"Email: {request.email}")
    print(f"Role: {request.role}")
    print("=" * 50)

    try:
        # 이메일 중복 확인
        existing_user = db.query(User).filter(User.email == request.email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="이미 존재하는 이메일입니다")

        # 비밀번호 길이 검증 (bcrypt는 72바이트까지만 처리 가능)
        if len(request.password.encode('utf-8')) > 72:
            raise HTTPException(status_code=400, detail="비밀번호는 72바이트 이하여야 합니다")

        # 비밀번호 해시 처리
        hashed_password = get_password_hash(request.password)

        # 새 사용자 생성
        new_user = User(
            name=request.name,
            email=request.email,
            password=hashed_password,  # 해시된 비밀번호 저장
            role=request.role
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        print(f"✅ User created with ID: {new_user.id}")

        return SignupResponse(
            message="회원가입이 완료되었습니다",
            user_id=new_user.id,
            email=new_user.email
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """
    로그인 엔드포인트 - 이메일과 비밀번호 검증 후 JWT 토큰 발급
    """

    print("=" * 50)
    print(f"🔐 Login endpoint called!")
    print(f"Email: {request.email}")
    print("=" * 50)

    try:
        # 사용자 찾기
        user = db.query(User).filter(User.email == request.email).first()
        if not user:
            raise HTTPException(
                status_code=401,
                detail="이메일 또는 비밀번호가 올바르지 않습니다"
            )

        # 비밀번호 검증
        if not verify_password(request.password, user.password):
            raise HTTPException(
                status_code=401,
                detail="이메일 또는 비밀번호가 올바르지 않습니다"
            )

        # JWT 토큰 생성
        access_token = create_access_token(data={"sub": user.email, "user_id": user.id})

        print(f"✅ Login successful for user ID: {user.id}")

        return LoginResponse(
            access_token=access_token,
            token_type="bearer",
            user_id=user.id,
            email=user.email
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Login Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/me", response_model=schemas.UserOut)
def get_user_info(current_user: models.User = Depends(get_current_user)):
    """
    현재 로그인한 사용자의 정보를 반환합니다.
    헤더에 유효한 JWT 토큰이 있어야 작동합니다.
    """
    return current_user
