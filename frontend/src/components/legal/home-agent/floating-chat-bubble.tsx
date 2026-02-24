import { useNavigate } from "react-router-dom";
import { MessageSquare, Loader2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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
      ? lastMessage.content.slice(0, 60) + (lastMessage.content.length > 60 ? "..." : "")
      : "대화 진행 중";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center">
          {/* 구체 본체 */}
          <button
            onClick={() => navigate("/")}
            className={`
              w-14 h-14 rounded-full
              flex items-center justify-center
              transition-all duration-200
              hover:scale-110 active:scale-95
              hover:-translate-y-0.5
              ${agent.isStreaming ? "animate-pulse" : ""}
            `}
            style={{
              background: "linear-gradient(145deg, #6D5EF5 0%, #8B7AF7 50%, #A78BFA 100%)",
              boxShadow:
                "0 4px 12px rgba(109, 94, 245, 0.35)," +
                "0 12px 28px -4px rgba(79, 70, 229, 0.3)," +
                "0 0 0 1px rgba(255, 255, 255, 0.1) inset",
            }}
          >
          <div className="relative">
            {agent.isStreaming ? (
              <Loader2 className="h-6 w-6 text-white animate-spin" />
            ) : (
              <MessageSquare className="h-6 w-6 text-white" />
            )}
            <span
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white text-[10px] font-bold flex items-center justify-center shadow-sm"
              style={{ color: "#6D5EF5" }}
            >
              {messages.length}
            </span>
          </div>
        </button>

          {/* 바닥 그림자 */}
          <div
            className="mt-1"
            style={{
              width: 40,
              height: 8,
              borderRadius: "50%",
              background: "radial-gradient(ellipse, rgba(15, 23, 42, 0.18) 0%, rgba(15, 23, 42, 0.06) 50%, transparent 80%)",
            }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8} className="max-w-[200px]">
        {preview}
      </TooltipContent>
    </Tooltip>
  );
}
