/**
 * 판례 카드 컴포넌트
 */

import { Link } from "react-router-dom";
import { Scale, Building, ExternalLink } from "lucide-react";
import type { PrecedentCardData } from "@/types/chat";

interface PrecedentCardProps {
  data: PrecedentCardData;
}

export function PrecedentCard({ data }: PrecedentCardProps) {
  return (
    <div className="border border-border/50 rounded-2xl p-4 bg-card shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        {/* 아이콘 */}
        <div
          className="shrink-0 w-14 h-14 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #6D5EF5, #A78BFA)" }}
        >
          <Scale className="h-6 w-6 text-white" />
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm text-foreground truncate">
              {data.case_number}
            </span>
            {data.similarity !== undefined && (
              <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full border border-primary/30 text-primary bg-primary/5">
                {Math.round(data.similarity * 100)}% 유사
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building className="h-3 w-3" />
            <span>{data.court}</span>
            <span className="mx-0.5">•</span>
            <span>{data.date}</span>
          </div>
        </div>

        {/* 열기 버튼 */}
        <Link
          to={`/precedents/${encodeURIComponent(data.case_number)}`}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/50 text-sm font-medium text-foreground transition-colors"
        >
          열기
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
