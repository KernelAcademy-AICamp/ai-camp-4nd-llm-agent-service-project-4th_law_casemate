"use client";

import { useNavigate } from "react-router-dom";
import { type CaseData, sampleCases } from "@/lib/sample-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Calendar,
  Shield,
  Target,
  LayoutGrid,
  TrendingUp,
  ArrowRight,
  Info,
  Clock,
  X,
} from "lucide-react";
import { useState } from "react";

interface DashboardPageProps {
  cases?: CaseData[];
}

// ========== DATA ==========

// Risk indicators - Core 3 issues
const riskIndicators = [
  {
    id: "causality",
    label: "인과관계",
    level: "high" as const,
    reason: "행위↔피해 시점 간격 큼",
    detail: "2023.06~2024.02 기간 증거 부재로 인과관계 입증 어려움",
  },
  {
    id: "fault",
    label: "과실",
    level: "medium" as const,
    reason: "반복성/주체 특정 증거 일부 부족",
    detail: "발언 주체 특정, HR 기록 확인 필요",
  },
  {
    id: "damages",
    label: "손해",
    level: "low" as const,
    reason: "손해 발생 입증 자료 충분",
    detail: "진단서, 치료비 영수증 등 확보 완료",
  },
];

// Evidence coverage heatmap
const evidenceTypes = [
  { id: "kakao", name: "카카오톡" },
  { id: "record", name: "녹취" },
  { id: "email", name: "이메일·문서" },
  { id: "statement", name: "진술서" },
  { id: "opponent", name: "상대방서면" },
];
const timePeriods = [
  { id: "2306", label: "23.06" },
  { id: "2309", label: "23.09" },
  { id: "2312", label: "23.12" },
  { id: "2403", label: "24.03" },
  { id: "2406", label: "24.06" },
  { id: "2409", label: "24.09" },
];
const evidenceHeatmap: Record<string, Record<string, number>> = {
  kakao: { "2306": 3, "2309": 2, "2312": 0, "2403": 1, "2406": 2, "2409": 1 },
  record: { "2306": 0, "2309": 1, "2312": 2, "2403": 0, "2406": 1, "2409": 0 },
  email: { "2306": 1, "2309": 0, "2312": 0, "2403": 2, "2406": 1, "2409": 1 },
  statement: { "2306": 0, "2309": 0, "2312": 1, "2403": 1, "2406": 0, "2409": 2 },
  opponent: { "2306": 0, "2309": 0, "2312": 0, "2403": 1, "2406": 0, "2409": 0 },
};

// Issue-Evidence Matrix
const issueEvidenceMatrix = [
  {
    id: "1",
    issue: "괴롭힘 반복성",
    status: "sufficient" as const,
    evidenceTypes: ["카카오톡", "녹취"],
    evidenceCount: 4,
    guidance: null,
  },
  {
    id: "2",
    issue: "발언 주체 특정",
    status: "insufficient" as const,
    evidenceTypes: ["진술서"],
    evidenceCount: 1,
    guidance: {
      missing: "발언자 신원 특정 자료",
      recommend: "목격자 진술서, 회의록",
      clientQuestions: ["발언 당시 동석자 명단 확인 가능한가요?", "해당 회의/대화의 공식 기록이 있나요?"],
    },
  },
  {
    id: "3",
    issue: "회사 조치 여부",
    status: "insufficient" as const,
    evidenceTypes: [],
    evidenceCount: 0,
    guidance: {
      missing: "HR 공식 대응 기록",
      recommend: "인사부 회신 문서, 징계 기록",
      clientQuestions: ["회사에 정식 신고하셨나요?", "신고 후 회신받은 문서가 있나요?"],
    },
  },
  {
    id: "4",
    issue: "피해 발생·인과관계",
    status: "moderate" as const,
    evidenceTypes: ["이메일·문서", "진술서"],
    evidenceCount: 2,
    guidance: {
      missing: "피해 발생 시점 증빙",
      recommend: "진단서 날짜, 피해 직후 대화 기록",
      clientQuestions: ["증상이 시작된 정확한 시점을 기억하시나요?"],
    },
  },
  {
    id: "5",
    issue: "표현 특정성",
    status: "sufficient" as const,
    evidenceTypes: ["카카오톡", "녹취"],
    evidenceCount: 3,
    guidance: null,
  },
  {
    id: "6",
    issue: "공연성 입증",
    status: "sufficient" as const,
    evidenceTypes: ["카카오톡"],
    evidenceCount: 5,
    guidance: null,
  },
];

