# 홈 에이전트 기능명세서

## 1. 정체성

- **서비스명**: AI 어쏘 (AI Associate)
- **위치**: 홈페이지 메인 채팅 인터페이스
- **역할**: 법률 사건 관리 시스템의 대화형 AI 에이전트
- **사용자**: 변호사, 법무사 등 법률 전문가
- **핵심 차별점**: 단순 챗봇이 아닌 **LLM 기반 대화형 AI 에이전트**
  - 도구를 자율적으로 조합하는 ReAct 패턴
  - 멀티홉 추론 (질문 → 사건조회 → 분석 → 판례검색 → 비교)
  - 결과 검증 (Corrective RAG)

---

## 2. 아키텍처

### 2-1. 5-Node StateGraph (멀티홉 지원)

```
사용자 질문
    ↓
[Router] 질문 분류 (general / simple / complex)
    ↓
    ├── general → [Generator] 즉시 답변 (도구 호출 없음)
    └── simple/complex → [Agent] 도구 선택 (ReAct)
                              ↓
                         [Tools] 도구 실행 (9개)
                              ↓
                         [Grader] 결과 관련성 검증 (Corrective RAG)
                              ↓
                         [Agent] ← 항상 Agent로 복귀 (멀티홉 핵심)
                              ↓
                         ├── 추가 도구 필요 → [Tools] → [Grader] → [Agent] (반복)
                         └── 수집 완료 (tool_calls 없음) → [Generator] 최종 답변
```

**멀티홉 설계**:
- Grader는 항상 Agent로 돌려보냄 (retry >= 3일 때만 Generator로 직행)
- Agent가 매 턴마다 "원래 질문에 답하기 위해 아직 부족한 정보가 있는가?"를 판단
- 추가 도구가 필요하면 tool_calls 포함 응답 → Tools
- 충분하면 tool_calls 없이 텍스트 응답 → Generator
- recursion_limit=20 으로 무한루프 방지

### 2-2. LLM

- 모델: **gpt-4o-mini** (전 노드 공통)
- Router/Grader: temperature=0, structured output
- Agent/Generator: temperature=0.3

### 2-3. 도구 9개

| 도구 | 기능 | 의존 |
|---|---|---|
| `list_cases` | 사건 목록 조회 | 없음 |
| `analyze_case` | 사건 AI 분석 결과 조회 | 없음 |
| `generate_timeline` | 타임라인 생성 | analyze_case 선행 필수 |
| `generate_relationship` | 관계도 생성 | analyze_case 선행 필수 |
| `search_precedents` | 유사 판례 검색 | 없음 (키워드 query 필요) |
| `summarize_precedent` | 판례 요약 | 판례번호+내용 필요 |
| `compare_precedent` | 판례 비교 분석 | search_precedents 선행 |
| `search_laws` | 법령 검색 | 없음 |
| `get_case_evidence` | 증거 현황 조회 | case_id 필요 |

### 2-4. 인프라 의존성

| 컴포넌트 | 용도 | 설정 |
|---|---|---|
| PostgreSQL | 사건/증거/분석 데이터 | `DATABASE_URL` |
| Qdrant | 판례 벡터 검색 | `QDRANT_HOST:QDRANT_PORT` (기본 localhost:6333) |
| OpenAI API | LLM + 임베딩 | `OPENAI_API_KEY` |
| Supabase | 증거 파일 스토리지 | `SUPABASE_URL`, `SUPABASE_KEY` |

**주의**: search_precedents는 Qdrant가 실행 중이어야 동작함. Docker로 실행: `docker run -p 6333:6333 qdrant/qdrant`

---

## 3. 에이전트 행동 규칙 (프롬프트)

### 3-1. 최우선 원칙: Hallucination 금지

- 도구 결과에 없는 정보를 절대 만들어내지 않는다
- 사용자가 언급한 사건명/인물명이 도구 결과에 정확히 일치하지 않으면:
  - 추측하거나 유사한 것을 대체하지 않는다
  - 도구 호출을 중단하고 사용자에게 역질문한다
- **법률 서비스에서 hallucination은 치명적** — 이것이 모든 규칙 중 최우선

