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

// 유사 판례 캐시 (caseId별로 저장)
interface SimilarCasesCache {
  [caseId: string]: SimilarCaseResult[];
}

// 비교 분석 결과 타입
export interface ComparisonResult {
  success: boolean;
  analysis: string;
  parsed: {
    case_overview: string;
    precedent_summary: string;
    similarities: string;
    differences: string;
    strategy_points: string;
  };
  precedent_info: {
    case_number: string;
    case_name: string;
    court_name: string;
    judgment_date: string;
  };
  elapsed_time: number;
  error?: string;
}

// 비교 분석 캐시 (originCaseId_targetCaseNumber 형태의 키)
interface ComparisonCache {
  [key: string]: ComparisonResult;
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
  // 유사 판례 캐시
  getSimilarCases: (caseId: string) => SimilarCaseResult[] | null;
  setSimilarCases: (caseId: string, cases: SimilarCaseResult[]) => void;
  // 비교 분석 캐시
  getComparison: (originCaseId: string, targetCaseNumber: string) => ComparisonResult | null;
  setComparison: (originCaseId: string, targetCaseNumber: string, result: ComparisonResult) => void;
}

// Context 생성
const SearchContext = createContext<SearchContextType | null>(null);

// Provider 컴포넌트
export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // 유사 판례 캐시 (caseId별로 저장)
  const [similarCasesCache, setSimilarCasesCache] = useState<SimilarCasesCache>({});

  // 유사 판례 가져오기 (캐시된 경우 반환, 없으면 null)
  const getSimilarCases = (caseId: string): SimilarCaseResult[] | null => {
    return similarCasesCache[caseId] ?? null;
  };

  // 유사 판례 저장 (캐시에 추가)
  const setSimilarCases = (caseId: string, cases: SimilarCaseResult[]) => {
    setSimilarCasesCache((prev) => ({
      ...prev,
      [caseId]: cases,
    }));
  };

  // 비교 분석 캐시 (originCaseId_targetCaseNumber 형태의 키)
  const [comparisonCache, setComparisonCache] = useState<ComparisonCache>({});

  // 비교 분석 가져오기 (캐시된 경우 반환, 없으면 null)
  const getComparison = (originCaseId: string, targetCaseNumber: string): ComparisonResult | null => {
    const key = `${originCaseId}_${targetCaseNumber}`;
    return comparisonCache[key] ?? null;
  };

  // 비교 분석 저장 (캐시에 추가)
  const setComparison = (originCaseId: string, targetCaseNumber: string, result: ComparisonResult) => {
    const key = `${originCaseId}_${targetCaseNumber}`;
    setComparisonCache((prev) => ({
      ...prev,
      [key]: result,
    }));
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
        getSimilarCases,
        setSimilarCases,
        getComparison,
        setComparison,
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
