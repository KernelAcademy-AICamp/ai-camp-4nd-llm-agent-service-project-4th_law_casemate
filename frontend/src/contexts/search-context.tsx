"use client";

import { createContext, useContext, useState, ReactNode } from "react";

// 검색 결과 타입
export interface SearchResult {
  case_number: string;
  case_name: string;
  court_name: string;
  judgment_date: string;
  content: string;
  score: number;
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
}

// Context 생성
const SearchContext = createContext<SearchContextType | null>(null);

// Provider 컴포넌트
export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

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
