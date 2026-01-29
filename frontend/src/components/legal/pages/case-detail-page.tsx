"use client";

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  type CaseData,
  type EvidenceData,
  type PrecedentData,
  sampleCases,
  sampleEvidenceByDate,
} from "@/lib/sample-data";

// 유사 판례 API 응답 타입
interface SimilarCaseResult {
  case_number: string;
  case_name: string;
  court_name: string;
  judgment_date: string;
  score: number;
}

interface SimilarCasesResponse {
  total: number;
  results: SimilarCaseResult[];
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Upload,
  FileCheck,
  Edit2,
  Save,
  Plus,
  Scale,
  ArrowUpRight,
  Trash2,
  Users,
  Calendar,
  FileText,
  AlertTriangle,
  Clock,
  TrendingUp,
  CheckCircle2,
  XCircle,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { RelationshipEditor } from "@/components/legal/relationship-editor";

interface CaseDetailPageProps {
  caseData?: CaseData;
}

interface TimelineEvent {
  id: string;
  date: string;
  time: string;
  title: string;
  description: string;
  type: "의뢰인" | "상대방" | "증거" | "기타";
  actor?: string;
}

// 타임라인 이벤트는 API에서 가져옴

// Case overview editable fields
interface CaseOverviewData {
  summary: string;
  facts: string;
  claims: string;
  legalBasis: string;
}

export function CaseDetailPage({
  caseData: propCaseData,
}: CaseDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Find case data from sample data if not provided as prop
  const caseData = propCaseData && propCaseData.id ? propCaseData : sampleCases.find(c => c.id === id) || sampleCases[0];

  const [timelineEvents, setTimelineEvents] =
    useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState<Partial<TimelineEvent>>({
    date: "",
    time: "",
    title: "",
    description: "",
    type: "기타",
    actor: "",
  });

  // Case overview state
  const [isEditingOverview, setIsEditingOverview] = useState(false);
  const [overviewData, setOverviewData] = useState<CaseOverviewData>({
    summary:
      "온라인 커뮤니티 및 직장 내에서 발생한 명예훼손 사건. 피고소인이 34명 규모의 단체 카카오톡 채팅방에서 의뢰인에 대해 '업무능력이 없다', '팀에 짐만 된다' 등의 모욕적 발언과 '회사 돈을 횡령했다'는 허위사실을 유포함.",
    facts:
      "2025년 11월 15일부터 2026년 1월 10일까지 약 2개월간, 피고소인 박OO는 직장 동료 34명이 참여한 카카오톡 단체 채팅방에서 의뢰인 김OO에 대해 '업무능력이 없다', '팀에 짐만 된다' 등의 모욕적 발언과 '회사 돈을 횡령했다'는 허위사실을 유포함.",
    claims:
      "1. 형사: 명예훼손죄(형법 제307조) 및 모욕죄(형법 제311조)로 고소\n2. 민사: 위자료 5,000만원 손해배상 청구",
    legalBasis:
      "형법 제307조(명예훼손), 형법 제311조(모욕), 정보통신망 이용촉진 및 정보보호 등에 관한 법률 제70조",
  });

  const allEvidence = Object.values(sampleEvidenceByDate).flat();

  // 유사 판례 상태
  const [similarCases, setSimilarCases] = useState<SimilarCaseResult[]>([]);
  const [similarCasesLoading, setSimilarCasesLoading] = useState(false);

  // 유사 판례 검색 (overviewData 기반)
  const fetchSimilarCases = async () => {
    // overviewData의 summary + facts를 쿼리로 사용
    const query = `${overviewData.summary} ${overviewData.facts}`;

    if (!query.trim()) return;

    setSimilarCasesLoading(true);
    try {
      const response = await fetch("/api/search/cases/similar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query,
          exclude_case_number: null  // 현재 사건은 판례가 아니므로 제외할 필요 없음
        }),
      });

      if (!response.ok) {
        throw new Error("유사 판례 검색 중 오류가 발생했습니다.");
      }