### 3-2. 역질문 / 후속 질문 (대화형 에이전트 핵심)

- 사건 매칭 실패 시: 등록된 사건 목록 안내 + 역질문
- 정보 부족 시: 추가 정보 요청
- 사건 다수 시: 어떤 사건인지 확인 질문
- 모호한 요청 시: 의도 확인 질문
- **단답으로 끝내지 말고 다음 단계를 안내**한다

### 3-3. 도구가 없는 질문 처리

Agent가 가진 9개 도구로 답할 수 없는 질문 (예: 일정, 의뢰인 연락처)에는:
- 도구를 억지로 호출하지 않는다
- "해당 기능은 현재 AI 어쏘에서 직접 조회할 수 없습니다" + 해당 메뉴 안내

### 3-4. 도구 체인

- 한 번에 한 도구만 호출, 결과 확인 후 다음 도구 호출
- search_precedents의 query에는 사건명/인물명이 아닌 **법적 키워드** 사용
  (analyze_case 결과의 crime_names, legal_keywords 조합)

### 3-5. Grader 규칙

- 사용자가 특정 사건명/인물명을 지정했는데 도구 결과에 정확히 일치하는 것이 없으면 → irrelevant 판정
- 유사한 이름은 같은 것이 아님
- **list_cases는 Grader 스킵 대상이 아님**
  - skip_tools: `generate_timeline`, `generate_relationship`만

### 3-6. Generator 규칙

- **사용자의 원래 질문에 직접 답한다** (첫 HumanMessage 참조)
- **도구 결과를 그대로 반복하지 않는다** (도구 결과는 별도 패널에 표시됨)
- 채팅 답변에서는: 해석, 요약, 판단, 추천 등 **부가가치**만 작성
- 다음 단계를 안내하여 대화를 이어감 ("~도 해드릴까요?")
- Self-RAG: 도구 결과에 없는 판례번호/법조문에 [미확인] 태그

---

## 4. SSE 스트리밍 프로토콜

### 4-1. 이벤트 타입

| 이벤트 | 페이로드 | 설명 |
|---|---|---|
| `status` | `{step, message}` | 노드 진입 시 한글 상태 메시지 |
| `tool_start` | `{id, tool, input, message}` | 도구 실행 시작 (id = run_id) |
| `tool_end` | `{id, tool, result, structured, summary}` | 도구 실행 완료 |
| `token` | `{content}` | **generator 노드에서만** 토큰 전송 |
| `done` | `{}` | 스트리밍 완료 |
| `error` | `{message}` | 오류 |

### 4-2. 핵심 설계

- **router/agent/grader 노드의 토큰은 프론트에 전송하지 않는다**
- **`route` 이벤트 제거**
- tool_start/tool_end에 correlation ID (run_id) 사용
- tool_end에 구조화 데이터 + 한글 요약 포함

### 4-3. 에러 복구

- `_sanitize_messages()`: LLM 호출 전 메시지 정합성 검증
  - 이전 SSE 중단으로 tool_calls에 대응하는 ToolMessage가 누락된 경우 → placeholder 보충
  - OpenAI API "tool_call_ids did not have response messages" 400 에러 방지
- `BadRequestError` catch: 오염된 thread → 새 thread로 자동 재시도
- `handle_tool_errors=True`: 도구 실행 중 예외 → 에러 ToolMessage 생성

---

## 5. 도구 반환 형식 (구조화 데이터)

모든 도구는 JSON 문자열 `{"text": "LLM용 마크다운", "data": 구조화 데이터}` 형태로 반환.

| 도구 | data 형식 |
|---|---|
| `list_cases` | `[{id, title, client_name, opponent_name, case_type, status}]` |
| `analyze_case` | `{summary, facts, claims, crime_names[], legal_keywords[]}` |
| `generate_timeline` | `[{date, title, description, type, actor}]` |
| `generate_relationship` | `{persons: [...], relationships: [...]}` |
| `search_precedents` | `[{case_number, case_name, court, judgment_date, content_snippet}]` |
| `summarize_precedent` | `{case_number, summary}` |
| `compare_precedent` | `{case_overview, precedent_summary, similarities, differences, strategy_points}` |
| `search_laws` | `[{law_name, article_number, article_title, content}]` |
| `get_case_evidence` | `[{id, file_name, file_type, doc_type, starred, evidence_date, description, has_analysis, analysis_summary, legal_relevance, risk_level}]` |

