import { useNavigate } from "react-router-dom";
import { Clock, User, Tag, ExternalLink } from "lucide-react";

interface TimelineEvent {
  date: string | null;
  title: string;
  description: string;
  type: string | null;
  actor: string | null;
}

interface Props {
  data: Record<string, unknown>[];
  caseId?: number;
}

const TYPE_COLORS: Record<string, string> = {
  "의뢰인": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "상대방": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "증거": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "기타": "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

export function TimelineRenderer({ data, caseId }: Props) {
  const navigate = useNavigate();
  const events = data as unknown as TimelineEvent[];

  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground">타임라인 이벤트가 없습니다.</p>;
  }

  return (
    <div className="relative">
      {caseId && (
        <button
          onClick={() => navigate(`/cases/${caseId}`)}
          className="w-full flex items-center justify-between px-3 py-2 mb-3 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors border border-primary/20"
        >
          <span>사건 상세 페이지에서 보기</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border/60" />

      <div className="space-y-3">
        {events.map((ev, idx) => (
          <div key={idx} className="relative flex gap-3 pl-2">
            {/* Dot */}
            <div className="relative z-10 w-5 h-5 rounded-full border-2 border-primary/50 bg-card flex items-center justify-center shrink-0 mt-1">
              <Clock className="h-2.5 w-2.5 text-primary" />
            </div>

            {/* Content */}
            <div className="flex-1 rounded-xl border border-border/50 bg-card p-3">
              <div className="flex items-center gap-2 flex-wrap">
                {ev.date && (
                  <span className="text-[10px] font-mono text-muted-foreground">{ev.date}</span>
                )}
                {ev.type && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[ev.type] || TYPE_COLORS["기타"]}`}>
                    <Tag className="h-2.5 w-2.5 inline mr-0.5" />
                    {ev.type}
                  </span>
                )}
                {ev.actor && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <User className="h-2.5 w-2.5" />
                    {ev.actor}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground mt-1">{ev.title}</p>
              {ev.description && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{ev.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
