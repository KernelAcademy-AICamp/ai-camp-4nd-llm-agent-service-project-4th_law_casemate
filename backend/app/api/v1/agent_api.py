"""
홈 에이전트 SSE 엔드포인트

POST /api/v1/agent/chat → Server-Sent Events 스트리밍

이벤트 프로토콜:
  status     → {"step": "...", "message": "한글 상태 메시지"}
  tool_start → {"id": "run_id", "tool": "name", "input": {...}, "message": "한글 설명"}
  tool_end   → {"id": "run_id", "tool": "name", "result": "text", "structured": {...}, "summary": "한글 요약"}
  token      → {"content": "text"}  (generator 노드에서만)
  citations  → {"sources": [{"type": "precedent"|"law", "id": "..."}]}  (실제 인용된 출처만)
  suggestions → {"items": [{"text": "...", "type": "question"|"action", "action"?: {...}}]}
  done       → {}
  error      → {"message": "..."}
"""

import json
import logging
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage
from langgraph.errors import GraphRecursionError
from openai import BadRequestError

from tool.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agent"])

# ── 한글 상태 메시지 매핑 ──

STATUS_MESSAGES = {
    "router": "질문을 분석하고 있습니다...",
    "agent": "도구를 선택하고 있습니다...",
    "tools": "도구를 실행하고 있습니다...",
    "generator": "답변을 작성하고 있습니다...",
}

STATUS_STEPS = {
    "router": "routing",
    "agent": "thinking",
    "tools": "executing",
    "generator": "generating",
}

TOOL_MESSAGES = {
    "list_cases": "사건 목록을 조회하고 있습니다...",
    "analyze_case": "사건을 분석하고 있습니다...",
    "generate_timeline": "타임라인을 생성하고 있습니다...",
    "generate_relationship": "관계도를 생성하고 있습니다...",
    "search_precedents": "유사 판례를 검색하고 있습니다...",
    "summarize_precedent": "판례를 요약하고 있습니다...",
    "compare_precedent": "판례를 비교 분석하고 있습니다...",
    "search_laws": "관련 법령을 검색하고 있습니다...",
    "get_case_evidence": "증거 현황을 조회하고 있습니다...",
    "rag_search": "판례와 법령을 검색하고 있습니다...",
}


def _tool_end_summary(tool_name: str, result_text: str, structured: dict | None) -> str:
    """도구 완료 시 한글 요약 메시지 생성"""
    if structured and isinstance(structured, dict):
        data = structured.get("data")
        if isinstance(data, list):
            count = len(data)
            summaries = {
                "list_cases": f"{count}건의 사건을 찾았습니다",
                "search_precedents": f"유사 판례 {count}건을 검색했습니다",
                "search_laws": f"관련 법령 {count}건을 검색했습니다",
                "generate_timeline": f"타임라인 이벤트 {count}건을 생성했습니다",
                "get_case_evidence": f"증거 {count}건을 조회했습니다",
            }
            if tool_name in summaries:
                return summaries[tool_name]
        elif isinstance(data, dict):
            summaries = {
                "analyze_case": "사건 분석을 완료했습니다",
                "compare_precedent": "판례 비교 분석을 완료했습니다",
                "generate_relationship": "관계도를 생성했습니다",
            }
            if tool_name in summaries:
                return summaries[tool_name]
    # 폴백
    fallback = {
        "list_cases": "사건 목록을 조회했습니다",
        "analyze_case": "사건 분석을 완료했습니다",
        "generate_timeline": "타임라인을 생성했습니다",
        "generate_relationship": "관계도를 생성했습니다",
        "search_precedents": "판례 검색을 완료했습니다",
        "summarize_precedent": "판례 요약을 완료했습니다",
        "compare_precedent": "판례 비교를 완료했습니다",
        "search_laws": "법령 검색을 완료했습니다",
        "get_case_evidence": "증거 현황을 조회했습니다",
        "rag_search": "판례와 법령 검색을 완료했습니다",
    }
    return fallback.get(tool_name, "처리를 완료했습니다")


def _parse_structured(tool_name: str, raw_output: str) -> dict | None:
    """도구 결과에서 structured data를 파싱 (JSON {text, data} 형식 지원)"""
    try:
        parsed = json.loads(raw_output)
        if isinstance(parsed, dict) and "data" in parsed:
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    return None


