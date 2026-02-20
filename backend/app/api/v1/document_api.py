"""
법률 문서 초안 생성 + CRUD API
사건 데이터 기반 RAG 파이프라인으로 고소장/내용증명/소장 초안 생성
문서 저장/불러오기/수정/삭제 지원

v1.0: 고소장(complaint) 우선 구현
v1.1: CRUD + Markdown 출력 지시 추가
"""

import os
import json
import hashlib
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import or_
from openai import OpenAI

from tool.database import get_db
from tool.security import get_current_user
from app.models.evidence import Case, CaseAnalysis, Evidence, CaseEvidenceMapping
from app.models.timeline import TimeLine
from app.models.case_document import CaseDocument, CaseDocumentDraft
from app.models.user import User

router = APIRouter(tags=["Documents"])

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ==================== Request/Response 스키마 ====================

class GenerateDocumentRequest(BaseModel):
    case_id: int
    document_type: str = "criminal_complaint"  # criminal_complaint | demand_letter | civil_complaint


class GenerateDocumentResponse(BaseModel):
    document_type: str
    title: str
    content: str
    context_used: dict


class GenerateSectionsRequest(BaseModel):
    case_id: int


class GenerateSectionsResponse(BaseModel):
    crime_facts: str       # 범죄사실
    complaint_reason: str  # 고소이유


class CreateDocumentRequest(BaseModel):
    case_id: int
    title: str
    document_type: str = "criminal_complaint"
    content: str = ""
    access_level: str = "firm_readonly"  # private, firm_readonly, firm_editable


class UpdateDocumentRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    access_level: Optional[str] = None


class DocumentResponse(BaseModel):
    id: int
    case_id: int
    title: str
    document_type: str
    content: Optional[str] = None
    access_level: str = "firm_readonly"
    created_by: Optional[int] = None
    version: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class DocumentListItem(BaseModel):
    id: int
    title: str
    document_type: str
    access_level: str = "firm_readonly"
    created_by: Optional[int] = None
    updated_at: Optional[str] = None


class DocumentListItemWithCase(BaseModel):
    id: int
    case_id: int
    title: str
    document_type: str
    access_level: str = "firm_readonly"
    created_by: Optional[int] = None
    updated_at: Optional[str] = None


# ==================== 프롬프트 템플릿 ====================

MARKDOWN_OUTPUT_INSTRUCTION = """
출력 형식:
- 반드시 Markdown 형식으로 작성
- 대제목은 # (h1), 섹션은 ## (h2), 하위 항목은 ### (h3)
- 목록은 - 또는 1. 사용, 강조는 **굵게**"""

# ===== 고소장: HTML 양식 채우기 모드 =====
COMPLAINT_SYSTEM_PROMPT = """너는 법률 문서 작성 보조 AI다.
사용자가 제공하는 사건 데이터를 기반으로, 제공된 고소장 HTML 양식의 빈 칸을 채워 초안을 작성한다.

작성 원칙:
- 제공된 HTML 양식의 구조(태그, 테이블 구조, 섹션 순서)를 절대 변경하지 말 것
- 빈 <td> 셀에 사건 데이터의 해당 정보를 기입
- 고소인 정보: 의뢰인(client) 데이터로 채움
- 피고소인 정보: 상대방(opponent) 데이터로 채움
- 고소취지의 ○○죄를 [적용 죄명]에 명시된 실제 죄명으로 대체
- 범죄사실은 일시, 장소, 범행방법, 결과를 시간순으로 구체적으로 서술
- 고소이유는 범행 경위, 정황, 고소 동기를 간략 명료하게 서술
- 증거자료: 증거가 있으면 해당 ☐를 ☑로 변경
- 별지 증거서류/증거물 목록에 증거를 증 제N호증으로 기입
- 확인되지 않은 정보 처리: 피고소인의 주소를 모르면 "주소 불상", 주민등록번호를 모르면 "주민등록번호 불상", 직업을 모르면 "직업 불상", 연락처를 모르면 "연락처 불상"으로 기재
- 법률 전문 용어를 사용하되 문장은 명확하게 작성

출력 규칙:
- 반드시 순수 HTML만 출력 (```html 코드블록으로 감싸지 말 것)
- <h1>, <h2>, <h3>, <p>, <table>, <tbody>, <tr>, <th>, <td>, <strong>, <em>, <ul>, <ol>, <li>, <blockquote>, <hr>, <br> 태그만 사용
- style 속성은 text-align만 허용"""

