interface Props {
  tool: string;
}

const SKELETON_CONFIGS: Record<string, { rows: number; style: "cards" | "lines" | "sections" }> = {
  list_cases: { rows: 3, style: "cards" },
  search_precedents: { rows: 3, style: "cards" },
  search_laws: { rows: 3, style: "cards" },
  analyze_case: { rows: 3, style: "sections" },
  compare_precedent: { rows: 4, style: "sections" },
  generate_timeline: { rows: 4, style: "lines" },
  generate_relationship: { rows: 3, style: "cards" },
  summarize_precedent: { rows: 1, style: "sections" },
};

function CardSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/50 bg-card p-3 space-y-2 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/3 rounded bg-muted" />
              <div className="h-3.5 w-2/3 rounded bg-muted" />
            </div>
          </div>
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function LineSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3 pl-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-3 animate-pulse">
          <div className="w-5 h-5 rounded-full bg-muted shrink-0" />
          <div className="flex-1 rounded-xl border border-border/50 bg-card p-3 space-y-1.5">
            <div className="h-2.5 w-1/4 rounded bg-muted" />
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-2.5 w-1/2 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/50 bg-card overflow-hidden animate-pulse">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <div className="w-3.5 h-3.5 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="h-2.5 w-full rounded bg-muted" />
            <div className="h-2.5 w-5/6 rounded bg-muted" />
            <div className="h-2.5 w-3/4 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ToolSkeleton({ tool }: Props) {
  const config = SKELETON_CONFIGS[tool] || { rows: 3, style: "lines" };

  switch (config.style) {
    case "cards":
      return <CardSkeleton count={config.rows} />;
    case "lines":
      return <LineSkeleton count={config.rows} />;
    case "sections":
      return <SectionSkeleton count={config.rows} />;
  }
}
