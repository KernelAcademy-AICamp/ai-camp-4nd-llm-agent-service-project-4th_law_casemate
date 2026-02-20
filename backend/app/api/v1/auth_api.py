import re
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from app.models.user import User
from tool.database import SessionLocal
from tool.security import get_password_hash, verify_password, create_access_token, get_current_user
from supabase import create_client, Client
from dotenv import load_dotenv
import os
import uuid
import logging

logger = logging.getLogger(__name__)

# 환경변수 로드
load_dotenv()

# Supabase 설정 (Lazy Init - 환경변수 없어도 앱 시작 가능)
_supabase_client: Client | None = None


def _get_supabase() -> Client:
    """Supabase 클라이언트 lazy 초기화 (아바타 업로드용)"""
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise HTTPException(status_code=503, detail="Supabase 설정이 누락되었습니다")
        _supabase_client = create_client(url, key)
    return _supabase_client

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

# 이메일 형식 검증 패턴
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

# 요청/응답 스키마
class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str | None = None
    firm_code: int  # 회사 코드 (필수)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("올바른 이메일 형식이 아닙니다")
        return v.lower().strip()

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("비밀번호는 최소 8자 이상이어야 합니다")
        if not re.search(r"[a-zA-Z]", v):
            raise ValueError("비밀번호에 영문자가 최소 1자 포함되어야 합니다")
        if not re.search(r"\d", v):
            raise ValueError("비밀번호에 숫자가 최소 1자 포함되어야 합니다")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("비밀번호는 72바이트 이하여야 합니다")
        return v

class SignupResponse(BaseModel):
    message: str
    user_id: int | None = None
    email: str | None = None
    access_token: str  # 자동 로그인을 위한 JWT 토큰
    token_type: str

class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("올바른 이메일 형식이 아닙니다")
        return v.lower().strip()

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user_id: int
    email: str

class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: str | None = None
    avatar_url: str | None = None
    firm_id: int | None = None  # 사무실 ID

    class Config:
        from_attributes = True

@router.post("/signup", response_model=SignupResponse)
def signup(request: SignupRequest, db: Session = Depends(get_db)):
    """
    회원가입 엔드포인트 - DB에 사용자 정보 저장
    """

    logger.info("회원가입 요청 수신")

    try:
        # 회사 코드 필수 검증
        if not request.firm_code:
            raise HTTPException(status_code=400, detail="회사 코드를 입력해주세요")

        # 이메일 중복 확인
        existing_user = db.query(User).filter(User.email == request.email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="이미 존재하는 이메일입니다")

        # 비밀번호 해시 처리
        hashed_password = get_password_hash(request.password)

        # 새 사용자 생성 (firm_id에 firm_code 저장)
        new_user = User(
            name=request.name,
            email=request.email,
            password=hashed_password,  # 해시된 비밀번호 저장
            role=request.role,
            firm_id=request.firm_code  # 회사 코드를 firm_id에 저장
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        logger.info(f"사용자 생성 완료: id={new_user.id}")

        # 자동 로그인을 위한 JWT 토큰 생성
        access_token = create_access_token(data={"sub": new_user.email, "user_id": new_user.id})

        return SignupResponse(
            message="회원가입이 완료되었습니다",
            user_id=new_user.id,
            email=new_user.email,
            access_token=access_token,
            token_type="bearer"
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"회원가입 처리 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="회원가입 처리 중 오류가 발생했습니다")

@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """
    로그인 엔드포인트 - 이메일과 비밀번호 검증 후 JWT 토큰 발급
    """

    logger.info("로그인 요청 수신")

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

        logger.info(f"로그인 성공: user_id={user.id}")

        return LoginResponse(
            access_token=access_token,
            token_type="bearer",
            user_id=user.id,
            email=user.email
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"로그인 처리 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="로그인 처리 중 오류가 발생했습니다")

@router.get("/me", response_model=UserOut)
def get_user_info(current_user: User = Depends(get_current_user)):
    """
    현재 로그인한 사용자의 정보를 반환합니다.
    헤더에 유효한 JWT 토큰이 있어야 작동합니다.
    """
    return current_user


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    role: str | None = None


@router.put("/me", response_model=UserOut)
def update_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """프로필 수정 (이름, 직업)"""
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    if request.name is not None:
        user.name = request.name.strip()
    if request.role is not None:
        user.role = request.role
    db.commit()
    db.refresh(user)
    return user


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """프로필 사진 업로드"""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="지원하지 않는 이미지 형식입니다. (JPEG, PNG, WebP만 가능)")

    file_extension = file.filename.split(".")[-1].lower() if file.filename and "." in file.filename else "jpg"
    if file_extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 확장자입니다. (jpg, png, webp만 가능)")
    unique_filename = f"{uuid.uuid4()}.{file_extension}"
    file_path = f"avatars/{current_user.id}/{unique_filename}"

    try:
        file_content = await file.read()

        # 아바타 파일 크기 제한 (5MB)
        if len(file_content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="이미지 크기가 5MB를 초과했습니다")

        sb = _get_supabase()

        # 기존 아바타가 있으면 이전 파일 삭제
        user = db.query(User).filter(User.id == current_user.id).first()
        if user.avatar_url:
            try:
                old_files = sb.storage.from_("Evidences").list(f"avatars/{current_user.id}")
                if old_files:
                    old_paths = [f"avatars/{current_user.id}/{f['name']}" for f in old_files]
                    if old_paths:
                        sb.storage.from_("Evidences").remove(old_paths)
            except Exception:
                pass  # 이전 파일 삭제 실패는 무시

        # Supabase Storage에 업로드
        sb.storage.from_("Evidences").upload(
            path=file_path,
            file=file_content,
            file_options={"content-type": file.content_type}
        )

        # Signed URL 생성 (1년 = 31536000초)
        signed_url_response = sb.storage.from_("Evidences").create_signed_url(file_path, 31536000)

        # supabase-py 버전별 응답 형식 호환
        if isinstance(signed_url_response, dict):
            signed_url = signed_url_response.get("signedURL") or signed_url_response.get("signed_url", "")
        else:
            signed_url = getattr(signed_url_response, "signed_url", "") or getattr(signed_url_response, "signedURL", "")

        if not signed_url:
            logger.error(f"Signed URL 생성 실패: response={signed_url_response}")
            raise HTTPException(status_code=500, detail="프로필 사진 URL 생성에 실패했습니다")

        # DB 업데이트
        user.avatar_url = signed_url
        db.commit()
        db.refresh(user)

        return user

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"아바타 업로드 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="아바타 업로드 중 오류가 발생했습니다")