NOTICE_SYSTEM_PROMPT = """너는 명예훼손 전문 법률 문서 작성 보조 AI다.
사용자가 제공하는 사건 데이터를 기반으로 내용증명 초안을 작성한다.

작성 원칙:
- 내용증명의 형식(발신인/수신인/제목/본문/날짜)을 준수
- 피해 사실을 명확히 기술하고 시정을 요구
- 법적 근거를 간결하게 인용
- 향후 법적 조치 가능성을 언급
- 정중하되 단호한 어조로 작성""" + MARKDOWN_OUTPUT_INSTRUCTION

CIVIL_SUIT_SYSTEM_PROMPT = """너는 명예훼손 전문 법률 문서 작성 보조 AI다.
사용자가 제공하는 사건 데이터를 기반으로 손해배상 청구 소장 초안을 작성한다.

작성 원칙:
- 소장의 법적 형식(원고/피고/청구취지/청구원인/입증방법/첨부서류)을 엄격히 준수
- 청구원인은 사실관계와 법률적 근거를 구분하여 서술
- 손해배상 산정 근거를 포함
- 증거방법은 증거 파일 목록을 갑 제N호증으로 번호 부여""" + MARKDOWN_OUTPUT_INSTRUCTION

SYSTEM_PROMPTS = {
    "criminal_complaint": COMPLAINT_SYSTEM_PROMPT,
    "demand_letter": NOTICE_SYSTEM_PROMPT,
    "civil_complaint": CIVIL_SUIT_SYSTEM_PROMPT,
}

