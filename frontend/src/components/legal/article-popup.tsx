"use client";

import React, { useState, useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";

interface ArticleData {
  law_name: string;
  article_number: string;
  article_title: string;
  content: string;
  paragraphs: { number: string; content: string }[];
}

interface ArticleLinkProps {
  lawName: string;
  articleNumber: string;
  paragraph?: string;
  highlights?: string[];
  children: React.ReactNode;
}

export function ArticleLink({
  lawName,
  articleNumber,
  paragraph,
  highlights,
  children,
}: ArticleLinkProps) {
  const [open, setOpen] = useState(false);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  // ESC 키로 닫기
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("keydown", handleEsc);
    }

    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  // 조문 데이터 로드
  useEffect(() => {
    if (!open || !lawName || !articleNumber) return;
    if (article) return;

    const fetchArticle = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/v1/laws/article", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            law_name: lawName,
            article_number: articleNumber,
          }),
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("해당 조문은 법령 개정으로 현행법에서 조회할 수 없습니다.");
          }
          throw new Error("조회 실패");
        }

        const data: ArticleData = await response.json();
        setArticle(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류 발생");
      } finally {
        setLoading(false);
      }
    };

    fetchArticle();
  }, [open, lawName, articleNumber, article]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!open);
  };

  // 조문번호 형식 변환: "15의2" → "제15조의2", "307" → "제307조"
  const formatArticleNumber = (num: string) => {
    if (num.includes("의")) {
      const [base, sub] = num.split("의");
      return `제${base}조의${sub}`;
    }
    return `제${num}조`;
  };

  // 키워드 하이라이트: 텍스트 내 매칭 키워드에 마크 처리
  const highlightText = (text: string): React.ReactNode => {
    if (!highlights || highlights.length === 0) return text;

    const validKeywords = highlights.filter((k) => k.trim().length >= 2);
    if (validKeywords.length === 0) return text;

    const escaped = validKeywords.map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = text.split(pattern);

    return parts.map((part, i) =>
      pattern.test(part) ? (
        <mark
          key={i}
          className="bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200 rounded-sm px-0.5"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <span className="relative inline">
      <button
        ref={triggerRef}
        onClick={handleClick}
        className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
      >
        {children}
      </button>

      {open && (
        <div
          ref={popupRef}
          className="absolute z-50 left-0 top-full mt-2 overflow-hidden rounded-xl ring-1 ring-black/10 shadow-[0_8px_30px_rgba(0,0,0,0.12)] bg-white dark:bg-zinc-900 dark:ring-white/10"
          style={{ minWidth: "480px", maxWidth: "560px" }}
        >
          {/* 헤더 */}
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="w-1 h-5 rounded-full bg-blue-500 shrink-0" />
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {lawName} {formatArticleNumber(articleNumber)}
                {article?.article_title && (
                  <span className="font-normal text-zinc-500 dark:text-zinc-400"> ({article.article_title})</span>
                )}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 내용 */}
          <div className="px-5 py-4 overflow-y-auto max-h-80">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : error ? (
              <div className="text-center py-6 text-zinc-500 text-sm">
                {error}
              </div>
            ) : article ? (
              <div className="space-y-2.5">
                {article.paragraphs.length > 0 ? (
                  paragraph ? (
                    (() => {
                      const targetPara = article.paragraphs.find(p => p.number === paragraph);
                      return targetPara ? (
                        <p className="text-zinc-700 dark:text-zinc-300 text-[13px] leading-[1.8]">
                          {highlightText(targetPara.content)}
                        </p>
                      ) : (
                        <p className="text-sm text-zinc-500">해당 항을 찾을 수 없습니다.</p>
                      );
                    })()
                  ) : (
                    article.paragraphs.map((para) => (
                      <p key={para.number} className="text-zinc-700 dark:text-zinc-300 text-[13px] leading-[1.8]">
                        {highlightText(para.content)}
                      </p>
                    ))
                  )
                ) : (
                  <p className="text-[13px] leading-[1.8] whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                    {highlightText(article.content)}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </span>
  );
}
