"use client";

import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Search, ArrowUpRight, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

// API 응답 타입
interface CaseApiResponse {
  id: number;
  title: string;
  client_name: string | null;
  case_type: string | null;
  status: string | null;
  created_at: string | null;
}

// 화면 표시용 타입
interface CaseDisplayItem {
  id: string;
  title: string;
  clientName: string;
  caseType: string;
  status: string;
  createdAt: string;
}

export function CasesPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<CaseDisplayItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // API에서 사건 목록 조회
  useEffect(() => {
    const fetchCases = async () => {
      try {
        const token = localStorage.getItem("access_token");
        if (!token) {
          setError("로그인이 필요합니다.");
          setIsLoading(false);
          return;
        }

        const response = await fetch("http://localhost:8000/api/v1/cases", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            setError("로그인이 만료되었습니다. 다시 로그인해주세요.");
            return;
          }
          throw new Error("사건 목록을 불러오는데 실패했습니다.");
        }

        const data = await response.json();

        // API 응답을 화면 표시용 타입으로 변환
        const displayCases: CaseDisplayItem[] = data.cases.map(
          (c: CaseApiResponse) => ({
            id: String(c.id),
            title: c.title,
            clientName: c.client_name || "",
            caseType: c.case_type || "",
            status: c.status || "접수",
            createdAt: c.created_at
              ? new Date(c.created_at).toLocaleDateString("ko-KR")
              : "",
          })
        );

        setCases(displayCases);
      } catch (err) {
        console.error("사건 목록 조회 실패:", err);
        setError(
          err instanceof Error ? err.message : "오류가 발생했습니다."
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchCases();
  }, []);

  // 검색 필터링
  const filteredCases = cases.filter(
    (c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.clientName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/")}
        >
          로그인 페이지로
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search and Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="사건명 또는 의뢰인으로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-10"
          />
        </div>
        <Button onClick={() => navigate("/new-case")} className="gap-2 h-10">
          <Plus className="h-4 w-4" />
          새 사건 등록
        </Button>
      </div>

      {/* Cases Grid - 4 columns */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredCases.map((caseItem) => (
          <Card
            key={caseItem.id}
            className="border-border/60 hover:border-border hover:shadow-sm transition-all cursor-pointer group"
            onClick={() => navigate(`/cases/${caseItem.id}`)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <Badge
                  variant={caseItem.status === "완료" ? "default" : "secondary"}
                  className="text-xs font-normal"
                >
                  {caseItem.status}
                </Badge>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
              </div>

              <h3 className="font-medium mb-1 line-clamp-2 leading-snug text-sm">
                {caseItem.title}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {caseItem.createdAt}
                {caseItem.clientName && ` · ${caseItem.clientName}`}
              </p>

              {caseItem.caseType && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">유형</span>
                  <span className="text-xs font-medium">{caseItem.caseType}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {filteredCases.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            {searchQuery ? "검색 결과가 없습니다." : "등록된 사건이 없습니다."}
          </p>
        </div>
      )}
    </div>
  );
}
