from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from dotenv import load_dotenv

load_dotenv()

# 환경 변수에서 DB 주소 가져오기
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# DB 엔진 생성
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# DB 세션 가져오는 함수
def get_db():
    db = SessionLocal()
    try:
        yield db
        print("Database session created successfully")
    except Exception as e:
        print(f"Error creating database session: {e}")
        raise e
    finally:
        db.close()

# DB 테이블 초기화 함수
def init_db():
    """데이터베이스 테이블을 생성합니다."""
    Base.metadata.create_all(bind=engine)
