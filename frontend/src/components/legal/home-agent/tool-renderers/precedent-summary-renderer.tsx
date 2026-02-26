import { FileText, Scale, BookOpen, Lightbulb, ListChecks } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface SummaryData {
  case_number: string;
  summary: string;
}

interface Props {
  data: Record<string, string>;
}

interface Section {
  icon: React.ElementType;
  label: string;
  content: string;
  color: string;
}

function parseSummaryToSections(summary: string): Section[] {
  const sections: Section[] = [];

  // 섹션 정의 (순서대로)
  const sectionDefs = [
    { pattern: /##?\s*결과\s*요약/i, icon: ListChecks, label: "결과 요약", color: "#6D5EF5" },
    { pattern: /##?\s*사실\s*관계/i, icon: FileText, label: "사실관계", color: "#3B82F6" },
    { pattern: /##?\s*법리\s*분석/i, icon: Scale, label: "법리 분석 및 법원의 판단 과정", color: "#8B5CF6" },
    { pattern: /##?\s*실무\s*포인트/i, icon: Lightbulb, label: "실무 포인트", color: "#F59E0B" },
  ];

  // 각 섹션 위치 찾기
  const positions: { def: typeof sectionDefs[0]; start: number }[] = [];
  for (const def of sectionDefs) {
    const match = summary.match(def.pattern);
    if (match && match.index !== undefined) {
      positions.push({ def, start: match.index });
    }
  }

  // 위치순 정렬
  positions.sort((a, b) => a.start - b.start);

  // 각 섹션 내용 추출
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i];
    const nextStart = positions[i + 1]?.start ?? summary.length;

    // 섹션 제목 이후부터 다음 섹션 전까지 추출
    const sectionText = summary.slice(current.start, nextStart);
    // 제목 라인 전체 제거 (## 제목... 형태의 첫 줄)
    const content = sectionText
      .replace(/^##?\s*[^\n]+\n?/, "")
      .trim();

    if (content) {
      sections.push({
        icon: current.def.icon,
        label: current.def.label,
        content,
        color: current.def.color,
      });
    }
  }

  // 섹션을 못 찾으면 전체를 하나의 카드로
  if (sections.length === 0 && summary.trim()) {
    sections.push({
      icon: BookOpen,
      label: "판례 요약",
      content: summary,
      color: "#6366F1",
    });
  }

  return sections;
}

export function PrecedentSummaryRenderer({ data }: Props) {
  const d = data as unknown as SummaryData;
  if (!d || !d.summary) {
    return <p className="text-sm text-muted-foreground">요약 결과가 없습니다.</p>;
  }

  const sections = parseSummaryToSections(d.summary);

  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.label} className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <s.icon className="h-3.5 w-3.5" style={{ color: s.color }} />
            <span className="text-xs font-semibold text-foreground">{s.label}</span>
          </div>
          <div className="px-3 py-2.5 text-xs text-card-foreground leading-relaxed prose prose-sm prose-slate dark:prose-invert max-w-none">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                li: ({ children }) => <li className="text-xs">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              }}
            >
              {s.content}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}
