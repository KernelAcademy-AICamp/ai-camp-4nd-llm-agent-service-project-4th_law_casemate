# CaseMate - Legal Intelligence Platform

AI 기반 법률 지능 플랫폼 - FastAPI 백엔드와 React + TypeScript 프론트엔드를 사용하는 LLM 기반 법률 서비스입니다.

## 주요 기능

- 🔐 사용자 인증 시스템 (회원가입/로그인, JWT 기반)
- 💬 LLM 기반 대화 시스템
- 📄 증거 자동 분석 및 파일 관리
- 📁 증거 파일 업로드 및 Supabase Storage 통합
- 🗂️ 증거 카테고리 관리 (계층 구조 지원)
- 📋 사건(Case) 관리
- ⏱️ **사건 타임라인 관리** (시간순 이벤트 추적, CRUD 지원)
- 🤖 **AI 기반 타임라인 자동 생성** (LLM을 활용한 지능형 이벤트 추출)
- 🔍 판례 검색 (Qdrant 벡터 DB 기반 유사도 검색)
- 📊 리스크 평가
- 🏢 법무법인/사무실(Firm) 기반 데이터 격리
- 🤖 Markdown 렌더링 지원 (LLM 응답 포맷팅)

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
│   │   │       ├── auth_api.py  # 인증 API (회원가입/로그인)
│   │   │       └── evidence_api.py  # 증거 관리 API
│   │   ├── models/              # 데이터 모델
│   │   │   ├── __init__.py
│   │   │   ├── user.py          # User 모델
│   │   │   └── evidence.py      # Evidence, Case, EvidenceCategory 모델
│   │   └── services/            # 비즈니스 로직
│   │       ├── __init__.py
│   │       ├── llm_service.py   # LLM 서비스
│   │       ├── evidence_processor.py  # 증거 파일 처리 (AUDIO/PDF/IMAGE)
│   │       └── stt_service.py   # 음성-텍스트 변환 (Whisper API)
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
│   │   │       ├── auth-page.tsx       # 로그인/회원가입 페이지
│   │   │       ├── main-layout.tsx     # 메인 레이아웃
│   │   │       ├── sidebar.tsx         # 사이드바
│   │   │       └── pages/
│   │   │           ├── home-page.tsx           # 홈 페이지
│   │   │           ├── dashboard-page.tsx      # 대시보드
│   │   │           ├── cases-page.tsx          # 사건 목록
│   │   │           ├── case-detail-page.tsx    # 사건 상세
│   │   │           ├── new-case-page.tsx       # 새 사건 등록
│   │   │           ├── evidence-upload-page.tsx # 증거 업로드
│   │   │           ├── evidence-detail-page.tsx # 증거 상세
│   │   │           ├── precedents-page.tsx     # 판례 검색
│   │   │           └── precedent-detail-page.tsx # 판례 상세
│   │   ├── services/
│   │   │   └── api.ts          # API 서비스
│   │   └── main.tsx            # 진입점
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js      # Tailwind 설정
│   ├── postcss.config.js       # PostCSS 설정
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

# 벡터 DB 설정 (Qdrant)
QDRANT_URL=http://localhost:6333  # Qdrant 서버 URL
QDRANT_API_KEY=your_qdrant_api_key_here  # Qdrant Cloud 사용시

# Supabase 설정
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here  # Storage 업로드용 (RLS 우회)

# PostgreSQL 데이터베이스 URL (Supabase Transaction Pooler)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-1-ap-south-1.pooler.supabase.com:6543/postgres

# JWT 및 Bcrypt 시크릿 키
JWT_SECRET=your_jwt_secret_key_here
BCRYPT_SECRET=your_bcrypt_secret_key_here
```

**중요:** `SUPABASE_SERVICE_ROLE_KEY`는 Supabase Storage에 파일을 업로드할 때 RLS(Row Level Security) 정책을 우회하기 위해 필요합니다. Supabase 대시보드의 Settings > API에서 확인할 수 있습니다.

#### 1-3. 데이터베이스 초기화

```bash
# FastAPI 서버를 실행한 후, 브라우저에서 다음 URL에 접속하여 테이블 생성
# http://localhost:8000/db-init