async def _generate_suggestions(
    user_message: str,
    tool_history: list[str],
    tool_structured: dict[str, dict | None],
) -> list[dict]:
    """대화 맥락 기반 후속 질문/액션 생성 (LLM 호출)"""

    # 미등록 사건 → 등록 유도 (규칙 기반 — LLM 불필요)
    if "list_cases" in tool_history:
        lc_data = tool_structured.get("list_cases")
        if lc_data and isinstance(lc_data.get("data"), list) and len(lc_data["data"]) == 0:
            return [{
                "text": "새 사건을 등록하시겠습니까?",
                "type": "action",
                "action": {"navigate": "/new-case"},
            }]

    # LLM으로 맥락 기반 추천 생성
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage as HMsg
        from app.home_agent.prompts import SUGGESTION_SYSTEM_PROMPT
        from app.config import AgentConfig

        llm = ChatOpenAI(
            model=AgentConfig.ROUTER_MODEL, temperature=0.7,
            max_tokens=200, request_timeout=5,
        )
        context = f"사용자 질문: {user_message}\n실행된 도구: {', '.join(tool_history)}"
        response = await llm.ainvoke([
            SystemMessage(content=SUGGESTION_SYSTEM_PROMPT),
            HMsg(content=context),
        ])

        items = json.loads(response.content)
        if isinstance(items, list):
            return [{"text": t, "type": "question"} for t in items[:3]]
    except Exception as e:
        logger.warning(f"[Suggestions] LLM 추천 생성 실패, 스킵: {e}")

    return []


class AgentChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000)
    thread_id: str | None = None


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _stream_graph_events(graph, input_data: dict, config: dict):
    """그래프 이벤트를 SSE로 변환하는 공용 제너레이터.

    정상 실행과 BadRequestError 재시도 양쪽에서 동일하게 사용.
    Yields: (sse_string, tool_history, tool_structured)
    """
    current_node = ""
    tool_history: list[str] = []
    tool_structured: dict[str, dict | None] = {}
    pending_tools: dict[str, str] = {}  # run_id → tool_name (tool_end 누락 추적)

    async for event in graph.astream_events(input_data, config, version="v2"):
        kind = event["event"]

        # 도구 이벤트 디버그 로깅
        if kind in ("on_tool_start", "on_tool_end", "on_tool_error"):
            logger.info(f"[Agent] Event: {kind} — {event.get('name', '?')} (run_id={event.get('run_id', '?')[:8]})")

        # ── 노드 시작 → status 이벤트 ──
        if kind == "on_chain_start":
            node_name = event.get("name", "")
            if node_name in STATUS_MESSAGES:
                current_node = node_name
                yield _sse_event("status", {
                    "step": STATUS_STEPS.get(node_name, "executing"),
                    "message": STATUS_MESSAGES[node_name],
                })

        # ── LLM 토큰 → generator 또는 agent 노드에서 전송 ──
        elif kind == "on_chat_model_stream":
            if current_node in ("generator", "agent"):
                chunk = event["data"]["chunk"]
                content = chunk.content
                if content:
                    yield _sse_event("token", {"content": content})

        # ── 도구 시작 ──
        elif kind == "on_tool_start":
            tool_name = event["name"]
            run_id = event.get("run_id", "")
            tool_input = event["data"].get("input", {})
            pending_tools[run_id] = tool_name
            yield _sse_event("tool_start", {
                "id": run_id,
                "tool": tool_name,
                "input": tool_input,
                "message": TOOL_MESSAGES.get(tool_name, f"{tool_name} 실행 중..."),
            })

        # ── 도구 완료 ──
        elif kind == "on_tool_end":
            tool_name = event["name"]
            run_id = event.get("run_id", "")
            try:
                output = event["data"].get("output", "")
                if hasattr(output, "content"):
                    output = output.content
                output_str = str(output)
                logger.info(f"[Agent] tool_end output length: {len(output_str)} ({tool_name})")

                structured = _parse_structured(tool_name, output_str)
                summary = _tool_end_summary(tool_name, output_str, structured)

                tool_history.append(tool_name)
                tool_structured[tool_name] = structured
                pending_tools.pop(run_id, None)

                yield _sse_event("tool_end", {
                    "id": run_id,
                    "tool": tool_name,
                    "result": output_str[:3000],
                    "structured": structured,
                    "summary": summary,
                })
            except Exception as e:
                logger.error(f"[Agent] tool_end 처리 실패 ({tool_name}): {e}", exc_info=True)
                pending_tools.pop(run_id, None)
                tool_history.append(tool_name)
                yield _sse_event("tool_end", {
                    "id": run_id,
                    "tool": tool_name,
                    "result": f"도구 결과 처리 중 오류: {e}",
                    "structured": None,
                    "summary": f"{TOOL_MESSAGES.get(tool_name, tool_name)} 처리 실패",
                })

    # tool_start는 왔지만 tool_end가 누락된 도구에 대해 에러 tool_end 발행
    for run_id, tool_name in pending_tools.items():
        logger.warning(f"[Agent] tool_end 누락 — {tool_name} (run_id={run_id})")
        tool_history.append(tool_name)
        yield _sse_event("tool_end", {
            "id": run_id,
            "tool": tool_name,
            "result": f"{tool_name} 실행 중 오류가 발생했습니다",
            "structured": None,
            "summary": f"{TOOL_MESSAGES.get(tool_name, tool_name)} 실패",
        })

    # 최종 상태에서 cited_sources 추출
    try:
        final_state = await graph.aget_state(config)
        cited_sources = final_state.values.get("cited_sources", [])
        if cited_sources:
            yield _sse_event("citations", {"sources": cited_sources})
    except Exception as cite_err:
        logger.warning(f"[Agent] cited_sources 추출 실패: {cite_err}")

    # done 직전: 도구를 사용한 경우에만 suggestions 이벤트 발행
    if tool_history:
        user_message = input_data["messages"][0].content if input_data.get("messages") else ""
        suggestions = await _generate_suggestions(user_message, tool_history, tool_structured)
        if suggestions:
            yield _sse_event("suggestions", {"items": suggestions})

    yield _sse_event("done", {})


