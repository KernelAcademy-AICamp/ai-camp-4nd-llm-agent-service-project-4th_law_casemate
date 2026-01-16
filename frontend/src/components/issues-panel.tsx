

import { ChevronRight, ExternalLink, AlertCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useState } from "react"

const legalIssues = [
  {
    id: 1,
    title: "대항력 요건 충족 여부",
    law: "주택임대차보호법 제3조",
    description:
      "임차인이 주택의 인도와 주민등록을 마친 경우 대항력을 취득한다. 본 계약의 경우 인도 및 전입신고 일자 확인이 필요하다.",
    references: [{ type: "법령", title: "주택임대차보호법 제3조 (대항력)", id: "대법원 2022년234567" }],
    status: "review",
    expanded: true,
  },
  {
    id: 2,
    title: "우선변제권 취득 요건",
    law: "주택임대차보호법 제3조의2",
    description: null,
    references: [],
    status: "review",
    expanded: false,
  },
  {
    id: 3,
    title: "계약갱신청구권 행사 가능성",
    law: "주택임대차보호법 제6조의3",
    description: null,
    references: [],
    status: "review",
    expanded: false,
  },
  {
    id: 4,
    title: "보증금 증액 청구 제한",
    law: "주택임대차보호법 제7조",
    description: null,
    references: [],
    status: "review",
    expanded: false,
  },
]

export function IssuesPanel() {
  const [openIssues, setOpenIssues] = useState<number[]>([1])

  const toggleIssue = (id: number) => {
    setOpenIssues((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden bg-muted/20">
      {/* Header */}
      <div className="border-b border-border bg-background px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">검토 필요 쟁점</h2>
        <p className="text-xs text-muted-foreground">계약서 기반 법률 이슈 후보</p>
      </div>

      {/* Issues List - Scrollable */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {legalIssues.map((issue) => (
            <Collapsible key={issue.id} open={openIssues.includes(issue.id)} onOpenChange={() => toggleIssue(issue.id)}>
              <Card className="overflow-hidden">
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/50">
                    <ChevronRight
                      className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        openIssues.includes(issue.id) ? "rotate-90" : ""
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug text-foreground">{issue.title}</p>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-300 bg-amber-50 text-[10px] text-amber-700"
                        >
                          확인 필요
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{issue.law}</p>
                    </div>
                  </button>
                </CollapsibleTrigger>
                {issue.description && (
                  <CollapsibleContent>
                    <CardContent className="border-t border-border bg-muted/30 px-3 py-3">
                      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{issue.description}</p>

                      {/* Related References */}
                      {issue.references.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            관련 판례
                          </p>
                          {issue.references.map((ref, idx) => (
                            <button
                              key={idx}
                              className="flex w-full items-center gap-2 rounded border border-border bg-background p-2 text-left transition-colors hover:bg-muted/50"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-xs font-medium text-foreground">{ref.title}</p>
                                <p className="text-[10px] text-muted-foreground">{ref.id}</p>
                              </div>
                              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Reference note */}
                      <p className="mt-3 text-[10px] text-muted-foreground">주민등록 전입일과 대항력 취득시기</p>
                    </CardContent>
                  </CollapsibleContent>
                )}
              </Card>
            </Collapsible>
          ))}
        </div>
      </div>

      {/* Footer Disclaimer */}
      <div className="border-t border-border bg-background p-4">
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            <span className="font-medium">안내:</span> 제시된 법률 쟁점은 계약서 구조 분석을 기반으로 한 검토
            후보입니다. 최종 판단은 변호사의 전문적 검토가 필요합니다.
          </p>
        </div>
      </div>
    </aside>
  )
}
