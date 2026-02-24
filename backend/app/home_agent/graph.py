"""
조건부 StateGraph 정의

Simple (명령형):  Router → Agent → Tools → Agent → END        (3 LLM calls)
Complex (질문형): Router → Agent → Tools → Generator → END    (4 LLM calls)

Self-RAG: Generator에서 인용 검증 (환각 방지)
"""

import logging
from typing import Annotated, TypedDict
from functools import partial

from langchain_core.messages import BaseMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from app.home_agent.nodes import (
    router_node,
    agent_node,
    generator_node,
    route_after_router,
    route_after_agent,
    route_after_tools,
)

logger = logging.getLogger(__name__)


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    route: str | None
    cited_sources: list[dict]  # 실제 인용된 출처 목록


def build_graph(tools: list, checkpointer=None):
    """도구 목록을 받아 컴파일된 그래프를 반환"""

    graph = StateGraph(AgentState)

    # 노드 등록
    graph.add_node("router", router_node)
    graph.add_node("agent", partial(agent_node, tools=tools))
    graph.add_node("tools", ToolNode(tools, handle_tool_errors=True))
    graph.add_node("generator", generator_node)

    # 엣지: START → Router
    graph.add_edge(START, "router")

    # 조건부 엣지: Router → (general→generator, simple/complex→agent)
    graph.add_conditional_edges("router", route_after_router, {
        "generator": "generator",
        "agent": "agent",
    })

    # 조건부 엣지: Agent → (tool_calls→tools, simple→END, complex→generator)
    graph.add_conditional_edges("agent", route_after_agent, {
        "tools": "tools",
        "end": END,
        "generator": "generator",
    })

    # 조건부 엣지: Tools → (simple→agent, complex→generator)
    graph.add_conditional_edges("tools", route_after_tools, {
        "agent": "agent",
        "generator": "generator",
    })

    # 엣지: Generator → END
    graph.add_edge("generator", END)

    # 컴파일
    compiled = graph.compile(checkpointer=checkpointer)
    logger.info("[Graph] 에이전트 그래프 컴파일 완료")
    return compiled