# 고소장 HTML 양식 (프론트엔드 Tiptap 에디터와 동일한 구조)
COMPLAINT_HTML_TEMPLATE = """<h1>고 \u00a0 소 \u00a0 장</h1>
<p><em>(고소장 기재사항 중 <strong>*</strong> 표시된 항목은 반드시 기재하여야 합니다.)</em></p>
<hr>
<h2>1. 고소인*</h2>
<table><tbody>
<tr><th>성 \u00a0 명<br>(상호\u2027대표자)</th><td></td><th>주민등록번호<br>(법인등록번호)</th><td>\u00a0\u00a0\u00a0\u00a0 - \u00a0\u00a0\u00a0\u00a0</td></tr>
<tr><th>주 \u00a0 소<br>(주사무소 소재지)</th><td colspan="3"></td></tr>
<tr><th>직 \u00a0 업</th><td></td><th>사무실<br>주소</th><td></td></tr>
<tr><th>전 \u00a0 화</th><td colspan="3">(휴대폰)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (자택)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (사무실)</td></tr>
<tr><th>이메일</th><td colspan="3"></td></tr>
<tr><th>대리인에<br>의한 고소</th><td colspan="3">\u2610 법정대리인 (성명 :\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0, 연락처\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0)<br>\u2610 고소대리인 (성명 : 변호사\u00a0\u00a0\u00a0\u00a0\u00a0, 연락처\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0)</td></tr>
</tbody></table>
<blockquote><p>\u203b 고소인이 법인 또는 단체인 경우에는 상호 또는 단체명, 대표자, 법인등록번호(또는 사업자등록번호), 주된 사무소의 소재지, 전화 등 연락처를 기재해야 하며, 법인의 경우에는 법인등기부 등본이 첨부되어야 합니다.</p></blockquote>
<blockquote><p>\u203b 미성년자의 친권자 등 법정대리인이 고소하는 경우 및 변호사에 의한 고소대리의 경우 법정대리인 관계, 변호사 선임을 증명할 수 있는 서류를 첨부하시기 바랍니다.</p></blockquote>
<hr>
<h2>2. 피고소인*</h2>
<table><tbody>
<tr><th>성 \u00a0 명</th><td></td><th>주민등록번호</th><td>\u00a0\u00a0\u00a0\u00a0 - \u00a0\u00a0\u00a0\u00a0</td></tr>
<tr><th>주 \u00a0 소</th><td colspan="3"></td></tr>
<tr><th>직 \u00a0 업</th><td></td><th>사무실<br>주소</th><td></td></tr>
<tr><th>전 \u00a0 화</th><td colspan="3">(휴대폰)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (자택)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (사무실)</td></tr>
<tr><th>이메일</th><td colspan="3"></td></tr>
<tr><th>기타사항</th><td colspan="3"></td></tr>
</tbody></table>
<blockquote><p>\u203b 피고소인에 대해 알고 있는 사항을 기재하여 주시기 바랍니다.</p></blockquote>
<hr>
<h2>3. 고소취지*</h2>
<p><em>(죄명 및 피고소인에 대한 처벌의사 기재)</em></p>
<p>고소인은 피고소인을 <strong>\u25cb\u25cb죄</strong>로 고소하오니 철저히 수사하여 엄벌에 처하여 주시기 바랍니다.</p>
<hr>
<h2>4. 범죄사실*</h2>
<blockquote><p>\u203b 범죄사실은 일시, 장소, 범행방법, 결과 등을 구체적으로 특정하여 기재하여야 합니다.</p></blockquote>
<p>[범죄사실 기재]</p>
<hr>
<h2>5. 고소이유</h2>
<blockquote><p>\u203b 고소이유에는 피고소인의 범행 경위 및 정황, 고소를 하게 된 동기와 사유를 간략, 명료하게 기재해야 합니다.</p></blockquote>
<p>[고소이유 기재]</p>
<hr>
<h2>6. 증거자료</h2>
<p><em>(\u25a0 해당란에 체크하여 주시기 바랍니다)</em></p>
<ul><li>\u2610 고소인은 고소인의 진술 외에 제출할 증거가 <strong>없습니다.</strong></li>
<li>\u2610 고소인은 고소인의 진술 외에 제출할 증거가 <strong>있습니다.</strong></li></ul>
<p>\u00a0\u00a0\u00a0\u00a0\u261e 제출할 증거의 세부내역은 별지를 작성하여 첨부합니다.</p>
<hr>
<h2>7. 관련사건의 수사 및 재판 여부*</h2>
<table><tbody>
<tr><th>\u2460 중복 고소 여부</th><td>본 고소장과 같은 내용의 고소장을 다른 검찰청 또는 경찰서에 제출하거나 제출하였던 사실이 있습니다 \u2610 / 없습니다 \u2610</td></tr>
<tr><th>\u2461 관련 형사사건<br>수사 유무</th><td>본 고소장에 기재된 범죄사실과 관련된 사건 또는 공범에 대하여 검찰청이나 경찰서에서 수사 중에 있습니다 \u2610 / 수사 중에 있지 않습니다 \u2610</td></tr>
<tr><th>\u2462 관련 민사소송<br>유무</th><td>본 고소장에 기재된 범죄사실과 관련된 사건에 대하여 법원에서 민사소송 중에 있습니다 \u2610 / 민사소송 중에 있지 않습니다 \u2610</td></tr>
<tr><th>기타사항</th><td></td></tr>
</tbody></table>
<hr>
<h2>8. 기타</h2>
<h3 style="text-align: center">(고소내용에 대한 진실확약)</h3>
<p>본 고소장에 기재한 내용은 고소인이 알고 있는 지식과 경험을 바탕으로 모두 사실대로 작성하였으며, 만일 허위사실을 고소하였을 때에는 <strong>형법 제156조 무고죄</strong>로 처벌받을 것임을 서약합니다.</p>
<p style="text-align: center"><strong>\u00a0\u00a0\u00a0\u00a0년 \u00a0\u00a0 월 \u00a0\u00a0\u00a0 일*</strong></p>
<table><tbody>
<tr><th>고소인</th><td>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0(인)*</td></tr>
<tr><th>제출인</th><td>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0(인)</td></tr>
</tbody></table>
<p style="text-align: center"><strong>관할 경찰서장 귀하</strong></p>
<hr>
<h1>별지 : 증거자료 세부 목록</h1>
<h2>1. 인적증거 (목격자, 기타 참고인 등)</h2>
<table><tbody>
<tr><th>성 \u00a0 명</th><td></td><th>주민등록번호</th><td>\u00a0\u00a0\u00a0\u00a0 - \u00a0\u00a0\u00a0\u00a0</td></tr>
<tr><th rowspan="2">주 \u00a0 소</th><td colspan="3">\u00a0자택 :</td></tr>
<tr><td colspan="3">\u00a0직장 :</td></tr>
<tr><th>전 \u00a0 화</th><td colspan="3">(휴대폰)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (자택)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (사무실)</td></tr>
<tr><th>입증하려는<br>내용</th><td colspan="3"></td></tr>
</tbody></table>
<h2>2. 증거서류</h2>
<table><tbody>
<tr><th>순번</th><th>증거</th><th>작성자</th><th>제출 유무</th></tr>
<tr><td>1</td><td></td><td></td><td>\u2610 접수시 제출 \u00a0 \u2610 수사 중 제출</td></tr>
<tr><td>2</td><td></td><td></td><td>\u2610 접수시 제출 \u00a0 \u2610 수사 중 제출</td></tr>
<tr><td>3</td><td></td><td></td><td>\u2610 접수시 제출 \u00a0 \u2610 수사 중 제출</td></tr>
</tbody></table>
<h2>3. 증거물</h2>
<table><tbody>
<tr><th>순번</th><th>증거</th><th>소유자</th><th>제출 유무</th></tr>
<tr><td>1</td><td></td><td></td><td>\u2610 접수시 제출 \u00a0 \u2610 수사 중 제출</td></tr>
<tr><td>2</td><td></td><td></td><td>\u2610 접수시 제출 \u00a0 \u2610 수사 중 제출</td></tr>
<tr><td>3</td><td></td><td></td><td>\u2610 접수시 제출 \u00a0 \u2610 수사 중 제출</td></tr>
</tbody></table>
<h2>4. 기타 증거</h2>
<p>[기타 증거 기재]</p>"""

