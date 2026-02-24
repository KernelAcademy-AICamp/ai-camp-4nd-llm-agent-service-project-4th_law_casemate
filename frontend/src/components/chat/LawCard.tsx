/**
 * 법령 카드 컴포넌트
 */

import { BookOpen } from "lucide-react";
import type { LawCardData } from "@/types/chat";

interface LawCardProps {
  data: LawCardData;
}

export function LawCard({ data }: LawCardProps) {
  return (
    <div className="border border-border/50 rounded-2xl p-4 bg-card shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        {/* 아이콘 */}
        <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-green-500/10">
          <BookOpen className="h-5 w-5 text-green-600" />
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm text-foreground">
              {data.law_name}
            </span>
            <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full border border-green-400/30 text-green-600 bg-green-50">
              제{data.article_number}조
            </span>
          </div>

          {data.article_title && (
            <p className="text-xs text-muted-foreground mb-2">
              {data.article_title}
            </p>
          )}

          <p className="text-sm text-card-foreground whitespace-pre-wrap leading-relaxed">
            {data.content}
          </p>
        </div>
      </div>
    </div>
  );
}
