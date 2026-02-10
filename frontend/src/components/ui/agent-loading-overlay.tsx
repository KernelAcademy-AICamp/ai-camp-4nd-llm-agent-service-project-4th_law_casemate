import { useEffect, useState, useRef, useMemo } from "react";
import { Check } from "lucide-react";

export interface AgentStep {
  label: string;
  status: "pending" | "in_progress" | "done";
}

interface AgentLoadingOverlayProps {
  steps: AgentStep[];
  progress?: number;
  visibleCount?: number;
}

/** 파티클 하나의 설정 */
interface Particle {
  size: number;
  radius: number;
  duration: number;
  delay: number;
  opacity: number;
  reverse: boolean;
}

function generateParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const layer = i < 5 ? "core" : i < 11 ? "mid" : "outer";
    particles.push({
      size: layer === "core" ? 2.5 + Math.random() * 1.5
           : layer === "mid" ? 1.5 + Math.random() * 1
           : 1 + Math.random() * 0.8,
      radius: layer === "core" ? 6 + Math.random() * 10
             : layer === "mid" ? 18 + Math.random() * 14
             : 34 + Math.random() * 16,
      duration: layer === "core" ? 2 + Math.random() * 1.5
               : layer === "mid" ? 3 + Math.random() * 2
               : 4 + Math.random() * 3,
      delay: Math.random() * -6,
      opacity: layer === "core" ? 0.7 + Math.random() * 0.3
              : layer === "mid" ? 0.4 + Math.random() * 0.3
              : 0.15 + Math.random() * 0.25,
      reverse: Math.random() > 0.5,
    });
  }
  return particles;
}

function ParticleOrb() {
  const particles = useMemo(() => generateParticles(18), []);

  return (
    <div className="relative mb-7 flex items-center justify-center" style={{ width: 120, height: 120 }}>
      {/* 코어 글로우 (고정, 숨쉬는 빛) */}
      <div className="absolute agent-core-glow" />

      {/* 궤도 파티클들 */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute inset-0 flex items-center justify-center"
          style={{
            animation: `agent-orbit ${p.duration}s linear infinite ${p.reverse ? "reverse" : "normal"}`,
            animationDelay: `${p.delay}s`,
            // 각 파티클 궤도의 초기 각도를 분산
            transform: `rotate(${(i * 360) / particles.length}deg)`,
          }}
        >
          <div
            className="absolute rounded-full agent-particle-breathe"
            style={{
              width: p.size,
              height: p.size,
              top: `calc(50% - ${p.radius}px)`,
              left: "50%",
              marginLeft: -p.size / 2,
              background: `radial-gradient(circle, rgba(167, 139, 250, ${p.opacity}) 0%, rgba(109, 94, 245, ${p.opacity * 0.6}) 100%)`,
              boxShadow: `0 0 ${p.size * 2}px ${p.size * 0.5}px rgba(109, 94, 245, ${p.opacity * 0.4})`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration * 0.8}s`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function AgentLoadingOverlay({
  steps,
  progress,
  visibleCount = 4,
}: AgentLoadingOverlayProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [displaySteps, setDisplaySteps] = useState<AgentStep[]>(steps);

  useEffect(() => {
    setDisplaySteps(steps);
  }, [steps]);

  const doneCount = displaySteps.filter((s) => s.status === "done").length;
  const inProgressCount = displaySteps.filter((s) => s.status === "in_progress").length;
  const totalCount = displaySteps.length;
  const autoProgress =
    totalCount > 0
      ? Math.round(((doneCount + inProgressCount * 0.5) / totalCount) * 100)
      : 0;
  const finalProgress = progress ?? autoProgress;

  const activeIndex = displaySteps.findLastIndex(
    (s) => s.status === "in_progress" || s.status === "done"
  );

  const startIdx = Math.max(0, activeIndex - visibleCount + 1);
  const visibleSteps = displaySteps.slice(startIdx, startIdx + visibleCount);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [activeIndex]);

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg overflow-hidden"
      style={{
        backdropFilter: "blur(40px)",
        WebkitBackdropFilter: "blur(40px)",
        background: "color-mix(in srgb, var(--card) 82%, transparent)",
      }}
    >
      <ParticleOrb />

      {/* Task log */}
      <div
        ref={listRef}
        className="flex flex-col items-center gap-2 w-full max-w-[280px] mb-5 overflow-hidden"
        style={{ maxHeight: `${visibleCount * 30}px` }}
      >
        {visibleSteps.map((step, i) => {
          const globalIdx = startIdx + i;
          return (
            <div
              key={globalIdx}
              className="agent-slide-up flex items-center gap-2.5 px-1"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {step.status === "done" ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              ) : step.status === "in_progress" ? (
                <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                  <div className="h-2 w-2 rounded-full bg-primary agent-dot-pulse" />
                </div>
              ) : (
                <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
                </div>
              )}
              <span
                className={`text-[13px] leading-tight transition-all duration-300 ${
                  step.status === "done"
                    ? "text-muted-foreground/40"
                    : step.status === "in_progress"
                      ? "text-primary font-medium"
                      : "text-muted-foreground/30"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-[200px] h-[3px] rounded-full bg-muted/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-700 ease-out"
          style={{ width: `${finalProgress}%` }}
        />
      </div>
    </div>
  );
}