// Opponent risk signals
const opponentRisks = [
  {
    id: 1,
    claim: '"업무상 정당한 비판" 항변',
    risk: "high" as const,
    conflictsWith: "과실 입증",
    targetGap: "발언 맥락 기록 부재",
  },
  {
    id: 2,
    claim: '"피해자도 동일하게 응수" 주장',
    risk: "medium" as const,
    conflictsWith: "피해 인과관계",
    targetGap: "시간순 대화 정리 미비",
  },
];

// Next actions
const initialNextActions = [
  { id: 1, action: "2023.06~2024.02 공백 구간 보완", completed: false, linkedRisk: "인과관계", priority: "high" as const },
  { id: 2, action: "HR 공식 기록 확인", completed: false, linkedRisk: "과실", priority: "high" as const },
  { id: 3, action: "발언 주체 특정 증거 확보", completed: false, linkedRisk: "과실", priority: "medium" as const },
  { id: 4, action: "상대방 '정당한 비판' 항변 대비 논리 정리", completed: true, linkedRisk: "과실", priority: "medium" as const },
];

// Reference data
const referenceData = {
  similarCases: 12,
  faultRecognitionRate: [
    { label: "과실인정", value: 78, color: "bg-emerald-500" },
    { label: "일부인정", value: 15, color: "bg-amber-400" },
    { label: "기각", value: 7, color: "bg-[#EF4444]" },
  ],
  damageRange: { min: 500, max: 3000, avg: 1200 },
};

// ========== HELPERS ==========

const getRiskColor = (level: "high" | "medium" | "low") => {
  switch (level) {
    case "high":
      return { bg: "bg-[#EF4444]", text: "text-[#EF4444]", border: "border-[#EF4444]/20", bgLight: "bg-[#EF4444]/5" };
    case "medium":
      return { bg: "bg-amber-500", text: "text-amber-600", border: "border-amber-200", bgLight: "bg-amber-50" };
    case "low":
      return { bg: "bg-emerald-500", text: "text-emerald-600", border: "border-emerald-200", bgLight: "bg-emerald-50" };
  }
};

const getRiskLabel = (level: "high" | "medium" | "low") => {
  switch (level) {
    case "high":
      return "위험";
    case "medium":
      return "주의";
    case "low":
      return "안정";
  }
};

const getHeatmapIntensity = (count: number) => {
  if (count === 0) return { bg: "bg-[#EF4444]/10", border: "border-[#EF4444]/30 border-dashed", text: "text-[#EF4444]", isGap: true };
  if (count === 1) return { bg: "bg-emerald-100", border: "border-transparent", text: "text-emerald-700", isGap: false };
  if (count === 2) return { bg: "bg-emerald-300", border: "border-transparent", text: "text-emerald-800", isGap: false };
  return { bg: "bg-emerald-500", border: "border-transparent", text: "text-white", isGap: false };
};

// ========== COMPONENT ==========

