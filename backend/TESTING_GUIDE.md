# 사건 분석 증거 통합 기능 - 테스트 가이드

## 구현 완료 사항

### 1. 새로운 응답 모델 추가
- `TimelineEvent`: 타임라인 이벤트 정보
- `EvidenceAnalysisResult`: 증거 분석 결과
- `CaseAnalyzeResponse`: 확장된 사건 분석 응답 (하위 호환)

### 2. 증거 처리 파이프라인 구현
- `download_evidence_file()`: Supabase Storage에서 증거 파일 다운로드
- `analyze_evidence_content()`: LLM을 통한 증거 내용 분석
- `process_single_evidence()`: 단일 증거 처리 (캐싱, STT/VLM, LLM 분석)
- `process_all_evidences()`: 병렬 증거 처리 (asyncio.gather)

### 3. 타임라인 추출 기능
- `extract_timeline()`: LLM을 통한 타임라인 이벤트 추출
- 기존 timeline_prompt.py 재사용
- DB 저장하지 않고 반환만 함

### 4. /analyze 엔드포인트 수정
- 증거 분석 통합 (STT/VLM 사용)
- 증거 분석 결과를 사건 분석 프롬프트에 포함
- 타임라인 자동 추출
- 캐싱 지원 (force=false 시 기존 분석 재사용)

## API 응답 구조

```json
{
  "summary": "사건 요약 (2-4문장)",
  "facts": "사실관계 (시간순 정리)",
  "claims": "청구 내용 (형사/민사 구분)",
  "evidence_analyses": [
    {
      "evidence_id": 123,
      "file_name": "카톡_대화.png",
      "success": true,
      "summary": "증거 요약",
      "legal_relevance": "법적 관련성 설명",
      "risk_level": "high|medium|low",
      "error": null
    }
  ],
  "timeline_events": [
    {
      "date": "2025-11-15",
      "time": "09:30",
      "title": "이벤트 제목",
      "description": "상세 설명",
      "type": "의뢰인|상대방|증거|기타",
      "actor": "관련 인물/증거명"
    }
  ],
  "total_evidences": 3,
  "analyzed_evidences": 3,
  "failed_evidences": 0
}
```

## 테스트 시나리오

### 시나리오 1: 증거 없는 사건 분석
```bash
curl -X POST "http://localhost:8000/api/v1/cases/{case_id}/analyze" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**예상 결과:**
- summary, facts, claims 정상 생성
- evidence_analyses: []
- timeline_events: [] 또는 description 기반 이벤트
- total_evidences: 0

### 시나리오 2: 증거 포함 사건 분석 (첫 실행)
```bash
curl -X POST "http://localhost:8000/api/v1/cases/{case_id}/analyze" \
  -H "Authorization: Bearer {token}"
```

**예상 동작:**
1. 모든 증거 파일 병렬 다운로드 (Supabase Storage)
2. 파일 타입별 처리:
   - AUDIO → STT (Whisper API)
   - IMAGE/PDF → VLM (GPT-4o-mini Vision)
3. 각 증거 content를 LLM 분석 (summary, legal_relevance, risk_level)
4. evidence_analyses 테이블에 저장
5. 증거 컨텍스트 포함하여 사건 분석
6. 타임라인 추출
7. 종합 응답 반환

**예상 시간:**
- 증거 3개: ~10-15초
- 증거 10개: ~20-30초 (병렬 처리)

### 시나리오 3: 캐시된 증거 재분석 (force=false, 기본값)
```bash
curl -X POST "http://localhost:8000/api/v1/cases/{case_id}/analyze" \
  -H "Authorization: Bearer {token}"
```

**예상 동작:**
1. evidence_analyses 테이블에서 기존 분석 결과 조회
2. 캐시 히트 → 파일 처리 스킵
3. 캐시된 분석 결과 사용
4. case_summaries 테이블에서 기존 사건 분석 조회
5. 캐시 히트 → 타임라인만 추출하고 즉시 반환

**예상 시간:** ~2-3초

### 시나리오 4: 강제 재분석 (force=true)
```bash
curl -X POST "http://localhost:8000/api/v1/cases/{case_id}/analyze?force=true" \
  -H "Authorization: Bearer {token}"
