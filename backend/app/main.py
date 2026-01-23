from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import routes
from tool.database import SessionLocal
from sqlalchemy import text

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

@app.get("/")
async def root():
    return {"message": "CaseMate LLM API에 오신 것을 환영합니다"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/db-init")
async def db_init():
    try:
        # 데이터베이스 연결 테스트
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return {"message": "Database initialized successfully"}
    except Exception as e:
        print(str(e))
        return {"message": f"Database initialization failed: {str(e)}"}