@router.post("/chat")
async def agent_chat(
    request: AgentChatRequest,
    current_user=Depends(get_current_user),
):
    from app.home_agent.tools import create_tools
    from app.home_agent.graph import build_graph
    from app.home_agent.checkpointer import get_checkpointer

    user_id = current_user.id
    law_firm_id = current_user.firm_id

    async def event_stream():
        try:
            tools = create_tools(user_id=user_id, law_firm_id=law_firm_id)
            checkpointer = await get_checkpointer()
            graph = build_graph(tools=tools, checkpointer=checkpointer)

            thread_id = request.thread_id or f"user_{user_id}"
            config = {
                "configurable": {"thread_id": thread_id},
                "recursion_limit": 20,
            }

            input_data = {
                "messages": [HumanMessage(content=request.message)],
                "route": None,
                "cited_sources": [],
            }

            async for sse in _stream_graph_events(graph, input_data, config):
                yield sse

        except BadRequestError as e:
            error_msg = str(e)
            if "tool_call_ids" in error_msg:
                # 이전 대화 상태가 오염됨 → 새 thread로 재시도
                logger.warning(f"[Agent] 오염된 대화 상태 감지, 새 thread로 재시도: {e}")
                try:
                    fresh_config = {
                        "configurable": {"thread_id": f"user_{user_id}_{int(__import__('time').time())}"},
                        "recursion_limit": 20,
                    }
                    fresh_input = {
                        "messages": [HumanMessage(content=request.message)],
                        "route": None,
                        "cited_sources": [],
                    }
                    yield _sse_event("status", {"step": "routing", "message": "재처리 중입니다..."})
                    async for sse in _stream_graph_events(graph, fresh_input, fresh_config):
                        yield sse
                except Exception as retry_err:
                    logger.error(f"[Agent] 재시도도 실패: {retry_err}", exc_info=True)
                    yield _sse_event("error", {"message": "대화 상태 복구에 실패했습니다. 새 대화를 시작해 주세요."})
            else:
                logger.error(f"[Agent] OpenAI 요청 오류: {e}", exc_info=True)
                yield _sse_event("error", {"message": "AI 서비스 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."})
        except GraphRecursionError:
            yield _sse_event("error", {"message": "처리 단계가 너무 많습니다. 질문을 더 구체적으로 해주세요."})
        except Exception as e:
            logger.error(f"[Agent] 스트리밍 오류: {e}", exc_info=True)
            yield _sse_event("error", {"message": "오류가 발생했습니다. 잠시 후 다시 시도해 주세요."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
