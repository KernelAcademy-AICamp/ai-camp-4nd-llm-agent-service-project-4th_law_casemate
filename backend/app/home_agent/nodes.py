"""
4-Node 에이전트 노드 정의

Router    → 쿼리 분류 (general/simple/complex)
Agent     → 도구 선택 (ReAct) + simple 직접 답변
Tools     → 도구 실행 (ToolNode)
Generator → 최종 답변 생성 (Self-RAG + IRAC) - complex만
"""

import json
import re
import logging
from typing import Literal

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from app.home_agent.prompts import (
    ROUTER_SYSTEM_PROMPT,
    AGENT_SYSTEM_PROMPT,
    GENERATOR_SYSTEM_PROMPT,
    GENERAL_SYSTEM_PROMPT,
)
from app.config import AgentConfig

logger = logging.getLogger(__name__)


# ── Structured Output 스키마 ──────────────────────────────────

class RouteDecision(BaseModel):
    route: Literal["general", "simple", "complex"] = Field(
        description="Query classification: general, simple, or complex"
    )


# ── LLM 인스턴스 ─────────────────────────────────────────────
# Base LLM은 캐시, tools 바인딩은 매 요청마다 새로 수행

_router_llm = None
_agent_base_llm = None
_generator_llm = None


def _get_router_llm():
    global _router_llm
    if _router_llm is None:
        _router_llm = ChatOpenAI(
            model=AgentConfig.ROUTER_MODEL, temperature=0, request_timeout=15
        ).with_structured_output(RouteDecision)
    return _router_llm


def _get_agent_llm(tools):
    """Base LLM은 캐시하되, tools 바인딩은 매번 새로 수행 (유저별 도구 격리)"""
    global _agent_base_llm
    if _agent_base_llm is None:
        _agent_base_llm = ChatOpenAI(
            model=AgentConfig.AGENT_MODEL, temperature=0.3, request_timeout=30
        )
    return _agent_base_llm.bind_tools(tools)


def _get_generator_llm():
    global _generator_llm
    if _generator_llm is None:
        _generator_llm = ChatOpenAI(
            model=AgentConfig.GENERATOR_MODEL, temperature=0.4, request_timeout=45
        )
    return _generator_llm


# ── 노드 함수 ────────────────────────────────────────────────

def router_node(state: dict) -> dict:
    """쿼리를 general/simple/complex로 분류"""
    messages = state["messages"]
    last_human = next(
        (m for m in reversed(messages) if isinstance(m, HumanMessage)), None
    )
    if not last_human:
        return {"route": "general"}

    llm = _get_router_llm()
    result = llm.invoke([
        SystemMessage(content=ROUTER_SYSTEM_PROMPT),
        last_human,
    ])
    route = result.route
    logger.info(f"[Router] 분류 결과: {route}")
    return {"route": route}


def agent_node(state: dict, tools) -> dict:
    """도구 선택 및 호출 계획 (ReAct)"""
    messages = _sanitize_messages(state["messages"])

    # Agent에게는 도구 결과 데이터를 전달하지 않음 (복사 방지)
    # "[N건 조회됨]" 같은 최소 정보만 전달
    llm_messages = _strip_tool_data_for_agent(messages)

    llm = _get_agent_llm(tools)
    response = llm.invoke([SystemMessage(content=AGENT_SYSTEM_PROMPT)] + llm_messages)

    # Guard: per-case 도구 N×1 반복 호출 차단
    if hasattr(response, "tool_calls") and response.tool_calls:
        response = _guard_repeated_tool_calls(response, messages)

    return {"messages": [response]}


def generator_node(state: dict) -> dict:
    """최종 답변 생성 (Self-RAG + IRAC + Citation Filtering)"""
    messages = _sanitize_messages(state["messages"])
    route = state.get("route", "general")

    # 일반 대화는 간단한 프롬프트
    if route == "general":
        system = GENERAL_SYSTEM_PROMPT
    else:
        system = GENERATOR_SYSTEM_PROMPT

    # ToolMessage에서 text 필드 제거 (LLM이 복사하는 것 방지)
    llm_messages = _strip_tool_text_for_llm(messages)

    llm = _get_generator_llm()
    response = llm.invoke([SystemMessage(content=system)] + llm_messages)

    # Self-RAG: 인용 검증 (도구 결과가 있을 때만)
    tool_messages = [m for m in messages if isinstance(m, ToolMessage)]
    if tool_messages and route != "general":
        response = _verify_citations(response, tool_messages)

    # Citation Filtering: 실제 인용된 출처만 추출
    cited_sources = []
    if tool_messages and route != "general":
        cited_sources = _extract_cited_sources(response.content, tool_messages)

    return {"messages": [response], "cited_sources": cited_sources}


# ── 조건부 엣지 함수 ──────────────────────────────────────────

def route_after_router(state: dict) -> str:
    """Router 판정 후 분기"""
    route = state.get("route", "general")
    if route == "general":
        return "generator"
    return "agent"


