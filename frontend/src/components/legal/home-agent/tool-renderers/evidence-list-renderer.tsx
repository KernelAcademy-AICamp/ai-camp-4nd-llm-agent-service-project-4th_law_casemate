import { useNavigate } from "react-router-dom";
import { FileText, Star, AlertTriangle, CheckCircle, ExternalLink } from "lucide-react";

interface EvidenceItem {
  id: number;
  file_name: string;
  file_type: string;
  doc_type: string;
  starred: boolean;
  evidence_date: string | null;
  description: string | null;
  has_analysis: boolean;
  analysis_summary: string | null;
  legal_relevance: string | null;
  risk_level: string | null;
}

interface Props {
  data: Record<string, unknown>[];
  caseId?: number;
}

const RISK_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

export function EvidenceListRenderer({ data, caseId }: Props) {
  const navigate = useNavigate();
  const items = data as unknown as EvidenceItem[];

  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">연결된 증거가 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      {caseId && (
        <button
          onClick={() => navigate(`/cases/${caseId}`)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors border border-primary/20"
        >
          <span>사건 상세 페이지에서 보기</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border border-border/50 bg-card p-3 space-y-1.5"
        >
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold text-foreground truncate flex-1">
              {item.file_name}
            </span>
            {item.starred && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" />}
            {item.risk_level && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${RISK_COLORS[item.risk_level] || ""}`}>
                {item.risk_level === "high" ? "고위험" : item.risk_level === "medium" ? "주의" : "양호"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{item.doc_type}</span>
            {item.evidence_date && <span>{item.evidence_date}</span>}
            {item.has_analysis ? (
              <span className="flex items-center gap-0.5 text-green-600">
                <CheckCircle className="h-2.5 w-2.5" /> 분석 완료
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-muted-foreground/60">
                <AlertTriangle className="h-2.5 w-2.5" /> 미분석
              </span>
            )}
          </div>

          {item.description && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">{item.description}</p>
          )}

          {item.analysis_summary && (
            <div className="text-[11px] text-card-foreground bg-muted/30 rounded-lg px-2.5 py-1.5 leading-relaxed">
              {item.analysis_summary.slice(0, 200)}
              {item.analysis_summary.length > 200 && "..."}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
