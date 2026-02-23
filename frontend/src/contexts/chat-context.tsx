import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useAgentSSE, type StepEvent, type ToolResult, type AgentPhase } from "@/hooks/useAgentSSE";

// ── Types ──
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: StepEvent[];
  toolResults?: ToolResult[];
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
    send: (message: string, threadId?: string) => Promise<void>;
    abort: () => void;
  };
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const agent = useAgentSSE();

  const addUserMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: text },
    ]);
  }, []);

  const finalizeAssistantMessage = useCallback(() => {
    if (agent.streamingText) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: agent.streamingText,
          steps: agent.steps.length > 0 ? [...agent.steps] : undefined,
          toolResults: agent.toolResults.length > 0 ? [...agent.toolResults] : undefined,
        },
      ]);
    }
  }, [agent.streamingText, agent.steps, agent.toolResults]);

  const resetChat = useCallback(() => {
    agent.abort();
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
