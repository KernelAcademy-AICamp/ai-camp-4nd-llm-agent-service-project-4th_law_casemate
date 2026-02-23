import { FileText, CheckCircle2, XCircle, Lightbulb, Scale } from "lucide-react";

interface ComparisonData {
  case_overview: string;
  precedent_summary: string;
  similarities: string;
  differences: string;
  strategy_points: string;
}

interface Props {
  data: Record<string, string>;
}

export function ComparisonRenderer({ data }: Props) {
  const d = data as unknown as ComparisonData;
  if (!d) {
    return <p className="text-sm text-muted-foreground">비교 분석 결과가 없습니다.</p>;
  }

  const sections = [
    { icon: FileText, label: "현재 사건 개요", content: d.case_overview, color: "#6D5EF5" },
    { icon: Scale, label: "판례 요약", content: d.precedent_summary, color: "#3B82F6" },
    { icon: CheckCircle2, label: "유사점", content: d.similarities, color: "#10B981" },
    { icon: XCircle, label: "차이점", content: d.differences, color: "#EF4444" },
    { icon: Lightbulb, label: "전략적 시사점", content: d.strategy_points, color: "#F59E0B" },
  ];

  return (
    <div className="space-y-3">
      {sections.map((s) =>
        s.content ? (
          <div key={s.label} className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
              <s.icon className="h-3.5 w-3.5" style={{ color: s.color }} />
              <span className="text-xs font-semibold text-foreground">{s.label}</span>
            </div>
            <div className="px-3 py-2.5 text-xs text-card-foreground leading-relaxed whitespace-pre-wrap">
              {s.content}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}