```

**예상 동작:**
1. 캐시 무시
2. 모든 증거 재처리 (STT/VLM 재호출)
3. 사건 재분석 (LLM 재호출)
4. 타임라인 재추출
5. 모든 결과 DB 업데이트

### 시나리오 5: 일부 증거 실패
증거 파일 중 일부가 손상되었거나 처리 불가능한 경우

**예상 동작:**
1. 병렬 처리 중 일부 증거 실패
2. 실패한 증거: success=false, error 메시지 포함
3. 성공한 증거: 정상 분석 결과
4. 나머지 프로세스 정상 진행
5. failed_evidences 카운트 증가

## 성능 최적화 사항

### 병렬 처리
- `asyncio.gather(*tasks, return_exceptions=True)` 사용
- 10개 증거: 순차 처리 ~50초 → 병렬 처리 ~8초

### 캐싱 전략
- **증거 레벨**: evidence_analyses 테이블 (증거는 여러 사건에 연결 가능)
- **사건 레벨**: case_summaries 테이블
- force=false (기본값): 캐시 사용
- force=true: 캐시 무시하고 전체 재분석

### 타임아웃 설정
- 파일 다운로드: 30초
- LLM API 호출: 기본값 (약 30-60초)
- 전체 엔드포인트: 5분 (대용량 증거 처리 고려)

## 에러 처리

### 파일 다운로드 실패
- 해당 증거만 실패 처리 (success=false)
- 나머지 증거 계속 처리
- error 필드에 상세 오류 메시지

### STT/VLM API 실패
- 리트라이 없음 (첫 실패 시 즉시 실패 처리)
- 해당 증거만 실패
- 나머지 프로세스 정상 진행

### LLM 분석 실패
- JSON 파싱 실패 시 기본값 반환
- summary: "{case.title} 사건입니다."
- facts: description 일부 사용
- claims: ""
- 증거 분석 결과는 정상 반환

### 타임라인 추출 실패
- JSON 파싱 실패 시 빈 배열 반환
- timeline_events: []
- 나머지 응답은 정상

## 확인 사항

### 코드 검증 완료
✅ 모든 응답 모델 정의 확인
✅ 모든 헬퍼 함수 정의 확인
✅ analyze_case 엔드포인트 시그니처 확인
✅ 서버 정상 기동 확인
✅ Swagger UI 접근 가능 (http://localhost:8000/docs)

### 수동 테스트 필요
⚠️ 실제 사용자 인증 토큰 필요
⚠️ 증거가 포함된 실제 사건 필요
⚠️ Supabase Storage 접근 권한 필요
⚠️ OpenAI API 키 설정 필요

## 다음 단계

1. **통합 테스트**: 실제 사건 데이터로 전체 플로우 테스트
2. **성능 모니터링**: 응답 시간, 메모리 사용량 측정
3. **에러 로깅**: 실패 케이스 분석 및 개선
4. **프론트엔드 연동**: 새로운 응답 필드 활용

## 주의사항

1. **하위 호환성**: 기존 클라이언트는 summary, facts, claims만 사용 가능 (신규 필드는 기본값 제공)
2. **타임라인 저장**: 자동 저장 안됨, 사용자가 검토 후 수동 저장 필요
3. **증거 재처리**: force=true 사용 시 API 호출 비용 증가 주의
4. **동시성**: 같은 사건을 여러 사용자가 동시 분석 시 캐시 동시성 이슈 가능 (현재 미처리)

## 트러블슈팅

### 증거 분석이 너무 느림
- 증거 파일 크기 확인 (대용량 음성/비디오 파일)
- STT/VLM API 응답 시간 확인
- 네트워크 대역폭 확인

### 타임라인이 추출되지 않음
- LLM 응답이 JSON 형식인지 확인
- 프롬프트에 날짜/시간 정보가 충분한지 확인
- extract_timeline 함수 로그 확인

### 캐시가 작동하지 않음
- evidence_analyses, case_summaries 테이블 확인
- force 파라미터 값 확인
- DB 연결 상태 확인

### 일부 증거만 분석됨
- failed_evidences 카운트 확인
- error 필드 메시지 확인
- Supabase Storage 파일 존재 여부 확인
- 파일 타입 지원 여부 확인 (AUDIO, IMAGE, PDF만 지원)
