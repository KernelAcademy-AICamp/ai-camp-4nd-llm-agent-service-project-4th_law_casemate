"""
5-Node StateGraph 정의

Router → Agent → Tools → Grader → Generator
                  ↑                    |
                  └────── (irrelevant) ─┘
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
    grader_node,
    generator_node,
    route_after_router,
    route_after_agent,
    route_after_grader,
)

logger = logging.getLogger(__name__)


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    route: str | None
    grader_score: str | None
    retry_count: int


def build_graph(tools: list, checkpointer=None):
    """도구 목록을 받아 컴파일된 그래프를 반환"""

    graph = StateGraph(AgentState)

    # 노드 등록
    graph.add_node("router", router_node)
    graph.add_node("agent", partial(agent_node, tools=tools))
    graph.add_node("tools", ToolNode(tools, handle_tool_errors=True))
    graph.add_node("grader", grader_node)
    graph.add_node("generator", generator_node)

    # 엣지: START → Router
    graph.add_edge(START, "router")

    # 조건부 엣지: Router → (general→generator, simple/complex→agent)
    graph.add_conditional_edges("router", route_after_router, {
        "generator": "generator",
        "agent": "agent",
    })

    # 조건부 엣지: Agent → (tool_calls→tools, 없으면→generator)
    graph.add_conditional_edges("agent", route_after_agent, {
        "tools": "tools",
        "generator": "generator",
    })

    # 엣지: Tools → Grader
    graph.add_edge("tools", "grader")

    # 조건부 엣지: Grader → (relevant→generator, irrelevant→agent 재시도)
    graph.add_conditional_edges("grader", route_after_grader, {
        "generator": "generator",
        "agent": "agent",
    })

    # 엣지: Generator → END
    graph.add_edge("generator", END)

    # 컴파일
    compiled = graph.compile(checkpointer=checkpointer)
    logger.info("[Graph] 에이전트 그래프 컴파일 완료")
    return compiled