# 또는 curl 명령어 사용
curl http://localhost:8000/db-init
```

이 명령은 다음 테이블들을 자동으로 생성합니다:
- `users` - 사용자 정보
- `cases` - 사건 정보
- `evidences` - 증거 파일 메타데이터
- `evidence_categories` - 증거 카테고리 (계층 구조)
- `case_evidence_mappings` - 사건-증거 매핑

**참고:** Supabase Storage에 "Evidences" 버킷도 수동으로 생성해야 합니다 (Supabase 대시보드 > Storage).

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
- `POST /api/v1/auth/signup` - 회원가입
  - Request Body: `{ "name": "string", "email": "string", "password": "string", "role": "string", "firm_code": int }`
  - Response: `{ "message": "string", "user_id": int, "email": "string", "access_token": "string", "token_type": "bearer" }`
  - 주의: `firm_code`는 필수 입력 값입니다
- `POST /api/v1/auth/login` - 로그인
  - Request Body: `{ "email": "string", "password": "string" }`
  - Response: `{ "access_token": "string", "token_type": "bearer", "user": {...} }`
- `GET /api/v1/auth/me` - 현재 사용자 정보 (인증 필요)

### 증거 관리 API (v1)
- `POST /api/v1/evidence/upload` - 증거 파일 업로드 (인증 필요)
  - Request: multipart/form-data
  - Parameters: `file`, `case_id` (optional), `category_id` (optional)
  - Response: `{ "evidence_id": int, "file_name": "string", "url": "string" }`
- `GET /api/v1/evidence/list` - 증거 목록 조회 (인증 필요)
  - Query Parameters: `case_id` (optional), `category_id` (optional)
  - Response: `{ "total": int, "files": [...] }`
- `DELETE /api/v1/evidence/delete/{evidence_id}` - 증거 파일 삭제 (인증 필요)
  - Response: `{ "message": "string", "evidence_id": int }`
- `POST /api/v1/evidence/{evidence_id}/link-case/{case_id}` - 증거를 사건에 연결 (인증 필요)
  - Response: `{ "message": "string", "mapping_id": int }`
- `PATCH /api/v1/evidence/{evidence_id}/starred` - 즐겨찾기 토글 (인증 필요)
  - Response: `{ "message": "string", "starred": boolean }`
- `GET /api/v1/evidence/{evidence_id}/url` - Signed URL 생성 (인증 필요)
  - Response: `{ "signed_url": "string", "expires_in": 60 }`

### 카테고리 관리 API (v1)
- `POST /api/v1/evidence/categories` - 카테고리 생성 (인증 필요)
  - Request Body: `{ "name": "string", "parent_id": int | null, "order_index": int }`
  - Response: `{ "category_id": int, "name": "string", "firm_id": int, "parent_id": int | null }`
- `GET /api/v1/evidence/categories` - 카테고리 목록 조회 (인증 필요)
  - Response: `{ "total": int, "categories": [...] }`

### 타임라인 관리 API (v1)
- `GET /api/v1/timeline/{case_id}` - 사건 타임라인 목록 조회 (인증 필요)
  - Response: `[{ "id": "string", "case_id": int, "firm_id": int | null, "date": "YYYY-MM-DD", "time": "HH:MM", "title": "string", "description": "string", "type": "의뢰인|상대방|증거|기타", "actor": "string", "order_index": int }]`
- `POST /api/v1/timeline/{case_id}` - 타임라인 이벤트 추가 (인증 필요)
  - Request Body: `{ "date": "string", "time": "string", "title": "string", "description": "string", "type": "string", "actor": "string", "order_index": int, "firm_id": int | null }`
  - Response: 생성된 타임라인 객체
- `PUT /api/v1/timeline/{timeline_id}` - 타임라인 이벤트 수정 (인증 필요)
  - Request Body: 타임라인 데이터 (POST와 동일, firm_id 포함)
  - Response: 수정된 타임라인 객체
- `DELETE /api/v1/timeline/{timeline_id}` - 타임라인 이벤트 삭제 (인증 필요)
  - Response: `{ "message": "타임라인이 삭제되었습니다" }`
- `POST /api/v1/timeline/{case_id}/generate?use_llm=false&firm_id=1` - AI 자동 생성 (인증 필요)
  - Query Parameters:
    - `use_llm` (boolean, 기본값: false) - LLM 사용 여부
    - `firm_id` (int, 옵션) - 소속 법무법인/사무실 ID
  - Response: 생성된 타임라인 목록

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
pip install python-multipart==0.0.6 # 파일 업로드 처리
```

