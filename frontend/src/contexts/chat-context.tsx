import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { useAgentSSE, type StepEvent, type ToolResult, type AgentPhase, type SuggestionItem, type CitationSource } from "@/hooks/useAgentSSE";

// ── Types ──
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: StepEvent[];
  toolResults?: ToolResult[];
  suggestions?: SuggestionItem[];
  citations?: CitationSource[];
}

interface ChatContextValue {
  messages: ChatMessage[];
  addUserMessage: (text: string) => void;
  finalizeAssistantMessage: () => void;
  resetChat: () => void;
  hasMessages: boolean;
  // Agent SSE passthrough
  agent: {
    steps: StepEvent[];
    toolResults: ToolResult[];
    streamingText: string;
    phase: AgentPhase;
    isStreaming: boolean;
    error: string | null;
    suggestions: SuggestionItem[];
    citations: CitationSource[];
    send: (message: string, threadId?: string) => Promise<void>;
    abort: () => void;
    reset: () => void;
  };
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const agent = useAgentSSE();
  const finalizedRef = useRef(false);

  const addUserMessage = useCallback((text: string) => {
    finalizedRef.current = false; // 새 메시지 시작 → finalize 허용
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: text },
    ]);
  }, []);

  const finalizeAssistantMessage = useCallback(() => {
    if (finalizedRef.current) return; // 이미 확정됨 → 중복 방지
    if (agent.streamingText) {
      finalizedRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: agent.streamingText,
          steps: agent.steps.length > 0 ? [...agent.steps] : undefined,
          toolResults: agent.toolResults.length > 0 ? [...agent.toolResults] : undefined,
          suggestions: agent.suggestions.length > 0 ? [...agent.suggestions] : undefined,
          citations: agent.citations.length > 0 ? [...agent.citations] : undefined,
        },
      ]);
    }
  }, [agent.streamingText, agent.steps, agent.toolResults, agent.suggestions, agent.citations]);

  const resetChat = useCallback(() => {
    finalizedRef.current = false;
    agent.reset();  // 모든 agent 상태 초기화 (toolResults 포함)
    setMessages([]);
  }, [agent]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        addUserMessage,
        finalizeAssistantMessage,
        resetChat,
        hasMessages: messages.length > 0,
        agent,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
