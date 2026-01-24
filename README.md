# CaseMate - Legal Intelligence Platform

AI 기반 법률 지능 플랫폼 - FastAPI 백엔드와 React + TypeScript 프론트엔드를 사용하는 LLM 기반 법률 서비스입니다.

## 주요 기능

- 🔐 사용자 인증 시스템 (회원가입/로그인)
- 💬 LLM 기반 대화 시스템
- 📄 증거 자동 분석
- 🔍 판례 검색
- 📊 리스크 평가

## 📁 프로젝트 구조

```
CaseMate/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI 앱 진입점
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── routes.py        # API 라우트 (LLM 채팅)
│   │   │   └── v1/              # API v1
│   │   │       ├── __init__.py
│   │   │       └── auth.py      # 인증 API (회원가입)
│   │   ├── models/              # 데이터 모델
│   │   │   ├── __init__.py
│   │   │   └── user.py          # User 모델
│   │   └── services/            # 비즈니스 로직
│   │       ├── __init__.py
│   │       └── llm_service.py   # LLM 서비스
│   ├── tool/
│   │   ├── database.py          # DB 연결 및 세션 관리
│   │   └── security.py          # 비밀번호 해싱 및 JWT 처리
│   ├── requirements.txt         # Python 의존성
│   └── .env                     # 환경 변수 (Git에 커밋하지 않음)
├── frontend/                    # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx             # 메인 컴포넌트
│   │   ├── App.css             # 스타일시트
│   │   ├── types.ts            # TypeScript 타입 정의
│   │   ├── components/
│   │   │   └── legal/
│   │   │       └── auth-page.tsx  # 로그인/회원가입 페이지
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

#### 1-1. Python 환경 설정

```bash
# 백엔드 디렉토리로 이동
cd backend

# 가상환경 생성
python -m venv venv

# 가상환경 활성화
# macOS/Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt
```

#### 1-2. 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 설정하세요:

```bash
# OpenAI API 키 (LLM 사용시)
OPENAI_API_KEY=your_openai_api_key_here

# Pinecone API 키 (벡터 DB 사용시)
PINECONE_API_KEY=your_pinecone_api_key_here

# Supabase 데이터베이스 설정
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# PostgreSQL 데이터베이스 URL (Supabase Transaction Pooler)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-1-ap-south-1.pooler.supabase.com:6543/postgres

# JWT 및 Bcrypt 시크릿 키
JWT_SECRET=your_jwt_secret_key_here
BCRYPT_SECRET=your_bcrypt_secret_key_here
```

#### 1-3. 데이터베이스 초기화

```bash
# FastAPI 서버를 실행한 후, 브라우저에서 다음 URL에 접속하여 테이블 생성
# http://localhost:8000/db-init

# 또는 curl 명령어 사용
curl http://localhost:8000/db-init
```

이 명령은 `users` 테이블을 자동으로 생성합니다.

#### 1-4. 서버 실행

```bash
# 개발 서버 실행 (자동 리로드 활성화)
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

### 기본 엔드포인트
- `GET /` - API 루트
- `GET /health` - 헬스 체크
- `GET /db-init` - 데이터베이스 초기화 (테이블 생성)

### 인증 API (v1)
- `POST /api/v1/signup` - 회원가입
  - Request Body: `{ "name": "string", "email": "string", "password": "string", "role": "string" }`
  - Response: `{ "message": "string", "user_id": int, "email": "string" }`

### LLM 채팅 API
- `POST /api/chat` - LLM과 대화
- `GET /api/conversations/{conversation_id}` - 대화 기록 조회
- `DELETE /api/conversations/{conversation_id}` - 대화 기록 삭제

자세한 API 문서는 서버 실행 후 `http://localhost:8000/docs`에서 확인할 수 있습니다.

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

#### 코어 프레임워크
```bash
pip install fastapi==0.109.0        # 웹 프레임워크
pip install uvicorn[standard]==0.27.0  # ASGI 서버
pip install pydantic==2.5.3         # 데이터 검증
pip install python-dotenv==1.0.0    # 환경 변수 관리
```

#### 데이터베이스
```bash
pip install sqlalchemy==2.0.25      # ORM (Object-Relational Mapping)
pip install psycopg2-binary==2.9.9  # PostgreSQL 어댑터
```

#### 인증 및 보안
```bash
pip install passlib==1.7.4          # 비밀번호 해싱 유틸리티
pip install "bcrypt==4.0.1"         # Bcrypt 해싱 (passlib 1.7.4와 호환)
pip install python-jose[cryptography]==3.3.0  # JWT 토큰 생성 및 검증
```

#### 한 번에 설치
```bash
pip install -r requirements.txt
```

### Frontend
- React 19 - UI 라이브러리
- TypeScript - 타입 안전성
- Vite - 빌드 도구 및 개발 서버
- Radix UI - 접근성 높은 UI 컴포넌트
- Tailwind CSS - 유틸리티 우선 CSS 프레임워크
- Lucide React - 아이콘 라이브러리

## 💾 데이터베이스 스키마

### Users 테이블

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,           -- 자동 증가 ID
    name VARCHAR NOT NULL,           -- 사용자 이름
    email VARCHAR UNIQUE NOT NULL,   -- 이메일 (중복 불가)
    password VARCHAR NOT NULL,       -- 해시된 비밀번호 (bcrypt)
    role VARCHAR,                    -- 직업 (변호사, 법무사 등)
    created_at TIMESTAMP DEFAULT NOW(),      -- 생성 시간
    updated_at TIMESTAMP DEFAULT NOW()       -- 업데이트 시간
);
```

테이블은 `/db-init` 엔드포인트 호출 시 자동으로 생성됩니다.

## 🔐 보안

### 비밀번호 보안
- bcrypt 알고리즘을 사용한 비밀번호 해싱
- 72바이트 길이 제한 (bcrypt 스펙)
- 이메일 중복 검증

### API 보안
- JWT 토큰 기반 인증 준비 (create_access_token 함수 구현됨)
- CORS 설정: 프로덕션에서는 특정 도메인으로 제한 필요
- HTTPS 사용 권장

### 환경 변수 보안
- `.env` 파일에 민감한 정보 저장
- `.gitignore`에 `.env` 추가하여 Git 커밋 방지
- 프로덕션 환경에서는 환경 변수 관리 시스템 사용 권장

## 🔧 트러블슈팅

### bcrypt 버전 호환성 문제
만약 bcrypt 관련 에러가 발생하면:
```bash
# bcrypt 버전을 4.x로 다운그레이드
pip install "bcrypt<5.0"
```

### 데이터베이스 연결 실패
1. `.env` 파일의 `DATABASE_URL`이 올바른지 확인
2. Supabase Project Settings > Database > Connection String 확인
3. Transaction Pooler 사용 (포트 6543)

### CORS 에러
프론트엔드에서 백엔드 API 호출 시 CORS 에러가 발생하면:
- 백엔드가 `http://localhost:8000`에서 실행 중인지 확인
- `backend/app/main.py`의 CORS 설정 확인

### 포트 충돌
포트가 이미 사용 중이면:
```bash
# 백엔드: 다른 포트 사용
uvicorn app.main:app --reload --port 8001

# 프론트엔드: vite.config.ts에서 포트 변경
```

## 📄 라이선스

MIT License
