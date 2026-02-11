"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Search, SlidersHorizontal, ChevronLeft, ChevronRight, X, RotateCcw, Star } from "lucide-react";
import { useSearch, type SearchResult, type SearchFilters } from "@/contexts/search-context";
import { highlightKeywords } from "@/lib/highlight";

// 필터 옵션 정의
const COURT_OPTIONS = ["대법원", "고등법원", "지방법원"];
const CASE_TYPE_OPTIONS = ["민사", "형사", "일반행정", "가사"];
const PERIOD_OPTIONS = [
  { value: "1y", label: "~1년" },
  { value: "3y", label: "~3년" },
  { value: "5y", label: "~5년" },
  { value: "10y", label: "~10년" },
  { value: "old", label: "10년~" },
];

// API 응답 타입
interface SearchResponse {
  query?: string;
  total: number;
  offset: number;
  has_more: boolean;
  results: SearchResult[];
}

interface PrecedentsPageProps { }

const ITEMS_PER_PAGE = 10;  // 한 페이지당 표시 개수
const PAGES_PER_GROUP = 5;   // 한 번에 표시할 페이지 버튼 수
const ITEMS_PER_FETCH = ITEMS_PER_PAGE * PAGES_PER_GROUP;  // 한 번에 가져올 데이터 수 (50개)

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
    filters,
    setFilters,
  } = useSearch();

  // 페이지네이션 계산
  const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedResults = results.slice(startIndex, endIndex);

  // 로딩/에러는 로컬 상태 (현재 검색에만 필요)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);

  // 서버 페이지네이션 상태
  const [hasMore, setHasMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);  // 현재 로드된 데이터의 시작 offset

  // 즐겨찾기 상태
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteLoading, setFavoriteLoading] = useState<string | null>(null); // 현재 토글 중인 case_number

  // 활성화된 필터 개수
  const activeFilterCount = filters.courtTypes.length + filters.caseTypes.length + (filters.period ? 1 : 0);

  // 탭 상태: "search" | "favorites"
  const [activeTab, setActiveTab] = useState<"search" | "favorites">(hasSearched ? "search" : "favorites");
  const [favoriteResults, setFavoriteResults] = useState<SearchResult[]>([]);


  // 페이지 진입 시 즐겨찾기 목록 가져오기
  useEffect(() => {
    const fetchFavorites = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem("access_token");
        if (!token) return;

        const response = await fetch("/api/v1/favorites/precedents", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const favoriteSet = new Set<string>(
            data.favorites.map((fav: { case_number: string }) => fav.case_number)
          );
          setFavorites(favoriteSet);

          // 즐겨찾기 목록을 SearchResult 형태로 변환
          const favoriteItems: SearchResult[] = data.favorites.map((fav: {
            case_number: string;
            case_name: string;
            court_name: string;
            judgment_date: string;
          }) => ({
            case_number: fav.case_number,
            case_name: fav.case_name || "",
            court_name: fav.court_name || "",
            judgment_date: fav.judgment_date || "",
            content: "",
          }));
          setFavoriteResults(favoriteItems);
        }
      } catch (err) {
        console.error("즐겨찾기 목록 조회 실패:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchFavorites();
  }, []);

  // 즐겨찾기 토글 (Optimistic Update)
  const toggleFavorite = async (e: React.MouseEvent, caseNumber: string) => {
    e.stopPropagation(); // 카드 클릭 이벤트 전파 방지

    const token = localStorage.getItem("access_token");
    if (!token) {
      alert("로그인이 필요합니다.");
      return;
    }

    const wasFavorite = favorites.has(caseNumber);

    // 즉시 UI 업데이트 (Optimistic)
    setFavorites((prev) => {
      const newSet = new Set(prev);
      if (wasFavorite) {
        newSet.delete(caseNumber);
      } else {
        newSet.add(caseNumber);
      }
      return newSet;
    });

    // 즐겨찾기 목록 즉시 업데이트
    if (wasFavorite) {
      // 제거
      setFavoriteResults((prev) => prev.filter((r) => r.case_number !== caseNumber));
    } else {
      // 추가 - 검색 결과에서 해당 판례 정보 찾아서 즐겨찾기 목록 맨 앞에 추가
      const resultItem = results.find((r) => r.case_number === caseNumber);
      if (resultItem) {
        setFavoriteResults((prev) => [resultItem, ...prev]);
      }
    }

    try {
      const response = await fetch(`/api/v1/favorites/precedents/${encodeURIComponent(caseNumber)}/toggle`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // 실패 시 롤백
        setFavorites((prev) => {
          const newSet = new Set(prev);
          if (wasFavorite) {
            newSet.add(caseNumber);
          } else {
            newSet.delete(caseNumber);
          }
          return newSet;
        });
      }
    } catch (err) {
      // 에러 시 롤백
      console.error("즐겨찾기 토글 실패:", err);
      setFavorites((prev) => {
        const newSet = new Set(prev);
        if (wasFavorite) {
          newSet.add(caseNumber);
        } else {
          newSet.delete(caseNumber);
        }
        return newSet;
      });
    }
  };

  // 검색 실행 함수 (form submit과 필터 적용에서 공통 사용)
  const executeSearch = async (overrideFilters?: SearchFilters, offset: number = 0) => {
    // 검색어 없으면 즐겨찾기 목록으로 돌아가기
    if (!searchQuery.trim()) {
      setHasSearched(false);
      setActiveTab("favorites");
      setCurrentPage(1);
      setCurrentOffset(0);
      setHasMore(false);
      return;
    }

    setActiveTab("search");
    setLoading(true);
    setError(null);
    setHasSearched(true);

    // 새 검색(offset=0)이면 1페이지로, 추가 로드면 페이지 유지
    if (offset === 0) {
      setCurrentPage(1);
    }

    // 파라미터로 받은 필터 우선, 없으면 현재 상태 사용
    const activeFilters = overrideFilters ?? filters;

    try {
      // 필터 파라미터 구성
      const params = new URLSearchParams();
      params.append("query", searchQuery);
      params.append("limit", String(ITEMS_PER_FETCH));
      params.append("offset", String(offset));
      // 중복 선택된 필터는 쉼표로 연결
      if (activeFilters.courtTypes.length > 0) params.append("court_type", activeFilters.courtTypes.join(","));
      if (activeFilters.caseTypes.length > 0) params.append("case_type", activeFilters.caseTypes.join(","));
      if (activeFilters.period) params.append("period", activeFilters.period);

      const response = await fetch(`/api/v1/search/cases?${params.toString()}`);

      if (!response.ok) {
        throw new Error("검색 중 오류가 발생했습니다.");
      }

      const data: SearchResponse = await response.json();
      setResults(data.results);
      setHasMore(data.has_more);
      setCurrentOffset(offset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "검색 중 오류가 발생했습니다.");
      setResults([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeSearch();
  };

  // 필터 적용 후 검색
  const handleApplyFilters = () => {
    setFilterDialogOpen(false);
    executeSearch();
  };

  // 필터 초기화 + 검색 재실행
  const clearFilters = () => {
    const emptyFilters: SearchFilters = { courtTypes: [], caseTypes: [], period: null };
    setFilters(emptyFilters);
    // 검색어가 있으면 필터 없이 재검색
    if (searchQuery.trim()) {
      executeSearch(emptyFilters);
    }
  };

  // 필터 토글 헬퍼 (태그에서 제거 시 재검색)
  const toggleCourtType = (court: string, shouldSearch = false) => {
    const newFilters: SearchFilters = {
      ...filters,
      courtTypes: filters.courtTypes.includes(court)
        ? filters.courtTypes.filter(c => c !== court)
        : [...filters.courtTypes, court]
    };
    setFilters(newFilters);
    if (shouldSearch && searchQuery.trim()) {
      executeSearch(newFilters);
    }
  };

  const toggleCaseType = (type: string, shouldSearch = false) => {
    const newFilters: SearchFilters = {
      ...filters,
      caseTypes: filters.caseTypes.includes(type)
        ? filters.caseTypes.filter(t => t !== type)
        : [...filters.caseTypes, type]
    };
    setFilters(newFilters);
    if (shouldSearch && searchQuery.trim()) {
      executeSearch(newFilters);
    }
  };

  const togglePeriod = (period: string, shouldSearch = false) => {
    const newFilters: SearchFilters = {
      ...filters,
      period: filters.period === period ? null : period
    };
    setFilters(newFilters);
    if (shouldSearch && searchQuery.trim()) {
      executeSearch(newFilters);
    }
  };

  // 날짜 포맷 (20200515 → 2020.05.15)
  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr.length !== 8) return dateStr || "";
    return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
  };

  // 사건명 truncate (길면 ...으로 자르기)
  const truncateCaseName = (name: string, maxLength: number = 70) => {
    if (!name) return "";
    return name.length > maxLength ? `${name.slice(0, maxLength)}…` : name;
  };

  // 키워드가 포함된 부분 미리보기
  const getKeywordPreview = (content: string, query: string, maxLength: number = 200) => {
    if (!content) return "";
    // 【사건명】 섹션 제거 + {{PARA}} 청크 구분자 제거 + 공백 정리
    const cleaned = content
      .replace(/【사건명】[^【]*(?=【|$)/g, "")  // 【사건명】 섹션 전체 제거
      .replace(/\{\{PARA\}\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 검색어가 없으면 처음부터
    if (!query.trim()) {
      return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
    }

    // 키워드 추출 (2글자 이상)
    const keywords = query.split(/\s+/).filter(k => k.length >= 2);

    // 첫 번째 키워드 위치 찾기
    let firstIndex = -1;
    for (const keyword of keywords) {
      const idx = cleaned.indexOf(keyword);
      if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
        firstIndex = idx;
      }
    }

    // 키워드가 없으면 처음부터
    if (firstIndex === -1) {
      return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
    }

    // 키워드 위치를 중심으로 추출 (키워드 앞에 1/3, 뒤에 2/3)
    const padding = Math.floor(maxLength / 3);
    const start = Math.max(0, firstIndex - padding);
    const end = Math.min(cleaned.length, start + maxLength);

    let preview = cleaned.slice(start, end);

    // 앞/뒤가 잘렸으면 … 추가
    if (start > 0) preview = "…" + preview;
    if (end < cleaned.length) preview = preview + "…";

    return preview;
  };

  return (
    <div className="space-y-6">
      {/* Search Section */}
      <div className="space-y-2">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="판례 검색어를 입력하세요 (예: 명예훼손 손해배상)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10"
            />
          </div>

          {/* 필터 버튼 */}
          <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="h-10 relative">
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>상세 검색</DialogTitle>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* 법원 (중복 선택 가능) */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">법원 <span className="text-xs text-muted-foreground"></span></h4>
                  <div className="flex flex-wrap gap-2">
                    {COURT_OPTIONS.map((court) => (
                      <Button
                        key={court}
                        type="button"
                        variant={filters.courtTypes.includes(court) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleCourtType(court)}
                      >
                        {court}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* 사건종류 (중복 선택 가능) */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">사건종류 <span className="text-xs text-muted-foreground"></span></h4>
                  <div className="flex flex-wrap gap-2">
                    {CASE_TYPE_OPTIONS.map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={filters.caseTypes.includes(type) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleCaseType(type)}
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* 기간 (단일 선택) */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">기간</h4>
                  <div className="flex flex-wrap gap-2">
                    {PERIOD_OPTIONS.map((opt) => (
                      <Button
                        key={opt.value}
                        type="button"
                        variant={filters.period === opt.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => togglePeriod(opt.value)}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={clearFilters}>
                  초기화
                </Button>
                <Button onClick={handleApplyFilters}>
                  적용
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button type="submit" className="h-10" disabled={loading}>
            {loading ? "검색 중..." : "검색"}
          </Button>
        </form>

        {/* 활성 필터 표시 */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.courtTypes.map(court => (
              <Badge
                key={court}
                variant="outline"
                className="gap-1.5 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 transition-colors"
              >
                {court}
                <X
                  className="h-3 w-3 cursor-pointer hover:text-destructive transition-colors"
                  onClick={() => toggleCourtType(court, true)}
                />
              </Badge>
            ))}
            {filters.caseTypes.map(type => (
              <Badge
                key={type}
                variant="outline"
                className="gap-1.5 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 transition-colors"
              >
                {type}
                <X
                  className="h-3 w-3 cursor-pointer hover:text-destructive transition-colors"
                  onClick={() => toggleCaseType(type, true)}
                />
              </Badge>
            ))}
            {filters.period && (
              <Badge
                variant="outline"
                className="gap-1.5 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 transition-colors"
              >
                {PERIOD_OPTIONS.find(p => p.value === filters.period)?.label}
                <X
                  className="h-3 w-3 cursor-pointer hover:text-destructive transition-colors"
                  onClick={() => togglePeriod(filters.period!, true)}
                />
              </Badge>
            )}
            {/* 초기화 버튼 */}
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-sm text-muted-foreground border border-dashed border-muted-foreground/40 rounded-full hover:border-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              초기화
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
          {error}
        </div>
      )}

      {/* 탭 */}
      <div className="flex border-b">
        <button
          type="button"
          onClick={() => {
            setActiveTab("search");
            if (!hasSearched && searchQuery.trim()) {
              executeSearch();
            }
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "search"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          검색결과
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("favorites")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "favorites"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Star className="h-4 w-4" />
          즐겨찾기
        </button>
      </div>

      {/* Results */}
      <div className="space-y-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-20 w-20 mb-2" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
            불러오는 중...
          </div>
        )}

        {/* 즐겨찾기 목록 */}
        {!loading && activeTab === "favorites" && (
          <>
            {favoriteResults.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Star className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-base mb-2">즐겨찾기한 판례가 없습니다</p>
                <p className="text-sm">판례를 검색하고 별 아이콘을 눌러 즐겨찾기에 추가해보세요</p>
              </div>
            ) : (
              <div className="space-y-3">
                {favoriteResults.map((result, index) => (
                  <Card
                    key={`fav-${result.case_number}-${index}`}
                    className="border-border/60 hover:border-border hover:shadow-sm transition-all cursor-pointer group"
                    onClick={() => navigate(`/precedents/${encodeURIComponent(result.case_number)}`)}
                  >
                    <CardContent className="p-5 lg:p-6">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-1 min-w-0">
                          <h3 className="font-semibold text-base">
                            {result.case_number} [{truncateCaseName(result.case_name)}]
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {result.court_name} · {formatDate(result.judgment_date)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(e, result.case_number)}
                          disabled={favoriteLoading === result.case_number}
                          className="flex-shrink-0 p-2 rounded-full transition-colors text-amber-300 hover:text-amber-400"
                        >
                          <Star className="h-5 w-5 fill-current" />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* 검색 결과 */}
        {!loading && activeTab === "search" && (
          <>
            {results.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                검색 결과가 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {paginatedResults.map((result, index) => (
                  <Card
                    key={`${result.case_number}-${index}`}
                    className="border-border/60 hover:border-border hover:shadow-sm transition-all cursor-pointer group"
                    onClick={() => navigate(`/precedents/${encodeURIComponent(result.case_number)}`)}
                  >
                    <CardContent className="p-5 lg:p-6">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-2 min-w-0">
                          <h3 className="font-semibold text-base">
                            {result.case_number} [{truncateCaseName(result.case_name)}]
                          </h3>
                          {result.content && (
                            <p
                              className="text-sm text-muted-foreground line-clamp-3"
                              dangerouslySetInnerHTML={{
                                __html: highlightKeywords(getKeywordPreview(result.content, searchQuery, 200), searchQuery)
                              }}
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(e, result.case_number)}
                          disabled={favoriteLoading === result.case_number}
                          className={`flex-shrink-0 p-2 rounded-full transition-colors ${
                            favorites.has(result.case_number)
                              ? "text-amber-300 hover:text-amber-400"
                              : "text-gray-300 hover:text-amber-300"
                          } ${favoriteLoading === result.case_number ? "opacity-50" : ""}`}
                        >
                          <Star
                            className={`h-5 w-5 ${favorites.has(result.case_number) ? "fill-current" : ""}`}
                          />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Pagination (검색 결과에서만) */}
        {!loading && activeTab === "search" && totalPages > 0 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            {/* 이전 그룹 버튼 (< ) - 현재 offset이 0보다 크면 이전 그룹 로드 */}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (currentPage > 1) {
                  // 현재 그룹 내에서 이전 페이지로
                  setCurrentPage(currentPage - 1);
                } else if (currentOffset > 0) {
                  // 이전 그룹 로드
                  const prevOffset = Math.max(0, currentOffset - ITEMS_PER_FETCH);
                  await executeSearch(undefined, prevOffset);
                  setCurrentPage(PAGES_PER_GROUP);  // 이전 그룹의 마지막 페이지로
                }
              }}
              disabled={currentPage === 1 && currentOffset === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            {/* 페이지 번호 버튼 (최대 5개) */}
            {Array.from({ length: Math.min(PAGES_PER_GROUP, totalPages) }, (_, i) => {
              // 현재 그룹의 시작 페이지 번호 (1, 6, 11, ...)
              const groupStartPage = Math.floor(currentOffset / ITEMS_PER_FETCH) * PAGES_PER_GROUP + 1;
              const pageNum = groupStartPage + i;
              return (
                <Button
                  key={pageNum}
                  variant={currentPage === i + 1 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(i + 1)}
                  className="w-9"
                >
                  {pageNum}
                </Button>
              );
            })}

            {/* 다음 그룹 버튼 (>) - hasMore가 true이거나 현재 그룹 내 다음 페이지 있으면 */}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (currentPage < totalPages) {
                  // 현재 그룹 내에서 다음 페이지로
                  setCurrentPage(currentPage + 1);
                } else if (hasMore) {
                  // 다음 그룹 로드
                  const nextOffset = currentOffset + ITEMS_PER_FETCH;
                  await executeSearch(undefined, nextOffset);
                  setCurrentPage(1);  // 다음 그룹의 첫 페이지로
                }
              }}
              disabled={currentPage === totalPages && !hasMore}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