export function DashboardPage({ cases: propCases }: DashboardPageProps) {
  const navigate = useNavigate();
  const cases = propCases || sampleCases;
  const [nextActions, setNextActions] = useState(initialNextActions);
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ type: string; period: string } | null>(null);

  const selectedCase = cases[0];

  const toggleAction = (id: number) => {
    setNextActions((prev) =>
      prev.map((action) => (action.id === id ? { ...action, completed: !action.completed } : action))
    );
  };

  const completedCount = nextActions.filter((a) => a.completed).length;
  const totalCount = nextActions.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);

  const selectedIssueData = issueEvidenceMatrix.find((i) => i.id === selectedIssue);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* ===== TOP STRIP: Case ID + Risk Summary (Fixed One Line) ===== */}
        <div className="p-4 rounded-xl border border-border/60 bg-card">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Left: Case Identification */}
            <div className="flex items-center gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h1 className="text-base font-semibold truncate">{selectedCase?.name || "김OO 명예훼손 사건"}</h1>
                  <Badge variant="outline" className="text-[10px] font-mono h-5 shrink-0">
                    CASE-2024-001
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">김OO vs 박OO</p>
              </div>
              <div className="h-10 w-px bg-border hidden sm:block" />
              <div className="hidden sm:flex items-center gap-3">
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">구조화완료</Badge>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">진행률</span>
                  <div className="w-12 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-foreground rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <span className="font-medium tabular-nums">{progressPercent}%</span>
                </div>
              </div>
            </div>

            {/* Right: Risk Strip - 3 Core Issues */}
            <div className="flex items-center gap-2 sm:gap-4 flex-1 justify-end flex-wrap">
              {riskIndicators.map((indicator) => {
                const colors = getRiskColor(indicator.level);
                return (
                  <Tooltip key={indicator.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${colors.border} ${colors.bgLight} transition-all hover:shadow-sm`}
                      >
                        <div className={`w-2 h-2 rounded-full ${colors.bg}`} />
                        <span className="text-xs font-medium">{indicator.label}</span>
                        <Badge variant="outline" className={`text-[10px] py-0 px-1.5 h-4 ${colors.text} border-current/30`}>
                          {getRiskLabel(indicator.level)}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground hidden xl:inline max-w-[140px] truncate">
                          {indicator.reason}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-xs">{indicator.detail}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => navigate(`/cases/${selectedCase.id}`)}>
                리포트 <ChevronRight className="h-3 w-3 ml-0.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* ===== MAIN 3-COLUMN LAYOUT ===== */}
        <div className="grid grid-cols-12 gap-4">
          {/* LEFT: Evidence Coverage Heatmap */}
          <div className="col-span-12 lg:col-span-4">
            <Card className="border-border/60 h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                    증거 커버리지 맵
                  </CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                      <p className="text-xs">시간×증거유형 밀도를 시각화합니다. 빨간 점선은 증거 공백 구간으로, 클릭하면 보완 안내가 표시됩니다.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                {/* Legend */}
                <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-emerald-500" />
                    <span>3+</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-emerald-300" />
                    <span>2</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-emerald-100" />
                    <span>1</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-[#EF4444]/10 border border-dashed border-[#EF4444]/30" />
                    <span>공백</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Heatmap Grid */}
                <div className="space-y-1">
                  {/* Header */}
                  <div className="flex gap-1">
                    <div className="w-16 shrink-0" />
                    {timePeriods.map((p) => (
                      <div key={p.id} className="flex-1 text-center text-[10px] text-muted-foreground font-medium">
                        {p.label}
                      </div>
                    ))}
                  </div>
                  {/* Rows */}
                  {evidenceTypes.map((type) => (
                    <div key={type.id} className="flex gap-1 items-center">
                      <div className="w-16 shrink-0 text-[10px] text-muted-foreground truncate pr-1">{type.name}</div>
                      {timePeriods.map((period) => {
                        const count = evidenceHeatmap[type.id][period.id];
                        const intensity = getHeatmapIntensity(count);
                        const isHovered = hoveredCell?.type === type.id && hoveredCell?.period === period.id;
                        return (
                          <Tooltip key={`${type.id}-${period.id}`}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className={`flex-1 aspect-square rounded text-[10px] font-medium flex items-center justify-center border transition-all ${intensity.bg} ${intensity.border} ${intensity.text} ${isHovered ? "ring-2 ring-foreground/30 scale-110 z-10" : ""}`}
                                onMouseEnter={() => setHoveredCell({ type: type.id, period: period.id })}
                                onMouseLeave={() => setHoveredCell(null)}
                              >
                                {intensity.isGap ? "!" : count}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs font-medium">
                                {type.name} / {period.label}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {count === 0 ? "증거 없음 - 보완 필요" : `${count}건 확보`}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Gap Alert */}
                <div className="mt-4 p-2.5 rounded-lg bg-[#EF4444]/5 border border-[#EF4444]/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-[#EF4444] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-medium text-[#EF4444]">증거 공백 감지</p>
                      <p className="text-[11px] text-[#EF4444]/80 mt-0.5">23.12 녹취/이메일, 24.03 녹취, 24.09 녹취/진술서</p>
                      <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-[11px] text-[#EF4444]">
                        공백 구간 보완 가이드 <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* CENTER: Issue-Evidence Matrix */}
          <div className="col-span-12 lg:col-span-5">
            <Card className="border-border/60 h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    쟁점-증거 매트릭스
                  </CardTitle>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      불충분 {issueEvidenceMatrix.filter((i) => i.status === "insufficient").length}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {issueEvidenceMatrix.map((item) => {
                  const isSufficient = item.status === "sufficient";
                  const isInsufficient = item.status === "insufficient";
                  const isSelected = selectedIssue === item.id;

                  return (
                    <div key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedIssue(isSelected ? null : item.id)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${isInsufficient
                          ? "bg-amber-50 border-amber-200 hover:border-amber-300"
                          : isSufficient
                            ? "bg-card border-border/40 opacity-60 hover:opacity-100"
                            : "bg-card border-border/60 hover:bg-secondary/20"
                          } ${isSelected ? "ring-2 ring-foreground/20" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          {isSufficient ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : isInsufficient ? (
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-amber-400" />
                          )}
                          <span className={`text-sm ${isInsufficient ? "font-medium text-amber-900" : ""}`}>{item.issue}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">{item.evidenceCount}건</span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] py-0 h-5 ${isSufficient
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : isInsufficient
                                ? "border-amber-300 bg-amber-100 text-amber-800 font-medium"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                          >
                            {isSufficient ? "충분" : isInsufficient ? "불충분" : "보통"}
                          </Badge>
                          {(isInsufficient || item.status === "moderate") && (
                            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isSelected ? "rotate-180" : ""}`} />
                          )}
                        </div>
                      </button>

                      {/* Expanded Guidance */}
                      {isSelected && item.guidance && (
                        <div className="mt-1.5 ml-6 p-3 rounded-lg bg-secondary/30 border border-border/60 space-y-2">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[11px] font-medium">부족한 증거: {item.guidance.missing}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">권장 자료: {item.guidance.recommend}</p>
                            </div>
                          </div>
                          <div className="border-t border-border/60 pt-2">
                            <p className="text-[10px] text-muted-foreground mb-1.5">의뢰인 확인 질문</p>
                            <ul className="space-y-1">
                              {item.guidance.clientQuestions.map((q, idx) => (
                                <li key={idx} className="text-[11px] text-foreground flex items-start gap-1.5">
                                  <span className="text-muted-foreground">{idx + 1}.</span>
                                  {q}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* RIGHT: Risk Alerts + Actions + Schedule */}
          <div className="col-span-12 lg:col-span-3 space-y-4">
            {/* A. Opponent Claim Risk */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  상대방 주장 위험
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {opponentRisks.map((risk) => {
                  const colors = getRiskColor(risk.risk);
                  return (
                    <Tooltip key={risk.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={`w-full flex items-start gap-2 p-2 rounded-lg border text-left transition-all ${colors.border} ${colors.bgLight} hover:shadow-sm`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${colors.bg}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium leading-tight">{risk.claim}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">공격점: {risk.targetGap}</p>
                          </div>
                          <Badge variant="outline" className={`text-[10px] py-0 h-4 shrink-0 ${colors.text}`}>
                            {getRiskLabel(risk.risk)}
                          </Badge>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs">
                        <p className="text-xs">
                          <span className="font-medium">충돌 쟁점:</span> {risk.conflictsWith}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-medium">공략 공백:</span> {risk.targetGap}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </CardContent>
            </Card>

            {/* B. Next Actions Checklist */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">다음 행동</CardTitle>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {completedCount}/{totalCount}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1 bg-secondary rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {nextActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => toggleAction(action.id)}
                    className={`w-full flex items-start gap-2 p-2 rounded-lg border text-left transition-all group ${action.completed
                      ? "bg-secondary/20 border-border/40 opacity-50"
                      : "bg-card border-border/60 hover:bg-secondary/20"
                      }`}
                  >
                    <Checkbox checked={action.completed} className="mt-0.5 h-3.5 w-3.5" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] leading-relaxed ${action.completed ? "line-through text-muted-foreground" : ""}`}>
                        {action.action}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{action.linkedRisk} 관련</p>
                    </div>
                    {action.priority === "high" && !action.completed && (
                      <Badge variant="destructive" className="text-[9px] py-0 h-4 shrink-0">
                        긴급
                      </Badge>
                    )}
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* C. Key Schedule */}
            <Card className="border-border/60">
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#EF4444]/10 flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-[#EF4444]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> 다음 기한
                    </p>
                    <p className="text-sm font-medium truncate">내용증명 회신</p>
                  </div>
                  <Badge variant="destructive" className="text-xs font-semibold shrink-0 tabular-nums">
                    D-3
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ===== BOTTOM: Reference Intelligence (Collapsed) ===== */}
        <Collapsible open={isReferenceOpen} onOpenChange={setIsReferenceOpen}>
          <Card className="border-border/60">
            <CollapsibleTrigger asChild>
              <CardHeader className="py-3 cursor-pointer hover:bg-secondary/20 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    참고 인텔리전스
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">유사 판례 {referenceData.similarCases}건 기반</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isReferenceOpen ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 pb-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {/* Similar Cases */}
                  <div className="text-center sm:text-left">
                    <p className="text-[11px] text-muted-foreground mb-1">유사 판례</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {referenceData.similarCases}
                      <span className="text-sm font-normal text-muted-foreground ml-1">건</span>
                    </p>
                    <Button variant="link" size="sm" className="h-auto p-0 text-[11px] mt-1">
                      판례 상세 보기 <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>

                  {/* Fault Recognition Rate */}
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-2">과실 인정 비율</p>
                    <div className="flex items-end gap-1.5 h-14">
                      {referenceData.faultRecognitionRate.map((item) => (
                        <Tooltip key={item.label}>
                          <TooltipTrigger asChild>
                            <div className="flex-1 flex flex-col items-center gap-1 cursor-default">
                              <div
                                className={`w-full ${item.color} rounded-t transition-all hover:opacity-80`}
                                style={{ height: `${item.value * 0.5}px` }}
                              />
                              <span className="text-[10px] text-muted-foreground">{item.label}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs font-medium">{item.value}%</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>

                  {/* Damage Range */}
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-2">손해액 분포 (만원)</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground tabular-nums">{referenceData.damageRange.min}</span>
                      <div className="flex-1 h-2 bg-secondary rounded-full relative">
                        <div className="absolute left-[15%] right-[15%] h-full bg-foreground/20 rounded-full" />
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-foreground rounded-full border-2 border-background" />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{referenceData.damageRange.max}</span>
                    </div>
                    <p className="text-center text-[11px] mt-1.5">
                      <span className="text-muted-foreground">평균</span>{" "}
                      <span className="font-semibold tabular-nums">{referenceData.damageRange.avg}</span>
                      <span className="text-muted-foreground">만원</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </TooltipProvider>
  );
}
