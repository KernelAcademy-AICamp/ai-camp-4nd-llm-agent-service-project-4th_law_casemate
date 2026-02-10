"use client";

import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation, useSearchParams, Link } from "react-router-dom";
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
  Star,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSearch } from "@/contexts/search-context";
import { highlightKeywords } from "@/lib/highlight";
import { ComparisonAnalysisContent } from "@/components/legal/comparison-analysis";

// API 응답 타입
interface CaseDetail {
  case_number: string;
  case_name: string;
  court_name: string;
  judgment_date: string;
  case_type: string;
  full_text: string;
}

// 요약 섹션 헤더 렌더링 함수
const renderSummaryHeader = (children: React.ReactNode) => {
  const content = String(children);
  let icon = <FileText className="h-3.5 w-3.5" />;
  let bgColor = "bg-gray-100";
  let iconColor = "text-gray-600";

  if (content.includes("결과")) {
    icon = <Gavel className="h-3.5 w-3.5" />;
    bgColor = "bg-emerald-100";
    iconColor = "text-emerald-600";
  }
  if (content.includes("사실")) {
    icon = <Search className="h-3.5 w-3.5" />;
    bgColor = "bg-blue-100";
    iconColor = "text-blue-600";
  }
  if (content.includes("법리")) {
    icon = <FileText className="h-3.5 w-3.5" />;
    bgColor = "bg-amber-100";
    iconColor = "text-amber-600";
  }
  if (content.includes("포인트") || content.includes("시사점") || content.includes("실무")) {
    icon = <Lightbulb className="h-3.5 w-3.5" />;
    bgColor = "bg-purple-100";
    iconColor = "text-purple-600";
  }

  return (
    <div className="flex items-center gap-2 mt-6 mb-3">
      <div className={`w-6 h-6 rounded-full ${bgColor} flex items-center justify-center`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <h4 className="text-sm font-medium">{children}</h4>
    </div>
  );
};

interface PrecedentDetailPageProps { }

export function PrecedentDetailPage({ }: PrecedentDetailPageProps) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { searchQuery, getCaseDetail: getCachedDetail, setCaseDetail: setCachedDetail, updateCaseSummary } = useSearch();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // 유사 판례에서 들어온 경우: caseId 파라미터와 원본 사건 정보
  const originCaseId = searchParams.get("caseId");
  const originFacts = (location.state as { originFacts?: string })?.originFacts || "";
  const originClaims = (location.state as { originClaims?: string })?.originClaims || "";
  const isFromSimilarCase = !!originCaseId && !!originFacts && !!originClaims;

  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  // 즐겨찾기 상태
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  // 판례 상세 조회 (캐시 우선)
  useEffect(() => {
    const fetchCaseDetail = async () => {
      if (!id) return;

      // 페이지 전환 시 에러 상태 초기화 (캐시 확인 전에 수행)
      setError(null);

      // 캐시 확인
      const cached = getCachedDetail(id);
      if (cached) {
        setCaseDetail(cached);
        setSummary(cached.summary ?? null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setSummary(null);

      try {
        const response = await fetch(
          `/api/v1/search/cases/${encodeURIComponent(id)}`
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("판례를 찾을 수 없습니다.");
          }
          throw new Error("판례 조회 중 오류가 발생했습니다.");
        }

        const data: CaseDetail = await response.json();
        setCaseDetail(data);

        // 캐시에 저장
        setCachedDetail(data.case_number, data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchCaseDetail();
  }, [id]);

  // AI 요약 요청 (유사 판례가 아닐 때만)
  useEffect(() => {
    // 유사 판례에서 들어온 경우 요약 불필요
    if (isFromSimilarCase) {
      setSummaryLoading(false);
      return;
    }

    // 이미 요약이 있으면 다시 호출하지 않음
    if (summary) return;

    if (!caseDetail?.full_text) return;

    const abortController = new AbortController();

    const fetchSummary = async () => {
      setSummaryLoading(true);

      try {
        const response = await fetch("/api/v1/search/summarize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: caseDetail.full_text,
            case_number: caseDetail.case_number,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("요약 중 오류가 발생했습니다.");
        }

        const data = await response.json();
        setSummary(data.summary);

        // 캐시에 요약 업데이트
        if (caseDetail.case_number) {
          updateCaseSummary(caseDetail.case_number, data.summary);
        }
      } catch (err) {
        // 취소된 경우 무시
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setSummary("요약을 불러올 수 없습니다.");
      } finally {
        setSummaryLoading(false);
      }
    };

    fetchSummary();

    // cleanup: 페이지 나갈 때 API 호출 취소
    return () => {
      abortController.abort();
    };
  }, [caseDetail?.case_number, isFromSimilarCase]);

  // 즐겨찾기 상태 확인
  useEffect(() => {
    const checkFavoriteStatus = async () => {
      if (!id) return;

      try {
        const response = await fetch(`/api/v1/favorites/precedents/${encodeURIComponent(id)}/status`);
        if (response.ok) {
          const data = await response.json();
          setIsFavorite(data.is_favorite);
        }
      } catch (err) {
        console.error("즐겨찾기 상태 확인 실패:", err);
      }
    };

    checkFavoriteStatus();
  }, [id]);

  // 즐겨찾기 토글
  const toggleFavorite = async () => {
    if (!id || favoriteLoading) return;

    setFavoriteLoading(true);
    try {
      const response = await fetch(`/api/v1/favorites/precedents/${encodeURIComponent(id)}/toggle`, {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        setIsFavorite(data.is_favorite);
      }
    } catch (err) {
      console.error("즐겨찾기 토글 실패:", err);
    } finally {
      setFavoriteLoading(false);
    }
  };

  // 날짜 포맷 (20200515 → 2020.05.15)
  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr.length !== 8) return dateStr || "";
    return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
  };

  // 참조판례 전체 인용문을 링크로 변환
  // 예: "대법원 2000. 11. 24. 선고 99도822 판결" 전체가 링크
  const renderWithCaseLinks = (text: string): React.ReactNode[] => {
    // 전체 판례 인용 패턴: [법원명] [날짜] 선고 [사건번호] [판결/결정]
    const fullCitationPattern = /((?:[가-힣]+(?:법원|재판소)\s+)?(?:\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*선고\s+)?(\d{2,4}[가-힣]+\d+)(?:\s*(?:판결|결정|전원합의체))?)/g;

    const result: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = fullCitationPattern.exec(text)) !== null) {
      // 매치 이전 텍스트 추가
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }

      const fullCitation = match[1]; // 전체 인용문 (예: 대법원 2000. 11. 24. 선고 99도822 판결)
      const caseNumber = match[2];   // 사건번호만 (예: 99도822)

      result.push(
        <Link
          key={match.index}
          to={`/precedents/${encodeURIComponent(caseNumber)}`}
          className="text-blue-600 hover:text-blue-800 hover:underline"
        >
          {fullCitation}
        </Link>
      );

      lastIndex = match.index + match[0].length;
    }

    // 남은 텍스트 추가
    if (lastIndex < text.length) {
      result.push(text.slice(lastIndex));
    }

    return result.length > 0 ? result : [text];
  };

  // 로딩 상태
  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
        <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-20 w-20" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
      </div>
    );
  }

  // 에러 상태
  if (error || !caseDetail) {
    const isNotFound = error?.includes("찾을 수 없습니다");
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
        <div className="text-center py-20">
          {isNotFound ? (
            <div className="space-y-4">
              <p className="text-lg text-muted-foreground">
                해당 판례는 접근이 제한되었습니다.
              </p>
              <p className="text-sm text-muted-foreground/70">
                사건번호: {id}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              {error || "판례를 찾을 수 없습니다."}
            </p>
          )}
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
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFavorite}
            disabled={favoriteLoading}
            className={`h-8 px-2 ${isFavorite ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground hover:text-yellow-500"}`}
          >
            <Star className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
            <span className="ml-1 text-xs">{isFavorite ? "즐겨찾기됨" : "즐겨찾기"}</span>
          </Button>
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
        {/* Full Text Section 줄 간격 (leading-loose / tight */}
        <div className="prose prose-base max-w-none transition-all duration-300 flex-[6]">
          <div className="whitespace-pre-wrap text-[0.95rem] leading-loose font-sans text-foreground/80">
            {(() => {
              const sections: { header: string | null; lines: string[] }[] = [];
              let currentSection: { header: string | null; lines: string[] } = { header: null, lines: [] };

              // 모든 【header】 를 섹션으로 인식 (백엔드에서 독립 줄 보장됨)
              caseDetail.full_text.split("\n").forEach((line) => {
                const trimmedLine = line.trim();
                const sectionMatch = trimmedLine.match(/^【(.+?)】$/);

                if (sectionMatch) {
                  if (currentSection.header || currentSection.lines.length > 0) {
                    sections.push(currentSection);
                  }
                  currentSection = { header: trimmedLine, lines: [] };
                } else {
                  currentSection.lines.push(line);
                }
              });
              sections.push(currentSection);

              return sections.map((section, sIndex) => {
                return (
                  <div key={sIndex} className={section.header ? "mt-1" : "mt-0"}> {/* 섹션 간의 간격*/}
                    {section.header && (
                      <h3 className="text-lg font-bold text-gray-900 mb-1"> {/* 헤더 아래 간격*/}
                        {section.header.replace(/[【】]/g, '')}
                      </h3>
                    )}
                    <div className={`${section.header ? "pl-6 md:pl-10" : ""} space-y-0`}>
                      {section.lines.map((line, lIndex) => {
                        // 연속 공백을 하나로 정리
                        const cleanedLine = line.replace(/\s{2,}/g, ' ');
                        const trimmedLine = cleanedLine.trim();

                        // [섹션명] 형태의 placeholder는 숨김 (예: [전문], [판시사항] 등)
                        if (/^\[.+\]$/.test(trimmedLine)) {
                          return null;
                        }

                        // 참조 섹션인지 확인 (참조판례는 링크로 변환)
                        const isRefSection = section.header?.includes("참조판례") ||
                          section.header?.includes("참조조문");

                        return (
                          <React.Fragment key={lIndex}>
                            <div className="min-h-[1.5rem]">
                              {isRefSection ? (
                                // 참조판례 섹션: 사건번호를 링크로 변환
                                renderWithCaseLinks(cleanedLine)
                              ) : (
                                // 그 외 섹션: 기존 방식 (하이라이트)
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: isFromSimilarCase ? cleanedLine : highlightKeywords(cleanedLine, searchQuery),
                                  }}
                                />
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Side Panel - AI 요약 또는 비교 분석 */}
        <div className="flex-[4] min-w-[320px] flex-shrink-0 self-start sticky top-20">
          <Card className="border-border/60 max-h-[calc(100vh-8rem)] flex flex-col shadow-sm">
            <CardHeader className="pb-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {isFromSimilarCase ? "비교 분석" : "AI 요약"}
                </CardTitle>
                <Badge variant="secondary" className="text-xs font-normal">
                  AI 분석
                </Badge>
              </div>
              {isFromSimilarCase && (
                <p className="text-xs text-muted-foreground mt-1">
                  현재 수임 사건과 이 판례의 비교 분석 결과입니다.
                </p>
              )}
            </CardHeader>

            <CardContent className="overflow-y-auto pt-0">
              {isFromSimilarCase && caseDetail && originCaseId ? (
                /* 비교 분석 콘텐츠 */
                <ComparisonAnalysisContent
                  originCaseId={originCaseId}
                  originFacts={originFacts}
                  originClaims={originClaims}
                  targetCaseNumber={caseDetail.case_number}
                />
              ) : (
                /* AI 요약 콘텐츠 */
                <>
                  {summaryLoading ? (
                    <div className="py-12">
                      <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                        <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-20 w-20" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
                        <p className="text-sm">AI가 판례를 요약하고 있습니다...</p>
                      </div>
                    </div>
                  ) : summary ? (
                    <div className="space-y-6">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => renderSummaryHeader(children),
                          h2: ({ children }) => renderSummaryHeader(children),
                          p: ({ ...props }) => (
                            <p className="text-sm text-muted-foreground leading-relaxed pl-8 mb-2" {...props} />
                          ),
                          li: ({ ...props }) => (
                            <div className="flex items-start gap-2 pl-8 mb-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-2 shrink-0" />
                              <p className="text-sm text-muted-foreground leading-relaxed">{props.children}</p>
                            </div>
                          ),
                          ul: ({ children }) => (
                            <div className="space-y-1">{children}</div>
                          ),
                        }}
                      >
                        {summary}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="py-8">
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <p className="text-sm">요약을 불러올 수 없습니다.</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
