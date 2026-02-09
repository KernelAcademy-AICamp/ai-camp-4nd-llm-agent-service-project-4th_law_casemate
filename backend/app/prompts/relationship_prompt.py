"""
관계도 자동 생성을 위한 프롬프트
"""

RELATIONSHIP_GENERATION_PROMPT = """당신은 법률 사건의 인물 관계도를 분석하는 전문가입니다.

다음 사건 정보를 바탕으로 주요 인물들과 그들 간의 관계를 파악하여 관계도를 생성하세요.

## 사건 정보

### 의뢰인 정보
- 의뢰인 이름: {client_name}
- 의뢰인 역할: {client_role}

### 사건 요약
{summary}

### 사실관계
{facts}

### 타임라인 요약
{timeline_summary}

## 작업 지침

1. **주요 인물 추출**:
   - 의뢰인, 상대방(피고소인/가해자), 증인, 관련자 등 사건에 등장하는 모든 중요 인물
   - 이름은 익명화하여 표시 (예: "김OO", "박OO", "이OO")
   - 각 인물의 역할을 명확히 분류 (피해자, 가해자, 증인, 동료, 상사, 미확인 등)
   - 인물에 대한 간단한 설명 추가

2. **관계 파악**:
   - 인물 간의 법적 관계 (명예훼손, 폭행, 계약 등)
   - 인물 간의 사실적 관계 (동료, 상사, 목격자 등)
   - 관계의 방향성 파악 (단방향 vs 양방향)
     * 단방향: A가 B를 명예훼손, A가 B를 목격 등
     * 양방향: A와 B는 동료, A와 B는 친구 등
   - 관계에 대한 간단한 메모 추가 (구체적 행위, 조사 필요 사항 등)

3. **중요도 기준**:
   - 법적 쟁점과 직접 관련된 인물 우선
   - 증거나 증언으로 언급된 인물 포함
   - 단순 배경 인물은 제외

## 응답 형식

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명이나 텍스트를 추가하지 마세요.

```json
{{
  "persons": [
    {{
      "name": "김OO",
      "role": "피해자",
      "description": "의뢰인, 명예훼손 피해 당사자"
    }},
    {{
      "name": "박OO",
      "role": "가해자",
      "description": "피고소인, 단톡방에서 명예훼손 발언"
    }},
    {{
      "name": "이OO",
      "role": "증인",
      "description": "회식 자리 목격자"
    }}
  ],
  "relationships": [
    {{
      "source": "박OO",
      "target": "김OO",
      "type": "명예훼손",
      "label": "명예훼손",
      "memo": "단톡방 비방 발언 및 허위사실 유포",
      "directed": true
    }},
    {{
      "source": "이OO",
      "target": "김OO",
      "type": "목격",
      "label": "목격",
      "memo": "회식 자리 모욕 발언 목격",
      "directed": true
    }},
    {{
      "source": "김OO",
      "target": "박OO",
      "type": "동료",
      "label": "동료",
      "memo": "같은 부서 근무",
      "directed": false
    }}
  ]
}}
```

## 필드 설명

**persons (인물 목록)**:
- name: 익명화된 이름 (예: "김OO")
- role: 피해자, 가해자, 증인, 동료, 상사, 미확인 등
- description: 인물에 대한 간단한 설명

**relationships (관계 목록)**:
- source: 관계의 출발점 인물 이름 (persons의 name과 정확히 일치해야 함)
- target: 관계의 도착점 인물 이름 (persons의 name과 정확히 일치해야 함)
- type: 관계 유형 (명예훼손, 폭행, 목격, 동료, 상사 등)
- label: 관계도에 표시될 라벨 (짧게)
- memo: 관계에 대한 상세 설명 또는 조사 필요 사항
- directed: true(단방향) 또는 false(양방향)

## 예시

**명예훼손 사건 예시:**

```json
{{
  "persons": [
    {{
      "name": "김OO",
      "role": "피해자",
      "description": "의뢰인, 직장 내 명예훼손 피해자"
    }},
    {{
      "name": "박OO",
      "role": "가해자",
      "description": "피고소인, 단톡방에서 허위사실 유포"
    }},
    {{
      "name": "이OO",
      "role": "증인",
      "description": "회식 자리 목격자, 진술서 제공"
    }},
    {{
      "name": "정OO",
      "role": "동료",
      "description": "같은 부서 동료, 중립적 입장"
    }},
    {{
      "name": "미확인 상사",
      "role": "미확인",
      "description": "박OO에게 지시했다는 소문, 확인 필요"
    }}
  ],
  "relationships": [
    {{
      "source": "박OO",
      "target": "김OO",
      "type": "명예훼손",
      "label": "명예훼손",
      "memo": "단톡방 비방 발언 및 횡령 허위사실 유포",
      "directed": true
    }},
    {{
      "source": "이OO",
      "target": "김OO",
      "type": "목격",
      "label": "목격",
      "memo": "회식 자리에서 모욕 발언 목격, 진술서 제공",
      "directed": true
    }},
    {{
      "source": "정OO",
      "target": "김OO",
      "type": "동료",
      "label": "동료",
      "memo": "같은 부서 근무",
      "directed": false
    }},
    {{
      "source": "정OO",
      "target": "박OO",
      "type": "동료",
      "label": "동료",
      "memo": "같은 부서 근무",
      "directed": false
    }},
    {{
      "source": "미확인 상사",
      "target": "박OO",
      "type": "상사 관계",
      "label": "상사 관계",
      "memo": "지시자 가능성 있음, 추가 조사 필요",
      "directed": true
    }}
  ]
}}
```

이제 위 사건 정보를 바탕으로 관계도 JSON을 생성해주세요:
"""


def create_relationship_prompt(
    summary: str,
    facts: str,
    timeline_summary: str,
    client_name: str = "의뢰인",
    client_role: str = "원고"
) -> str:
    """
    관계도 생성 프롬프트 생성

    Args:
        summary: 사건 요약
        facts: 사실관계
        timeline_summary: 타임라인 요약 (주요 이벤트들)
        client_name: 의뢰인 이름
        client_role: 의뢰인 역할 (원고/피고 등)

    Returns:
        완성된 프롬프트
    """
    return RELATIONSHIP_GENERATION_PROMPT.format(
        client_name=client_name or "의뢰인",
        client_role=client_role or "원고",
        summary=summary or "없음",
        facts=facts or "없음",
        timeline_summary=timeline_summary or "없음"
    )