# 문서 유형별 출력 템플릿 구조
DOCUMENT_TEMPLATES = {
    "criminal_complaint": "",  # criminal_complaint는 COMPLAINT_HTML_TEMPLATE 사용
    "demand_letter": """
아래 Markdown 구조를 반드시 따르세요:

# 내 용 증 명
## 발신인 / 수신인
## 제목
## 본문
### 피해 사실
### 시정 요구
### 법적 조치 경고
## 날짜""",
    "civil_complaint": """
아래 Markdown 구조를 반드시 따르세요:

# 소    장
## 원고 / 피고
## 청 구 취 지
## 청 구 원 인
### 1. 당사자의 지위
### 2. 사실관계
### 3. 피고의 책임
## 입 증 방 법
## 첨 부 서 류""",
}


# ==================== RAG: 사건 데이터 수집 ====================

def retrieve_case_context(case_id: int, db: Session) -> dict:
    """사건 관련 데이터를 DB에서 수집 (Retrieval)"""

    # 1. 사건 기본 정보
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

    # 2. 사건 분석 결과 (summary, facts, claims, legal_keywords, legal_laws)
    analysis = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()

    # 3. 증거 목록
    evidence_mappings = (
        db.query(CaseEvidenceMapping, Evidence)
        .join(Evidence, CaseEvidenceMapping.evidence_id == Evidence.id)
        .filter(CaseEvidenceMapping.case_id == case_id)
        .all()
    )

    # 4. 타임라인
    timeline_events = (
        db.query(TimeLine)
        .filter(TimeLine.case_id == case_id)
        .order_by(TimeLine.date, TimeLine.order_index)
        .all()
    )

    # 데이터 구조화
    evidences = []
    for mapping, evidence in evidence_mappings:
        evidences.append({
            "file_name": evidence.file_name,
            "doc_type": evidence.doc_type or "기타",
            "description": mapping.description or "",
        })

    timeline = []
    for event in timeline_events:
        timeline.append({
            "date": event.date,
            "title": event.title,
            "description": event.description or "",
        })

    # JSON 필드 파싱
    facts = None
    claims = None
    crime_names = []
    legal_keywords = []
    legal_laws = []

    if analysis:
        if analysis.facts:
            try:
                facts = json.loads(analysis.facts)
            except json.JSONDecodeError:
                facts = analysis.facts
        if analysis.claims:
            try:
                claims = json.loads(analysis.claims)
            except json.JSONDecodeError:
                claims = analysis.claims
        if analysis.crime_names:
            try:
                crime_names = json.loads(analysis.crime_names)
            except json.JSONDecodeError:
                pass
        if analysis.legal_keywords:
            try:
                legal_keywords = json.loads(analysis.legal_keywords)
            except json.JSONDecodeError:
                pass
        if analysis.legal_laws:
            try:
                legal_laws = json.loads(analysis.legal_laws)
            except json.JSONDecodeError:
                pass

    return {
        "case": {
            "title": case.title,
            "client_name": case.client_name or "[의뢰인]",
            "client_role": case.client_role or "[역할]",
            "opponent_name": case.opponent_name or "[상대방]",
            "opponent_role": case.opponent_role or "[역할]",
            "case_type": case.case_type or "명예훼손",
            "description": case.description or "",
        },
        "analysis": {
            "summary": analysis.summary if analysis else None,
            "facts": facts,
            "claims": claims,
            "crime_names": crime_names,
            "legal_keywords": legal_keywords,
            "legal_laws": legal_laws,
        },
        "evidences": evidences,
        "timeline": timeline,
    }


# ==================== RAG: 프롬프트 구성 ====================