#### 데이터베이스 및 스토리지
```bash
pip install sqlalchemy==2.0.25      # ORM (Object-Relational Mapping)
pip install psycopg2-binary==2.9.9  # PostgreSQL 어댑터
pip install supabase==2.10.0        # Supabase 클라이언트 (Storage 및 DB)
```

#### 인증 및 보안
```bash
pip install passlib==1.7.4          # 비밀번호 해싱 유틸리티
pip install "bcrypt==4.0.1"         # Bcrypt 해싱 (passlib 1.7.4와 호환)
pip install python-jose[cryptography]==3.3.0  # JWT 토큰 생성 및 검증
```

#### 벡터 DB 및 임베딩
```bash
pip install qdrant-client==1.16.1   # Qdrant 벡터 데이터베이스 클라이언트
pip install fastembed==0.4.2        # 고속 임베딩 라이브러리 (Sparse embedding, BM25)
```

#### LLM 및 문서 처리 라이브러리
```bash
pip install openai==1.10.0          # OpenAI API 클라이언트 (Whisper STT, Vision API)
pip install pymupdf==1.24.14        # PDF 텍스트 추출
pip install easyocr==1.7.2          # 로컬 OCR (한글/영어 지원, Pillow 10 호환)
pip install pillow==10.3.0          # 이미지 처리
pip install httpx==0.27.0           # HTTP 클라이언트
```

**증거 파일 자동 처리 (하이브리드 전략):**

- **AUDIO**: OpenAI Whisper API로 음성을 텍스트로 변환 (ffmpeg 불필요)

- **PDF**:
  1. PyMuPDF로 텍스트 추출 시도 (무료)
  2. 페이지당 20자 미만 → 이미지형 페이지로 판단
  3. 이미지형 페이지만 Vision API로 OCR → 최소 비용

- **IMAGE**:
  1. **EasyOCR 로컬 처리** (무료, 한글/영어 동시 인식)
     - 20자 이상 추출 성공 → 완료 (비용 0원)
  2. 로컬 OCR 실패 시 → **OpenAI Vision API**
     - 개선된 프롬프트: 법률 증거 맥락 명시
     - 카톡, 대화 이미지도 처리 가능
     - 거절 감지 및 에러 처리

**비용 최적화:**
- 텍스트형 PDF: 100% 무료 (PyMuPDF)
- 이미지: 80% 무료 (EasyOCR), 실패 시에만 Vision API
- 이미지형 PDF: 텍스트 페이지는 무료, 이미지 페이지만 유료
- 하이브리드 전략으로 평균 70-90% 비용 절감

**문서 유형 자동 분류 (Vision API):**

- **IMAGE 파일 + Vision API 사용 시**에만 문서 유형 자동 분류
- Vision API(gpt-4o-mini)가 이미지를 직접 보고 텍스트 추출과 동시에 문서 유형 판단
- 지원하는 문서 유형:
  - **카카오톡**: 카카오톡 메시지, 채팅 대화
  - **문자메시지**: SMS, MMS 문자 메시지
  - **계약서**: 계약서, 합의서, 약정서, 동의서
  - **영수증**: 영수증, 세금계산서, 거래명세서, 청구서
  - **법원문서**: 소장, 답변서, 판결문, 결정문, 증거서류, 진술서
  - **신분증**: 신분증, 여권, 운전면허증, 주민등록증
  - **금융문서**: 통장 거래내역, 계좌이체 확인증, 대출 문서
  - **일반문서**: 위 카테고리에 해당하지 않는 일반 문서
  - **기타**: 분류하기 어려운 문서
