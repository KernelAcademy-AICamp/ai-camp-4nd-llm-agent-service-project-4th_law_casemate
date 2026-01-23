"use client";

import { useNavigate } from "react-router-dom";
import { type CaseData, sampleCases } from "@/lib/sample-data";
import {
  Plus,
  FolderOpen,
  FileText,
  Scale,
  ChevronRight,
  AlertCircle,
  TrendingUp,
  CheckCircle2,
  Clock,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface HomePageProps {
  cases?: CaseData[];
}

export function HomePage({ cases: propCases }: HomePageProps) {
  const navigate = useNavigate();
  const cases = propCases || sampleCases;
  const needsAttentionCount = cases.filter(
    (c) => c.riskLevel === "high" || c.status === "분석중"
  ).length;
  const completedCount = cases.filter((c) => c.status === "완료").length;
  const inProgressCount = cases.filter((c) => c.status !== "완료").length;
  const recentCase = cases.length > 0 ? cases[0] : null;

  // Mock performance data
  const performanceData = {
    totalCases: cases.length,
    completedThisMonth: 2,
    avgProcessingTime: "12일",
    successRate: 87,
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* Page Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          안녕하세요, 변호사님
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          오늘의 업무 현황과 사건 진행 상태를 확인하세요.
        </p>
      </div>

      {/* Section 1: Start Here - Primary Actions */}
      <section className="mb-12">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          시작하기
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Primary Action - Create New Case */}
          <button
            type="button"
            onClick={() => navigate("/new-case")}
            className="group relative bg-primary text-primary-foreground p-6 rounded-lg border border-primary text-left transition-all hover:shadow-sm"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-primary-foreground/10 rounded-lg">
                <Plus className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold">새 사건 등록</h3>
                <p className="mt-1 text-sm text-primary-foreground/70 line-clamp-2">
                  새로운 법률 사건을 등록하고 증거 분석을 시작합니다.
                </p>
              </div>
            </div>
            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary-foreground/50 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* Secondary Action - Continue Existing Case */}
          <button
            type="button"
            onClick={() => navigate("/cases")}
            className="group relative bg-card text-card-foreground p-6 rounded-lg border border-border text-left transition-all hover:border-muted-foreground/30 hover:shadow-sm"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold">진행중인 사건</h3>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {recentCase
                    ? `최근 사건: ${recentCase.name}`
                    : "진행중인 사건이 없습니다."}
                </p>
              </div>
            </div>
            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* Secondary Action - Manage Files */}
          <button
            type="button"
            onClick={() => navigate("/evidence/upload")}
            className="group relative bg-card text-card-foreground p-6 rounded-lg border border-border text-left transition-all hover:border-muted-foreground/30 hover:shadow-sm"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold">파일 관리</h3>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  증거 자료를 업로드하고 AI 분석을 진행합니다.
                </p>
              </div>
            </div>
            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* Secondary Action - Explore Precedents */}
          <button
            type="button"
            onClick={() => navigate("/precedents")}
            className="group relative bg-card text-card-foreground p-6 rounded-lg border border-border text-left transition-all hover:border-muted-foreground/30 hover:shadow-sm"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <Scale className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold">판례 검색</h3>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  유사 판례를 검색하고 법률 분석을 수행합니다.
                </p>
              </div>
            </div>
            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      {/* Section 2: Current Status */}
      <section className="mb-12">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          현재 상태
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Cases */}
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-muted rounded-lg">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <p className="text-2xl font-semibold text-foreground">
                {cases.length}
              </p>
              <p className="text-xs text-muted-foreground mt-1">전체 사건</p>
            </CardContent>
          </Card>

          {/* In Progress */}
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-muted rounded-lg">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <p className="text-2xl font-semibold text-foreground">
                {inProgressCount}
              </p>
              <p className="text-xs text-muted-foreground mt-1">진행중</p>
            </CardContent>
          </Card>

          {/* Needs Attention */}
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-muted rounded-lg">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-semibold text-foreground">
                  {needsAttentionCount}
                </p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">확인 필요</p>
            </CardContent>
          </Card>

          {/* Completed */}
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-muted rounded-lg">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <p className="text-2xl font-semibold text-foreground">
                {completedCount}
              </p>
              <p className="text-xs text-muted-foreground mt-1">완료</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Section 3: Performance Report (Reports integrated into Home) */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          성과 현황
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Performance Card */}
          <Card className="border-border/60 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                사건 분석 현황
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                  <p className="text-3xl font-semibold text-foreground">
                    {performanceData.successRate}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    분석 정확도
                  </p>
                  <div className="w-full h-1.5 bg-muted rounded-full mt-2">
                    <div
                      className="h-full bg-foreground rounded-full"
                      style={{ width: `${performanceData.successRate}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-3xl font-semibold text-foreground">
                    {performanceData.completedThisMonth}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    이번 달 완료
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-3xl font-semibold text-foreground">
                    {performanceData.avgProcessingTime}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    평균 처리 시간
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                주간 활동
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b border-border/60">
                <span className="text-sm text-muted-foreground">새 사건</span>
                <span className="text-sm font-medium">+2</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border/60">
                <span className="text-sm text-muted-foreground">증거 분석</span>
                <span className="text-sm font-medium">15건</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">판례 검색</span>
                <span className="text-sm font-medium">8건</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
