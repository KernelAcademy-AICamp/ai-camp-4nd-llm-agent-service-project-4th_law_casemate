/**
 * 문서 카드 컴포넌트
 */

import { Link } from "react-router-dom";
import { FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentCardData } from "@/types/chat";

interface DocumentCardProps {
  data: DocumentCardData;
}

const docTypeLabels: Record<string, string> = {
  criminal_complaint: "고소장",
  civil_complaint: "소장",
  demand_letter: "내용증명",
  brief: "준비서면",
  contract: "계약서",
};

export function DocumentCard({ data }: DocumentCardProps) {
  const formattedDate = data.created_at
    ? new Date(data.created_at).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <div className="border border-border/50 rounded-xl p-4 bg-card shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-orange-500/10">
          <FileText className="h-4 w-4 text-orange-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-foreground truncate">
              {data.title}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
              {docTypeLabels[data.document_type] || data.document_type}
            </span>
          </div>

          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-muted-foreground">{formattedDate}</span>

            <Button variant="outline" size="sm" asChild>
              <Link to={`/documents/${data.id}`}>
                문서 열기
                <ExternalLink className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
