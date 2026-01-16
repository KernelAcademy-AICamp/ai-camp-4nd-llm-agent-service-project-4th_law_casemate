import { ChevronDown, ChevronRight, Eye, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useState } from "react"

const contractClauses = [
  {
    id: 1,
    title: "제1조 목적물의 표시",
    expanded: true,
    content: `임대인은 아래 표시 부동산(이하 "목적물"이라 한다)을 임차인에게 임대하고, 임차인은 이를 임차한다.

• 소재지: 서울특별시 강남구 논현동 123-45
• 건물명칭: 논현 래미안 아파트
• 전유부분: 101동 1001호 (84.2㎡)`,
  },
  {
    id: 2,
    title: "제2조 계약기간 및 갱신",
    expanded: false,
    content: null,
  },
  {
    id: 3,
    title: "제3조 보증금 및 차임",
    expanded: false,
    content: null,
  },
  {
    id: 4,
    title: "제4조 특약사항",
    expanded: false,
    content: null,
  },
]

export function ContractPanel() {
  const [openClauses, setOpenClauses] = useState<number[]>([1])

  const toggleClause = (id: number) => {
    setOpenClauses((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-r border-border bg-background">
      {/* Contract Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">서울 강남구 논현동 주택 임대차계약서</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              계약일: 2023.12.15 · 임대차기간: 2024.01.01 ~ 2025.12.31
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 bg-transparent">
            <Eye className="h-3.5 w-3.5" />
            원본 보기
          </Button>
        </div>
      </div>

      {/* Contract Content - Scrollable */}
      <div className="flex-1 overflow-auto p-6">
        {/* Contract Summary Card */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold text-foreground">계약 개요</h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <div>
                <p className="text-muted-foreground">임대인</p>
                <p className="font-medium text-foreground">홍길동 (650102-1******)</p>
              </div>
              <div>
                <p className="text-muted-foreground">임차인</p>
                <p className="font-medium text-foreground">김영희 (880315-2******)</p>
              </div>
              <div>
                <p className="text-muted-foreground">대상 부동산</p>
                <p className="font-medium text-foreground">서울시 강남구 논현동 123-45, 101호</p>
              </div>
              <div>
                <p className="text-muted-foreground">임대차 목적</p>
                <p className="font-medium text-foreground">주거용</p>
              </div>
              <div>
                <p className="text-muted-foreground">보증금</p>
                <p className="font-medium text-foreground">금 삼억원 (₩300,000,000)</p>
              </div>
              <div>
                <p className="text-muted-foreground">월차임</p>
                <p className="font-medium text-foreground">없음</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Clause Structure */}
        <div className="mb-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">계약 조항 구조</h2>
          <div className="space-y-2">
            {contractClauses.map((clause) => (
              <Collapsible
                key={clause.id}
                open={openClauses.includes(clause.id)}
                onOpenChange={() => toggleClause(clause.id)}
              >
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50">
                    {openClauses.includes(clause.id) ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium text-foreground">{clause.title}</span>
                  </button>
                </CollapsibleTrigger>
                {clause.content && (
                  <CollapsibleContent>
                    <div className="ml-6 border-l-2 border-border py-3 pl-4">
                      <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                        {clause.content}
                      </p>
                    </div>
                  </CollapsibleContent>
                )}
              </Collapsible>
            ))}
          </div>
        </div>

        {/* Internal Review Memo */}
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">내부 검토 초안</h2>
              <p className="text-xs text-muted-foreground">AI 생성 초안 - 검토 후 수정 필요</p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
              <Pencil className="h-3 w-3" />
              편집
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="mb-1 font-medium text-foreground">1. 사안의 개요</h3>
              <p className="leading-relaxed text-muted-foreground">
                본 건은 서울 강남구 소재 주거용 부동산에 관한 임대차 계약으로, 보증금 3억원의 전세 계약이다. 계약기간은
                2024년 1월 1일부터 2025년 12월 31일까지이며, 주택임대차보호법의 적용 대상이다.
              </p>
            </div>
            <div>
              <h3 className="mb-1 font-medium text-foreground">2. 검토 필요 사항</h3>
              <p className="leading-relaxed text-muted-foreground">
                우측 패널에 정리된 법률 쟁점을 중심으로 추가 검토가 필요하다. 특히 임차인의 대항력 요건 충족 여부,
                확정일자 취득 시점, 보증금 회수 우선순위 등을 확인해야 한다.
              </p>
            </div>

            {/* Disclaimer */}
            <div className="mt-4 rounded-md bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">안내:</span> 제시된 법률 쟁점은 계약서 구조 분석을 기반으로 한 검토
                후보입니다. 최종 판단은 변호사의 전문적 검토가 필요합니다.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
