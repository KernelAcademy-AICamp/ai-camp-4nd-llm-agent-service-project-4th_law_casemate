import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import routes
from app.routers import search
from tool.database import SessionLocal, init_db
from sqlalchemy import text
from app.models.user import User  # User 모델 import

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

app = FastAPI(
    title="CaseMate LLM API",
    description="FastAPI 기반 LLM 서비스",
    version="1.0.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 프로덕션에서는 특정 도메인으로 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 라우터 포함
app.include_router(routes.router, prefix="/api")
app.include_router(search.router)  # 검색 API (/api/search)

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
