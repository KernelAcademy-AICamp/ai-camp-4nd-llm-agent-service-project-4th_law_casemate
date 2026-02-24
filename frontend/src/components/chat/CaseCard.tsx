/**
 * 사건 카드 컴포넌트
 */

import { Link } from "react-router-dom";
import { Folder, User, ExternalLink } from "lucide-react";
import type { CaseCardData } from "@/types/chat";

interface CaseCardProps {
  data: CaseCardData;
}

const caseTypeLabels: Record<string, string> = {
  civil: "민사",
  criminal: "형사",
  administrative: "행정",
  family: "가사",
  other: "기타",
};

export function CaseCard({ data }: CaseCardProps) {
  const formattedDate = data.created_at
    ? new Date(data.created_at).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="border border-border/50 rounded-2xl p-4 bg-card shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        {/* 폴더 아이콘 */}
        <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10">
          <Folder className="h-5 w-5 text-primary" />
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm text-foreground truncate">
              {data.title}
            </span>
            <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full border border-primary/30 text-primary bg-primary/5">
              {caseTypeLabels[data.case_type] || data.case_type || "기타"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>{data.client_name || "의뢰인 미지정"}</span>
            <span className="mx-0.5">•</span>
            <span>{formattedDate}</span>
          </div>
        </div>

        {/* 열기 버튼 */}
        <Link
          to={`/cases/${data.id}`}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/50 text-sm font-medium text-foreground transition-colors"
        >
          열기
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
