# CaseMate 배포 가이드

> 최종 업데이트: 2026-02-20
> 작성: dayforged + Claude

비전공자도 이해할 수 있도록, 개념 설명부터 실제 작업까지 정리한 문서.

---

## 목차

1. [배포란 무엇인가](#1-배포란-무엇인가)
2. [우리 서비스 구조 이해하기](#2-우리-서비스-구조-이해하기)
3. [왜 Docker를 쓰는가](#3-왜-docker를-쓰는가)
4. [배포 전 코드 정돈 작업](#4-배포-전-코드-정돈-작업)
5. [배포 파일 구조와 역할](#5-배포-파일-구조와-역할)
6. [환경변수 정리](#6-환경변수-정리)
7. [배포 실행 절차 (Lightsail)](#7-배포-실행-절차-lightsail)
8. [검증 체크리스트](#8-검증-체크리스트)
9. [트러블슈팅](#9-트러블슈팅)
10. [작업 이력](#10-작업-이력)

---

## 1. 배포란 무엇인가

### 한 줄 요약
> **내 컴퓨터에서만 돌아가는 서비스를, 인터넷에 연결된 서버에 올려서 누구나 접속할 수 있게 만드는 것**

### 로컬 vs 배포 비교

| | 로컬 (지금) | 배포 (목표) |
|---|---|---|
| 접속 주소 | `http://localhost:3000` | `http://서버IP` (또는 도메인) |
| 누가 쓸 수 있나 | 내 컴퓨터에서만 | 인터넷 있으면 누구나 |
| 서버가 꺼지면 | 내가 다시 켜야 함 | 자동 재시작 (Docker) |
| 실행 방법 | 터미널 3개 열어서 각각 실행 | `docker compose up` 한 줄 |

### 왜 AWS Lightsail인가

| 선택지 | 가격 | 특징 |
|---|---|---|
| **AWS Lightsail** | **$10/월** | 고정 요금, 2GB RAM, 간단한 UI, 초보자 친화적 |
| AWS EC2 | 종량제 | 유연하지만 요금 예측 어려움 |
| Vercel/Netlify | 무료~ | 프론트만 가능, 백엔드 불가 |
| Railway/Render | $5~20/월 | 간편하지만 RAM 제한 빡빡 |

**$10 플랜 스펙: 2GB RAM, 60GB SSD, 서울 리전**

---

## 2. 우리 서비스 구조 이해하기

### 로컬에서 지금 돌아가는 방식

```
[브라우저 localhost:3000]
        │
        ├── 화면 요청 ──→ Vite 개발서버 (프론트엔드)
        │
        └── API 요청 ──→ FastAPI 서버 (localhost:8000)
                              │
                              ├── PostgreSQL (Supabase 클라우드)
                              ├── Qdrant (localhost:6333, Docker)
                              ├── OpenAI API (외부)
                              └── Supabase Storage (외부, 증거 파일)
```

- 프론트엔드: Vite 개발서버가 React 코드를 실시간 변환해서 보여줌
- 백엔드: FastAPI가 API 요청을 처리
- DB: PostgreSQL은 Supabase 클라우드, Qdrant는 로컬 Docker
- 외부 API: OpenAI(GPT), Supabase Storage(파일), 법령 API

### 배포 후 돌아가는 방식

```
[브라우저 http://서버IP]
        │
        └── 모든 요청 ──→ nginx (:80)
                            │
                            ├── /           ──→ 프론트 정적파일 (빌드된 HTML/JS/CSS)
                            ├── /api/       ──→ FastAPI 백엔드 (:8000, 내부)
                            └── /health     ──→ FastAPI 헬스체크
                                                  │
                                                  ├── PostgreSQL (Supabase 클라우드, 동일)
                                                  ├── Qdrant (:6333, 내부)
                                                  ├── OpenAI API (동일)
                                                  └── Supabase Storage (동일)
```

**핵심 차이:**
- Vite 개발서버 대신 **nginx**가 빌드된 정적파일을 서빙
- 프론트와 백엔드가 **같은 서버, 같은 포트(80)**에서 서빙 → CORS 문제 없음
- 외부에 열리는 포트는 **80번 하나뿐** (보안)

### "같은 서버"라는 게 왜 중요한가 (Same-Origin)

로컬에서는 프론트(3000)와 백엔드(8000)가 **다른 포트**라서 CORS 설정이 필요했음.
배포에서는 nginx가 둘 다 80번 포트로 묶어주니까:
- 브라우저 입장에서 "같은 출처"로 인식
- 프론트에서 `/api/v1/cases` 같은 **상대경로**로 API 호출 가능
- CORS 걱정 없음

---

## 3. 왜 Docker를 쓰는가

### Docker가 뭔데?

> **앱 실행에 필요한 모든 것(코드, 라이브러리, 설정)을 하나의 "상자"에 담아서, 어디서든 동일하게 실행하는 기술**

비유: 이사할 때 짐을 박스에 포장하면, 어느 집에 가도 박스만 열면 바로 쓸 수 있는 것과 같음.

### Docker 없이 배포하면?

```
서버에 접속해서...
1. Python 3.11 설치
2. Node.js 20 설치
3. nginx 설치
4. pip install -r requirements.txt (의존성 충돌 가능)
5. npm install (버전 안 맞을 수 있음)
6. npm run build
7. 빌드 결과물 nginx 폴더로 복사
8. nginx 설정 파일 작성
9. uvicorn 실행 스크립트 작성
10. 서버 재부팅 시 자동 실행 설정
... 중간에 하나라도 틀리면 안 돌아감
```

### Docker로 배포하면?

```
서버에 접속해서...
1. Docker 설치 (한 번만)
2. git clone
3. .env 파일 생성
4. docker compose -f docker-compose.prod.yml up -d --build
끝.
```

### 우리 프로젝트의 Docker 구성

```
docker-compose.prod.yml (총감독)
│
├── nginx 컨테이너        ← frontend/Dockerfile로 빌드
│   ├── 프론트 빌드 (npm run build)
│   ├── 빌드 결과물을 nginx로 서빙
│   └── /api/ 요청을 backend로 전달
│
├── backend 컨테이너      ← backend/Dockerfile로 빌드
│   ├── Python 패키지 설치 (requirements.txt)
│   ├── FastAPI 서버 실행
│   └── 환경변수로 설정 제어
│
└── qdrant 컨테이너       ← 공식 이미지 그대로 사용
    └── 벡터 검색 DB (판례, 법령)
```

### 용어 정리

| 용어 | 의미 |
|---|---|
| **컨테이너** | 실행 중인 Docker "상자" 하나 |
| **이미지** | 컨테이너를 만드는 "설계도" (Dockerfile로 빌드) |
| **Dockerfile** | 이미지를 만드는 레시피 (어떤 OS, 뭘 설치, 뭘 복사, 뭘 실행) |
| **docker-compose** | 여러 컨테이너를 한번에 관리하는 설정 파일 |
| **빌드** | Dockerfile → 이미지로 변환하는 과정 |
| **expose vs ports** | expose: 컨테이너끼리만 통신 / ports: 외부에서도 접근 가능 |
| **볼륨(volumes)** | 컨테이너가 삭제돼도 데이터를 보존하는 방법 (qdrant_data 등) |

---

## 4. 배포 전 코드 정돈 작업

### 4-1. 왜 코드 정돈이 필요한가

로컬에서는 문제없이 돌아가지만, 배포 환경에서는 터지는 것들:
- `http://localhost:8000` 하드코딩 → 서버에선 localhost가 아님
- Supabase 환경변수 없으면 앱 자체가 안 뜸 → Docker 빌드 실패
- `sentence-transformers`(2.3GB RAM) → 2GB 서버에서 메모리 초과
- 사용하지 않는 패키지 → 빌드 시간 증가, 이미지 크기 증가

### 4-2. 수행한 작업 목록

#### (A) 메모리 최적화: 리랭킹 환경변수 분기

| 항목 | 상세 |
|---|---|
| **문제** | `sentence-transformers` 패키지가 PyTorch를 포함해 RAM 2.3GB 차지. 2GB 서버에서 실행 불가 |
| **해결** | 환경변수 `USE_RERANKING`으로 on/off 분기. false면 import 자체를 스킵 |
| **수정 파일** | `backend/app/services/precedent_similar_service.py` |
| **기존 기능 영향** | 없음. 로컬에서 `USE_RERANKING=true` + `pip install sentence-transformers` 하면 동일 동작 |
| **배포 시 설정** | `USE_RERANKING=false` (docker-compose.prod.yml에 이미 설정됨) |

**변경 내용:**
```python
# 추가된 함수
def is_reranking_enabled() -> bool:
    return os.getenv("USE_RERANKING", "false").lower() in ("true", "1", "yes")

# get_reranker_model() 수정: 비활성 시 None 반환
def get_reranker_model():
    if not is_reranking_enabled():
        return None
    # ... 기존 로딩 코드

# __init__ 수정: 환경변수에서 기본값 읽기
def __init__(self, use_reranking: bool | None = None):
    self.use_reranking = use_reranking if use_reranking is not None else is_reranking_enabled()

# _rerank() 수정: reranker가 None이면 원본 순서 반환
def _rerank(self, query, candidates, top_k):
    reranker = get_reranker_model()
    if reranker is None:
        return candidates[:top_k]  # 리랭킹 없이 기존 순서 유지
```

**RAM 절약 효과:**

| 구성 | Backend RAM |
|---|---|
| sentence-transformers 포함 (기존) | ~2.7GB (서버에서 실행 불가) |
| sentence-transformers 제거 (변경 후) | ~400MB |

#### (B) 앱 시작 크래시 방지: evidence_api.py

| 항목 | 상세 |
|---|---|
| **문제** | Supabase 환경변수 없으면 `raise ValueError`로 앱 전체 크래시 |
| **해결** | 모듈레벨 초기화 → lazy init 함수 `get_supabase()`로 변경 |
| **수정 파일** | `backend/app/api/v1/evidence_api.py` |
| **기존 기능 영향** | 없음. 환경변수 있으면 기존과 100% 동일 동작 |

**변경 전:**
```python
# 모듈 로드 시점에 바로 실행 → 환경변수 없으면 여기서 크래시
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL 또는 ...")  # 💥 앱 전체 안 뜸
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
```

**변경 후:**
```python
# 실제 API 호출 시점에만 초기화
_supabase_client: Client | None = None

def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise HTTPException(status_code=503, detail="Supabase 설정 누락")
        _supabase_client = create_client(url, key)
    return _supabase_client
```

#### (C) 프론트엔드 하드코딩 URL 제거

| 항목 | 상세 |
|---|---|
| **문제** | `relationship-editor.tsx`에서 `http://localhost:8000/api/v1/...` 9곳 하드코딩 |
| **해결** | 이미 구현된 `apiFetch()` 함수 사용으로 전환 (상대경로 `/api/v1/...`) |
| **수정 파일** | `frontend/src/components/legal/relationship-editor.tsx` |
| **기존 기능 영향** | 없음. 로컬에서도 Vite proxy 또는 상대경로로 동작 |

**변경 예시:**
```typescript
// 변경 전
const res = await fetch(`http://localhost:8000/api/v1/relationships/${caseId}`);

// 변경 후
const res = await apiFetch(`/api/v1/relationships/${caseId}`);
// apiFetch는 상대경로 + 인증 토큰 자동 첨부
```

**apiFetch가 하는 일** (`frontend/src/lib/api.ts`):
1. localStorage에서 JWT 토큰 읽기
2. Authorization 헤더에 토큰 자동 첨부
3. `fetch(path, ...)` 호출 (상대경로 그대로)

#### (D) 불필요한 패키지 제거

| 패키지 | 위치 | 이유 |
|---|---|---|
| `sentence-transformers` | `backend/requirements.txt` | PyTorch 2.3GB, 프로덕션 불필요 |
| `next` (Next.js) | `frontend/package.json` | Vite 프로젝트인데 사용하지 않는 Next.js가 설치돼 있었음 (~100MB) |

#### (E) 누락 패키지 추가

| 패키지 | 위치 | 이유 |
|---|---|---|
| `numpy` | `backend/requirements.txt` | `evidence_processor.py`에서 `import numpy` 하는데 requirements.txt에 없었음. 지금까지는 다른 패키지의 의존성으로 우연히 설치됐을 뿐 |

#### (F) 보안/운영 개선: main.py

| 항목 | 기존 | 변경 후 | 이유 |
|---|---|---|---|
| CORS | `allow_origins=["*"]` 하드코딩 | `ALLOWED_ORIGINS` 환경변수 | 프로덕션에서 특정 도메인만 허용 가능 |
| `/db-init` | 항상 노출 | `ENABLE_DB_INIT=true`일 때만 등록 | 프로덕션에서 DB 초기화 엔드포인트 노출 방지 |
| 리랭커 warm-up | 항상 시도 | `USE_RERANKING` 체크 후 분기 | 불필요한 모델 로딩 방지 |

---

## 5. 배포 파일 구조와 역할

### 파일 트리

```
프로젝트 루트/
├── docker-compose.prod.yml    ← "총감독": 컨테이너 3개를 어떻게 실행할지 정의
├── .env.example               ← 환경변수 템플릿 (실제 .env의 가이드)
│
├── nginx/
│   └── nginx.conf             ← nginx 설정: URL별로 어디로 보낼지 규칙
│
├── backend/
│   ├── Dockerfile             ← 백엔드 이미지 레시피
│   ├── .dockerignore          ← Docker 빌드 시 제외할 파일
│   └── requirements.txt       ← Python 패키지 목록 (정리 완료)
│
└── frontend/
    ├── Dockerfile             ← 프론트 이미지 레시피 (빌드 → nginx)
    ├── .dockerignore          ← Docker 빌드 시 제외할 파일
    └── package.json           ← npm 패키지 목록 (next 제거 완료)
```

### 각 파일 상세 설명

#### `docker-compose.prod.yml` — 총감독

```yaml
services:
  nginx:          # 1번 컨테이너: 프론트 + 리버스 프록시
    build: ./frontend
    ports: "80:80"           # 외부 80번 포트 오픈 (유일하게 외부 노출)
    volumes: nginx.conf 마운트
    depends_on: backend      # backend가 먼저 떠야 함

  backend:        # 2번 컨테이너: FastAPI API 서버
    build: ./backend
    expose: "8000"           # 내부에서만 접근 가능 (외부 노출 안 됨)
    env_file: .env           # 환경변수 파일 로드
    environment:             # 추가 환경변수 (docker 전용)
      QDRANT_HOST: qdrant    # docker 내부에서 qdrant 컨테이너 이름으로 접근
      USE_RERANKING: false
    depends_on: qdrant

  qdrant:         # 3번 컨테이너: 벡터 검색 DB
    image: qdrant/qdrant     # 공식 이미지 그대로 사용
    expose: "6333"           # 내부에서만 접근
    volumes: qdrant_data     # 데이터 영속화 (컨테이너 삭제돼도 데이터 유지)
```

**ports vs expose 차이:**
- `ports: "80:80"` → 외부 인터넷에서 접근 가능
- `expose: "8000"` → Docker 내부 컨테이너끼리만 통신

**depends_on 순서:**
```
qdrant (먼저) → backend (다음) → nginx (마지막)
```

#### `nginx/nginx.conf` — 교통정리

```
브라우저 요청이 오면:

/api/로 시작하면    → backend:8000으로 전달 (리버스 프록시)
/health이면        → backend:8000으로 전달
그 외 전부 (/, /cases/123 등) → 프론트 정적파일 서빙

/api/ 요청 특이사항:
- 타임아웃 120초 (GPT 호출이 오래 걸릴 수 있어서)
- 파일 업로드 최대 50MB
- 원래 클라이언트 IP를 백엔드에 전달
```

#### `backend/Dockerfile` — 백엔드 레시피

```dockerfile
FROM python:3.11-slim              # 1. Python 3.11 경량 이미지에서 시작
WORKDIR /app                       # 2. 작업 디렉토리 설정
RUN apt-get install gcc libpq-dev  # 3. PostgreSQL 연결에 필요한 시스템 패키지
COPY requirements.txt .            # 4. 패키지 목록 복사
RUN pip install -r requirements.txt # 5. Python 패키지 설치
COPY app/ ./app/                   # 6. 소스코드 복사
COPY tool/ ./tool/
EXPOSE 8000                        # 7. 8000번 포트 사용 선언
CMD ["uvicorn", ...]               # 8. 서버 실행 (worker 2개)
```

**왜 requirements.txt를 먼저 복사하나?**
Docker는 변경된 줄부터 다시 빌드함. 코드만 수정하면 패키지 재설치 없이 빠르게 빌드됨 (캐싱).

#### `frontend/Dockerfile` — 프론트 레시피 (2단계 빌드)

```dockerfile
# --- 1단계: 빌드 ---
FROM node:20-alpine AS builder    # Node.js로 빌드
COPY package.json package-lock.json ./
RUN npm ci                        # 패키지 설치 (lock 파일 기준, 재현성 보장)
COPY . .
RUN npm run build                 # Vite 빌드 → dist/ 폴더에 HTML/JS/CSS 생성

# --- 2단계: 서빙 ---
FROM nginx:alpine                 # 가벼운 nginx 이미지
COPY --from=builder /app/dist /usr/share/nginx/html
# 빌드 결과물만 nginx에 복사. Node.js는 버림 → 최종 이미지 매우 가벼움
```

**왜 2단계로 나누나?**
- 1단계(builder): Node.js + 소스코드 + node_modules → 수백 MB
- 2단계(최종): nginx + 빌드된 정적파일만 → ~30MB
- Node.js는 빌드에만 필요하고, 실행 시에는 필요 없으니까 버림

---

## 6. 환경변수 정리

### 필수 환경변수 (`.env`에 반드시 설정)

| 변수 | 설명 | 예시 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열 | `postgresql://postgres:PW@db.xxx.supabase.co:5432/postgres` |
| `OPENAI_API_KEY` | OpenAI API 키 | `sk-...` |
| `JWT_SECRET_KEY` | JWT 토큰 서명 키 (`openssl rand -hex 32`로 생성) | `a1b2c3...64자리hex` |
| `LAW_API_KEY` | 법령 API 키 | `...` |
| `SUPABASE_URL` | Supabase 프로젝트 URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 롤 키 | `eyJ...` |

### 선택 환경변수 (기본값이 있어서 안 넣어도 됨)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `QDRANT_HOST` | `localhost` | docker-compose에서 `qdrant`로 자동 설정 |
| `QDRANT_PORT` | `6333` | docker-compose에서 자동 설정 |
| `USE_RERANKING` | `false` | 리랭킹 활성화 (true면 sentence-transformers 필요) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS 허용 오리진 (쉼표 구분) |
| `DEBUG` | `false` | true면 에러 상세 메시지 노출 |
| `ENABLE_DB_INIT` | `false` | true면 /db-init 엔드포인트 활성화 |

### 로컬 .env vs 프로덕션 .env 차이

| 변수 | 로컬 | 프로덕션 |
|---|---|---|
| `QDRANT_HOST` | `localhost` | `qdrant` (docker 내부 네트워크) |
| `USE_RERANKING` | `true` (선택) | `false` (RAM 절약) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | `*` (nginx same-origin이라 무관) |
| `ENABLE_DB_INIT` | `true` (개발 편의) | `false` (보안) |
| `DEBUG` | `true` (개발 편의) | `false` (보안) |

---

## 7. 배포 실행 절차 (Lightsail)

### 사전 준비
- [ ] AWS 계정 생성
- [ ] 로컬에서 Docker 테스트 통과 (아래 8번 참고)

### Step 1: Lightsail 인스턴스 생성
1. AWS Lightsail 콘솔 접속
2. "인스턴스 생성" 클릭
3. 리전: **서울 (ap-northeast-2)**
4. 플랫폼: **Linux/Unix**
5. 블루프린트: **OS만 선택 → Ubuntu 22.04 LTS**
6. 플랜: **$10 USD/월 (2GB RAM, 60GB SSD)**
7. 인스턴스 이름 지정 → 생성

### Step 2: 서버 초기 설정 (SSH 접속 후)

```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# Docker 설치
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Docker Compose 설치 (Docker 플러그인)
sudo apt install -y docker-compose-plugin

# 재접속 (docker 그룹 적용)
exit
# SSH 재접속
```

### Step 3: 프로젝트 배포

```bash
# 프로젝트 클론
git clone https://github.com/KernelAcademy-AICamp/ai-camp-4nd-llm-agent-service-project-4th_law_casemate.git
cd ai-camp-4nd-llm-agent-service-project-4th_law_casemate

# 환경변수 파일 생성 (.env.example을 복사해서 실제 값 입력)
cp .env.example .env
nano .env  # 실제 값 입력
```

### Step 4: Qdrant 데이터 전송

로컬 qdrant_data를 서버로 전송해야 함 (판례/법령 벡터 데이터):

```bash
# 로컬에서 압축
tar -czf qdrant_data.tar.gz qdrant_data/

# 서버로 전송 (scp)
scp -i your-key.pem qdrant_data.tar.gz ubuntu@서버IP:~/프로젝트경로/

# 서버에서 압축 해제
tar -xzf qdrant_data.tar.gz
```

### Step 5: 실행

```bash
# 빌드 + 실행 (백그라운드)
docker compose -f docker-compose.prod.yml up -d --build

# 로그 확인
docker compose -f docker-compose.prod.yml logs -f

# 상태 확인
docker compose -f docker-compose.prod.yml ps
```

### Step 6: 네트워크 설정
1. Lightsail 콘솔 → 인스턴스 → "네트워킹" 탭
2. 방화벽 규칙 추가:
   - **TCP 80** (HTTP)
   - **TCP 443** (HTTPS, 나중에 SSL 추가 시)
   - TCP 22 (SSH, 이미 열려있음)
3. "고정 IP 생성" → 인스턴스에 연결

### Step 7: 접속 확인
- 브라우저에서 `http://고정IP` 접속
- 로그인 → 사건 목록 → 각 기능 확인

---

## 8. 검증 체크리스트

### 로컬 Docker 테스트 (배포 전 필수)

```bash
# 프로젝트 루트에서 실행
docker compose -f docker-compose.prod.yml up --build
```

- [ ] 빌드 에러 없이 완료
- [ ] `curl http://localhost/health` → `{"status": "healthy"}`
- [ ] `curl http://localhost/api/v1/` → API 응답
- [ ] 브라우저 `http://localhost` → 프론트엔드 로딩
- [ ] 로그인 성공
- [ ] 사건 목록 조회
- [ ] 사건 상세 → 분석 기능
- [ ] 판례 검색 (Qdrant 연동)
- [ ] 관계도 조회/편집
- [ ] 타임라인 조회
- [ ] 증거 업로드 (Supabase 연동)
- [ ] `docker stats` → 전체 메모리 2GB 이내

### RAM 사용량 목표

| 컨테이너 | 예상 RAM |
|---|---|
| Backend (FastAPI, 2 workers, PyTorch 없음) | ~400MB |
| Qdrant (116K 벡터, 3 컬렉션) | ~1.0GB |
| Nginx | ~20MB |
| OS | ~200MB |
| **합계** | **~1.6GB / 2GB** |

---

## 9. 트러블슈팅

### 빌드 실패

| 에러 | 원인 | 해결 |
|---|---|---|
| `npm ci` 실패 | `package-lock.json`이 없거나 오래됨 | 로컬에서 `npm install` 후 lock 파일 커밋 |
| `pip install` 실패 | 패키지 버전 충돌 | requirements.txt 버전 확인 |
| `gcc` 관련 에러 | 시스템 패키지 부족 | Dockerfile에 이미 `gcc libpq-dev` 포함되어 있음 |

### 실행 후 에러

| 증상 | 원인 | 해결 |
|---|---|---|
| 프론트 화면은 뜨는데 API 에러 | backend 컨테이너 안 떴음 | `docker compose logs backend` 확인 |
| 502 Bad Gateway | backend가 아직 시작 중 | 30초 기다리기, 로그 확인 |
| DB 연결 실패 | DATABASE_URL 잘못됨 | `.env` 확인, Supabase 대시보드에서 연결 문자열 복사 |
| Qdrant 연결 실패 | qdrant_data 없음 | Step 4 데이터 전송 확인 |
| 판례 검색 안 됨 | qdrant_data가 비어있음 | 로컬 qdrant_data 전송 확인 |
| 메모리 초과 (OOM) | RAM 2GB 초과 | `docker stats`로 확인, USE_RERANKING=false 확인 |

### 유용한 Docker 명령어

```bash
# 전체 상태 확인
docker compose -f docker-compose.prod.yml ps

# 실시간 로그 보기
docker compose -f docker-compose.prod.yml logs -f

# 특정 컨테이너 로그만
docker compose -f docker-compose.prod.yml logs -f backend

# 메모리 사용량 실시간 모니터링
docker stats

# 전부 중지
docker compose -f docker-compose.prod.yml down

# 전부 중지 + 재빌드 + 재시작
docker compose -f docker-compose.prod.yml up -d --build

# 특정 컨테이너만 재시작
docker compose -f docker-compose.prod.yml restart backend
```

---

## 10. 작업 이력

### 2026-02-20: 배포 준비 Phase 1~2

**수행자:** dayforged

#### 코드 정돈 (Phase 1)

| # | 파일 | 작업 | 상태 |
|---|---|---|---|
| 1 | `backend/app/services/precedent_similar_service.py` | 리랭킹 환경변수 분기 (`USE_RERANKING`) | 완료 |
| 2 | `backend/app/main.py` | lifespan warm-up 분기, CORS 환경변수화, db-init 게이트 | 완료 |
| 3 | `backend/app/api/v1/evidence_api.py` | Supabase lazy init (모듈레벨 크래시 방지) | 완료 |
| 4 | `frontend/src/components/legal/relationship-editor.tsx` | 하드코딩 URL 9곳 → apiFetch 전환 | 완료 |
| 5 | `frontend/package.json` | 미사용 `next` 패키지 제거 | 완료 |
| 6 | `backend/requirements.txt` | `sentence-transformers` 제거, `numpy` 추가, 주석 정리 | 완료 |

#### 배포 파일 생성 (Phase 2)

| # | 파일 | 역할 | 상태 |
|---|---|---|---|
| 1 | `backend/Dockerfile` | 백엔드 Docker 이미지 빌드 | 생성 완료 |
| 2 | `backend/.dockerignore` | 빌드 시 제외 파일 | 생성 완료 |
| 3 | `frontend/Dockerfile` | 프론트 빌드 + nginx 서빙 | 생성 완료 |
| 4 | `frontend/.dockerignore` | 빌드 시 제외 파일 | 생성 완료 |
| 5 | `nginx/nginx.conf` | 리버스 프록시 + 정적파일 + SPA | 생성 완료 |
| 6 | `docker-compose.prod.yml` | 컨테이너 3개 오케스트레이션 | 생성 완료 |
| 7 | `.env.example` | 환경변수 가이드 | 생성 완료 |

#### 팀원 공유 필요 사항

| 항목 | 영향받는 팀원 | 내용 |
|---|---|---|
| `main.py` CORS 변경 | 전원 | `ALLOWED_ORIGINS` 환경변수 미설정 시 기본값 `http://localhost:3000`으로 동작. 기존 `*`에서 변경됨. 로컬에서 문제 시 `.env`에 `ALLOWED_ORIGINS=*` 추가 |
| `main.py` db-init | 전원 | `/db-init` 사용하려면 `.env`에 `ENABLE_DB_INIT=true` 추가 필요 |
| `relationship-editor.tsx` | hdju | `fetch` → `apiFetch` 전환. merge 시 충돌 가능성 낮음 (함수명만 변경) |

#### 보안 점검 + 최종 스캔 (Phase 1 추가)

| # | 파일 | 작업 | 상태 |
|---|---|---|---|
| 7 | `backend/tool/security.py` | JWT 시크릿 하드코딩 fallback 제거 → `BCRYPT_SECRET` 필수화 | 완료 |
| 8 | `backend/requirements.txt` | `tqdm` 제거 (scripts 전용, 런타임 불필요) | 완료 |
| 9 | `.gitignore` | `package-lock.json` 추적 허용 (Docker 빌드 필수), `qdrant_data/` 제외 추가 | 완료 |
| 10 | `backend/tool/database.py` | `DATABASE_URL` 미설정 시 명확한 에러 메시지 추가 | 완료 |
| 11 | `nul` (루트) | Windows 찌꺼기 파일 삭제 | 완료 |

#### 최종 코드 스캔 결과 (2회차, 이상 없음 확인)

| 점검 항목 | 결과 |
|---|---|
| 프론트엔드 localhost 하드코딩 | 없음 (전부 apiFetch 전환 완료) |
| 백엔드 하드코딩 시크릿 | 없음 (security.py 수정 완료) |
| 모듈레벨 크래시 가능성 | 없음 (evidence_api, database, security 모두 방어 처리) |
| sentence-transformers 안전성 | lazy import + 환경변수 게이트, 안전 |
| 누락 패키지 | 없음 |
| 불필요 패키지 | 없음 (tqdm, sentence-transformers, next 제거 완료) |
| Docker 빌드 차단 요소 | 없음 (package-lock.json gitignore 해제 완료) |
| .env.example 완성도 | 모든 런타임 환경변수 문서화 완료 |
| nginx 프록시 구성 | /api/ → backend 정상 매핑, 120s 타임아웃, 50M 업로드 |

### 2026-02-20: 보안 강화 (Phase 1 추가)

**수행자:** dayforged

#### 인증 미적용 API 보호 (CRITICAL)

| # | 파일 | 작업 | 상태 |
|---|---|---|---|
| 1 | `backend/app/api/v1/timeline_api.py` | 5개 엔드포인트에 `Depends(get_current_user)` 추가 | 완료 |
| 2 | `backend/app/api/v1/relationship_api.py` | 10개 엔드포인트에 `Depends(get_current_user)` 추가 | 완료 |
| 3 | `backend/app/api/v1/search_api.py` | 6개 엔드포인트에 `Depends(get_current_user)` 추가 | 완료 |
| 4 | `backend/app/api/v1/search_laws.py` | 4개 엔드포인트에 `Depends(get_current_user)` 추가 | 완료 |

> 이전: 타임라인, 관계도, 판례검색, 법령검색 API가 인증 없이 접근 가능
> 이후: JWT 토큰 없이는 모든 API 접근 불가

#### 에러 메시지 내부 정보 노출 차단

| # | 파일 | 수정 건수 | 상태 |
|---|---|---|---|
| 1 | `timeline_api.py` | 5곳 | 완료 |
| 2 | `relationship_api.py` | 3곳 | 완료 |
| 3 | `search_api.py` | 6곳 | 완료 |
| 4 | `search_laws.py` | 4곳 | 완료 |
| 5 | `evidence_api.py` | 16곳 | 완료 |
| 6 | `case_api.py` | 7곳 | 완료 |
| 7 | `auth_api.py` | 3곳 | 완료 |
| 8 | `precedent_favorites_api.py` | 5곳 | 완료 |
| 9 | `document_api.py` | 2곳 | 완료 |

> 이전: `raise HTTPException(status_code=500, detail=str(e))` → 서버 내부 에러(SQL, traceback 등) 클라이언트 노출
> 이후: `logger.error(...)` + 일반적인 한국어 에러 메시지만 클라이언트 전달

#### 기타 보안 개선

| # | 파일 | 작업 | 상태 |
|---|---|---|---|
| 1 | `evidence_api.py` | 파일 업로드 50MB 크기 제한 추가 | 완료 |
| 2 | `auth_api.py` | Supabase lazy init (모듈레벨 크래시 방지) | 완료 |
| 3 | `auth_api.py` | 아바타 업로드 5MB 크기 제한 추가 | 완료 |
| 4 | `main.py` | 프로덕션 `/docs`, `/redoc`, `/openapi.json` 비활성화 (DEBUG=true일 때만 노출) | 완료 |

#### 팀원 공유 필요 사항

| 항목 | 영향받는 팀원 | 내용 |
|---|---|---|
| 타임라인/관계도 API 인증 추가 | hdju | 프론트에서 이미 `apiFetch` (토큰 자동 첨부) 사용 중이면 영향 없음. `fetch`로 직접 호출하는 코드가 있으면 `apiFetch`로 변경 필요 |
| 판례검색/법령검색 API 인증 추가 | DaHee05 | 동일 - `apiFetch` 사용 시 영향 없음 |
| `/docs` 비활성화 | 전원 | 로컬 개발 시 `.env`에 `DEBUG=true` 추가하면 Swagger UI 사용 가능 |

### 2026-02-20: 보안 정밀 강화 + 배포 수준 업그레이드 (Phase 1 최종)

**수행자:** dayforged

> 보안 감사에서 발견된 IDOR, JWT 설정, 입력 검증, 로그 정보 노출 등
> 배포 전 반드시 해결해야 할 취약점을 전수 조사하여 수정한 작업.

#### 1. IDOR (Cross-firm 데이터 접근) 취약점 차단

**문제:** 인증된 사용자라면 누구나 다른 법률사무소의 사건/타임라인/관계도 데이터에 접근 가능했음.
예: A사무소 사용자가 B사무소 사건의 타임라인을 조회/수정/삭제 가능.

**해결:** 모든 데이터 접근 엔드포인트에 `case.law_firm_id == current_user.firm_id` 검증 추가.

| # | 파일 | 보호된 엔드포인트 수 | 상태 |
|---|---|---|---|
| 1 | `timeline_api.py` | 5개 (GET/POST/PUT/DELETE/생성) | 완료 |
| 2 | `relationship_api.py` | 10개 (관계도 CRUD 전체) | 완료 |
| 3 | `search_api.py` | 1개 (`search_similar_cases`) | 완료 |
| 4 | `document_api.py` | 3개 (`generate_sections`, `get_case_context`, `generate_document`) | 완료 |

> `case_api.py`, `evidence_api.py`, `file_manager_api.py`는 이미 firm 검증이 있었음.

#### 2. JWT 인증 시스템 개선

**문제들:**
- 환경변수명 `BCRYPT_SECRET`이 JWT 서명 키로 사용되어 혼란
- 토큰 만료가 7일로 지나치게 길어 토큰 유출 시 장기간 악용 가능
- 비밀번호 72바이트 초과 시 경고 없이 잘림 (silent truncation)

| # | 파일 | 수정 내용 | 타당성 |
|---|---|---|---|
| 1 | `security.py` | `BCRYPT_SECRET` → `JWT_SECRET_KEY` (하위호환 유지) | JWT 서명 키는 bcrypt와 무관. 이름이 기능을 반영해야 함 |
| 2 | `security.py` | 토큰 만료 7일 → 24시간 (`ACCESS_TOKEN_EXPIRE_HOURS` 환경변수) | 업계 표준. 토큰 유출 시 피해 범위 축소 |
| 3 | `security.py` | silent truncation → `raise ValueError` | 비밀번호가 조용히 잘리면 다른 비밀번호와 해시 충돌 가능 |

#### 3. 사용자 입력 검증 강화

**문제:** 비밀번호 `"1"`, 이메일 `"abc"` 등 무효한 입력이 그대로 DB에 저장되었음.

| # | 파일 | 수정 내용 | 타당성 |
|---|---|---|---|
| 1 | `auth_api.py` | 비밀번호 최소 8자 + 영문 1자 + 숫자 1자 필수 | 약한 비밀번호 방지, 무차별 대입 공격 저항력 확보 |
| 2 | `auth_api.py` | 이메일 정규식 검증 추가 (`user@domain.com` 형식) | DB에 무효한 이메일 저장 방지 |
| 3 | `auth_api.py` | 아바타 업로드 파일 확장자 allowlist (`jpg/png/webp`) | 악성 파일 확장자 차단 |

#### 4. 프로덕션 로그 정보 노출 차단

**문제:** `print()` 문으로 사용자 이메일, 이름, 사건 내용 등 PII가 프로덕션 로그에 기록됨.
Docker 컨테이너 로그는 운영팀이나 모니터링 서비스에서 접근 가능하여 정보 유출 위험.

| # | 파일 | print() 제거 수 | 상태 |
|---|---|---|---|
| 1 | `auth_api.py` | 8개 | 완료 |
| 2 | `case_api.py` | 40+개 | 완료 |
| 3 | `timeline_api.py` | 9개 | 완료 |
| 4 | `relationship_api.py` | 20개 | 완료 |
| 5 | `evidence_api.py` | 30+개 | 완료 |
| 6 | `search_laws.py` | 8개 | 완료 |
| 7 | `document_api.py` | 12개 | 완료 |
| 8 | `precedent_favorites_api.py` | 9개 | 완료 |

> 전부 `logger.debug()` 또는 `logger.info()`로 교체.
> PII(이메일, 이름)는 로그에서 완전 제거. user_id, case_id만 유지.

#### 5. 기타 보안 개선

| # | 파일 | 수정 내용 | 타당성 |
|---|---|---|---|
| 1 | `evidence_api.py:354` | Supabase `upload_response.error` 노출 제거 | 내부 스토리지 에러 메시지가 클라이언트에 노출되던 마지막 1건 |
| 2 | `main.py` | `/db-init` 에러 메시지에서 `str(e)` 제거 | DB 연결 문자열 등 민감 정보 유출 방지 |
| 3 | `.env.example` (backend + root) | `JWT_SECRET_KEY` 반영, 모든 환경변수 문서화 | 배포 시 환경변수 누락 방지 |

#### 최종 보안 스캔 결과

| 점검 항목 | 결과 |
|---|---|
| API 레이어 `print()` | **0개** (전부 logger로 교체) |
| `str(e)` 클라이언트 노출 | **0건** (전부 generic 메시지) |
| JWT 인증 미적용 엔드포인트 | **0개** (login/signup/health 제외 전부 보호) |
| IDOR (타 사무소 데이터 접근) | **0건** (전 엔드포인트 firm_id 검증) |
| 비밀번호 검증 | 최소 8자 + 영문 + 숫자 필수 |
| 이메일 검증 | 정규식 검증 적용 |
| 파일 업로드 제한 | 증거 50MB, 아바타 5MB + 확장자 검증 |

---

### 배포 전 반드시 할 일

| # | 작업 | 방법 |
|---|---|---|
| 1 | **JWT 시크릿 키 강화** | `.env`에서 `JWT_SECRET_KEY=` 값을 `openssl rand -hex 32` 결과로 교체 |
| 2 | **로컬 Docker 빌드 테스트** | `docker compose -f docker-compose.prod.yml up --build` |
| 3 | **Qdrant 데이터 전송** | 로컬 `qdrant_data/` → 서버 전송 |

### 배포 후 개선 권장 사항 (지금 처리 못한 항목)

| # | 문제 | 못 고친 이유 | 위험도 |
|---|---|---|---|
| 1 | **SSE에서 JWT가 URL 쿼리로 전달** (`case-detail-page.tsx:706,771`) | EventSource API가 커스텀 헤더 미지원. 해결하려면 백엔드 일회용 티켓 엔드포인트 신규 개발 + 프론트 SSE 로직 전면 교체 필요 | CRITICAL |
| 2 | **Rate Limiting 없음** (로그인/회원가입) | `slowapi` 패키지 설치 + 미들웨어 구성 + 스토어 설정 필요. 팀 합의 후 의존성 추가 | HIGH |
| 3 | **localStorage에 JWT 저장** | httpOnly 쿠키로 변경하려면 백엔드 인증 흐름 + 프론트 API 클라이언트 전면 구조 변경 필요 | HIGH |
| 4 | **Mermaid SVG innerHTML 삽입** | DOMPurify 패키지 설치 필요. 현재 Mermaid 라이브러리 자체 sanitization에 의존 중 | MEDIUM |
| 5 | **서비스 레이어 print() 잔존** (21개) | `timeline_service.py`, `relationship_service.py` 등 내부 로직. API 레이어가 아니라 직접적 보안 위험 낮음 | LOW |
