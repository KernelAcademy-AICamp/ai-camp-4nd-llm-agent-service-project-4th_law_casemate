import { FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";

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
      <div className="px-3 py-2.5 text-xs text-card-foreground leading-relaxed prose prose-sm prose-slate dark:prose-invert max-w-none">
        <ReactMarkdown
          components={{
            h2: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0">{children}</h3>,
            h3: ({ children }) => <h4 className="text-xs font-semibold mt-2 mb-1">{children}</h4>,
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
            li: ({ children }) => <li className="text-xs">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          }}
        >
          {d.summary}
        </ReactMarkdown>
      </div>
    </div>
  );
}