---

## 6. 프론트엔드 UX

### 6-1. 3채널 상태 모델 (useAgentSSE)

| 채널 | 용도 | 데이터 |
|---|---|---|
| `steps` | 좌측 채팅 내 단계 표시 | `StepEvent[]` |
| `toolResults` | 우측 패널 리치 렌더링 | `ToolResult[]` |
| `streamingText` | generator 토큰만 | `string` |

phase 추적: `idle → routing → planning → executing → generating → done`

### 6-2. 채팅 영역 (좌측)

- 사용자 메시지 아래에 **Claude Code 스타일 단계별 진행 표시** (AgentStepsList)
  - 고정 높이 2-3줄 컨테이너. 새 단계가 추가되면 자동 스크롤
  - 완료된 단계가 위로 밀려 올라감 + 위쪽 페이드 그래디언트
- 최종 답변: **마크다운 렌더링** (react-markdown + remark-gfm)
- 채팅 헤더에 "새 대화" 버튼 (RotateCcw 아이콘)

### 6-3. 우측 패널 (리치 렌더링)

- **첫 tool_start 시 자동 오픈**
- **새 도구 결과 추가 시 자동으로 해당 탭으로 전환** (최신 결과 우선 표시)
- 탭 스트립: 도구별 아이콘 + 라벨로 결과 전환
- 도구별 전용 렌더러 (11개):

| 렌더러 | 표시 방식 |
|---|---|
| `CaseListRenderer` | 사건 카드 (클릭 → `/cases/:id`) |
| `CaseAnalysisRenderer` | 섹션별 카드 + "사건 상세 페이지에서 보기" 링크 |
| `PrecedentListRenderer` | 판례 카드 (클릭 → `/precedents/:caseNumber`) |
| `ComparisonRenderer` | 5섹션 (개요/판례/유사점/차이점/전략) |
| `TimelineRenderer` | 수직 타임라인 + "사건 상세 페이지에서 보기" 링크 |
| `RelationshipRenderer` | 인물 그리드 + 관계 리스트 + "사건 상세 페이지에서 보기" 링크 |
| `LawListRenderer` | 법령 카드 |
| `PrecedentSummaryRenderer` | 요약 텍스트 카드 |
| `EvidenceListRenderer` | 증거 카드 (파일명, 유형, 분석현황, 위험도) + 사건 상세 링크 |
| `RawTextRenderer` | 마크다운 폴백 |
| `ToolSkeleton` | 도구 유형별 스켈레톤 |

### 6-4. 채팅 상태 영속화 + 플로팅 버블

- **ChatContext** (React Context)가 채팅 상태를 전역 관리
- 페이지 이동해도 채팅 상태 유지
- 홈 이외 페이지에서는 우측 하단에 **플로팅 채팅 구체** 표시
  - 클릭 시 홈(채팅)으로 복귀
- **사이드바 홈 버튼 클릭 시 resetChat() 호출** → 랜딩 페이지로 복귀

---

## 7. 검증 시나리오

| # | 입력 | 기대 동작 |
|---|---|---|
| 1 | "안녕하세요" | 도구 호출 없이 인사. 패널 안 열림 |
| 2 | "[존재하는 사건] 분석해줘" | list → analyze → 채팅: 간단 요약 + "더 해드릴까요?" / 패널: 분석 상세 |
| 3 | "[존재하는 사건] 유사 판례 찾아줘" | list → analyze → search_precedents → 채팅: 판례 요약 / 패널: 판례 목록 |
| 4 | "[없는 사건] 분석해줘" | list → 매칭 실패 → 역질문 (등록된 사건 목록 안내) |
| 5 | "[존재하는 사건] 증거 현황 알려줘" | list → get_case_evidence → 채팅: 요약 / 패널: 증거 카드 |
| 6 | "승소하려면 어떤 증거가 더 필요할까?" | list → analyze → get_case_evidence → search_precedents → 종합 판단 |
| 7 | "[존재하는 사건] 타임라인 만들어줘" | list → analyze → generate_timeline → 패널: 타임라인 |

