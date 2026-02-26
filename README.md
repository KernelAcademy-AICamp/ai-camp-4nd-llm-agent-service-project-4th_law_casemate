# CaseMate - AI 법률 사건 관리 플랫폼

법률 사건의 등록부터 분석, 판례 검색, 증거 관리까지 AI가 지원하는 올인원 법률 지능 플랫폼입니다.

## 핵심 기능

### AI 어시스턴트 (홈 에이전트)
- **자연어 대화형 법률 AI** — "유사 판례 찾아줘", "사건 분석해줘" 등 자연어로 요청
- **LangGraph 기반 멀티홉 추론** — 5-Node StateGraph + 11개 도구, Router → Agent → Tools → Generator 파이프라인
- **SSE 실시간 스트리밍** — 도구 실행 상태, 중간 결과, 최종 답변을 실시간 전송
- **Hallucination 방지** — 도구 결과에 없는 정보 생성 금지, 출처 인용 필수
- **후속 질문 추천** — 대화 맥락에 맞는 자연스러운 다음 질문 자동 생성

### 사건 관리
- 사건 등록/수정/삭제 (CRUD)
- **AI 사건 분석** — 배경, 사실관계, 쟁점, 범죄유형 자동 추출
- **타임라인 자동 생성** — 사건 개요 + 증거에서 시간순 이벤트 추출
- **인물 관계도 자동 생성** — 사건 내 등장 인물 및 관계 추출

### 판례 검색 및 분석
- **하이브리드 검색** — Qdrant 벡터 DB 기반 (의미 검색 + 키워드 BM25)
- **KURE 임베딩** — 한국어 법률 특화 임베딩 모델 (HuggingFace API)
- **AI 판례 요약** — 결과 요약, 사실관계, 법리 분석, 실무 포인트 섹션별 정리
- **판례 비교 분석** — 현재 사건과 유사 판례 간 유사점/차이점/전략적 시사점
- **유사 판례 캐싱** — 분석 결과 DB 저장, 재요청 시 LLM 호출 스킵
- **판례 즐겨찾기** — 배치 메타데이터 조회로 성능 최적화

### 법령 검색
- **정확한 조문 조회** — "형법 제307조" → DB 조회 + API Fallback
- **벡터 검색** — 키워드 기반 관련 법령 검색
- **RAG 통합 검색** — 판례 + 법령 병렬 검색

### 증거 관리
- **파일 업로드** — Supabase Storage 통합 (이미지, PDF, 음성, 영상)
- **자동 텍스트 추출** — 이미지(EasyOCR → Vision API), PDF(PyMuPDF), 음성(Whisper STT)
- **AI 법적 분석** — 사건 맥락 기반 증거 요약, 법적 관련성, 위험도 평가
- **증거 네비게이션** — 페이지 전환 없이 이전/다음 증거 즉시 전환
- **문서 유형 자동 분류** — 카카오톡, 계약서, 영수증, 법원문서 등 자동 분류

### 인증 및 보안
- JWT 기반 인증 (회원가입/로그인)
- 법무법인(Firm) 기반 멀티테넌트 데이터 격리
- Supabase Signed URL (60초 제한) 파일 접근 제어

## 기술 스택

| 영역 | 기술 |
|------|------|
| **Backend** | FastAPI, Python 3.11+, SQLAlchemy, PostgreSQL (Supabase) |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, Radix UI |
| **AI/LLM** | OpenAI GPT-4o-mini, LangGraph, LangChain |
| **벡터 DB** | Qdrant (하이브리드 검색: Dense + Sparse) |
| **임베딩** | KURE (HuggingFace Inference API), FastEmbed (BM25) |
| **스토리지** | Supabase Storage |
| **실시간** | Server-Sent Events (SSE) |

## 프로젝트 구조

