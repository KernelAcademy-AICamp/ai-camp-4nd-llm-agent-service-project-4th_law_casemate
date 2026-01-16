

import { Upload, FileText, Search, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const recentCases = [
  { id: 1, title: "서울 강남구 논현동 계약", date: "2024.01.12 업로드", active: true },
  { id: 2, title: "인천 부평구 상가 계약", date: "2024.01.08 업로드", active: false },
  { id: 3, title: "수원 영통구 주택 계약", date: "2024.01.05 업로드", active: false },
]

export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-background">
      {/* Upload CTA */}
      <div className="p-4">
        <Button className="w-full gap-2" size="lg">
          <Upload className="h-4 w-4" />
          계약서 업로드
        </Button>
      </div>

      {/* Search */}
      <div className="px-4 pb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="사건 검색" className="pl-9" />
        </div>
      </div>

      {/* Recent Cases */}
      <div className="flex-1 overflow-auto px-2">
        <div className="px-2 py-2">
          <span className="text-xs font-medium text-muted-foreground">최근 사건</span>
        </div>
        <nav className="space-y-1">
          {recentCases.map((caseItem) => (
            <button
              key={caseItem.id}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                caseItem.active
                  ? "bg-primary/5 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <FileText className={cn("mt-0.5 h-4 w-4 shrink-0", caseItem.active && "text-primary")} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm", caseItem.active && "font-medium")}>{caseItem.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{caseItem.date}</p>
              </div>
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile app download - bottom */}
      <div className="border-t border-border p-4">
        <p className="mb-2 text-xs text-muted-foreground">모바일 앱 다운로드</p>
        <p className="mb-2 text-xs text-muted-foreground">외부에서도 사건 관리</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 text-xs bg-transparent">
            <Clock className="mr-1 h-3 w-3" />
            iOS
          </Button>
          <Button variant="outline" size="sm" className="flex-1 text-xs bg-transparent">
            <Clock className="mr-1 h-3 w-3" />
            Android
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">v1.0.2 Beta</p>
      </div>
    </aside>
  )
}