def build_user_prompt(context: dict, document_type: str) -> str:
    """사건 데이터로 유저 프롬프트 구성 (Augmentation)"""

    case = context["case"]
    analysis = context["analysis"]
    evidences = context["evidences"]
    timeline = context["timeline"]

    sections = []

    # 사건 정보
    sections.append(f"""[사건 정보]
- 사건명: {case['title']}
- 고소인(의뢰인): {case['client_name']} ({case['client_role']})
- 피고소인(상대방): {case['opponent_name']} ({case['opponent_role']})
- 사건 유형: {case['case_type']}""")

    # 사건 요약
    if analysis["summary"]:
        sections.append(f"[사건 요약]\n{analysis['summary']}")

    # 사실관계
    if analysis["facts"]:
        if isinstance(analysis["facts"], list):
            facts_text = "\n".join(f"- {f}" for f in analysis["facts"])
        else:
            facts_text = str(analysis["facts"])
        sections.append(f"[사실관계]\n{facts_text}")

    # 청구내용
    if analysis["claims"]:
        if isinstance(analysis["claims"], dict):
            claims_parts = []
            for category, items in analysis["claims"].items():
                claims_parts.append(f"  [{category}]")
                if isinstance(items, list):
                    for item in items:
                        claims_parts.append(f"  - {item}")
                else:
                    claims_parts.append(f"  - {items}")
            claims_text = "\n".join(claims_parts)
        else:
            claims_text = str(analysis["claims"])
        sections.append(f"[청구내용]\n{claims_text}")

    # 적용 죄명
    if analysis["crime_names"]:
        crime_names_text = ", ".join(analysis["crime_names"])
        sections.append(f"[적용 죄명]\n{crime_names_text}")

    # 적용 법조문
    if analysis["legal_laws"]:
        laws_text = "\n".join(f"- {law}" for law in analysis["legal_laws"])
        sections.append(f"[적용 법조문]\n{laws_text}")

    # 법적 쟁점 키워드
    if analysis["legal_keywords"]:
        keywords_text = ", ".join(analysis["legal_keywords"])
        sections.append(f"[법적 쟁점]\n{keywords_text}")

    # 타임라인
    if timeline:
        timeline_text = "\n".join(
            f"- {e['date']}: {e['title']}" + (f" - {e['description']}" if e['description'] else "")
            for e in timeline
        )
        sections.append(f"[사건 경과]\n{timeline_text}")

    # 증거 목록
    if evidences:
        evidence_text = "\n".join(
            f"- 증 제{i+1}호증: {e['description'] or e['doc_type']}"
            for i, e in enumerate(evidences)
        )
        sections.append(f"[증거 목록]\n{evidence_text}")

    # 원문 (분석 결과가 없는 경우 fallback)
    if not analysis["summary"] and case["description"]:
        sections.append(f"[사건 원문]\n{case['description'][:3000]}")

    # 문서 유형별 작성 지시
    template_structure = DOCUMENT_TEMPLATES.get(document_type, "")

    if document_type == "criminal_complaint":
        sections.append(f"""[작성 지시]
위 사건 데이터를 기반으로 아래 고소장 HTML 양식의 빈 칸을 채워주세요.
- 양식의 HTML 구조를 절대 변경하지 말고, 빈 <td> 셀과 [범죄사실 기재], [고소이유 기재] 등 작성란만 채우세요.
- 고소인 정보에는 의뢰인(client) 데이터를, 피고소인 정보에는 상대방(opponent) 데이터를 기입하세요.
- ○○죄를 실제 죄명으로 대체하세요.
- 순수 HTML만 출력하세요 (코드블록 없이).

[고소장 HTML 양식]
{COMPLAINT_HTML_TEMPLATE}""")
    elif document_type == "demand_letter":
        sections.append(f"""[작성 지시]
위 사건 데이터를 기반으로 내용증명 초안을 작성해주세요.
형식: 발신인/수신인/제목/본문(피해사실+시정요구+법적조치경고)/날짜
{template_structure}""")
    elif document_type == "civil_complaint":
        sections.append(f"""[작성 지시]
위 사건 데이터를 기반으로 손해배상 청구 소장 초안을 작성해주세요.
형식: 원고/피고/청구취지/청구원인/입증방법/첨부서류
{template_structure}""")

    return "\n\n".join(sections)


# ==================== 섹션별 생성 (GPT 1회, JSON 응답) ====================