---

## 8. 비용

- 모델: gpt-4o-mini (입력 $0.15/1M, 출력 $0.60/1M)
- general 질문: LLM 2회 (~$0.001)
- simple 질문: LLM 4-5회 (~$0.003)
- complex 질문 (멀티홉): LLM 8-15회 (~$0.005-0.015)
- MVP 수준 월 $3-20 예상

---

## 9. 파일 구조

### 백엔드
```
backend/app/home_agent/
├── prompts.py          # 시스템 프롬프트 (Router/Agent/Grader/Generator/General)
├── nodes.py            # 5개 노드 함수 + 조건부 엣지 + Self-RAG + _sanitize_messages
├── graph.py            # StateGraph 정의 + 컴파일
├── tools.py            # 도구 9개 (구조화 데이터 반환)
└── checkpointer.py     # MemorySaver 체크포인터

backend/app/api/v1/
└── agent_api.py        # SSE 스트리밍 엔드포인트 (POST /api/v1/agent/chat)
```

### 프론트엔드
```
frontend/src/hooks/
└── useAgentSSE.ts      # 3채널 SSE 상태 관리 훅

frontend/src/contexts/
└── chat-context.tsx    # ChatContext (전역 채팅 상태 관리)

frontend/src/components/legal/home-agent/
├── agent-steps-list.tsx         # 단계별 진행 표시
├── markdown-message.tsx         # 마크다운 답변 렌더링
├── agent-results-panel.tsx      # 우측 패널 (탭 기반 + 자동 전환)
├── floating-chat-bubble.tsx     # 비홈 페이지 플로팅 버블
└── tool-renderers/
    ├── case-list-renderer.tsx        (클릭 → /cases/:id)
    ├── case-analysis-renderer.tsx    (+ 사건 상세 링크)
    ├── precedent-list-renderer.tsx   (클릭 → /precedents/:caseNumber)
    ├── comparison-renderer.tsx
    ├── timeline-renderer.tsx         (+ 사건 상세 링크)
    ├── relationship-renderer.tsx     (+ 사건 상세 링크)
    ├── law-list-renderer.tsx
    ├── precedent-summary-renderer.tsx
    ├── evidence-list-renderer.tsx    (증거 카드 + 사건 상세 링크)
    ├── raw-text-renderer.tsx
    └── tool-skeleton.tsx
```

---

## 10. 설계 원칙 (사용자 요구사항 아카이브)

이 섹션은 홈 에이전트의 **완성형 비전**을 기록한다.
매 세션마다 재설명하지 않기 위한 아카이브.

### 10-1. 절대 원칙

1. **Hallucination = 서비스 사망**: 법률 서비스에서 없는 정보를 지어내면 고소당한다.
   도구 결과에 없는 것은 절대 만들어내지 않는다. 모르면 "모릅니다" + 역질문.
2. **채팅 답변 ≠ 도구 결과 반복**: 도구 실행 결과는 이미 우측 패널에 표시된다.
   채팅 답변에서는 사용자 질문에 대한 해석/판단/추천만 제공.
   같은 데이터를 두 번 보여주면 안 된다.
3. **범용 프롬프트**: 프롬프트에 특정 사건명/인물명을 하드코딩하지 않는다.
   모든 규칙은 일반화되어야 한다.

### 10-2. UX 비전

1. **대화형 AI 에이전트** — 챗봇이 아님. Claude/ChatGPT 수준의 대화 능력.
   - 맥락을 이해하고 후속 질문으로 대화를 이어감
   - 부족한 정보는 역질문으로 보충
   - 어떤 질문이든 (도구가 없어도) 최소한 안내는 해줘야 함
2. **클로드 스타일 선택지 UI**: 역질문 시 "A/B/C 중 선택" + "직접 입력" 옵션
   → 사용자가 클릭으로 빠르게 응답 가능 (미구현)
3. **확장형 질문 지원**: "승소하려면 어떤 증거가 더 필요할까?" 같은 멀티홉 + 종합 판단 질문
   → 사건분석 + 증거현황 + 판례검색 → 전략적 조언 제공
