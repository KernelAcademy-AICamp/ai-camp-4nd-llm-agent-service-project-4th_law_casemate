import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, AlertCircle, Gavel, Tag, ExternalLink } from "lucide-react";

interface AnalysisData {
  summary: string;
  facts: string;
  claims: string;
  crime_names: string[];
  legal_keywords: string[];
}

interface Props {
  data: Record<string, string | string[]>;
  caseId?: number;
}

export function CaseAnalysisRenderer({ data, caseId }: Props) {
  const navigate = useNavigate();
  const d = data as unknown as AnalysisData;
  if (!d || !d.summary) {
    return <p className="text-sm text-muted-foreground">분석 결과가 없습니다.</p>;
  }

  const sections = [
    { icon: FileText, label: "요약", content: d.summary, color: "#6D5EF5" },
    { icon: AlertCircle, label: "사실관계", content: d.facts, color: "#F59E0B" },
    { icon: Gavel, label: "청구사항", content: d.claims, color: "#3B82F6" },
  ];

  return (
    <div className="space-y-3">
      {caseId && (
        <button
          onClick={() => navigate(`/cases/${caseId}`)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors border border-primary/20"
        >
          <span>사건 상세 페이지에서 보기</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      {sections.map((s) => (
        <div key={s.label} className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <s.icon className="h-3.5 w-3.5" style={{ color: s.color }} />
            <span className="text-xs font-semibold text-foreground">{s.label}</span>
          </div>
          <div className="px-3 py-2.5 text-xs text-card-foreground leading-relaxed
            prose prose-xs dark:prose-invert max-w-none
            prose-p:my-1 prose-p:text-xs prose-p:text-card-foreground
            prose-strong:text-foreground prose-strong:font-semibold
            prose-li:text-xs prose-li:my-0.5
            prose-ul:my-1 prose-ol:my-1
            prose-headings:text-xs prose-headings:font-semibold prose-headings:my-1
          ">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.content}</ReactMarkdown>
          </div>
        </div>
      ))}

      {/* 범죄명 + 키워드 태그 */}
      {(d.crime_names.length > 0 || d.legal_keywords.length > 0) && (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <Tag className="h-3.5 w-3.5 text-purple-500" />
            <span className="text-xs font-semibold text-foreground">관련 키워드</span>
          </div>
          <div className="px-3 py-2.5 flex flex-wrap gap-1.5">
            {d.crime_names.map((name) => (
              <span key={name} className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
                {name}
              </span>
            ))}
            {d.legal_keywords.map((kw) => (
              <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
