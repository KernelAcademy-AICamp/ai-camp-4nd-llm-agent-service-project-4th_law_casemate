import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import routes
from app.routers import search

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

# 정적 파일 서빙 (테스트 페이지)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return {"message": "CaseMate LLM API에 오신 것을 환영합니다"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