- 분류 결과는 `doc_type` 컬럼에 자동 저장
- 추출된 텍스트는 `content` 컬럼에 저장하여 검색 및 분석 가능
- 로컬 OCR, PDF 텍스트 추출, 음성 STT의 경우 `doc_type`은 NULL (추후 필요 시 수동 분류 또는 추가 API 호출)

#### 한 번에 설치
```bash
pip install -r requirements.txt
```

### Frontend

#### 핵심 라이브러리
- **React 19** - UI 라이브러리
- **TypeScript** - 타입 안전성
- **Vite** - 빌드 도구 및 개발 서버
- **React Router DOM** - 클라이언트 사이드 라우팅

#### UI 컴포넌트 및 스타일
- **Radix UI** - 접근성 높은 UI 컴포넌트
  - Avatar, Checkbox, Collapsible, Context Menu, Dialog, Dropdown Menu
  - Label, Progress, Scroll Area, Select, Separator, Slot, Tabs, Tooltip
- **Tailwind CSS** - 유틸리티 우선 CSS 프레임워크
- **tailwindcss-animate** - Tailwind 애니메이션 유틸리티
- **Lucide React** - 아이콘 라이브러리

#### 유틸리티
- **class-variance-authority** - CSS 클래스 변형 관리
- **clsx** - 조건부 클래스명 유틸리티
- **tailwind-merge** - Tailwind 클래스 병합

#### Markdown 렌더링
- **react-markdown** - React에서 Markdown 렌더링
- **remark-gfm** - GitHub Flavored Markdown 지원

#### 분석 및 기타
- **@vercel/analytics** - Vercel 애널리틱스
- **Next.js** - (일부 기능 활용)

#### 설치 명령어
```bash
# 전체 의존성 설치
npm install

# Markdown 렌더링 라이브러리 추가 설치
npm install react-markdown remark-gfm
```

## 💾 데이터베이스 스키마

