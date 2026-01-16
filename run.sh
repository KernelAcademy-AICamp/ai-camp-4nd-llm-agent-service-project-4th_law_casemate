#!/bin/bash

# CaseMate 실행 스크립트

echo "🚀 CaseMate 시작 중..."

# 백엔드 실행
echo "📦 백엔드 서버 시작..."
cd backend
source venv/bin/activate 2>/dev/null || python -m venv venv && source venv/bin/activate
pip install -r requirements.txt > /dev/null 2>&1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# 잠시 대기
sleep 2

# 프론트엔드 실행
echo "🌐 프론트엔드 서버 시작..."
cd frontend
python -m http.server 3000 &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ 서버가 실행되었습니다!"
echo "📍 백엔드: http://localhost:8000"
echo "📍 API 문서: http://localhost:8000/docs"
echo "📍 프론트엔드: http://localhost:3000"
echo ""
echo "종료하려면 Ctrl+C를 누르세요"

# Ctrl+C 처리
trap "echo ''; echo '🛑 서버 종료 중...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT

# 대기
wait
