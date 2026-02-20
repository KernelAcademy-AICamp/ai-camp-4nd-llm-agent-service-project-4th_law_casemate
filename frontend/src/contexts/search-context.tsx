"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

// 검색 결과 타입
export interface SearchResult {
  case_number: string;
  case_name: string;
  court_name: string;
  judgment_date: string;
  content: string;
  score: number;
}

// 유사 판례 결과 타입
export interface SimilarCaseResult {
  case_number: string;
  case_name: string;
  court_name: string;
  judgment_date: string;
  score: number;
}

// 파싱 결과 타입 (텍스트 기반)
export interface ParsedComparison {
  case_overview: string;
  precedent_summary: string;
  similarities: string;
  differences: string;
  strategy_points: string;
}

// 비교 분석 결과 타입
export interface ComparisonResult {
  success: boolean;
  analysis: string;
  parsed: ParsedComparison;
  precedent_info: {
    case_number: string;
    case_name: string;
    court_name: string;
    judgment_date: string;
  };
  prompt_version?: string;
  elapsed_time: number;
  error?: string;
}

// 필터 타입
export interface SearchFilters {
  courtTypes: string[];  // 중복 선택 가능
  caseTypes: string[];   // 중복 선택 가능
  period: string | null; // 단일 선택
}

// 판례 상세 + 요약 캐시 타입
export interface CaseDetailCache {
  case_number: string;
  case_name: string;
  court_name: string;
  judgment_date: string;
  case_type: string;
  full_text: string;
  from_api?: boolean;
  summary?: string | null;
  cachedAt: number;
}

// Context 타입
interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  results: SearchResult[];
  setResults: (results: SearchResult[]) => void;
  hasSearched: boolean;
  setHasSearched: (searched: boolean) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  // 검색 필터
  filters: SearchFilters;
  setFilters: (filters: SearchFilters | ((prev: SearchFilters) => SearchFilters)) => void;
  // 유사 판례 캐시
  getSimilarCases: (caseId: string) => SimilarCaseResult[] | null;
  setSimilarCases: (caseId: string, cases: SimilarCaseResult[]) => void;
  // 비교 분석 캐시
  getComparison: (originCaseId: string, targetCaseNumber: string) => ComparisonResult | null;
  setComparison: (originCaseId: string, targetCaseNumber: string, result: ComparisonResult) => void;
  // 판례 상세 + 요약 캐시
  getCaseDetail: (caseNumber: string) => CaseDetailCache | null;
  setCaseDetail: (caseNumber: string, detail: Omit<CaseDetailCache, "cachedAt">) => void;
  updateCaseSummary: (caseNumber: string, summary: string) => void;
}

// Context 생성
const SearchContext = createContext<SearchContextType | null>(null);

// 캐시 제한 상수
const MAX_SIMILAR_CACHE = 30;
const MAX_COMPARISON_CACHE = 20;
const MAX_CASE_DETAIL_CACHE = 20;

// 캐시 크기 제한 헬퍼 (FIFO 방식)
function limitCacheSize<T>(cache: Record<string, T>, maxSize: number): Record<string, T> {
  const keys = Object.keys(cache);
  if (keys.length <= maxSize) return cache;

  const newCache = { ...cache };
  delete newCache[keys[0]];
  return newCache;
}

// 초기 필터 상태
const initialFilters: SearchFilters = {
  courtTypes: [],
  caseTypes: [],
  period: null,
};

// Provider 컴포넌트
export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersState, setFiltersState] = useState<SearchFilters>(initialFilters);

  // 함수형 업데이트 지원하는 setFilters
  const setFilters = (value: SearchFilters | ((prev: SearchFilters) => SearchFilters)) => {
    if (typeof value === "function") {
      setFiltersState(value);
    } else {
      setFiltersState(value);
    }
  };

  // 유사 판례 캐시
  const [similarCasesCache, setSimilarCasesCache] = useState<Record<string, SimilarCaseResult[]>>({});

  const getSimilarCases = (caseId: string): SimilarCaseResult[] | null => {
    return similarCasesCache[caseId] ?? null;
  };

  const setSimilarCases = (caseId: string, cases: SimilarCaseResult[]) => {
    setSimilarCasesCache((prev) =>
      limitCacheSize({ ...prev, [caseId]: cases }, MAX_SIMILAR_CACHE)
    );
  };

  // 비교 분석 캐시
  const [comparisonCache, setComparisonCache] = useState<Record<string, ComparisonResult>>({});

  const getComparison = (originCaseId: string, targetCaseNumber: string): ComparisonResult | null => {
    const key = `${originCaseId}_${targetCaseNumber}`;
    return comparisonCache[key] ?? null;
  };

  const setComparison = (originCaseId: string, targetCaseNumber: string, result: ComparisonResult) => {
    const key = `${originCaseId}_${targetCaseNumber}`;
    setComparisonCache((prev) =>
      limitCacheSize({ ...prev, [key]: result }, MAX_COMPARISON_CACHE)
    );
  };

  // 판례 상세 + 요약 캐시 (LRU 방식)
  const [caseDetailCache, setCaseDetailCache] = useState<Record<string, CaseDetailCache>>({});

  const getCaseDetail = (caseNumber: string): CaseDetailCache | null => {
    return caseDetailCache[caseNumber] ?? null;
  };

  const setCaseDetail = (caseNumber: string, detail: Omit<CaseDetailCache, "cachedAt">) => {
    setCaseDetailCache((prev) => {
      // 이미 있으면 업데이트
      if (prev[caseNumber]) {
        return { ...prev, [caseNumber]: { ...detail, cachedAt: Date.now() } };
      }

      // 최대 개수 초과 시 가장 오래된 것 삭제
      const keys = Object.keys(prev);
      if (keys.length >= MAX_CASE_DETAIL_CACHE) {
        const oldest = keys.reduce((a, b) => (prev[a].cachedAt < prev[b].cachedAt ? a : b));
        const { [oldest]: _, ...rest } = prev;
        return { ...rest, [caseNumber]: { ...detail, cachedAt: Date.now() } };
      }

      return { ...prev, [caseNumber]: { ...detail, cachedAt: Date.now() } };
    });
  };

  const updateCaseSummary = (caseNumber: string, summary: string) => {
    setCaseDetailCache((prev) => {
      if (!prev[caseNumber]) return prev;
      return {
        ...prev,
        [caseNumber]: { ...prev[caseNumber], summary, cachedAt: Date.now() },
      };
    });
  };

  return (
    <SearchContext.Provider
      value={{
        searchQuery,
        setSearchQuery,
        results,
        setResults,
        hasSearched,
        setHasSearched,
        currentPage,
        setCurrentPage,
        filters: filtersState,
        setFilters,
        getSimilarCases,
        setSimilarCases,
        getComparison,
        setComparison,
        getCaseDetail,
        setCaseDetail,
        updateCaseSummary,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

// Hook
export function useSearch() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error("useSearch must be used within a SearchProvider");
  }
  return context;
}