### Users 테이블

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,           -- 자동 증가 ID
    name VARCHAR NOT NULL,           -- 사용자 이름
    email VARCHAR UNIQUE NOT NULL,   -- 이메일 (중복 불가)
    password VARCHAR NOT NULL,       -- 해시된 비밀번호 (bcrypt)
    role VARCHAR,                    -- 직업 (변호사, 법무사 등)
    firm_id INTEGER,                 -- 소속 법무법인/사무실 ID
    created_at TIMESTAMP DEFAULT NOW(),      -- 생성 시간
    updated_at TIMESTAMP DEFAULT NOW()       -- 업데이트 시간
);
```

### Cases 테이블

```sql
CREATE TABLE cases (
    id SERIAL PRIMARY KEY,           -- 자동 증가 ID
    user_id INTEGER,                 -- 담당 변호사/법무사 ID
    title VARCHAR(255) NOT NULL,     -- 사건명
    client_name VARCHAR(100),        -- 의뢰인 이름
    status VARCHAR(50) DEFAULT '접수', -- 사건 상태 (접수, 진행중, 완료 등)
    description TEXT,                -- 사건 설명
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Evidences 테이블

```sql
CREATE TABLE evidences (
    id SERIAL PRIMARY KEY,                    -- 자동 증가 ID
    file_name VARCHAR(255) NOT NULL,          -- 원본 파일명 (한글 지원)
    file_url TEXT NOT NULL,                   -- Signed URL (임시 접근용)
    file_path VARCHAR,                        -- Supabase Storage 내부 경로
    file_type VARCHAR(50),                    -- 파일 타입 (MIME type)
    size BIGINT,                              -- 파일 크기 (바이트)
    starred BOOLEAN DEFAULT false,            -- 중요 표시 (즐겨찾기)
    created_at TIMESTAMP DEFAULT NOW(),       -- 생성 시간
    uploader_id INTEGER,                      -- 업로더 ID
    law_firm_id INTEGER REFERENCES law_firms(id) ON DELETE SET NULL,  -- 소속 법무법인 ID
    case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,           -- 연결된 사건 ID
    category_id INTEGER REFERENCES evidence_categories(id) ON DELETE SET NULL,  -- 카테고리 ID
    content TEXT,                             -- OCR/STT로 추출된 텍스트 내용
    doc_type VARCHAR                          -- 문서 유형 (카카오톡, 계약서, 영수증 등)
);
```

### Evidence_Categories 테이블

```sql
CREATE TABLE evidence_categories (
    id SERIAL PRIMARY KEY,           -- 자동 증가 ID
    firm_id INTEGER,                 -- 소속 법무법인 ID
    parent_id INTEGER REFERENCES evidence_categories(id), -- 부모 카테고리 (계층 구조)
    name VARCHAR(100) NOT NULL,      -- 카테고리명
    order_index INTEGER DEFAULT 0   -- 정렬 순서
);
```

### Case_Evidence_Mappings 테이블

```sql
CREATE TABLE case_evidence_mappings (
    id SERIAL PRIMARY KEY,
    case_id INTEGER,                 -- 사건 ID
    evidence_id INTEGER,             -- 증거 ID
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(case_id, evidence_id)     -- 중복 매핑 방지
);
```

### Evidence_Analyses 테이블 (AI 분석 결과 저장)

```sql
CREATE TABLE evidence_analyses (
    id SERIAL PRIMARY KEY,
    evidence_id INTEGER,                    -- 증거 ID
    summary TEXT,                           -- STT 결과 또는 요약문
    legal_relevance TEXT,                   -- 법적 관련성 분석
    risk_level VARCHAR(20),                 -- 위험 수준 (high, medium, low)
    ai_model VARCHAR(50),                   -- 사용한 AI 모델 (예: openai-whisper)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- **summary**: 오디오 파일의 STT(Speech-to-Text) 변환 결과 또는 문서 요약
- **legal_relevance**: AI가 분석한 법적 관련성 및 중요 포인트
- **risk_level**: AI가 판단한 법적 위험 수준
- **ai_model**: 분석에 사용된 AI 모델명

### Timelines 테이블 (사건 타임라인)

```sql
CREATE TABLE timelines (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    firm_id INTEGER REFERENCES law_firms(id) ON DELETE SET NULL,  -- 소속 법무법인/사무실 ID (멀티테넌트 데이터 격리)
    date VARCHAR(20) NOT NULL,              -- 발생 날짜 (YYYY-MM-DD 또는 "미상")
    time VARCHAR(10) NOT NULL,              -- 발생 시각 (HH:MM)
    title VARCHAR(200) NOT NULL,            -- 타임라인 제목
    description TEXT,                       -- 상세 설명
    type VARCHAR(20) NOT NULL,              -- 타입 (의뢰인, 상대방, 증거, 기타)
    actor VARCHAR(100),                     -- 관련 인물명 또는 증거명
    order_index INTEGER DEFAULT 0,          -- 표시 순서 (낮을수록 먼저 표시)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_timelines_case_id ON timelines(case_id);
CREATE INDEX idx_timelines_firm_id ON timelines(firm_id);
CREATE INDEX idx_timelines_date ON timelines(date);
CREATE INDEX idx_timelines_order_index ON timelines(order_index);
```

- **case_id**: 연결된 사건 ID (외래키, CASCADE 삭제)
- **firm_id**: 소속 법무법인/사무실 ID (멀티테넌트 데이터 격리, 외래키, SET NULL 삭제)
- **date**: 이벤트 발생 날짜 (YYYY-MM-DD 형식, 날짜 미상인 경우 "미상")
- **time**: 이벤트 발생 시각 (HH:MM 형식, 24시간 표기)
- **title**: 타임라인 이벤트 제목 (예: "단톡방 첫 비방 발언")
- **description**: 이벤트에 대한 상세 설명
- **type**: 이벤트 타입
  - **의뢰인**: 의뢰인(피해자)이 취한 행동
  - **상대방**: 상대방(피고소인/가해자)의 행동
  - **증거**: 증거 확보/발견 관련
  - **기타**: 법률 상담, 소송 제기 등 기타 사건
- **actor**: 관련 인물명 또는 증거명 (예: "박OO (피고소인)", "카카오톡 대화 캡처본")
- **order_index**: 동일 날짜/시간 내 이벤트의 정렬 순서

**타임라인 자동 생성 (AI 활용 가능):**

- LLM을 사용하여 사건 개요, 사실관계, 증거 목록에서 시간순 이벤트 자동 추출
- 날짜/시간 정보를 자연어에서 파싱하여 구조화
- 이벤트 타입 자동 분류 (의뢰인/상대방/증거/기타)
- 사용자가 직접 타임라인 이벤트 추가/수정/삭제 가능 (CRUD)

**멀티테넌트 데이터 격리:**

- `firm_id` 필드를 통한 법무법인/사무실별 타임라인 데이터 격리
- Evidence 모델과 동일한 패턴으로 `case_id`와 `firm_id` 모두 포함
- 같은 법무법인 소속만 타임라인 데이터 접근 가능 (추후 인증 로직 구현 시)

테이블은 `/db-init` 엔드포인트 호출 시 자동으로 생성되며, SQL 파일은 `backend/sql/create_timelines_table.sql`에서 확인할 수 있습니다.

## 🔐 보안

### 비밀번호 보안
- bcrypt 알고리즘을 사용한 비밀번호 해싱
- 72바이트 길이 제한 (bcrypt 스펙)
- 이메일 중복 검증

### API 보안
- JWT 토큰 기반 인증 (Bearer Token)
- `@Depends(get_current_user)` 데코레이터로 보호된 엔드포인트
- CORS 설정: 프로덕션에서는 특정 도메인으로 제한 필요
- HTTPS 사용 권장

### 데이터 격리 (Multi-tenancy)
- **Firm 기반 데이터 분리**: 각 법무법인(firm_id)별로 데이터 격리
- **증거 파일 접근 제어**: 같은 법무법인 소속만 파일 조회 가능
- **카테고리 격리**: 각 법무법인은 독립적인 카테고리 트리 관리

### Supabase Storage 보안
- **Service Role Key 사용**: RLS 정책 우회하여 서버에서만 업로드 가능
- **Signed URL**: 60초 제한 임시 URL로 파일 접근 제어
- **파일 경로 관리**: `firm_id/YYYYMMDD/unique_filename` 구조로 파일 저장
- **UUID 파일명**: 파일명 중복 방지 및 보안 강화

### 환경 변수 보안
- `.env` 파일에 민감한 정보 저장
- `.gitignore`에 `.env` 추가하여 Git 커밋 방지
- 프로덕션 환경에서는 환경 변수 관리 시스템 사용 권장
- `SUPABASE_SERVICE_ROLE_KEY`는 서버 사이드에서만 사용

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

### Supabase Storage 업로드 실패
파일 업로드 시 에러가 발생하면:
1. **Bucket 생성 확인**
   - Supabase 대시보드 > Storage에서 "Evidences" 버킷이 생성되어 있는지 확인
   - Public bucket으로 생성하지 마세요 (보안상 Private 권장)

2. **Service Role Key 확인**
   - `.env` 파일에 `SUPABASE_SERVICE_ROLE_KEY`가 올바르게 설정되어 있는지 확인
   - Supabase Settings > API > Service Role Key 복사

3. **RLS 정책 확인**
   - Storage 버킷의 RLS 정책이 있다면, Service Role Key를 사용하면 우회됨
   - 또는 업로드를 위한 적절한 RLS 정책 추가

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

### JWT 인증 실패
API 호출 시 401 Unauthorized 에러가 발생하면:
1. 로그인 후 받은 `access_token`을 확인
2. API 요청 시 `Authorization: Bearer <token>` 헤더가 포함되어 있는지 확인
3. 토큰이 만료되었는지 확인 (기본 만료 시간 확인)

## 📄 라이선스

MIT License
