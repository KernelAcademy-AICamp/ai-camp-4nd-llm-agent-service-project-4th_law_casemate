# CaseMate - LLM 프로젝트

FastAPI 백엔드와 React + TypeScript 프론트엔드를 사용하는 LLM 기반 대화 시스템입니다.

## 📁 프로젝트 구조

```
CaseMate/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI 앱 진입점
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes.py        # API 라우트
│   │   ├── models/              # 데이터 모델
│   │   │   └── __init__.py
│   │   └── services/            # 비즈니스 로직
│   │       ├── __init__.py
│   │       └── llm_service.py   # LLM 서비스
│   ├── requirements.txt         # Python 의존성
│   └── .env.example            # 환경 변수 예제
├── frontend/                    # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx             # 메인 컴포넌트
│   │   ├── App.css             # 스타일시트
│   │   ├── types.ts            # TypeScript 타입 정의
│   │   ├── services/
│   │   │   └── api.ts          # API 서비스
│   │   └── main.tsx            # 진입점
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts          # Vite 설정
├── .gitignore
└── README.md
```

## 🚀 시작하기

### 1. 백엔드 설정

```bash
# 가상환경 생성
cd backend
python -m venv venv

# 가상환경 활성화
# macOS/Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt

# 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 API 키를 설정하세요

# 서버 실행
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. 프론트엔드 실행

```bash
# 프론트엔드 디렉토리로 이동
cd frontend

# 의존성 설치 (처음 한 번만)
npm install

# 개발 서버 실행
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

### 3. 한 번에 실행 (선택사항)

```bash
# 프로젝트 루트에서
./run.sh
```

## 🔧 API 엔드포인트

- `GET /` - API 루트
- `GET /health` - 헬스 체크
- `POST /api/chat` - LLM과 대화
- `GET /api/conversations/{conversation_id}` - 대화 기록 조회
- `DELETE /api/conversations/{conversation_id}` - 대화 기록 삭제

## 📝 LLM 통합

현재 코드는 임시 에코 응답을 반환합니다. 실제 LLM을 사용하려면:

1. `backend/app/services/llm_service.py` 파일 수정
2. 필요한 LLM 라이브러리 주석 해제 (`requirements.txt`)
3. API 키를 `.env` 파일에 설정
4. LLM 호출 코드 구현

### OpenAI 예제

```python
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

response = await client.chat.completions.create(
    model="gpt-4",
    messages=self.conversations[conversation_id]
)
```

## 🛠️ 개발

- 백엔드는 `http://localhost:8000`에서 실행
- 프론트엔드는 `http://localhost:3000`에서 실행 (Vite 개발 서버)
- FastAPI 문서는 `http://localhost:8000/docs`에서 확인 가능

### 프론트엔드 개발

```bash
cd frontend

# 개발 서버 시작 (핫 리로드 지원)
npm run dev

# 프로덕션 빌드
npm run build

# 린트 검사
npm run lint

# 빌드된 앱 미리보기
npm run preview
```

Vite는 다음 기능을 제공합니다:
- ⚡️ 초고속 HMR (Hot Module Replacement)
- 📦 최적화된 프로덕션 빌드
- 🔧 TypeScript 지원
- 🎨 CSS 모듈 및 전처리기 지원

## 📦 의존성

### Backend
- FastAPI - 웹 프레임워크
- Uvicorn - ASGI 서버
- Pydantic - 데이터 검증

### Frontend
- React 19 - UI 라이브러리
- TypeScript - 타입 안전성
- Vite - 빌드 도구 및 개발 서버
- Modern CSS3

## 🔐 보안

- 프로덕션 환경에서는 CORS 설정을 제한하세요
- API 키를 `.env` 파일에 저장하고 절대 커밋하지 마세요
- HTTPS를 사용하세요

## 📄 라이선스

MIT License