SECTIONS_SYSTEM_PROMPT = """너는 대한민국 형사 고소장 작성 전문 AI다.
사용자가 제공하는 사건 데이터를 기반으로 고소장의 범죄사실과 고소이유를 작성한다.

[기본 규칙]
- 변호사가 작성하는 것처럼 전문적이고 명확한 문체를 사용한다.
- 반드시 "~습니다" 경어체로 작성한다 (예: "시작했습니다", "피해를 입었습니다", "해당한다고 사료됩니다").
- 단정적 표현을 금지한다 ("명백한", "확실한", "틀림없는" 등 사용 금지).
- "~한 것으로 사료됩니다", "~에 해당한다고 사료됩니다" 등 추정형 문체를 사용한다.
- 날짜는 "YYYY. M. D." 형식으로 표기한다 (예: 2025. 3. 15.).
- 제공된 사실관계와 증거에만 근거하여 작성한다 (추측 금지).
- 확인되지 않은 날짜/장소 등은 "일시 불상", "장소 불상"으로 기재한다.
- 증거를 인용할 때 "증 제N호증" 형식을 사용한다.

[범죄사실 작성 규칙]
- 반드시 가/나/다/라 구조로 작성한다:
  가. 고소인과 피고소인의 관계
  나. 범행의 구체적 내용 (일시, 장소, 방법, 결과를 시간순으로 서술, 증거번호 인용)
  다. 피해 결과 및 사후 경과
  라. 범행 요약
- 마지막 문장은 반드시 "위와 같은 사정에 비추어 피고소인의 행위는 ○○죄에 해당한다고 사료되므로 고소장을 제출합니다."로 끝낸다.
  (○○죄는 [적용 죄명]에 제공된 실제 죄명으로 대체. 여러 개면 쉼표로 나열)

[고소이유 작성 규칙]
- 수사 필요성을 중심으로 서술한다.
- 감정적 호소는 최소화하고 법적 논리에 집중한다.
- 피고소인의 행위가 왜 범죄에 해당하는지, 수사가 왜 필요한지를 논리적으로 서술한다.

출력 형식: 반드시 아래 JSON 형식만 출력 (코드블록 없이)
{
  "crime_facts": "가. 고소인과 피고소인의 관계\n...\n\n나. 범행의 구체적 내용\n...\n\n다. 피해 결과 및 사후 경과\n...\n\n라. 범행 요약\n...\n\n위와 같은 사정에 비추어 피고소인의 행위는 ○○죄에 해당한다고 사료되므로 고소장을 제출합니다.",
  "complaint_reason": "고소이유 서술문 (수사 필요성 중심, 법적 논리에 기반하여 간략 명료하게 서술)"
}"""


def build_sections_prompt(context: dict) -> str:
    """섹션 생성용 유저 프롬프트 (분석 결과 중심, 토큰 최소화)"""
    case = context["case"]
    analysis = context["analysis"]
    timeline = context["timeline"]
    evidences = context["evidences"]

    parts = []

    parts.append(f"[사건 기본]\n- 고소인: {case['client_name']} ({case['client_role']})\n- 피고소인: {case['opponent_name']} ({case['opponent_role']})\n- 사건유형: {case['case_type']}")

    if analysis["summary"]:
        parts.append(f"[사건 요약]\n{analysis['summary']}")

    if analysis["facts"]:
        if isinstance(analysis["facts"], list):
            parts.append("[사실관계]\n" + "\n".join(f"- {f}" for f in analysis["facts"]))
        else:
            parts.append(f"[사실관계]\n{analysis['facts']}")

    if analysis["claims"]:
        if isinstance(analysis["claims"], dict):
            claims_lines = []
            for cat, items in analysis["claims"].items():
                claims_lines.append(f"  [{cat}]")
                if isinstance(items, list):
                    claims_lines.extend(f"  - {item}" for item in items)
                else:
                    claims_lines.append(f"  - {items}")
            parts.append("[청구내용]\n" + "\n".join(claims_lines))
        else:
            parts.append(f"[청구내용]\n{analysis['claims']}")

    if analysis["crime_names"]:
        parts.append("[적용 죄명]\n" + ", ".join(analysis["crime_names"]))

    if analysis["legal_laws"]:
        parts.append("[적용 법조문]\n" + "\n".join(f"- {law}" for law in analysis["legal_laws"]))

    if timeline:
        parts.append("[사건 경과]\n" + "\n".join(
            f"- {e['date']}: {e['title']}" + (f" - {e['description']}" if e['description'] else "")
            for e in timeline
        ))

    if evidences:
        parts.append("[증거 목록]\n" + "\n".join(
            f"- 증 제{i+1}호증: {e['description'] or e['doc_type']}"
            for i, e in enumerate(evidences)
        ))

    parts.append("위 데이터를 기반으로 고소장의 범죄사실(crime_facts)과 고소이유(complaint_reason)를 JSON으로 작성하세요.")

    return "\n\n".join(parts)


