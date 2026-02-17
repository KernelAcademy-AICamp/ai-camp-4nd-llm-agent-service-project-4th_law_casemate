import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from tool.database import SessionLocal, init_db
from sqlalchemy import text
from app.models.user import User  # User 모델 import
from app.models.law_firm import LawFirm  # LawFirm 모델 import
from app.models import evidence  # Evidence 관련 모델들 import
from app.models import case_document  # CaseDocument 모델 import
from app.models.precedent import Precedent, PrecedentSummary  # 판례 원문 모델 import

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작/종료 시 실행되는 lifespan 이벤트"""
    # Startup: 리랭커 모델 warm-up
    logger.info("서버 시작: 리랭커 모델 warm-up 중...")
    try:
        from app.services.precedent_similar_service import get_reranker_model
        get_reranker_model()
        logger.info("리랭커 모델 warm-up 완료")
    except Exception as e:
        logger.warning(f"리랭커 warm-up 실패 (첫 요청 시 로드됨): {e}")

    yield

    logger.info("서버 종료")


app = FastAPI(
    title="CaseMate LLM API",
    description="FastAPI 기반 LLM 서비스",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 프로덕션에서는 특정 도메인으로 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# v1 API 라우터 포함
from app.api.v1 import router as v1_router
app.include_router(v1_router, prefix="/api/v1")

@app.get("/")
async def root():
    return {"message": "CaseMate LLM API에 오신 것을 환영합니다"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/db-init")
async def db_init_endpoint():
    try:
        # 데이터베이스 테이블 생성
        init_db()

        # 연결 테스트
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()

        return {"message": "Database initialized successfully"}
    except Exception as e:
        print(str(e))
        return {"message": f"Database initialization failed: {str(e)}"}
