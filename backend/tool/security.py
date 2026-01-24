from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import jwt
import os
from dotenv import load_dotenv

# .env 파일에서 환경 변수 로드
load_dotenv()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# .env 파일에서 시크릿 키 가져오기
SECRET_KEY = os.getenv("BCRYPT_SECRET", "default-bcrypt-secret-change-this")
ALGORITHM = "HS256"

def get_password_hash(password: str) -> str:
    """비밀번호를 bcrypt로 해시합니다."""
    # bcrypt는 72바이트까지만 처리 가능하므로 명시적으로 제한
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
    return pwd_context.hash(password_bytes.decode('utf-8'))

def verify_password(plain_password, hashed_password):
    """비밀번호를 검증합니다."""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=30) # 토큰 유효 시간
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