```
CaseMate/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI 앱 진입점
│   │   ├── config.py              # 임베딩/모델 설정
│   │   ├── api/v1/                # API 엔드포인트
│   │   │   ├── auth_api.py        # 인증 (회원가입/로그인)
│   │   │   ├── case_api.py        # 사건 CRUD + AI 분석
│   │   │   ├── evidence_api.py    # 증거 업로드/관리/분석
│   │   │   ├── search_api.py      # 판례/법령 검색
│   │   │   ├── agent_api.py       # AI 어시스턴트 (SSE 스트리밍)
│   │   │   ├── timeline_api.py    # 타임라인 CRUD
│   │   │   └── relationship_api.py # 인물 관계 CRUD
│   │   ├── home_agent/            # AI 어시스턴트 엔진
│   │   │   ├── graph.py           # LangGraph StateGraph 정의
│   │   │   ├── nodes.py           # 노드 함수 (router, agent, tools, generator)
│   │   │   ├── tools.py           # 11개 도구 정의
│   │   │   ├── prompts.py         # 시스템 프롬프트
│   │   │   └── checkpointer.py    # 대화 상태 관리
│   │   ├── models/                # SQLAlchemy 모델
│   │   ├── services/              # 비즈니스 로직
│   │   └── prompts/               # LLM 프롬프트 템플릿
│   ├── scripts/                   # 데이터 수집 스크립트
│   ├── tool/                      # DB, 보안, API 클라이언트
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # 라우팅 설정
│   │   ├── contexts/              # React Context (채팅, 검색)
│   │   ├── hooks/                 # Custom Hooks (useAgentSSE)
│   │   ├── components/legal/
│   │   │   ├── pages/             # 페이지 컴포넌트
│   │   │   │   ├── home-page.tsx          # 홈 (AI 어시스턴트)
│   │   │   │   ├── cases-page.tsx         # 사건 목록
│   │   │   │   ├── case-detail-page.tsx   # 사건 상세
│   │   │   │   ├── new-case-page.tsx      # 새 사건 등록
│   │   │   │   ├── precedents-page.tsx    # 판례 검색
│   │   │   │   ├── precedent-detail-page.tsx # 판례 상세
│   │   │   │   ├── evidence-detail-page.tsx  # 증거 상세
│   │   │   │   └── evidence-upload-page.tsx  # 증거 업로드
│   │   │   ├── home-agent/        # AI 어시스턴트 UI
│   │   │   │   ├── agent-results-panel.tsx   # 도구 결과 패널
│   │   │   │   └── tool-renderers/           # 도구별 렌더러
│   │   │   ├── sidebar.tsx        # 사이드바
│   │   │   └── main-layout.tsx    # 메인 레이아웃
│   │   └── lib/                   # 유틸리티
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## 시작하기

### 1. 백엔드

```bash
cd backend
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

`.env` 파일 설정:
```bash
OPENAI_API_KEY=your_key
DATABASE_URL=postgresql://...
QDRANT_URL=https://...
QDRANT_API_KEY=your_key
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_key
JWT_SECRET=your_secret
HF_API_TOKEN=your_token          # KURE 임베딩용
```

```bash
uvicorn app.main:app --reload --port 8000
```

### 2. 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

## AI 어시스턴트 도구 목록

| 도구 | 설명 |
|------|------|
| `list_cases` | 등록된 사건 목록 조회 |
| `analyze_case` | 사건 AI 분석 (배경/사실/쟁점) |
| `generate_timeline` | 타임라인 자동 생성 |
| `generate_relationship` | 인물 관계도 생성 |
| `search_precedents` | 판례 키워드 검색 |
| `summarize_precedent` | 판례 요약 (DB 직접 조회) |
| `compare_precedent` | 판례 비교 분석 (캐싱 지원) |
| `search_laws` | 법령 조문 검색 (DB + API Fallback) |
| `get_case_evidence` | 증거 현황 조회 |
| `get_case_similar_precedents` | 저장된 유사 판례 조회 |
| `rag_search` | 판례 + 법령 병렬 RAG 검색 |

## 주요 API 엔드포인트

```
POST /api/v1/auth/signup          # 회원가입
POST /api/v1/auth/login           # 로그인
GET  /api/v1/auth/me              # 현재 사용자

GET  /api/v1/cases                # 사건 목록
POST /api/v1/cases                # 사건 등록
POST /api/v1/cases/:id/analyze    # 사건 AI 분석

POST /api/v1/agent/chat           # AI 어시스턴트 (SSE)

GET  /api/v1/search/cases         # 판례 검색
POST /api/v1/search/summarize     # 판례 요약
POST /api/v1/search/cases/compare # 판례 비교

POST /api/v1/evidence/upload      # 증거 업로드
POST /api/v1/evidence/:id/analyze # 증거 AI 분석

GET  /api/v1/timeline/:case_id    # 타임라인 조회
GET  /api/v1/relationships/:case_id # 인물 관계 조회
```

API 상세 문서: `http://localhost:8000/docs`

## 팀

| 이름 | 역할 |
|------|------|
| dayforged | AI 어시스턴트 (홈 에이전트), AI 사건 분석, 보안/안정성, 프론트엔드 UI/UX |
| DaHee05 | AI 어시스턴트 (홈 에이전트), 판례 검색/AI 비교 분석, AWS 배포, 프론트엔드 UI/UX |
| hdju (kiribati) | 타임라인, 인물관계도, VLM |

## 라이선스

MIT License
