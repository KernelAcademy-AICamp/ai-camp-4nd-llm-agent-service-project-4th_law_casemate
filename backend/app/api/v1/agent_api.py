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
from pydantic import BaseModel
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


def _generate_suggestions(
    tool_history: list[str],
    tool_structured: dict[str, dict | None],
) -> list[dict]:
    """도구 실행 이력 기반 후속 질문/액션 생성 (LLM 호출 없음)"""
    suggestions: list[dict] = []

    # 미등록 사건 → 등록 유도
    if "list_cases" in tool_history:
        lc_data = tool_structured.get("list_cases")
        if lc_data and isinstance(lc_data.get("data"), list) and len(lc_data["data"]) == 0:
            suggestions.append({
                "text": "새 사건을 등록하시겠습니까?",
                "type": "action",
                "action": {"navigate": "/new-case"},
            })
            return suggestions

    last_tool = tool_history[-1] if tool_history else None

    TOOL_SUGGESTIONS: dict[str, list[str]] = {
        "list_cases": ["사건 분석해줘", "증거 현황 알려줘"],
        "analyze_case": ["유사 판례 찾아줘", "타임라인 만들어줘", "관계도 만들어줘"],
        "search_precedents": ["판례 요약해줘", "판례 비교해줘"],
        "generate_timeline": ["관계도도 만들어줘"],
        "generate_relationship": ["타임라인도 만들어줘"],
        "get_case_evidence": ["증거 분석 요약해줘", "사건 분석해줘"],
        "search_laws": ["유사 판례도 찾아줘"],
    }

    for text in TOOL_SUGGESTIONS.get(last_tool, []):
        suggestions.append({"text": text, "type": "question"})

    return suggestions[:3]


class AgentChatRequest(BaseModel):
    message: str
    thread_id: str | None = None


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


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
        # 현재 노드 추적 (generator 토큰만 전송하기 위해)
        current_node = ""
        # tool run_id → tool_name 매핑
        tool_run_ids: dict[str, str] = {}
        # suggestions 생성용 도구 이력 추적
        tool_history: list[str] = []
        tool_structured: dict[str, dict | None] = {}

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

            async for event in graph.astream_events(input_data, config, version="v2"):
                kind = event["event"]

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
                    # generator: complex 최종 답변
                    # agent: simple 최종 답변 (도구 결과 후 직접 응답)
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
                    tool_run_ids[run_id] = tool_name
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
                    output = event["data"].get("output", "")
                    if hasattr(output, "content"):
                        output = output.content
                    output_str = str(output)

                    # 구조화 데이터 파싱 시도
                    structured = _parse_structured(tool_name, output_str)
                    summary = _tool_end_summary(tool_name, output_str, structured)

                    # suggestions 생성용 이력 추적
                    tool_history.append(tool_name)
                    tool_structured[tool_name] = structured

                    yield _sse_event("tool_end", {
                        "id": run_id,
                        "tool": tool_name,
                        "result": output_str[:3000],
                        "structured": structured,
                        "summary": summary,
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
                suggestions = _generate_suggestions(tool_history, tool_structured)
                if suggestions:
                    yield _sse_event("suggestions", {"items": suggestions})

            yield _sse_event("done", {})

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
                    async for event in graph.astream_events(fresh_input, fresh_config, version="v2"):
                        kind = event["event"]
                        if kind == "on_chain_start":
                            node_name = event.get("name", "")
                            if node_name in STATUS_MESSAGES:
                                current_node = node_name
                                yield _sse_event("status", {
                                    "step": STATUS_STEPS.get(node_name, "executing"),
                                    "message": STATUS_MESSAGES[node_name],
                                })
                        elif kind == "on_chat_model_stream":
                            if current_node in ("generator", "agent"):
                                chunk = event["data"]["chunk"]
                                content = chunk.content
                                if content:
                                    yield _sse_event("token", {"content": content})
                        elif kind == "on_tool_start":
                            tool_name = event["name"]
                            run_id = event.get("run_id", "")
                            tool_input = event["data"].get("input", {})
                            tool_run_ids[run_id] = tool_name
                            yield _sse_event("tool_start", {
                                "id": run_id,
                                "tool": tool_name,
                                "input": tool_input,
                                "message": TOOL_MESSAGES.get(tool_name, f"{tool_name} 실행 중..."),
                            })
                        elif kind == "on_tool_end":
                            tool_name = event["name"]
                            run_id = event.get("run_id", "")
                            output = event["data"].get("output", "")
                            if hasattr(output, "content"):
                                output = output.content
                            output_str = str(output)
                            structured = _parse_structured(tool_name, output_str)
                            summary = _tool_end_summary(tool_name, output_str, structured)
                            tool_history.append(tool_name)
                            tool_structured[tool_name] = structured
                            yield _sse_event("tool_end", {
                                "id": run_id,
                                "tool": tool_name,
                                "result": output_str[:3000],
                                "structured": structured,
                                "summary": summary,
                            })
                    # 최종 상태에서 cited_sources 추출
                    try:
                        final_state = await graph.aget_state(fresh_config)
                        cited_sources = final_state.values.get("cited_sources", [])
                        if cited_sources:
                            yield _sse_event("citations", {"sources": cited_sources})
                    except Exception as cite_err:
                        logger.warning(f"[Agent] cited_sources 추출 실패 (재시도): {cite_err}")

                    if tool_history:
                        suggestions = _generate_suggestions(tool_history, tool_structured)
                        if suggestions:
                            yield _sse_event("suggestions", {"items": suggestions})
                    yield _sse_event("done", {})
                except Exception as retry_err:
                    logger.error(f"[Agent] 재시도도 실패: {retry_err}", exc_info=True)
                    yield _sse_event("error", {"message": "대화 상태 복구에 실패했습니다. 새 대화를 시작해 주세요."})
            else:
                logger.error(f"[Agent] OpenAI 요청 오류: {e}", exc_info=True)
                yield _sse_event("error", {"message": f"AI 서비스 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."})
        except GraphRecursionError:
            yield _sse_event("error", {"message": "처리 단계가 너무 많습니다. 질문을 더 구체적으로 해주세요."})
        except Exception as e:
            logger.error(f"[Agent] 스트리밍 오류: {e}", exc_info=True)
            yield _sse_event("error", {"message": f"오류가 발생했습니다. 잠시 후 다시 시도해 주세요."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
