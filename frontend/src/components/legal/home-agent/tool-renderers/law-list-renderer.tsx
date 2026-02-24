import { BookOpen } from "lucide-react";

interface LawItem {
  law_name: string;
  article_number: string;
  article_title: string;
  content: string;
}

interface Props {
  data: Record<string, unknown>[];
}

export function LawListRenderer({ data }: Props) {
  const items = data as unknown as LawItem[];

  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">검색된 법령이 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-border/50 bg-card p-3 hover:border-teal-300/50 transition-colors"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-500/10 shrink-0 mt-0.5">
              <BookOpen className="h-4 w-4 text-teal-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-teal-600 dark:text-teal-400">
                {item.law_name}
              </p>
              <p className="text-sm font-medium text-foreground mt-0.5">
                제{item.article_number}조 {item.article_title}
              </p>
              {item.content && (
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-4">
                  {item.content}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
