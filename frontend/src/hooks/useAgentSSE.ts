import { useState, useCallback, useRef } from "react";

// ── Types ──

export interface StepEvent {
  id: string;
  type: "status" | "tool";
  tool?: string;
  message: string;
  status: "active" | "done";
  summary?: string;
}

export interface ToolResult {
  id: string;
  tool: string;
  input?: Record<string, unknown>;
  result?: string;
  structured?: unknown;
  summary?: string;
  status: "loading" | "done" | "error";
}

export type AgentPhase = "idle" | "routing" | "planning" | "executing" | "generating" | "done";

/**
 * POST SSE 연결 훅 — 3채널 분리 상태 모델
 *
 * steps:         좌측 채팅 내 단계 표시용
 * toolResults:   우측 패널 리치 렌더링용
 * streamingText: generator 노드 토큰만
 */
export function useAgentSSE() {
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (message: string, threadId?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // 상태 초기화
    setSteps([]);
    setToolResults([]);
    setStreamingText("");
    setPhase("idle");
    setIsStreaming(true);
    setError(null);

    const token = localStorage.getItem("access_token");

    try {
      const response = await fetch("/api/v1/agent/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message, thread_id: threadId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("ReadableStream not supported");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const lines = part.split("\n");
          let eventType = "";
          let dataStr = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6);
            }
          }

          if (!eventType || !dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            handleEvent(eventType, data);
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "연결 오류");
    } finally {
      setIsStreaming(false);
    }
  }, []);

  function handleEvent(type: string, data: Record<string, unknown>) {
    switch (type) {
      case "status": {
        const step = data.step as string;
        const message = data.message as string;
        setPhase(step as AgentPhase);
        setSteps((prev) => {
          // 이전 status 단계를 done으로 마킹
          const updated = prev.map((s) =>
            s.type === "status" && s.status === "active"
              ? { ...s, status: "done" as const }
              : s
          );
          return [
            ...updated,
            {
              id: `status-${step}-${Date.now()}`,
              type: "status",
              message,
              status: "active",
            },
          ];
        });
        break;
      }

      case "tool_start": {
        const id = data.id as string;
        const tool = data.tool as string;
        const input = data.input as Record<string, unknown> | undefined;
        const message = data.message as string;

        // steps에 추가
        setSteps((prev) => [
          ...prev,
          { id, type: "tool", tool, message, status: "active" },
        ]);
        // toolResults에 추가
        setToolResults((prev) => [
          ...prev,
          { id, tool, input, status: "loading" },
        ]);
        break;
      }

      case "tool_end": {
        const id = data.id as string;
        const tool = data.tool as string;
        const result = data.result as string | undefined;
        const structured = data.structured as unknown;
        const summary = data.summary as string | undefined;

        // steps에서 완료 처리
        setSteps((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, status: "done" as const, summary: summary || s.message }
              : s
          )
        );
        // toolResults에서 업데이트
        setToolResults((prev) =>
          prev.map((tr) =>
            tr.id === id
              ? { ...tr, result, structured, summary, status: "done" as const }
              : tr
          )
        );
        break;
      }

      case "token":
        setStreamingText((prev) => prev + (data.content as string));
        break;

      case "done":
        setPhase("done");
        // 남은 active steps를 done으로
        setSteps((prev) =>
          prev.map((s) => (s.status === "active" ? { ...s, status: "done" as const } : s))
        );
        break;

      case "error":
        setError(data.message as string);
        break;
    }
  }

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return {
    steps,
    toolResults,
    streamingText,
    phase,
    isStreaming,
    error,
    send,
    abort,
  };
}
