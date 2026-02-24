import { Scale } from "lucide-react";

interface AgentBubbleProps {
  isProcessing: boolean;
  toolCount: number;
  onClick: () => void;
}

export function AgentBubble({ isProcessing, toolCount, onClick }: AgentBubbleProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg border border-border/50 transition-all hover:scale-105 hover:shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300"
      style={{
        background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)",
      }}
    >
      <div className="relative">
        <Scale className="h-5 w-5 text-white" />
        {isProcessing && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>
      <span className="text-sm font-medium text-white">
        {isProcessing
          ? "AI 어쏘가 업무를 처리하고 있습니다."
          : `처리 완료 (${toolCount}건) — 클릭하여 결과 보기`}
      </span>
    </button>
  );
}
