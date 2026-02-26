import { useNavigate } from "react-router-dom";
import { FileText, ExternalLink, Paperclip, FlaskConical, Calendar } from "lucide-react";

interface CaseItem {
  id: number;
  title: string;
  client_name: string;
  opponent_name: string;
  case_type: string;
  status: string;
  evidence_count?: number;
  has_analysis?: boolean;
  created_at?: string;
}

interface Props {
  data: Record<string, unknown>[];
}

const STATUS_COLORS: Record<string, string> = {
  "진행중": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "완료": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "대기": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  "접수": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export function CaseListRenderer({ data }: Props) {
  const navigate = useNavigate();
  const cases = data as unknown as CaseItem[];

  if (!cases || cases.length === 0) {
    return <p className="text-sm text-muted-foreground">등록된 사건이 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      {cases.map((c) => (
        <div
          key={c.id}
          onClick={() => navigate(`/cases/${c.id}`)}
          className="rounded-xl border border-border/50 bg-card p-3 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10 shrink-0 mt-0.5">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] || "bg-muted text-muted-foreground"}`}>
                  {c.status}
                </span>
                <ExternalLink className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors ml-auto shrink-0" />
              </div>
              <p className="text-sm font-medium text-foreground truncate mt-0.5 group-hover:text-primary transition-colors">{c.title}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>의뢰인: {c.client_name}</span>
                <span>상대방: {c.opponent_name}</span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[10px] text-muted-foreground/70">{c.case_type}</span>
                {c.created_at && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
                    <Calendar className="h-2.5 w-2.5" />
                    {c.created_at}
                  </span>
                )}
                {c.evidence_count != null && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
                    <Paperclip className="h-2.5 w-2.5" />
                    증거 {c.evidence_count}건
                  </span>
                )}
                {c.has_analysis != null && (
                  <span className={`flex items-center gap-0.5 text-[10px] ${c.has_analysis ? "text-green-600" : "text-muted-foreground/50"}`}>
                    <FlaskConical className="h-2.5 w-2.5" />
                    {c.has_analysis ? "분석완료" : "미분석"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
