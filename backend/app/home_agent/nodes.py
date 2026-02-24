"""
5-Node 에이전트 노드 정의

Router  → 쿼리 분류 (general/simple/complex)
Agent   → 도구 선택 (ReAct)
Tools   → 도구 실행 (ToolNode)
Grader  → 결과 관련성 평가 (Corrective RAG)
Generator → 최종 답변 생성 (Self-RAG + IRAC)
"""

import re
import logging
from typing import Literal

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from app.home_agent.prompts import (
    ROUTER_SYSTEM_PROMPT,
    AGENT_SYSTEM_PROMPT,
    GRADER_SYSTEM_PROMPT,
    GENERATOR_SYSTEM_PROMPT,
    GENERAL_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)


# ── Structured Output 스키마 ──────────────────────────────────

class RouteDecision(BaseModel):
    route: Literal["general", "simple", "complex"] = Field(
        description="Query classification: general, simple, or complex"
    )


class GradeResult(BaseModel):
    score: Literal["relevant", "irrelevant"] = Field(
        description="Whether the tool result is relevant to the question"
    )


# ── LLM 인스턴스 ─────────────────────────────────────────────

_router_llm = None
_agent_llm = None
_grader_llm = None
_generator_llm = None


def _get_router_llm():
    global _router_llm
    if _router_llm is None:
        _router_llm = ChatOpenAI(
            model="gpt-4o-mini", temperature=0, request_timeout=15
        ).with_structured_output(RouteDecision)
    return _router_llm


def _get_agent_llm(tools):
    global _agent_llm
    if _agent_llm is None:
        _agent_llm = ChatOpenAI(
            model="gpt-4o-mini", temperature=0.3, request_timeout=30
        ).bind_tools(tools)
    return _agent_llm


def _get_grader_llm():
    global _grader_llm
    if _grader_llm is None:
        _grader_llm = ChatOpenAI(
            model="gpt-4o-mini", temperature=0, request_timeout=15
        ).with_structured_output(GradeResult)
    return _grader_llm


def _get_generator_llm():
    global _generator_llm
    if _generator_llm is None:
        _generator_llm = ChatOpenAI(
            model="gpt-4o", temperature=0.4, request_timeout=45
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
    llm = _get_agent_llm(tools)
    response = llm.invoke([SystemMessage(content=AGENT_SYSTEM_PROMPT)] + messages)

    # Guard: per-case 도구 N×1 반복 호출 차단
    if hasattr(response, "tool_calls") and response.tool_calls:
        response = _guard_repeated_tool_calls(response, messages)

    return {"messages": [response]}


def grader_node(state: dict) -> dict:
    """도구 결과의 관련성 평가 (Corrective RAG)"""
    messages = state["messages"]

    # 마지막 HumanMessage(원래 질문) 찾기
    last_human = next(
        (m for m in reversed(messages) if isinstance(m, HumanMessage)), None
    )
    if not last_human:
        return {"grader_score": "relevant", "retry_count": state.get("retry_count", 0)}

    # 마지막 ToolMessage(도구 결과) 찾기
    tool_messages = [m for m in messages if isinstance(m, ToolMessage)]
    if not tool_messages:
        return {"grader_score": "relevant", "retry_count": state.get("retry_count", 0)}

    last_tool = tool_messages[-1]

    # 생성 도구는 grading 스킵 (결과 자체가 답이므로)
    skip_tools = {"generate_timeline", "generate_relationship"}
    if last_tool.name in skip_tools:
        return {"grader_score": "relevant", "retry_count": state.get("retry_count", 0)}

    llm = _get_grader_llm()
    result = llm.invoke([
        SystemMessage(content=GRADER_SYSTEM_PROMPT),
        HumanMessage(content=f"사용자 질문: {last_human.content}\n\n도구 결과: {last_tool.content[:2000]}"),
    ])

    score = result.score
    retry_count = state.get("retry_count", 0)
    if score == "irrelevant":
        retry_count += 1
    logger.info(f"[Grader] 판정: {score} (재시도: {retry_count})")

    return {"grader_score": score, "retry_count": retry_count}


def generator_node(state: dict) -> dict:
    """최종 답변 생성 (Self-RAG + IRAC)"""
    messages = _sanitize_messages(state["messages"])
    route = state.get("route", "general")

    # 일반 대화는 간단한 프롬프트
    if route == "general":
        system = GENERAL_SYSTEM_PROMPT
    else:
        system = GENERATOR_SYSTEM_PROMPT

    llm = _get_generator_llm()
    response = llm.invoke([SystemMessage(content=system)] + messages)

    # Self-RAG: 인용 검증 (도구 결과가 있을 때만)
    tool_messages = [m for m in messages if isinstance(m, ToolMessage)]
    if tool_messages and route != "general":
        response = _verify_citations(response, tool_messages)

    return {"messages": [response]}


# ── 조건부 엣지 함수 ──────────────────────────────────────────

def route_after_router(state: dict) -> str:
    """Router 판정 후 분기"""
    route = state.get("route", "general")
    if route == "general":
        return "generator"
    return "agent"


def route_after_agent(state: dict) -> str:
    """Agent 출력 후 분기: tool_calls 있으면 tools로, 없으면 generator로"""
    messages = state["messages"]
    last = messages[-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "generator"


def route_after_grader(state: dict) -> str:
    """Grader 판정 후 분기: Agent로 돌려보내 멀티홉 허용.
    Agent가 더 이상 도구가 필요 없다고 판단하면 tool_calls 없이 응답 → generator로 감."""
    retry_count = state.get("retry_count", 0)

    # 재시도 한계 초과 시 강제 종료
    if retry_count >= 3:
        return "generator"

    # relevant든 irrelevant든 Agent로 돌려보냄
    # Agent가 추가 도구 필요 여부를 직접 판단
    return "agent"


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


# ── 기타 헬퍼 ────────────────────────────────────────────────

_CASE_NUMBER_RE = re.compile(r'\d{2,4}[가-힣]{1,2}\d+')
_LAW_ARTICLE_RE = re.compile(r'([가-힣]+(?:법|령|규칙))\s*제(\d+)조')


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
