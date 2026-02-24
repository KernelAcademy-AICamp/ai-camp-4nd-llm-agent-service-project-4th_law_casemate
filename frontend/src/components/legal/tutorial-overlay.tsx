import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface TutorialStep {
  /** data-guide 속성값 (예: "nav-cases") */
  target: string;
  title: string;
  description: string;
  /** 툴팁 위치 */
  placement: "top" | "bottom" | "left" | "right";
}

interface TutorialOverlayProps {
  steps: TutorialStep[];
  onClose: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8; // spotlight padding around element
const TOOLTIP_GAP = 12; // gap between spotlight and tooltip
const TOOLTIP_WIDTH = 320;

function getTooltipStyle(
  spotRect: Rect,
  placement: TutorialStep["placement"],
  tooltipHeight: number,
): React.CSSProperties {
  const cx = spotRect.left + spotRect.width / 2;
  const cy = spotRect.top + spotRect.height / 2;

  switch (placement) {
    case "right":
      return {
        left: spotRect.left + spotRect.width + TOOLTIP_GAP,
        top: cy - tooltipHeight / 2,
      };
    case "left":
      return {
        left: spotRect.left - TOOLTIP_WIDTH - TOOLTIP_GAP,
        top: cy - tooltipHeight / 2,
      };
    case "top":
      return {
        left: cx - TOOLTIP_WIDTH / 2,
        top: spotRect.top - tooltipHeight - TOOLTIP_GAP,
      };
    case "bottom":
      return {
        left: cx - TOOLTIP_WIDTH / 2,
        top: spotRect.top + spotRect.height + TOOLTIP_GAP,
      };
  }
}

export function TutorialOverlay({ steps, onClose }: TutorialOverlayProps) {
  const [current, setCurrent] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(160);

  const step = steps[current];

  // 대상 요소의 위치 측정
  const measure = useCallback(() => {
    const el = document.querySelector<HTMLElement>(
      `[data-guide="${step.target}"]`,
    );
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - PADDING,
      left: r.left - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
  }, [step.target]);

  // 초기 측정 + resize / scroll 대응
  useEffect(() => {
    measure();

    const el = document.querySelector<HTMLElement>(
      `[data-guide="${step.target}"]`,
    );

    // ResizeObserver로 대상 요소 크기 변경 대응
    let ro: ResizeObserver | undefined;
    if (el) {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, step.target]);

  // 툴팁 높이 측정
  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight);
    }
  }, [current]);

  const goNext = () => {
    if (current < steps.length - 1) setCurrent((c) => c + 1);
    else onClose();
  };

  const goPrev = () => {
    if (current > 0) setCurrent((c) => c - 1);
  };

  const isLast = current === steps.length - 1;

  if (!rect) return null;

  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    width: TOOLTIP_WIDTH,
    zIndex: 10001,
    ...getTooltipStyle(rect, step.placement, tooltipHeight),
  };

  return (
    <div className="fixed inset-0 z-[10000]">
      {/* 어두운 배경 + 스포트라이트 구멍 (box-shadow 기법) */}
      <div
        className="absolute transition-all duration-300 ease-out rounded-xl"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          pointerEvents: "none",
        }}
      />

      {/* 오버레이 클릭 차단 (스포트라이트 바깥) */}
      <div className="absolute inset-0" style={{ pointerEvents: "auto" }} onClick={(e) => e.stopPropagation()} />

      {/* 툴팁 카드 */}
      <div
        ref={tooltipRef}
        className="bg-card rounded-xl border border-border/60 shadow-xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-200"
        style={tooltipStyle}
      >
        {/* 제목 + 닫기 */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5 -mr-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 설명 */}
        <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
          {step.description}
        </p>

        {/* 하단: 스텝 인디케이터 + 버튼 */}
        <div className="flex items-center justify-between">
          {/* 도트 인디케이터 */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className="block rounded-full transition-all duration-200"
                style={{
                  width: i === current ? 16 : 6,
                  height: 6,
                  background:
                    i === current
                      ? "linear-gradient(135deg, #6D5EF5, #A78BFA)"
                      : "var(--muted)",
                }}
              />
            ))}
          </div>

          {/* 버튼 그룹 */}
          <div className="flex items-center gap-2">
            {current > 0 && (
              <button
                type="button"
                onClick={goPrev}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-muted/60"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                이전
              </button>
            )}
            {!isLast && (
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors px-2 py-1.5"
              >
                건너뛰기
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="flex items-center gap-1 text-xs font-medium text-white px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
              style={{
                background: "linear-gradient(135deg, #6D5EF5, #A78BFA)",
              }}
            >
              {isLast ? "완료" : "다음"}
              {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
