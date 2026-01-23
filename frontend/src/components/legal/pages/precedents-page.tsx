"use client";

import React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type PrecedentData, samplePrecedents } from "@/lib/sample-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ArrowUpRight } from "lucide-react";

interface PrecedentsPageProps { }

export function PrecedentsPage({ }: PrecedentsPageProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="space-y-6">
      {/* Search Section */}
      <div className="space-y-2">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="판례 검색어를 입력하세요 (예: 명예훼손, 허위사실, 모욕)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10"
            />
          </div>
          <Button type="submit" className="h-10">
            검색
          </Button>
        </form>
      </div>

      {/* Results */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            검색 결과 {samplePrecedents.length}건
          </h2>
        </div>

        <div className="space-y-3">
          {samplePrecedents.map((result) => (
            <Card
              key={result.id}
              className="border-border/60 hover:border-border hover:shadow-sm transition-all cursor-pointer group"
              onClick={() => navigate(`/precedents/${result.id}`)}
            >
              <CardContent className="p-5 lg:p-6">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-medium">{result.caseNo}</h3>
                      <Badge variant="secondary" className="text-xs font-normal">
                        유사도 {result.similarity}%
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-foreground/80">
                      {result.issue}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {result.keyPoint}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      결과: {result.result}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <p className="text-xs text-muted-foreground hidden lg:block">
                      {result.courtDate.split(" ")[1]}
                    </p>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
