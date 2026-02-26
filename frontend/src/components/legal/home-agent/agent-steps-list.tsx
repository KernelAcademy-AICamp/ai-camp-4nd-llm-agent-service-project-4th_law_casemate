import { useRef, useEffect } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { StepEvent } from "@/hooks/useAgentSSE";

interface AgentStepsListProps {
  steps: StepEvent[];
}

/**
 * 2-3줄 고정 높이 컨테이너. 새 단계가 추가되면 자동 스크롤되어
 * 완료된 단계가 위로 밀려 올라가고 현재 진행 중인 단계만 보임.
 */
export function AgentStepsList({ steps }: AgentStepsListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 새 step 추가 시 자동 스크롤
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [steps.length]);

  if (steps.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="overflow-hidden relative"
      style={{ maxHeight: "4.5rem" /* 약 3줄 */ }}
    >
      {/* 위쪽 페이드 그래디언트 (밀려 올라간 항목이 흐려짐) */}
      {steps.length > 3 && (
        <div className="absolute top-0 left-0 right-0 h-4 z-10 pointer-events-none bg-gradient-to-b from-card to-transparent" />
      )}
      <div className="flex flex-col gap-0.5 py-1">
        {steps.map((step) => (
          <div
            key={step.id}
            className="flex items-center gap-2 text-xs transition-opacity duration-300"
            style={{ opacity: step.status === "done" ? 0.45 : 1 }}
          >
            {step.status === "active" ? (
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
            )}
            <span className="text-muted-foreground truncate">
              {step.status === "done" && step.summary ? step.summary : step.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
