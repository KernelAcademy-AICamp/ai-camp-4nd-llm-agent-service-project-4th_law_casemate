"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useSearch, type SearchResult } from "@/contexts/search-context";

// API 응답 타입
interface SearchResponse {
  query?: string;
  total: number;
  results: SearchResult[];
}

interface PrecedentsPageProps { }

const ITEMS_PER_PAGE = 10;

export function PrecedentsPage({ }: PrecedentsPageProps) {
  const navigate = useNavigate();

  // Context에서 상태 가져오기 (페이지 이동해도 유지됨)
  const {
    searchQuery,
    setSearchQuery,
    results,
    setResults,
    hasSearched,
    setHasSearched,
    currentPage,
    setCurrentPage,
  } = useSearch();

  // 페이지네이션 계산
  const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedResults = results.slice(startIndex, endIndex);

  // 로딩/에러는 로컬 상태 (현재 검색에만 필요)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 페이지 진입 시 데이터 없으면 최신 판례 불러오기
  useEffect(() => {
    if (results.length === 0 && !hasSearched) {
      fetchRecentCases();
    }
  }, []);

  // 최신 판례 조회
  const fetchRecentCases = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/search/cases/recent?limit=50");

      if (!response.ok) {
        throw new Error("판례를 불러오는 중 오류가 발생했습니다.");
      }

      const data: SearchResponse = await response.json();
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    // 검색어 없으면 최신 판례로 리셋
    if (!searchQuery.trim()) {
      setHasSearched(false);
      setCurrentPage(1);
      fetchRecentCases();
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setCurrentPage(1);  // 새 검색 시 1페이지로

    try {
      const response = await fetch(
        `/api/v1/search/cases?query=${encodeURIComponent(searchQuery)}&limit=100`
      );

      if (!response.ok) {
        throw new Error("검색 중 오류가 발생했습니다.");
      }

      const data: SearchResponse = await response.json();
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "검색 중 오류가 발생했습니다.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // 날짜 포맷 (20200515 → 2020.05.15)
  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr.length !== 8) return dateStr || "";
    return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
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
          <Button type="submit" className="h-10" disabled={loading}>
            {loading ? "검색 중..." : "검색"}
          </Button>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="space-y-4">
        {!loading && (
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              {hasSearched ? `검색 결과 ${results.length}건` : `최신 판례 ${results.length}건`}
            </h2>
          </div>
        )}

        {loading && (
          <div className="text-center py-10 text-muted-foreground">
            불러오는 중...
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            검색 결과가 없습니다.
          </div>
        )}

        {!loading && (
          <div className="space-y-3">
            {paginatedResults.map((result, index) => (
            <Card
              key={`${result.case_number}-${index}`}
              className="border-border/60 hover:border-border hover:shadow-sm transition-all cursor-pointer group"
              onClick={() => navigate(`/precedents/${encodeURIComponent(result.case_number)}`)}
            >
              <CardContent className="p-5 lg:p-6">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-medium">{result.case_number}</h3>
                    </div>
                    <p className="text-sm font-medium text-foreground/80">
                      {result.case_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {result.court_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <p className="text-xs text-muted-foreground hidden lg:block">
                      {formatDate(result.judgment_date)}
                    </p>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => setCurrentPage(page)}
                className="w-9"
              >
                {page}
              </Button>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
