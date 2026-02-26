import { useNavigate } from "react-router-dom";
import { Scale, Calendar, Building2, ExternalLink } from "lucide-react";

interface PrecedentItem {
  case_number: string;
  case_name: string;
  court: string;
  judgment_date: string;
  content_snippet: string;
}

interface Props {
  data: Record<string, unknown>[];
}

// {{PARA}}, <br>, HTML 태그 등을 제거
function cleanSnippet(text: string): string {
  return text
    .replace(/\{\{PARA\}\}/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function PrecedentListRenderer({ data }: Props) {
  const navigate = useNavigate();
  const items = data as unknown as PrecedentItem[];

  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">검색된 판례가 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div
          key={item.case_number || idx}
          onClick={() => navigate(`/precedents/${encodeURIComponent(item.case_number)}`)}
          className="rounded-xl border border-border/50 bg-card p-3 hover:border-blue-300/50 hover:shadow-sm transition-all cursor-pointer group"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10 shrink-0 mt-0.5">
              <Scale className="h-4 w-4 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-primary">{item.case_number}</p>
                <ExternalLink className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors ml-auto shrink-0" />
              </div>
              <p className="text-sm font-medium text-foreground mt-0.5 line-clamp-2 group-hover:text-primary transition-colors">{item.case_name}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {item.court}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {item.judgment_date}
                </span>
              </div>
              {item.content_snippet && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-3 leading-relaxed">
                  {cleanSnippet(item.content_snippet)}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
