"use client";

import { useState, useEffect } from "react";
import { Loader2, X, Search } from "lucide-react";

interface ArticleData {
  law_name: string;
  article_number: string;
  article_title: string;
  content: string;
  paragraphs: { number: string; content: string }[];
}

interface SearchResult {
  law_name: string;
  article_number: string;
  article_title: string;
  content: string;
  paragraphs: { number: string; content: string }[];
  score: number;
}

export interface ArticleRef {
  /** 직접 조문 참조 */
  lawName?: string;
  articleNumber?: string;
  paragraph?: string;
  /** 법률 용어 검색 */
  searchTerm?: string;
}

interface ArticlePanelProps {
  articles: ArticleRef[];
  onRemove: (index: number) => void;
  onClear: () => void;
}

const formatArticleNumber = (num: string) => {
  if (num.includes("의")) {
    const [base, sub] = num.split("의");
    return `제${base}조의${sub}`;
  }
  return `제${num}조`;
};

/** 직접 조문 참조 카드 (POST /api/v1/laws/article) */
function DirectArticleCard({
  articleRef,
  onRemove,
}: {
  articleRef: ArticleRef;
  onRemove: () => void;
}) {
  const [data, setData] = useState<ArticleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchArticle = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/v1/laws/article", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            law_name: articleRef.lawName,
            article_number: articleRef.articleNumber,
          }),
        });

        if (cancelled) return;

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("현행법에서 조회할 수 없는 조문입니다.");
          }
          throw new Error("조회 실패");
        }

        const result: ArticleData = await response.json();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "오류 발생");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchArticle();
    return () => { cancelled = true; };
  }, [articleRef.lawName, articleRef.articleNumber]);

  return (
    <ArticleCardShell
      header={`${articleRef.lawName} ${formatArticleNumber(articleRef.articleNumber!)}`}
      subtitle={data?.article_title ? `(${data.article_title})` : undefined}
      onRemove={onRemove}
    >
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
      ) : error ? (
        <p className="text-xs text-zinc-500 text-center py-2">{error}</p>
      ) : data ? (
        <ArticleContent data={data} paragraph={articleRef.paragraph} />
      ) : null}
    </ArticleCardShell>
  );
}

/** 법률 용어 검색 카드 (POST /api/v1/laws/search-term — BM25 로컬 검색) */
function SearchTermCard({
  searchTerm,
  onRemove,
}: {
  searchTerm: string;
  onRemove: () => void;
}) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchResults = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/v1/laws/search-term", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term: searchTerm, limit: 3 }),
        });

        if (cancelled) return;

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("관련 법조항을 찾을 수 없습니다.");
          }
          throw new Error("검색 실패");
        }

        const data = await response.json();
        if (!cancelled) setResults(data.results || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "오류 발생");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchResults();
    return () => { cancelled = true; };
  }, [searchTerm]);

  const topResult = results[0];

  return (
    <ArticleCardShell
      header={searchTerm}
      subtitle={
        topResult
          ? `→ ${topResult.law_name} ${formatArticleNumber(topResult.article_number)}`
          : undefined
      }
      icon={<Search className="h-3 w-3 text-blue-500 shrink-0" />}
      onRemove={onRemove}
    >
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
      ) : error ? (
        <p className="text-xs text-zinc-500 text-center py-2">{error}</p>
      ) : topResult ? (
        <div className="space-y-1 overflow-hidden">
          {(() => {
            // paragraphs 유효성 검증: 실제 내용이 있는 항만 필터
            const validParas = (topResult.paragraphs || []).filter(
              (p) => p.content && p.content.length > 5
            );
            return validParas.length > 0 ? (
              validParas.map((para) => (
                <p key={para.number} className="text-xs leading-relaxed text-zinc-700 break-words">
                  {para.content}
                </p>
              ))
            ) : (
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 break-words">
                {topResult.content}
              </p>
            );
          })()}
        </div>
      ) : null}
    </ArticleCardShell>
  );
}

/** 카드 외곽 (공통) */
function ArticleCardShell({
  header,
  subtitle,
  icon,
  onRemove,
  children,
}: {
  header: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden w-full min-w-0">
      <div className="px-3 py-2 flex items-center justify-between gap-1 border-b border-zinc-100 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-1">
          {icon || <div className="w-0.5 h-4 rounded-full bg-blue-500 shrink-0" />}
          <span className="text-xs font-semibold text-zinc-800 truncate block min-w-0">
            {header}
            {subtitle && (
              <span className="font-normal text-zinc-400 ml-1">{subtitle}</span>
            )}
          </span>
        </div>
        <button
          onClick={onRemove}
          className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-3 py-2 max-h-48 overflow-y-auto overflow-x-hidden w-full min-w-0">
        {children}
      </div>
    </div>
  );
}

/** 조문 내용 렌더링 (직접 조회용) */
function ArticleContent({
  data,
  paragraph,
}: {
  data: ArticleData;
  paragraph?: string;
}) {
  // paragraphs 유효성: 실제 내용이 있는 항만 필터 (항번호 기호만 있는 것 제외)
  const validParas = data.paragraphs.filter((p) => p.content && p.content.length > 5);

  if (validParas.length > 0) {
    if (paragraph) {
      const target = validParas.find((p) => p.number === paragraph);
      return target ? (
        <p className="text-xs leading-relaxed text-zinc-700 break-words">{target.content}</p>
      ) : (
        <p className="text-xs text-zinc-500">해당 항을 찾을 수 없습니다.</p>
      );
    }
    return (
      <div className="space-y-1 overflow-hidden">
        {validParas.map((para) => (
          <p key={para.number} className="text-xs leading-relaxed text-zinc-700 break-words">
            {para.content}
          </p>
        ))}
      </div>
    );
  }

  return (
    <p className="text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 break-words">
      {data.content}
    </p>
  );
}

export function ArticlePanel({ articles, onRemove, onClear }: ArticlePanelProps) {
  if (articles.length === 0) return null;

  return (
    <div className="min-w-0 w-full">
      <div className="w-full flex items-center gap-2 mb-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[11px] font-medium text-muted-foreground shrink-0">참조</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="space-y-2">
        {articles.map((art, i) => {
          const key = art.searchTerm
            ? `search-${art.searchTerm}-${i}`
            : `article-${art.lawName}-${art.articleNumber}-${art.paragraph || ""}-${i}`;

          return art.searchTerm ? (
            <SearchTermCard
              key={key}
              searchTerm={art.searchTerm}
              onRemove={() => onRemove(i)}
            />
          ) : (
            <DirectArticleCard
              key={key}
              articleRef={art}
              onRemove={() => onRemove(i)}
            />
          );
        })}
      </div>
    </div>
  );
}