      const data: SimilarCasesResponse = await response.json();
      setSimilarCases(data.results);
    } catch (err) {
      console.error("유사 판례 검색 실패:", err);
      setSimilarCases([]);
    } finally {
      setSimilarCasesLoading(false);
    }
  };

  // 타임라인 데이터 가져오기
  const fetchTimeline = async () => {
    setTimelineLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/api/v1/timeline/${caseData.id}`);
      if (!response.ok) {
        throw new Error("타임라인 데이터를 가져오는 중 오류가 발생했습니다.");
      }
      const data = await response.json();
      setTimelineEvents(data);
    } catch (err) {
      console.error("타임라인 데이터 가져오기 실패:", err);
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  };

  // 컴포넌트 마운트 시 유사 판례 검색 및 타임라인 데이터 가져오기
  useEffect(() => {
    fetchSimilarCases();
    fetchTimeline();
  }, []);

  // 날짜 포맷 (20200515 → 2020.05.15)
  const formatJudgmentDate = (dateStr: string) => {
    if (!dateStr || dateStr.length !== 8) return dateStr || "";
    return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
  };

  const handleSaveEvent = () => {
    if (editingEvent) {
      setTimelineEvents((prev) =>
        prev.map((e) => (e.id === editingEvent.id ? editingEvent : e))
      );
      setEditingEvent(null);
    }
  };

  const handleAddEvent = () => {
    if (newEvent.date && newEvent.title) {
      const event: TimelineEvent = {
        id: Date.now().toString(),
        date: newEvent.date,
        time: newEvent.time || "00:00",
        title: newEvent.title,
        description: newEvent.description || "",
        type: (newEvent.type as TimelineEvent["type"]) || "기타",
        actor: newEvent.actor || "",
      };
      setTimelineEvents((prev) =>
        [...prev, event].sort((a, b) => {
          const dateA = new Date(`${a.date}T${a.time}`);
          const dateB = new Date(`${b.date}T${b.time}`);
          return dateA.getTime() - dateB.getTime();
        })
      );
      setNewEvent({
        date: "",
        time: "",
        title: "",
        description: "",
        type: "기타",
        actor: "",
      });
      setIsAddingEvent(false);
    }
  };

  const handleDeleteEvent = (id: string) => {
    setTimelineEvents((prev) => prev.filter((e) => e.id !== id));
  };

  const getTypeColor = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "의뢰인":
        return "border-emerald-500 bg-emerald-50 text-emerald-800";
      case "상대방":
        return "border-amber-600 bg-amber-50 text-amber-900";
      case "증거":
        return "border-blue-500 bg-blue-50 text-blue-800";
      default:
        return "border-border bg-secondary text-secondary-foreground";
    }
  };

  const getTimelineDotColor = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "의뢰인":
        return "bg-emerald-500";
      case "상대방":
        return "bg-amber-600";
      case "증거":
        return "bg-blue-500";
      default:
        return "bg-foreground";
    }
  };

  const getTypeLabel = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "의뢰인":
        return "우리측";
      case "상대방":
        return "상대측";
      case "증거":
        return "증거";
      default:
        return "기타";
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const [bottomSectionOpen, setBottomSectionOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/cases")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          사건 목록
        </Button>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {caseData.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              사건 ID: {caseData.id} · {caseData.client} vs {caseData.opponent}
            </p>
          </div>
          <Badge
            variant={caseData.status === "완료" ? "default" : "secondary"}
            className="w-fit text-xs font-normal"
          >
            {caseData.status}
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Progress value={caseData.progress} className="h-2" />
          </div>
          <span className="text-sm font-medium min-w-[3rem] text-muted-foreground">
            {caseData.progress}%
          </span>
        </div>
      </div>

      {/* Tabs - New Structure */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-10 p-1 bg-secondary/50">
          <TabsTrigger value="overview" className="text-sm">
            사건 개요
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-sm">
            타임라인
          </TabsTrigger>
          <TabsTrigger value="relations" className="text-sm">
            관계도
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="text-sm">
            대시보드
          </TabsTrigger>
        </TabsList>

        {/* ===== 사건 개요 탭 ===== */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Case Details - Editable (Moved to top) */}
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">
                  사건 상세 정보
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditingOverview(!isEditingOverview)}
                >
                  {isEditingOverview ? (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      저장
                    </>
                  ) : (
                    <>
                      <Edit2 className="h-4 w-4 mr-2" />
                      편집
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-6 border-b border-border/60">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">사건 유형</p>
                  <p className="text-sm font-medium">{caseData.caseType}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">의뢰인</p>
                  <p className="text-sm font-medium">{caseData.client}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">발생 기간</p>
                  <p className="text-sm font-medium">
                    {caseData.period || "2025.11.15 ~ 2026.01.10"}
                  </p>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">사건 요약</Label>
                  {isEditingOverview ? (
                    <Textarea
                      value={overviewData.summary}
                      onChange={(e) =>
                        setOverviewData((prev) => ({
                          ...prev,
                          summary: e.target.value,
                        }))
                      }
                      rows={3}
                      className="text-sm"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {overviewData.summary}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">사실관계</Label>
                  {isEditingOverview ? (
                    <Textarea
                      value={overviewData.facts}
                      onChange={(e) =>
                        setOverviewData((prev) => ({
                          ...prev,
                          facts: e.target.value,
                        }))
                      }
                      rows={4}
                      className="text-sm"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {overviewData.facts}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">청구 내용</Label>
                  {isEditingOverview ? (
                    <Textarea
                      value={overviewData.claims}
                      onChange={(e) =>
                        setOverviewData((prev) => ({
                          ...prev,
                          claims: e.target.value,
                        }))
                      }
                      rows={2}
                      className="text-sm"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                      {overviewData.claims}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">적용 법률</Label>
                  {isEditingOverview ? (
                    <Textarea
                      value={overviewData.legalBasis}
                      onChange={(e) =>
                        setOverviewData((prev) => ({
                          ...prev,
                          legalBasis: e.target.value,
                        }))
                      }
                      rows={2}
                      className="text-sm"
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {overviewData.legalBasis.split(", ").map((law) => (
                        <Badge
                          key={law}
                          variant="outline"
                          className="font-normal text-xs"
                        >
                          {law}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Evidence Management - Compact List */}
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-medium">증거 목록</CardTitle>
                <Badge variant="secondary" className="text-xs font-normal">
                  {allEvidence.length}건
                </Badge>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate("/evidence/upload")}>
                <Upload className="h-4 w-4 mr-2" />
                업로드
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="border border-border/60 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/30 border-b border-border/60">
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">증거명</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground hidden sm:table-cell">유형</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground hidden md:table-cell">일시</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allEvidence.map((evidence, idx) => (
                      <tr
                        key={evidence.id}
                        onClick={() => navigate(`/evidence/${evidence.id}`)}
                        className={`cursor-pointer hover:bg-secondary/30 transition-colors ${idx !== allEvidence.length - 1 ? 'border-b border-border/40' : ''}`}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <FileCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="font-medium truncate max-w-[180px]">{evidence.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">{evidence.type}</td>
                        <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">{evidence.date} {evidence.time}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant="outline" className="text-xs font-normal py-0 h-5">
                            {evidence.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Similar Precedents from API */}
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Scale className="h-4 w-4" />
                유사 판례
                {similarCases.length > 0 && (
                  <Badge variant="secondary" className="text-xs font-normal">
                    {similarCases.length}건
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {similarCasesLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
                  유사 판례 검색 중...
                </div>
              ) : similarCases.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  유사 판례가 없습니다.
                </div>
              ) : (
                <div className="space-y-3">
                  {similarCases.map((caseItem, index) => (
                    <button
                      key={`${caseItem.case_number}-${index}`}
                      type="button"
                      onClick={() => navigate(`/precedents/${encodeURIComponent(caseItem.case_number)}`)}
                      className="w-full p-4 rounded-lg border border-l-4 border-l-primary border-t-border/60 border-r-border/60 border-b-border/60 bg-card hover:bg-secondary/30 transition-colors text-left group overflow-hidden relative"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="w-2 h-2 rounded-full shrink-0 bg-primary" />
                            <h4 className="text-sm font-medium">
                              {caseItem.case_number}
                            </h4>
                            <Badge
                              variant="secondary"
                              className="text-xs font-normal"
                            >
                              유사도 {Math.round(caseItem.score * 100)}%
                            </Badge>
                          </div>
                          <p className="text-sm text-foreground/80">
                            {caseItem.case_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {caseItem.court_name} | {formatJudgmentDate(caseItem.judgment_date)}
                          </p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 타임라인 탭 - Zigzag Design with Color Highlights ===== */}
        <TabsContent value="timeline" className="mt-6">
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-base font-medium">
                  사건 경과 타임라인
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  실제 발생한 사건들을 시간순으로 정리
                </p>
              </div>
              <div className="flex items-center gap-4">
                {/* Legend */}
                <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span>우리측</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-600" />
                    <span>상대측</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span>증거</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsAddingEvent(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  추가
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {timelineLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
                  타임라인 데이터 로딩 중...
                </div>
              ) : timelineEvents.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  타임라인 이벤트가 없습니다.
                </div>
              ) : (
              <>
              {/* Zigzag Timeline */}
              <div className="relative py-8">
                {/* Center Line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-1/2" />

                {/* Timeline Events */}
                <div className="space-y-8">
                  {timelineEvents.map((event, index) => {
                    const isLeft = index % 2 === 0;
                    return (
                      <div
                        key={event.id}
                        className={`relative flex items-center ${isLeft ? "justify-start" : "justify-end"}`}
                      >
                        {/* Center Number Circle with Color */}
                        <div className="absolute left-1/2 -translate-x-1/2 z-10">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${getTimelineDotColor(event.type)} text-white`}>
                            {index + 1}
                          </div>
                        </div>

                        {/* Event Card */}
                        <div
                          className={`w-[calc(50%-3rem)] group ${isLeft ? "pr-4 text-right" : "pl-4 text-left"}`}
                        >
                          <div
                            className={`p-5 rounded-xl border-2 bg-card hover:shadow-md transition-all ${getTypeColor(event.type)}`}
                          >
                            {/* Header */}
                            <div
                              className={`flex items-center gap-2 mb-2 ${isLeft ? "justify-end" : "justify-start"}`}
                            >
                              <Badge
                                variant="outline"
                                className={`text-xs font-medium px-2 py-0.5 ${event.type === "의뢰인"
                                  ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                                  : event.type === "상대방"
                                    ? "border-amber-300 bg-amber-100 text-amber-800"
                                    : event.type === "증거"
                                      ? "border-blue-300 bg-blue-100 text-blue-700"
                                      : "border-border bg-secondary text-muted-foreground"
                                  }`}
                              >
                                {getTypeLabel(event.type)}
                              </Badge>
                              {event.actor && (
                                <span className="text-xs text-muted-foreground">{event.actor}</span>
                              )}
                            </div>

                            {/* Title */}
                            <h4 className="text-base font-semibold mb-1">
                              {event.title}
                            </h4>

                            {/* Description */}
                            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                              {event.description}
                            </p>

                            {/* Date & Time */}
                            <div
                              className={`pt-3 border-t border-current/10 flex items-center gap-2 text-xs text-muted-foreground ${isLeft ? "justify-end" : "justify-start"}`}
                            >
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(event.date)}</span>
                              <span className="opacity-50">|</span>
                              <Clock className="h-3 w-3" />
                              <span>{event.time}</span>
                            </div>

                            {/* Action Buttons - Show on Hover */}
                            <div
                              className={`mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isLeft ? "justify-end" : "justify-start"}`}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditingEvent(event)}
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => handleDeleteEvent(event.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 관계도 탭 ===== */}
        <TabsContent value="relations" className="mt-6">
          <Card className="border-border/60 overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  인물 관계도 편집기
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  인물을 드래그하여 이동하고, 파란 점을 드래그하여 관계를 연결하세요
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <RelationshipEditor
                clientName={caseData.client}
                opponentName={caseData.opponent}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 대시보드 탭 (법적 리스크 분석) ===== */}
        <TabsContent value="dashboard" className="mt-6 space-y-6">
          {/* TOP: Risk Summary Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 인과관계 */}
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">인과관계</span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    주의
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  2023년 6월~12월 증거 공백으로 인과관계 입증 취약
                </p>
              </CardContent>
            </Card>

            {/* 과실 */}
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">과실</span>
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    안정
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  상대방 고의성 입증 자료 충분 (채팅 로그 4건 확보)
                </p>
              </CardContent>
            </Card>

            {/* 손해 */}
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">손해</span>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    <XCircle className="h-3 w-3 mr-1" />
                    고위험
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  정신적 피해 입증 자료 부족, 진단서 미확보
                </p>
              </CardContent>
            </Card>
          </div>

          {/* MAIN: Left Heatmap + Center Matrix + Right Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT: Time × Evidence Type Heatmap */}
            <Card className="border-border/60 lg:col-span-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">시간 × 증거유형 히트맵</CardTitle>
                <p className="text-xs text-muted-foreground">증거 공백 구간 식별</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {/* Header Row */}
                  <div className="grid grid-cols-7 gap-1 text-xs text-muted-foreground mb-2">
                    <div className="col-span-1" />
                    {["1월", "2월", "3월", "4월", "5월", "6월"].map((month) => (
                      <div key={month} className="text-center text-[10px]">{month}</div>
                    ))}
                  </div>
                  {/* Heatmap Rows */}
                  {[
                    { type: "채팅", data: [3, 2, 4, 1, 0, 0] },
                    { type: "음성", data: [1, 0, 2, 0, 0, 0] },
                    { type: "문서", data: [2, 1, 1, 2, 1, 0] },
                    { type: "진술", data: [1, 1, 0, 0, 0, 0] },
                    { type: "상대측", data: [0, 1, 1, 0, 0, 0] },
                  ].map((row) => (
                    <div key={row.type} className="grid grid-cols-7 gap-1 items-center">
                      <div className="text-xs text-muted-foreground truncate">{row.type}</div>
                      {row.data.map((value, idx) => (
                        <div
                          key={idx}
                          className={`h-6 rounded-sm flex items-center justify-center text-[10px] font-medium ${value === 0
                            ? "bg-red-100 text-red-600 border border-red-200"
                            : value <= 1
                              ? "bg-amber-100 text-amber-700"
                              : value <= 2
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-emerald-200 text-emerald-800"
                            }`}
                        >
                          {value}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-2 rounded bg-red-50 border border-red-100">
                  <p className="text-xs text-red-700 font-medium">증거 공백 경고</p>
                  <p className="text-xs text-red-600">5월~6월 전 증거유형 공백</p>
                </div>
              </CardContent>
            </Card>

            {/* CENTER: Issue-Evidence Matrix */}
            <Card className="border-border/60 lg:col-span-5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">쟁점-증거 매트릭스</CardTitle>
                <p className="text-xs text-muted-foreground">핵심 쟁점별 증거 충족도</p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th className="text-left py-2 pr-2 font-medium text-muted-foreground">쟁점</th>
                        <th className="text-center py-2 px-1 font-medium text-muted-foreground">채팅</th>
                        <th className="text-center py-2 px-1 font-medium text-muted-foreground">음성</th>
                        <th className="text-center py-2 px-1 font-medium text-muted-foreground">문서</th>
                        <th className="text-center py-2 px-1 font-medium text-muted-foreground">진술</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { issue: "명예훼손 발언", chat: "sufficient", audio: "partial", doc: "none", statement: "sufficient" },
                        { issue: "공연성 (다수 인지)", chat: "sufficient", audio: "none", doc: "sufficient", statement: "partial" },
                        { issue: "허위사실 적시", chat: "partial", audio: "partial", doc: "none", statement: "none" },
                        { issue: "고의성", chat: "sufficient", audio: "sufficient", doc: "partial", statement: "sufficient" },
                        { issue: "피해 발생", chat: "none", audio: "none", doc: "none", statement: "partial" },
                      ].map((row) => (
                        <tr key={row.issue} className="border-b border-border/40">
                          <td className="py-2 pr-2 font-medium">{row.issue}</td>
                          {[row.chat, row.audio, row.doc, row.statement].map((status, idx) => (
                            <td key={idx} className="text-center py-2 px-1">
                              {status === "sufficient" ? (
                                <div className="w-6 h-6 mx-auto rounded bg-emerald-100 flex items-center justify-center">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                </div>
                              ) : status === "partial" ? (
                                <div className="w-6 h-6 mx-auto rounded bg-amber-100 flex items-center justify-center">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 mx-auto rounded bg-red-100 flex items-center justify-center">
                                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                                </div>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-emerald-100" /> 충분
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-amber-100" /> 부분
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-red-100" /> 미확보
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* RIGHT: Action Panel */}
            <div className="lg:col-span-3 space-y-4">
              {/* Opponent Claim Risk Alerts */}
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    상대측 주장 리스크
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="p-2 rounded bg-amber-50 border border-amber-100">
                    <p className="text-xs font-medium text-amber-800">허위사실 부인 가능성</p>
                    <p className="text-[10px] text-amber-700">"사실적시에 불과" 주장 예상</p>
                  </div>
                  <div className="p-2 rounded bg-red-50 border border-red-100">
                    <p className="text-xs font-medium text-red-800">손해 인과관계 부정</p>
                    <p className="text-[10px] text-red-700">증거 공백기간 악용 우려</p>
                  </div>
                </CardContent>
              </Card>

              {/* Next Actions */}
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">필수 조치사항</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[
                      { action: "5~6월 증거 공백 보완", priority: "high" },
                      { action: "정신과 진단서 확보", priority: "high" },
                      { action: "목격자 진술서 추가 확보", priority: "medium" },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 ${item.priority === "high" ? "bg-red-500" : "bg-amber-500"
                          }`} />
                        <p className="text-xs">{item.action}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Nearest Deadline */}
              <Card className="border-red-200 bg-red-50/50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="h-3.5 w-3.5 text-red-600" />
                    <span className="text-xs font-medium text-red-700">최근접 기한</span>
                  </div>
                  <p className="text-sm font-semibold text-red-800">2026. 1. 25.</p>
                  <p className="text-xs text-red-600">내용증명 회신 기한 (D-3)</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* BOTTOM: Collapsible Section */}
          <Card className="border-border/60">
            <CardHeader className="pb-0">
              <button
                type="button"
                onClick={() => setBottomSectionOpen(!bottomSectionOpen)}
                className="flex items-center justify-between w-full py-2"
              >
                <CardTitle className="text-sm font-medium">예상 판결 범위 (참고용)</CardTitle>
                {bottomSectionOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </CardHeader>
            {bottomSectionOpen && (
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Fault Ratio Range Bar */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">과실 비율 예상 범위</span>
                      <span className="text-xs text-muted-foreground">유사 판례 기준</span>
                    </div>
                    <div className="relative h-8 bg-secondary/50 rounded-lg overflow-hidden">
                      {/* Full bar background */}
                      <div className="absolute inset-0 flex items-center px-2">
                        <div className="flex-1 h-2 bg-muted rounded-full" />
                      </div>
                      {/* Range indicator */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-4 bg-emerald-500/80 rounded"
                        style={{ left: "15%", width: "25%" }}
                      />
                      {/* Labels */}
                      <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px]">
                        <span className="text-muted-foreground">0%</span>
                        <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-medium">
                          15% ~ 40%
                        </span>
                        <span className="text-muted-foreground">100%</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      상대방 과실: 현재 증거 기준 60~85% 예상
                    </p>
                  </div>

                  {/* Damage Exposure Range */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">손해배상 인정 범위</span>
                      <span className="text-xs text-muted-foreground">유사 판례 기준</span>
                    </div>
                    <div className="relative h-8 bg-secondary/50 rounded-lg overflow-hidden">
                      {/* Full bar background */}
                      <div className="absolute inset-0 flex items-center px-2">
                        <div className="flex-1 h-2 bg-muted rounded-full" />
                      </div>
                      {/* Range indicator */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-4 bg-blue-500/80 rounded"
                        style={{ left: "20%", width: "40%" }}
                      />
                      {/* Labels */}
                      <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px]">
                        <span className="text-muted-foreground">0원</span>
                        <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">
                          500만 ~ 2,000만원
                        </span>
                        <span className="text-muted-foreground">5천만원</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      정신적 피해 입증 시 상향 가능, 미입증 시 하향 조정
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-4 pt-3 border-t border-border/60">
                  위 범위는 유사 판례를 참고한 예상치이며, 실제 판결은 재판부 판단에 따라 달라질 수 있습니다.
                </p>
              </CardContent>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Event Dialog */}
      <Dialog open={isAddingEvent} onOpenChange={setIsAddingEvent}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>새 사건 이벤트 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>날짜</Label>
                <Input
                  type="date"
                  value={newEvent.date}
                  onChange={(e) =>
                    setNewEvent((prev) => ({ ...prev, date: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>시간</Label>
                <Input
                  type="time"
                  value={newEvent.time}
                  onChange={(e) =>
                    setNewEvent((prev) => ({ ...prev, time: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>유형</Label>
              <Select
                value={newEvent.type}
                onValueChange={(value) =>
                  setNewEvent((prev) => ({
                    ...prev,
                    type: value as TimelineEvent["type"],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="이벤트 유형 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="의뢰인">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      우리측 (의뢰인)
                    </div>
                  </SelectItem>
                  <SelectItem value="상대방">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-600" />
                      상대측 (피고소인)
                    </div>
                  </SelectItem>
                  <SelectItem value="증거">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      증거 발생/확보
                    </div>
                  </SelectItem>
                  <SelectItem value="기타">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                      기타
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>제목</Label>
              <Input
                value={newEvent.title}
                onChange={(e) =>
                  setNewEvent((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="예: 단톡방 비방 발언, 증거 캡처 확보"
              />
            </div>
            <div className="space-y-2">
              <Label>설명</Label>
              <Textarea
                value={newEvent.description}
                onChange={(e) =>
                  setNewEvent((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="실제 발생한 사건의 상세 내용을 기술하세요"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>관련 인물/증거명 (선택)</Label>
              <Input
                value={newEvent.actor || ""}
                onChange={(e) =>
                  setNewEvent((prev) => ({ ...prev, actor: e.target.value }))
                }
                placeholder="예: 김OO (의뢰인), 캡처 이미지"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingEvent(false)}>
              취소
            </Button>
            <Button onClick={handleAddEvent}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Event Dialog */}
      <Dialog
        open={editingEvent !== null}
        onOpenChange={() => setEditingEvent(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>사건 이벤트 편집</DialogTitle>
          </DialogHeader>
          {editingEvent && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>날짜</Label>
                  <Input
                    type="date"
                    value={editingEvent.date}
                    onChange={(e) =>
                      setEditingEvent((prev) =>
                        prev ? { ...prev, date: e.target.value } : null
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>시간</Label>
                  <Input
                    type="time"
                    value={editingEvent.time}
                    onChange={(e) =>
                      setEditingEvent((prev) =>
                        prev ? { ...prev, time: e.target.value } : null
                      )
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>유형</Label>
                <Select
                  value={editingEvent.type}
                  onValueChange={(value) =>
                    setEditingEvent((prev) =>
                      prev
                        ? { ...prev, type: value as TimelineEvent["type"] }
                        : null
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="의뢰인">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        우리측 (의뢰인)
                      </div>
                    </SelectItem>
                    <SelectItem value="상대방">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-600" />
                        상대측 (피고소인)
                      </div>
                    </SelectItem>
                    <SelectItem value="증거">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        증거 발생/확보
                      </div>
                    </SelectItem>
                    <SelectItem value="기타">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                        기타
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>제목</Label>
                <Input
                  value={editingEvent.title}
                  onChange={(e) =>
                    setEditingEvent((prev) =>
                      prev ? { ...prev, title: e.target.value } : null
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea
                  value={editingEvent.description}
                  onChange={(e) =>
                    setEditingEvent((prev) =>
                      prev ? { ...prev, description: e.target.value } : null
                    )
                  }
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>관련 인물/증거명 (선택)</Label>
                <Input
                  value={editingEvent.actor || ""}
                  onChange={(e) =>
                    setEditingEvent((prev) =>
                      prev ? { ...prev, actor: e.target.value } : null
                    )
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEvent(null)}>
              취소
            </Button>
            <Button onClick={handleSaveEvent}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
