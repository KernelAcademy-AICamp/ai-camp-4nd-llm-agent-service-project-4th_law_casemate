"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Lightbulb,
  Loader2,
  AlertTriangle,
  FileText,
  Gavel,
  type LucideIcon,
} from "lucide-react";
import {
  useSearch,
  type ComparisonResult,
} from "@/contexts/search-context";
import {
  AgentLoadingOverlay,
  type AgentStep,
} from "@/components/ui/agent-loading-overlay";

interface ComparisonAnalysisProps {
  originCaseId: string;
  originFacts: string;
  originClaims: string;
  targetCaseNumber: string;
}

interface SectionConfig {
  title: string;
  icon: LucideIcon;
  bgColor: string;
  iconColor: string;
  bulletColor: string;
  items: string[];
  emptyMessage?: string;
}

const COMPARISON_STEPS: AgentStep[] = [
  { label: "판례 원문 조회 중…", status: "pending" },
  { label: "사실관계 대조 중…", status: "pending" },
  { label: "유사점 분석 중…", status: "pending" },
  { label: "차이점 도출 중…", status: "pending" },
  { label: "전략 포인트 정리 중…", status: "pending" },
];

const advanceStep = (steps: AgentStep[], index: number): AgentStep[] =>
  steps.map((s, i) =>
    i < index ? { ...s, status: "done" }
      : i === index ? { ...s, status: "in_progress" }
        : s
  );

export function ComparisonAnalysisContent({
  originCaseId,
  originFacts,
  originClaims,
  targetCaseNumber,
}: ComparisonAnalysisProps) {
  const { getComparison, setComparison } = useSearch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ComparisonResult | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);

  useEffect(() => {
    const fetchComparison = async () => {
      if (!originCaseId || !originFacts || !originClaims || !targetCaseNumber) return;

      // 1. 캐시에 있으면 캐시된 결과 사용
      const cached = getComparison(originCaseId, targetCaseNumber);
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }

      // 2. 캐시에 없으면 API 호출 + 에이전트 오버레이
      setLoading(true);
      setError(null);

      const steps = [...COMPARISON_STEPS];
      setAgentSteps(advanceStep(steps, 0));

      try {
        const timer1 = setTimeout(() => setAgentSteps(prev => advanceStep(prev, 1)), 1500);
        const timer2 = setTimeout(() => setAgentSteps(prev => advanceStep(prev, 2)), 4000);
        const timer3 = setTimeout(() => setAgentSteps(prev => advanceStep(prev, 3)), 7000);

        const response = await fetch("/api/v1/search/cases/compare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            origin_facts: originFacts,
            origin_claims: originClaims,
            target_case_number: targetCaseNumber,
          }),
        });

        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || "비교 분석 중 오류가 발생했습니다.");
        }

        // 결과 수신 → 마지막 단계
        setAgentSteps(prev => advanceStep(prev, 4));
        const result: ComparisonResult = await response.json();
        setData(result);

        // 3. 결과를 캐시에 저장
        setComparison(originCaseId, targetCaseNumber, result);

        // 모든 단계 완료 표시
        await new Promise(r => setTimeout(r, 800));
        setAgentSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
      } catch (err) {
        console.error("비교 분석 실패:", err);
        setError(err instanceof Error ? err.message : "비교 분석 중 오류가 발생했습니다.");
      } finally {
        setTimeout(() => {
          setLoading(false);
          setAgentSteps([]);
        }, 500);
      }
    };

    fetchComparison();
  }, [originCaseId, originFacts, originClaims, targetCaseNumber]);

  // 텍스트를 불릿 포인트 리스트로 변환
  const parseToList = (text: string): string[] => {
    if (!text) return [];
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[-•*]\s*/, ""));
  };

  // 문장 단위로 분리 (줄바꿈 또는 마침표 기준)
  const parseToSentences = (text: string): string[] => {
    if (!text) return [];
    const byNewline = text.split("\n").map(line => line.trim()).filter(line => line.length > 0);
    if (byNewline.length > 1) return byNewline;
    return text
      .split(/(?<=[.!?])\s+/)
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 0);
  };

  // **텍스트**를 <strong>으로 변환
  const formatBoldText = (text: string): React.ReactNode => {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((part, idx) =>
      idx % 2 === 1 ? <strong key={idx} className="font-semibold text-foreground">{part}</strong> : part
    );
  };

  // 아이템 컴포넌트
  const BulletItem = ({
    text,
    bulletColor,
  }: {
    text: string;
    bulletColor: string;
  }) => {
    return (
      <div className="flex items-start gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${bulletColor} mt-2 shrink-0`} />
        <p className="text-sm text-muted-foreground leading-relaxed">
          {formatBoldText(text)}
        </p>
      </div>
    );
  };

  // 불렛 리스트 섹션 컴포넌트
  const BulletSection = ({
    title,
    icon: Icon,
    bgColor,
    iconColor,
    bulletColor,
    items,
    emptyMessage,
  }: SectionConfig) => {
    if (items.length === 0 && !emptyMessage) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full ${bgColor} flex items-center justify-center`}>
            <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          </div>
          <h4 className="text-sm font-medium">{title}</h4>
        </div>
        <div className="pl-8 space-y-2">
          {items.length > 0 ? (
            items.map((item, idx) => (
              <BulletItem
                key={idx}
                text={item}
                bulletColor={bulletColor}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          )}
        </div>
      </div>
    );
  };

  // 로딩 상태 (에이전트 오버레이)
  if (agentSteps.length > 0) {
    return (
      <div className="relative" style={{ minHeight: "340px" }}>
        <AgentLoadingOverlay steps={agentSteps} />
      </div>
    );
  }

  // 캐시 로딩 등 간단한 로딩
  if (loading) {
    return (
      <div className="py-12">
        <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <div className="py-8">
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-[#EF4444]" />
          <p className="text-sm text-[#EF4444]">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { parsed } = data;

  const sections: SectionConfig[] = [
    {
      title: "현재 사건 개요",
      icon: FileText,
      bgColor: "bg-slate-100",
      iconColor: "text-slate-600",
      bulletColor: "bg-slate-500",
      items: parseToSentences(parsed.case_overview || ""),
    },
    {
      title: "유사 판례 요약",
      icon: Gavel,
      bgColor: "bg-violet-100",
      iconColor: "text-violet-600",
      bulletColor: "bg-violet-500",
      items: parseToSentences(parsed.precedent_summary || ""),
    },
    {
      title: "유사점",
      icon: CheckCircle2,
      bgColor: "bg-emerald-100",
      iconColor: "text-emerald-600",
      bulletColor: "bg-emerald-500",
      items: parseToList(parsed.similarities),
      emptyMessage: "분석된 유사점이 없습니다.",
    },
    {
      title: "차이점",
      icon: XCircle,
      bgColor: "bg-amber-100",
      iconColor: "text-amber-600",
      bulletColor: "bg-amber-500",
      items: parseToList(parsed.differences),
      emptyMessage: "분석된 차이점이 없습니다.",
    },
    {
      title: "전략 포인트",
      icon: Lightbulb,
      bgColor: "bg-blue-100",
      iconColor: "text-blue-600",
      bulletColor: "bg-blue-500",
      items: parseToList(parsed.strategy_points),
      emptyMessage: "분석된 전략 포인트가 없습니다.",
    },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section, idx) => (
        <BulletSection key={idx} {...section} />
      ))}
    </div>
  );
}
