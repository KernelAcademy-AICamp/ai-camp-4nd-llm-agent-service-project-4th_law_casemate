"use client";

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Sparkles,
  PanelRightOpen,
  PanelRightClose,
  Loader2,
  Gavel,
  FileText,
  Search,
  Lightbulb,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// API 응답 타입
interface CaseDetail {
  case_number: string;
  case_name: string;
  court_name: string;
  judgment_date: string;
  case_type: string;
  full_text: string;
}

interface PrecedentDetailPageProps { }

export function PrecedentDetailPage({ }: PrecedentDetailPageProps) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // 판례 상세 조회 + 요약 동시 요청
  useEffect(() => {
    const fetchCaseDetail = async () => {
      if (!id) return;

      setLoading(true);
      setError(null);
      setSummaryLoading(true);

      try {
        const response = await fetch(`/api/search/cases/${encodeURIComponent(id)}`);

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("판례를 찾을 수 없습니다.");
          }
          throw new Error("판례 조회 중 오류가 발생했습니다.");
        }

        const data: CaseDetail = await response.json();
        setCaseDetail(data);
        setLoading(false);

        // 상세 조회 완료 후 바로 요약 요청 (백그라운드)
        if (data.full_text) {
          fetchSummary(data.full_text);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
        setLoading(false);
        setSummaryLoading(false);
      }
    };

    fetchCaseDetail();
  }, [id]);

  // AI 요약 요청 (백그라운드)
  const fetchSummary = async (fullText: string) => {
    try {
      const response = await fetch("/api/search/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: fullText }),
      });

      if (!response.ok) {
        throw new Error("요약 중 오류가 발생했습니다.");
      }

      const data = await response.json();
      setSummary(data.summary);
    } catch (err) {
      setSummary("요약을 불러올 수 없습니다.");
    } finally {
      setSummaryLoading(false);
    }
  };

  // 날짜 포맷 (20200515 → 2020.05.15)
  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr.length !== 8) return dateStr || "";
    return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
  };

  // 로딩 상태
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 에러 상태
  if (error || !caseDetail) {
    return (
      <div className="space-y-6">
        <Button
          variant="ghost"
          className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          돌아가기
        </Button>
        <div className="text-center py-20 text-muted-foreground">
          {error || "판례를 찾을 수 없습니다."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          돌아가기
        </Button>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs font-normal">
            판례 정보
          </Badge>
        </div>
      </div>

      {/* Title Section */}
      <div className="text-center space-y-2 max-w-3xl mx-auto">
        <h1 className="text-lg lg:text-xl font-semibold tracking-tight text-balance leading-relaxed">
          {caseDetail.case_name || caseDetail.case_number}
        </h1>
        <p className="text-sm text-muted-foreground">
          {caseDetail.case_number} | {caseDetail.court_name} | {formatDate(caseDetail.judgment_date)}
        </p>
      </div>

      <Separator />

      {/* Content Area - Side by Side Layout */}
      <div className="flex gap-6">
        {/* Full Text Section */}
        <div className="prose prose-base max-w-none transition-all duration-300 flex-[6]">
          <div className="whitespace-pre-wrap text-[0.95rem] leading-loose font-sans text-foreground/80">
            {(() => {
              const sections: { header: string | null; lines: string[] }[] = [];
              let currentSection: { header: string | null; lines: string[] } = { header: null, lines: [] };

              caseDetail.full_text.split("\n").forEach((line) => {
                const trimmedLine = line.trim();
                const sectionMatch = trimmedLine.match(/^【(.+?)】$/);

                if (sectionMatch) {
                  if (currentSection.header || currentSection.lines.length > 0) {
                    sections.push(currentSection);
                  }
                  currentSection = { header: line, lines: [] };
                } else {
                  currentSection.lines.push(line);
                }
              });
              sections.push(currentSection);

              // 위에 간격 추가할 섹션들
              const spacedSections = ['전문', '이    유', '이유', '이 유'];

              return sections.map((section, sIndex) => {
                const needsSpacing = spacedSections.some(s => section.header?.includes(s));

                return (
                  <div key={sIndex} className={needsSpacing ? "mt-8" : "mt-0"}>
                    {section.header && (
                      <h3 className="text-lg font-bold text-gray-900 mb-2">
                        {section.header.replace(/[【】]/g, '')}
                      </h3>
                    )}
                    <div className={`${section.header ? "pl-6 md:pl-10" : ""} space-y-1`}>
                      {section.lines.map((line, lIndex) => {
                        const trimmedLine = line.trim();

                        // [섹션명] 형태의 placeholder는 숨김 (예: [전문], [판시사항] 등)
                        if (/^\[.+\]$/.test(trimmedLine)) {
                          return null;
                        }

                        // 법률 문서 번호 패턴 감지: 1., 1), 가., 가), (1), ① 등
                        const isNumbered = /^\d+\./.test(trimmedLine) ||
                          /^\d+\)/.test(trimmedLine) ||
                          /^[가-힣]\./.test(trimmedLine) ||
                          /^[가-힣]\)/.test(trimmedLine) ||
                          /^\(\d+\)/.test(trimmedLine) ||
                          /^[①-⑳]/.test(trimmedLine);

                        return (
                          <>
                            {isNumbered && <div key={`spacer-${lIndex}`} className="min-h-[1.5rem]"></div>}
                            <div
                              key={lIndex}
                              className="min-h-[1.5rem]"
                            >
                              {line}
                            </div>
                          </>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* AI Summary Panel */}
        <div className="flex-[4] min-w-[320px] flex-shrink-0 self-start sticky top-20">
          <Card className="border-border/60 max-h-[calc(100vh-8rem)] flex flex-col shadow-sm">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI 요약
              </CardTitle>
            </CardHeader>

            <CardContent className="overflow-y-auto pt-0">
              {summaryLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">요약 중...</span>
                </div>
              ) : summary ? (
                <div className="text-foreground/90 font-sans">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h2: ({ ...props }) => {
                        const content = String(props.children);
                        let icon = <FileText className="h-3.5 w-3.5" />;

                        if (content.includes("결과")) icon = <Gavel className="h-3.5 w-3.5" />;
                        if (content.includes("사실")) icon = <Search className="h-3.5 w-3.5" />;
                        if (content.includes("법리")) icon = <FileText className="h-3.5 w-3.5" />;
                        if (content.includes("포인트") || content.includes("시사점")) icon = <Lightbulb className="h-3.5 w-3.5" />;

                        return (
                          <h2
                            className="text-[13px] font-bold text-primary mt-6 mb-3 flex items-center gap-2 border-l-4 border-primary/40 pl-2.5 bg-primary/5 py-1.5 rounded-r-sm"
                            {...props}
                          >
                            {icon}
                            {props.children}
                          </h2>
                        );
                      },
                      p: ({ ...props }) => (
                        <p className="mb-4 leading-5 text-[13px] text-foreground/80" {...props} />
                      ),
                      li: ({ ...props }) => (
                        <li className="mb-2 leading-6 text-[13px] text-foreground/80 list-none relative pl-4 before:content-['•'] before:absolute before:left-0 before:text-primary/60" {...props} />
                      ),
                      ul: ({ ...props }) => (
                        <ul className="pl-0 mb-4" {...props} />
                      ),
                    }}
                  >
                    {summary}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  요약을 불러올 수 없습니다.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
