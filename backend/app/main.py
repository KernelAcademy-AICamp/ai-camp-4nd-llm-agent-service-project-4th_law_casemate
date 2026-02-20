import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
    from app.services.precedent_similar_service import is_reranking_enabled, get_reranker_model
    if is_reranking_enabled():
        logger.info("서버 시작: 리랭커 모델 warm-up 중...")
        try:
            get_reranker_model()
            logger.info("리랭커 모델 warm-up 완료")
        except Exception as e:
            logger.warning(f"리랭커 warm-up 실패 (첫 요청 시 로드됨): {e}")
    else:
        logger.info("서버 시작: 리랭킹 비활성 (USE_RERANKING=false)")

    yield

    logger.info("서버 종료")


_debug = os.getenv("DEBUG", "").lower() in ("true", "1", "yes")

app = FastAPI(
    title="CaseMate LLM API",
    description="FastAPI 기반 LLM 서비스",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _debug else None,
    redoc_url="/redoc" if _debug else None,
    openapi_url="/openapi.json" if _debug else None,
)

# CORS 설정
_allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# v1 API 라우터 포함
from app.api.v1 import router as v1_router
app.include_router(v1_router, prefix="/api/v1")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger = logging.getLogger(__name__)
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    debug = os.getenv("DEBUG", "").lower() in ("true", "1", "yes")
    detail = str(exc) if debug else "Internal server error"
    return JSONResponse(status_code=500, content={"detail": detail})

@app.get("/")
async def root():
    return {"message": "CaseMate LLM API에 오신 것을 환영합니다"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if os.getenv("ENABLE_DB_INIT", "false").lower() in ("true", "1", "yes"):
    @app.get("/db-init")
    async def db_init_endpoint():
        try:
            init_db()
            db = SessionLocal()
            db.execute(text("SELECT 1"))
            db.close()
            return {"message": "Database initialized successfully"}
        except Exception as e:
            logger.error(f"DB 초기화 실패: {e}", exc_info=True)
            return {"message": "Database initialization failed"}
