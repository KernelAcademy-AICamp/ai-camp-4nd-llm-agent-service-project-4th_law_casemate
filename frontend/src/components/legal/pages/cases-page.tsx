"use client";

import { useNavigate } from "react-router-dom";
import { type CaseData, sampleCases } from "@/lib/sample-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Plus, Search, ArrowUpRight } from "lucide-react";
import { useState } from "react";

interface CasesPageProps {
  cases?: CaseData[];
}

export function CasesPage({ cases: propCases }: CasesPageProps) {
  const navigate = useNavigate();
  const cases = propCases || sampleCases;
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCases = cases.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.client.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getRiskBadgeVariant = (risk: CaseData["riskLevel"]) => {
    switch (risk) {
      case "low":
        return "secondary";
      case "medium":
        return "outline";
      case "high":
        return "destructive";
    }
  };

  const getRiskLabel = (risk: CaseData["riskLevel"]) => {
    switch (risk) {
      case "low":
        return "낮음";
      case "medium":
        return "중간";
      case "high":
        return "높음";
    }
  };

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
                {caseItem.name}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {caseItem.date} · 증거 {caseItem.evidenceCount}건
              </p>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">진행률</span>
                    <span className="font-medium">{caseItem.progress}%</span>
                  </div>
                  <Progress value={caseItem.progress} className="h-1" />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">리스크</span>
                  <Badge
                    variant={getRiskBadgeVariant(caseItem.riskLevel)}
                    className="text-xs font-normal"
                  >
                    {getRiskLabel(caseItem.riskLevel)}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredCases.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted-foreground">검색 결과가 없습니다.</p>
        </div>
      )}
    </div>
  );
}
