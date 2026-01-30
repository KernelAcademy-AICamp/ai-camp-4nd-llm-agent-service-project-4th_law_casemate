"use client";

import { useState, useEffect } from "react";
import {
  Scale,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Loader2,
  AlertTriangle,
  FileText,
  Gavel,
} from "lucide-react";
import { useSearch, type ComparisonResult } from "@/contexts/search-context";

interface ComparisonAnalysisProps {
  originCaseId: string;
  originFacts: string;
  originClaims: string;
  targetCaseNumber: string;
}

export function ComparisonAnalysisContent({
  originCaseId,
  originFacts,
  originClaims,
  targetCaseNumber,
}: ComparisonAnalysisProps) {
  const { getComparison, setComparison } = useSearch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ComparisonResult | null>(null);

  useEffect(() => {
    const fetchComparison = async () => {
      if (!originCaseId || !originFacts || !originClaims || !targetCaseNumber) return;

      // 1. 캐시에 있으면 캐시된 결과 사용
      const cached = getComparison(originCaseId, targetCaseNumber);
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }

      // 2. 캐시에 없으면 API 호출
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/v1/search/cases/compare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            origin_facts: originFacts,
            origin_claims: originClaims,
            target_case_number: targetCaseNumber,
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || "비교 분석 중 오류가 발생했습니다.");
        }

        const result: ComparisonResult = await response.json();
        setData(result);

        // 3. 결과를 캐시에 저장
        setComparison(originCaseId, targetCaseNumber, result);
      } catch (err) {
        console.error("비교 분석 실패:", err);
        setError(err instanceof Error ? err.message : "비교 분석 중 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchComparison();
  }, [originCaseId, originFacts, originClaims, targetCaseNumber]);

  // 텍스트를 불릿 포인트 리스트로 변환
  const parseToList = (text: string): string[] => {
    if (!text) return [];
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[-•*]\s*/, ""));
  };

  // **텍스트**를 <strong>으로 변환
  const formatBoldText = (text: string): React.ReactNode => {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((part, idx) =>
      idx % 2 === 1 ? <strong key={idx} className="font-semibold text-foreground">{part}</strong> : part
    );
  };

  // 로딩 상태
  if (loading) {
    return (
      <div className="py-12">
        <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">AI가 판례를 비교 분석하고 있습니다...</p>

        </div>
      </div>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <div className="py-8">
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-red-500" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { parsed } = data;
  const caseOverview = parsed.case_overview || "";
  const precedentSummary = parsed.precedent_summary || "";
  const similarities = parseToList(parsed.similarities);
  const differences = parseToList(parsed.differences);
  const strategyPoints = parseToList(parsed.strategy_points);

  return (
    <div className="space-y-6">
      {/* 현재 사건 개요 */}
      {caseOverview && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
              <FileText className="h-3.5 w-3.5 text-slate-600" />
            </div>
            <h4 className="text-sm font-medium">현재 사건 개요</h4>
          </div>
          <div className="pl-8">
            <p className="text-sm text-muted-foreground leading-relaxed">{formatBoldText(caseOverview)}</p>
          </div>
        </div>
      )}

      {/* 유사 판례 요약 */}
      {precedentSummary && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center">
              <Gavel className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <h4 className="text-sm font-medium">유사 판례 요약</h4>
          </div>
          <div className="pl-8">
            <p className="text-sm text-muted-foreground leading-relaxed">{formatBoldText(precedentSummary)}</p>
          </div>
        </div>
      )}

      {/* 유사점 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <h4 className="text-sm font-medium">유사점</h4>
        </div>
        <div className="pl-8 space-y-2">
          {similarities.length > 0 ? (
            similarities.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 shrink-0" />
                <p className="text-sm text-muted-foreground leading-relaxed">{formatBoldText(item)}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">분석된 유사점이 없습니다.</p>
          )}
        </div>
      </div>

      {/* 차이점 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
            <XCircle className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <h4 className="text-sm font-medium">차이점</h4>
        </div>
        <div className="pl-8 space-y-2">
          {differences.length > 0 ? (
            differences.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                <p className="text-sm text-muted-foreground leading-relaxed">{formatBoldText(item)}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">분석된 차이점이 없습니다.</p>
          )}
        </div>
      </div>

      {/* 전략 포인트 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
            <Lightbulb className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <h4 className="text-sm font-medium">전략 포인트</h4>
        </div>
        <div className="pl-8 space-y-2">
          {strategyPoints.length > 0 ? (
            strategyPoints.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
                <p className="text-sm text-muted-foreground leading-relaxed">{formatBoldText(item)}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">분석된 전략 포인트가 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
