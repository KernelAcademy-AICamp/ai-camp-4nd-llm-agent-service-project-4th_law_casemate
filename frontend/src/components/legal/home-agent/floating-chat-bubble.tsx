import { useNavigate } from "react-router-dom";
import { MessageSquare, Loader2 } from "lucide-react";
import { useChat } from "@/contexts/chat-context";

/**
 * 홈 이외의 페이지에서 표시되는 플로팅 채팅 구체.
 * 진행 중인 대화가 있을 때만 노출. 클릭 시 홈(채팅)으로 복귀.
 */
export function FloatingChatBubble() {
  const navigate = useNavigate();
  const { hasMessages, agent, messages } = useChat();

  if (!hasMessages) return null;

  const lastMessage = messages[messages.length - 1];
  const preview = agent.isStreaming
    ? "답변 작성 중..."
    : lastMessage?.role === "assistant"
      ? lastMessage.content.slice(0, 30) + (lastMessage.content.length > 30 ? "..." : "")
      : "대화 진행 중";

  return (
    <button
      onClick={() => navigate("/")}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 pl-4 pr-5 py-3 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
      style={{
        background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)",
      }}
    >
      <div className="relative">
        {agent.isStreaming ? (
          <Loader2 className="h-5 w-5 text-white animate-spin" />
        ) : (
          <MessageSquare className="h-5 w-5 text-white" />
        )}
        {/* 메시지 수 배지 */}
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white text-[9px] font-bold text-primary flex items-center justify-center">
          {messages.length}
        </span>
      </div>
      <span className="text-white text-xs font-medium max-w-[140px] truncate">
        {preview}
      </span>
    </button>
  );
}