@router.post("/generate-sections", response_model=GenerateSectionsResponse)
async def generate_sections(
    request: GenerateSectionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """고소장 서술형 2개 섹션 생성 (캐시 우선, 캐시 미스 시 GPT 호출)"""
    # 사건 원문 hash 계산
    case = db.query(Case).filter(Case.id == request.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

    current_hash = hashlib.sha256((case.description or "").encode()).hexdigest()

    # 캐시 확인: 같은 사건 + 같은 문서 유형 + hash 일치
    cached = db.query(CaseDocumentDraft).filter(
        CaseDocumentDraft.case_id == request.case_id,
        CaseDocumentDraft.document_type == "criminal_complaint",
    ).first()

    if cached and cached.description_hash == current_hash and cached.content:
        try:
            sections = json.loads(cached.content)
            print(f"✅ 초안 캐시 히트: case_id={request.case_id}")
            return GenerateSectionsResponse(
                crime_facts=sections.get("crime_facts", ""),
                complaint_reason=sections.get("complaint_reason", ""),
            )
        except json.JSONDecodeError:
            pass  # 캐시 파싱 실패 → 재생성

    # 캐시 미스 → GPT 호출
    print(f"📄 초안 생성 (GPT): case_id={request.case_id}")
    context = retrieve_case_context(request.case_id, db)
    user_prompt = build_sections_prompt(context)

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SECTIONS_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4000,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content.strip()
        sections = json.loads(content)

        # 캐시 저장 (upsert)
        if cached:
            cached.content = content
            cached.description_hash = current_hash
        else:
            cached = CaseDocumentDraft(
                case_id=request.case_id,
                document_type="criminal_complaint",
                content=content,
                description_hash=current_hash,
            )
            db.add(cached)
        db.commit()
        print(f"💾 초안 캐시 저장: case_id={request.case_id}")

        return GenerateSectionsResponse(
            crime_facts=sections.get("crime_facts", ""),
            complaint_reason=sections.get("complaint_reason", ""),
        )

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="GPT 응답 파싱 실패")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"섹션 생성 오류: {str(e)}")


# ==================== 컨텍스트 조회 (OpenAI 없음) ====================

