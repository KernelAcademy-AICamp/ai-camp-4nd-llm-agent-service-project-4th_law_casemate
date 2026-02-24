import { FileText } from "lucide-react";

interface SummaryData {
  case_number: string;
  summary: string;
}

interface Props {
  data: Record<string, string>;
}

export function PrecedentSummaryRenderer({ data }: Props) {
  const d = data as unknown as SummaryData;
  if (!d || !d.summary) {
    return <p className="text-sm text-muted-foreground">요약 결과가 없습니다.</p>;
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        <FileText className="h-3.5 w-3.5 text-indigo-500" />
        <span className="text-xs font-semibold text-foreground">판례 요약</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{d.case_number}</span>
      </div>
      <div className="px-3 py-2.5 text-xs text-card-foreground leading-relaxed whitespace-pre-wrap">
        {d.summary}
      </div>
    </div>
  );
}