4. **도구 결과 카드는 원본 페이지로 연결**: 사건 카드 → `/cases/:id`,
   판례 카드 → `/precedents/:caseNumber`, 증거 카드 → `/cases/:id`
5. **진행 상황 표시 2-3줄 고정**: 끝없이 늘어나지 않고 최신 작업만 표시
6. **우측 패널 탭 자동 전환**: 새 도구 결과가 나오면 자동으로 해당 탭으로 전환
7. **채팅 상태 영속**: 페이지 이동해도 대화 유지, 비홈 페이지에서 플로팅 버블

### 10-3. 다음 세션 작업 (우선순위 순)

**1. 답변 후 추천 질문 (Follow-up Suggestions)**
- 에이전트 답변 아래에 연결/파생 질문 2-3개를 추천
- 모든 답변이 아닌, 추천이 유용한 답변에 대해서만 표시
- 예: "고길동 사건 분석해줘" 답변 후 → "유사 판례를 검색할까요?", "타임라인을 만들어볼까요?"
- 사용자가 클릭하면 해당 질문이 바로 전송되는 형태

**2. 미등록 사건 → 새 사건 등록 유도**
- "김개똥 사건 분석해줘" → 사건 없음 안내까지는 현재 OK
- 여기서 끝내지 말고 "새로운 사건을 등록하시겠습니까?" 액션 추천
- 클릭 시 새 사건 등록 페이지(`/new-case`)로 이동 또는 등록 플로우 시작

**3. 증거 카드 확장 UI (원본 이미지 인라인 확인)**
- 현재: 증거 카드에 "사건 상세 페이지에서 보기" 링크만 있음
- 변경: 각 증거 카드에 확장(expand) UI 추가
- 카드 확장 시 원본 파일 이미지를 카드 내에서 바로 확인 가능
- 채팅 중 페이지 이동 없이 증거 원본을 빠르게 확인하는 UX
- Supabase signed URL로 이미지 로드

### 10-4. 아직 구현 안 된 것 (TODO)

- [ ] 클로드 스타일 클릭 가능한 선택지 버튼 UI (역질문 시 A/B/C/D 옵션)
- [ ] 대화 기록 DB 영속화 (현재 MemorySaver = 메모리 only, 서버 재시작 시 소실)
- [ ] MemorySaver → AsyncPostgresSaver 전환 (Supabase PostgreSQL 직결, AWS 멀티워커 대응)
- [ ] 에이전트 답변 피드백 (좋아요/싫어요)
- [ ] 대화 기록 목록/검색 (사이드바에서 이전 대화 선택)

### 10-4. 해결된 이슈 로그

| 이슈 | 원인 | 해결 |
|---|---|---|
| `{"route":"general"}` 디버그 정보 노출 | 모든 노드 토큰을 SSE로 전송 | generator 노드만 token 이벤트 전송 |
| 홍길동→고길동 hallucination | list_cases가 Grader skip_tools에 포함 | skip_tools에서 list_cases 제거 |
| 프롬프트에 특정 이름 하드코딩 | 디버깅 시 특정 사례로 작성 | 모든 프롬프트 범용화 |
| tool_call_ids 400 에러 반복 | SSE 중단 시 checkpointer 상태 오염 | _sanitize_messages + BadRequestError 재시도 |
| 멀티홉 안 됨 (analyze에서 끝남) | Grader relevant → Generator 직행 | Grader → Agent 복귀 (멀티홉 루프) |
| 채팅 답변이 도구 결과 반복 | Generator가 도구 출력 재포맷 | Generator 프롬프트: "패널에 이미 표시됨. 반복하지 마라" |
| 증거 현황 조회 불가 | get_case_evidence 도구 없음 | 도구 추가 (DB 직접 쿼리) |
| 홈 버튼 눌러도 랜딩 안 나옴 | ChatContext 상태가 유지됨 | 홈 NavLink onClick에 resetChat() 추가 |
| 패널이 첫 번째 탭(사건목록)만 표시 | activeTab 초기값 0 고정 | useEffect로 최신 탭 자동 전환 |
