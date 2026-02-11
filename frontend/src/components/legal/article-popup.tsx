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
  children: React.ReactNode;
}

export function ArticleLink({
  lawName,
  articleNumber,
  paragraph,
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
          className="absolute z-50 left-0 top-full mt-1 overflow-hidden rounded-2xl shadow-lg bg-gray-50"
          style={{ minWidth: "320px", maxWidth: "400px" }}
        >
          {/* 헤더 */}
          <div className="px-5 pt-4 pb-3 flex items-start justify-between">
            <span className="text-base font-semibold text-gray-800">
              {lawName} {formatArticleNumber(articleNumber)}
              {article?.article_title && ` (${article.article_title})`}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 ml-3"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* 내용 */}
          <div className="px-5 pb-5 overflow-y-auto max-h-60">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : error ? (
              <div className="text-center py-4 text-gray-500 text-sm">
                {error}
              </div>
            ) : article ? (
              <div>
                {article.paragraphs.length > 0 ? (
                  paragraph ? (
                    (() => {
                      const targetPara = article.paragraphs.find(p => p.number === paragraph);
                      return targetPara ? (
                        <p className="text-gray-700 text-sm leading-relaxed">
                          {targetPara.content}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-500">해당 항을 찾을 수 없습니다.</p>
                      );
                    })()
                  ) : (
                    article.paragraphs.map((para) => (
                      <p key={para.number} className="text-gray-700 text-sm leading-relaxed mb-2">
                        {para.content}
                      </p>
                    ))
                  )
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700">
                    {article.content}
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