@router.get("/context/{case_id}")
async def get_case_context(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """사건 컨텍스트 데이터 반환 (DB 조회만, OpenAI 호출 없음)"""
    context = retrieve_case_context(case_id, db)
    return context


# ==================== 권한 헬퍼 ====================

VALID_ACCESS_LEVELS = {"private", "firm_readonly", "firm_editable"}


def _to_doc_response(doc: CaseDocument) -> DocumentResponse:
    """CaseDocument → DocumentResponse 변환"""
    return DocumentResponse(
        id=doc.id,
        case_id=doc.case_id,
        title=doc.title,
        document_type=doc.document_type,
        content=doc.content,
        access_level=doc.access_level or "firm_readonly",
        created_by=doc.created_by,
        version=doc.version,
        created_at=doc.created_at.isoformat() if doc.created_at else None,
        updated_at=doc.updated_at.isoformat() if doc.updated_at else None,
    )


def _check_firm_access(doc: CaseDocument, user: User):
    """법무법인 접근 검사 (law_firm_id가 NULL인 레거시 문서는 허용)"""
    if doc.law_firm_id is not None and doc.law_firm_id != user.firm_id:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")


def _check_read_permission(doc: CaseDocument, user: User):
    """읽기 권한 검사: private → 작성자만, 나머지 → 같은 법무법인"""
    _check_firm_access(doc, user)
    if doc.access_level == "private" and doc.created_by != user.id:
        raise HTTPException(status_code=403, detail="비공개 문서입니다")


def _check_edit_permission(doc: CaseDocument, user: User):
    """편집 권한 검사: firm_editable → 같은 법무법인, 나머지 → 작성자만"""
    _check_firm_access(doc, user)
    if doc.access_level == "firm_editable":
        return  # 같은 법무법인이면 편집 가능
    if doc.created_by != user.id:
        raise HTTPException(status_code=403, detail="문서 작성자만 편집할 수 있습니다")


def _check_delete_permission(doc: CaseDocument, user: User):
    """삭제 권한: 항상 작성자만"""
    _check_firm_access(doc, user)
    if doc.created_by != user.id:
        raise HTTPException(status_code=403, detail="문서 작성자만 삭제할 수 있습니다")


def _filter_visible_docs(docs, user: User):
    """비공개 문서를 작성자가 아닌 사용자에게 숨김"""
    return [
        doc for doc in docs
        if doc.access_level != "private" or doc.created_by == user.id
    ]


# ==================== CRUD 엔드포인트 ====================

@router.post("/", response_model=DocumentResponse)
async def create_document(
    request: CreateDocumentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """새 문서 저장"""
    access_level = request.access_level if request.access_level in VALID_ACCESS_LEVELS else "firm_readonly"
    doc = CaseDocument(
        case_id=request.case_id,
        law_firm_id=current_user.firm_id,
        created_by=current_user.id,
        title=request.title,
        document_type=request.document_type,
        content=request.content,
        access_level=access_level,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _to_doc_response(doc)


@router.get("/", response_model=List[DocumentListItemWithCase])
async def list_all_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """법무법인 전체 문서 목록 (비공개 문서는 작성자만 볼 수 있음)"""
    docs = (
        db.query(CaseDocument)
        .filter(or_(
            CaseDocument.law_firm_id == current_user.firm_id,
            CaseDocument.law_firm_id.is_(None),
        ))
        .order_by(CaseDocument.updated_at.desc())
        .all()
    )
    visible = _filter_visible_docs(docs, current_user)
    return [
        DocumentListItemWithCase(
            id=doc.id,
            case_id=doc.case_id,
            title=doc.title,
            document_type=doc.document_type,
            access_level=doc.access_level or "firm_readonly",
            created_by=doc.created_by,
            updated_at=doc.updated_at.isoformat() if doc.updated_at else None,
        )
        for doc in visible
    ]


@router.get("/case/{case_id}", response_model=List[DocumentListItem])
async def list_documents(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """해당 사건의 문서 목록 (비공개 문서는 작성자만 볼 수 있음)"""
    docs = (
        db.query(CaseDocument)
        .filter(CaseDocument.case_id == case_id)
        .filter(or_(
            CaseDocument.law_firm_id == current_user.firm_id,
            CaseDocument.law_firm_id.is_(None),
        ))
        .order_by(CaseDocument.updated_at.desc())
        .all()
    )
    visible = _filter_visible_docs(docs, current_user)
    return [
        DocumentListItem(
            id=doc.id,
            title=doc.title,
            document_type=doc.document_type,
            access_level=doc.access_level or "firm_readonly",
            created_by=doc.created_by,
            updated_at=doc.updated_at.isoformat() if doc.updated_at else None,
        )
        for doc in visible
    ]


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """문서 상세 (content 포함) - 읽기 권한 검사"""
    doc = db.query(CaseDocument).filter(CaseDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
    _check_read_permission(doc, current_user)
    return _to_doc_response(doc)


@router.put("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: int,
    request: UpdateDocumentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """문서 수정 - 편집 권한 검사 (access_level 변경은 작성자만)"""
    doc = db.query(CaseDocument).filter(CaseDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
    _check_edit_permission(doc, current_user)

    if request.title is not None:
        doc.title = request.title
    if request.content is not None:
        doc.content = request.content
    # access_level 변경은 작성자만 가능
    if request.access_level is not None:
        if doc.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="공개 범위는 작성자만 변경할 수 있습니다")
        if request.access_level in VALID_ACCESS_LEVELS:
            doc.access_level = request.access_level

    db.commit()
    db.refresh(doc)
    return _to_doc_response(doc)


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """문서 삭제 - 작성자만 가능"""
    doc = db.query(CaseDocument).filter(CaseDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
    _check_delete_permission(doc, current_user)

    db.delete(doc)
    db.commit()
    return {"message": "문서가 삭제되었습니다"}


# ==================== AI 생성 엔드포인트 ====================

@router.post("/generate", response_model=GenerateDocumentResponse)
async def generate_document(
    request: GenerateDocumentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    사건 데이터 기반 법률 문서 초안 생성 (RAG)

    1. Retrieval: case_id로 DB에서 사건 데이터 수집
    2. Augmentation: 프롬프트 구성
    3. Generation: GPT-4o 호출
    """
    print("=" * 50)
    print(f"📄 문서 생성 요청: case_id={request.case_id}, type={request.document_type}")
    print("=" * 50)

    # 문서 유형 검증
    if request.document_type not in SYSTEM_PROMPTS:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 문서 유형: {request.document_type}. (criminal_complaint, demand_letter, civil_complaint)"
        )

    try:
        # 1. Retrieval
        context = retrieve_case_context(request.case_id, db)
        print(f"   사건: {context['case']['title']}")
        print(f"   분석 존재: {'예' if context['analysis']['summary'] else '아니오'}")
        print(f"   증거 수: {len(context['evidences'])}건")
        print(f"   타임라인: {len(context['timeline'])}건")

        # 2. Augmentation
        system_prompt = SYSTEM_PROMPTS[request.document_type]
        user_prompt = build_user_prompt(context, request.document_type)
        print(f"   프롬프트 길이: {len(user_prompt)}자")

        # 3. Generation
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=8000,
        )

        content = response.choices[0].message.content.strip()

        # GPT가 ```html ... ``` 코드블록으로 감싼 경우 제거
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:])  # 첫 줄 (```html) 제거
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()

        print(f"✅ 문서 생성 완료: {len(content)}자")

        # 문서 제목 생성
        type_names = {
            "criminal_complaint": "고소장",
            "demand_letter": "내용증명",
            "civil_complaint": "소장",
        }
        title = f"{type_names[request.document_type]} - {context['case']['title']}"

        return GenerateDocumentResponse(
            document_type=request.document_type,
            title=title,
            content=content,
            context_used={
                "has_analysis": context["analysis"]["summary"] is not None,
                "facts_count": len(context["analysis"]["facts"]) if isinstance(context["analysis"]["facts"], list) else 0,
                "laws_count": len(context["analysis"]["legal_laws"]),
                "evidence_count": len(context["evidences"]),
                "timeline_count": len(context["timeline"]),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"❌ 문서 생성 오류: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"문서 생성 중 오류 발생: {str(e)}")