def route_after_agent(state: dict) -> str:
    """Agent 출력 후 분기:
    - tool_calls 있으면 → tools
    - simple이고 tool_calls 없으면 → end (Agent가 직접 답변)
    - complex이고 tool_calls 없으면 → generator
    """
    messages = state["messages"]
    last = messages[-1]
    route = state.get("route")

    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"

    # tool_calls가 없음 → 답변 완료
    if route == "simple":
        return "end"  # Simple은 Agent 답변으로 종료
    return "generator"  # Complex는 Generator로


def route_after_tools(state: dict) -> str:
    """Tools 실행 후 분기:
    - simple → agent (Agent가 결과 보고 직접 답변)
    - complex → generator (Generator가 최종 답변 생성)
    """
    route = state.get("route")
    if route == "simple":
        return "agent"
    return "generator"


# ── 도구 반복 호출 가드 ────────────────────────────────────────

# case_id를 인자로 받는 도구 — 같은 도구를 여러 case_id로 반복 호출하면 차단
_PER_CASE_TOOLS = {
    "get_case_evidence", "analyze_case",
    "generate_timeline", "generate_relationship",
}


def _guard_repeated_tool_calls(response: AIMessage, messages: list) -> AIMessage:
    """같은 per-case 도구를 여러 case_id에 반복 호출하는 N×1 패턴 감지 시 차단.

    예: get_case_evidence(1), get_case_evidence(2), get_case_evidence(3)...
    list_cases가 이미 evidence_count/has_analysis를 포함하므로 개별 호출 불필요.
    """
    # 대화 이력에서 이미 호출된 per-case 도구 추적: {tool_name: {case_id, ...}}
    called: dict[str, set[int]] = {}
    for msg in messages:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                name = tc.get("name", "")
                if name in _PER_CASE_TOOLS:
                    cid = tc.get("args", {}).get("case_id")
                    if cid is not None:
                        called.setdefault(name, set()).add(cid)

    # 현재 응답의 tool_calls 중 반복 패턴 검사
    for tc in response.tool_calls:
        name = tc.get("name", "")
        cid = tc.get("args", {}).get("case_id")
        if name in _PER_CASE_TOOLS and cid is not None:
            existing = called.get(name, set())
            if existing and cid not in existing:
                # 이미 다른 case_id로 같은 도구를 호출한 적 있음 → N×1 패턴
                logger.warning(
                    f"[Guard] {name}(case_id={cid}) 반복 호출 차단 "
                    f"— 이미 case_id={existing}에서 호출됨. list_cases 집계로 대체."
                )
                return AIMessage(
                    content="수집 완료. list_cases 결과의 evidence_count, has_analysis 정보로 답변을 작성합니다."
                )

    return response


# ── 메시지 정합성 헬퍼 ────────────────────────────────────────

def _sanitize_messages(messages: list) -> list:
    """
    모든 AIMessage의 tool_calls에 대응하는 ToolMessage가 있는지 확인.
    이전 실행이 중간에 끊기면(SSE abort, 네트워크 에러 등)
    checkpointer에 tool_calls만 저장되고 ToolMessage가 누락될 수 있음.
    → OpenAI API가 400 에러로 거부하는 것을 방지.
    """
    # 기존 ToolMessage의 tool_call_id 수집
    existing_responses = set()
    for msg in messages:
        if isinstance(msg, ToolMessage) and getattr(msg, "tool_call_id", None):
            existing_responses.add(msg.tool_call_id)

    result = []
    for msg in messages:
        result.append(msg)
        # AIMessage에 tool_calls가 있으면 누락된 응답 채우기
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                tc_id = tc.get("id")
                if tc_id and tc_id not in existing_responses:
                    logger.warning(f"[Sanitize] 누락된 ToolMessage 보충: {tc_id} ({tc.get('name', '?')})")
                    result.append(ToolMessage(
                        content="[이전 실행이 중단되어 결과를 받지 못했습니다]",
                        tool_call_id=tc_id,
                        name=tc.get("name", "unknown"),
                    ))
                    existing_responses.add(tc_id)

    return result


# ── LLM 전달용 메시지 정리 ───────────────────────────────────

def _strip_tool_data_for_agent(messages: list) -> list:
    """Agent용: ToolMessage 내용을 최소화 (결과 건수만 전달)

    Agent는 도구 결과 데이터가 필요 없음.
    "N건 검색됨" 정도만 알면 됨.
    전체 데이터는 우측 패널에 표시됨.
    """
    result = []
    for msg in messages:
        if isinstance(msg, ToolMessage):
            summary = "[실행 완료]"
            try:
                parsed = json.loads(msg.content)
                if isinstance(parsed, dict) and "data" in parsed:
                    data = parsed["data"]
                    if isinstance(data, list):
                        summary = f"[{len(data)}건 조회됨]"
                    elif isinstance(data, dict):
                        summary = "[분석 완료]"
            except (json.JSONDecodeError, TypeError):
                pass

            result.append(ToolMessage(
                content=summary,
                tool_call_id=msg.tool_call_id,
                name=msg.name,
            ))
        else:
            result.append(msg)
    return result


