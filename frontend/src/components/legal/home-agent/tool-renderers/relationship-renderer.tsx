import { useNavigate } from "react-router-dom";
import { User, ArrowRight, ExternalLink } from "lucide-react";

interface PersonNode {
  name: string;
  role: string;
  description?: string;
}

interface RelationshipEdge {
  label: string;
  relationship_type: string;
  source?: string;
  target?: string;
}

interface RelationshipData {
  persons: Record<string, unknown>[];
  relationships: Record<string, unknown>[];
}

interface Props {
  data: RelationshipData;
  caseId?: number;
}

const ROLE_COLORS: Record<string, string> = {
  "피해자": "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  "가해자": "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  "증인": "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  "동료": "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
};

export function RelationshipRenderer({ data, caseId }: Props) {
  const navigate = useNavigate();
  const persons = (data?.persons || []) as unknown as PersonNode[];
  const relationships = (data?.relationships || []) as unknown as RelationshipEdge[];

  if (persons.length === 0) {
    return <p className="text-sm text-muted-foreground">관계도 데이터가 없습니다.</p>;
  }

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
      {/* Persons */}
      <div>
        <h4 className="text-xs font-semibold text-foreground mb-2">인물</h4>
        <div className="grid grid-cols-2 gap-2">
          {persons.map((p, idx) => {
            const colors = ROLE_COLORS[p.role] || "bg-muted text-muted-foreground border-border";
            return (
              <div key={idx} className={`rounded-xl border p-2.5 ${colors}`}>
                <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  <span className="text-xs font-semibold">{p.name}</span>
                </div>
                <span className="text-[10px] opacity-80">{p.role}</span>
                {p.description && (
                  <p className="text-[10px] mt-1 opacity-70 leading-relaxed">{p.description}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Relationships */}
      {relationships.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2">관계</h4>
          <div className="space-y-1.5">
            {relationships.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2 text-xs"
              >
                {r.source && <span className="font-medium text-foreground">{r.source}</span>}
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                {r.target && <span className="font-medium text-foreground">{r.target}</span>}
                <span className="text-muted-foreground ml-auto">
                  {r.label} ({r.relationship_type})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