def _strip_tool_text_for_llm(messages: list) -> list:
    """Generator용: ToolMessage의 text 필드만 제거 (data는 유지)

    Generator는 인용/출처를 위해 data가 필요함.
    """
    result = []
    for msg in messages:
        if isinstance(msg, ToolMessage):
            try:
                parsed = json.loads(msg.content)
                if isinstance(parsed, dict) and "text" in parsed and "data" in parsed:
                    # text 제거, data만 유지
                    new_content = json.dumps(parsed["data"], ensure_ascii=False)
                    result.append(ToolMessage(
                        content=new_content,
                        tool_call_id=msg.tool_call_id,
                        name=msg.name,
                    ))
                    continue
            except (json.JSONDecodeError, TypeError):
                pass
        result.append(msg)
    return result


# ── 기타 헬퍼 ────────────────────────────────────────────────

_CASE_NUMBER_RE = re.compile(r'\d{2,4}[가-힣]{1,2}\d+')
_LAW_ARTICLE_RE = re.compile(r'([가-힣]+(?:법|령|규칙))\s*제(\d+)조')


def _extract_cited_sources(answer: str, tool_messages: list[ToolMessage]) -> list[dict]:
    """
    LLM 응답에서 실제 인용된 출처만 추출

    Returns:
        [{"type": "precedent", "id": "2007도8155"}, {"type": "law", "id": "형법 제307조"}, ...]
    """
    cited = []
    seen = set()

    for msg in tool_messages:
        try:
            # structured data 파싱 시도
            parsed = json.loads(msg.content)
            data = parsed.get("data") if isinstance(parsed, dict) else None
        except (json.JSONDecodeError, TypeError):
            data = None
            parsed = None

        # rag_search 결과 처리
        if msg.name == "rag_search" and data:
            # 판례 확인
            for p in data.get("precedents", []):
                case_num = p.get("case_number", "")
                if case_num and case_num in answer and case_num not in seen:
                    cited.append({"type": "precedent", "id": case_num})
                    seen.add(case_num)

            # 법령 확인
            for law in data.get("laws", []):
                law_name = law.get("law_name", "")
                article_num = law.get("article_number", "")
                law_id = f"{law_name} 제{article_num}조"

                # 다양한 형식 매칭
                patterns = [
                    f"{law_name} 제{article_num}조",
                    f"{law_name} {article_num}조",
                    f"제{article_num}조",
                ]
                if any(p in answer for p in patterns) and law_id not in seen:
                    cited.append({"type": "law", "id": law_id})
                    seen.add(law_id)

        # search_precedents 결과 처리
        elif msg.name == "search_precedents" and data and isinstance(data, list):
            for p in data:
                case_num = p.get("case_number", "")
                if case_num and case_num in answer and case_num not in seen:
                    cited.append({"type": "precedent", "id": case_num})
                    seen.add(case_num)

        # search_laws 결과 처리
        elif msg.name == "search_laws" and data and isinstance(data, list):
            for law in data:
                law_name = law.get("law_name", "")
                article_num = law.get("article_number", "")
                law_id = f"{law_name} 제{article_num}조"

                patterns = [
                    f"{law_name} 제{article_num}조",
                    f"{law_name} {article_num}조",
                    f"제{article_num}조",
                ]
                if any(p in answer for p in patterns) and law_id not in seen:
                    cited.append({"type": "law", "id": law_id})
                    seen.add(law_id)

    logger.info(f"[Citation] 인용된 출처: {cited}")
    return cited


def _verify_citations(response: AIMessage, tool_messages: list[ToolMessage]) -> AIMessage:
    """Self-RAG: 답변의 법조문/판례번호가 도구 결과에 있는지 검증"""
    content = response.content
    if not content:
        return response

    # 도구 결과 텍스트 합치기
    tool_text = " ".join(m.content for m in tool_messages if m.content)

    # 판례번호 검증
    cited_cases = _CASE_NUMBER_RE.findall(content)
    for case_num in cited_cases:
        if case_num not in tool_text:
            content = content.replace(case_num, f"{case_num}[미확인]")

    # 법조문 검증
    cited_laws = _LAW_ARTICLE_RE.findall(content)
    for law_name, article_num in cited_laws:
        full = f"{law_name} 제{article_num}조"
        # 법령명과 조문번호가 도구 결과에 있는지 확인
        if law_name not in tool_text or f"제{article_num}조" not in tool_text:
            content = content.replace(full, f"{full}[미확인]")

    if content != response.content:
        logger.info("[Self-RAG] 미확인 인용 발견, 태그 추가")
        return AIMessage(content=content)

    return response
