"use client";

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  type CaseData,
  type EvidenceData,
  type PrecedentData,
} from "@/lib/sample-data";
import { useSearch, type SimilarCaseResult } from "@/contexts/search-context";
import { Loader2 } from "lucide-react";

// API 응답 타입
interface CaseApiResponse {
  id: number;
  title: string;
  client_name: string | null;
  client_role: string | null;
  case_type: string | null;
  status: string | null;
  created_at: string | null;
  incident_date: string | null;
  incident_date_end: string | null;
  description: string | null;
}

// 유사 판례 API 응답 타입
interface SimilarCasesResponse {
  total: number;
  results: SimilarCaseResult[];
}

// 관련 법령 API 응답 타입
interface RelatedLawResult {
  law_name: string;
  article_number: string;
  article_title: string;
  content: string;
  score: number;
}

interface RelatedLawsResponse {
  total: number;
  results: RelatedLawResult[];
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
  const { getSimilarCases, setSimilarCases: cacheSimilarCases } = useSearch();

  // 모든 useState 훅을 컴포넌트 최상단에 선언 (React 훅 규칙)
  const [caseData, setCaseData] = useState<CaseData | null>(propCaseData || null);
  const [isLoadingCase, setIsLoadingCase] = useState(!propCaseData);
  const [caseError, setCaseError] = useState<string | null>(null);

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

  // Case overview state - 빈 값으로 초기화, API 데이터 로드 후 업데이트
  const [isEditingOverview, setIsEditingOverview] = useState(false);
  const [overviewData, setOverviewData] = useState<CaseOverviewData>({
    summary: "",
    facts: "",
    claims: "",
    legalBasis: "",
  });

  // 서브 탭 상태: "analysis" (AI 분석) | "original" (원문 보기)
  const [detailSubTab, setDetailSubTab] = useState<"analysis" | "original">("analysis");

  // 원문 편집 상태
  const [isEditingOriginal, setIsEditingOriginal] = useState(false);
  const [originalDescription, setOriginalDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // 증거 파일 상태 (API에서 가져옴)
  const [allEvidence, setAllEvidence] = useState<EvidenceData[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  // 유사 판례 상태
  const [similarCases, setSimilarCases] = useState<SimilarCaseResult[]>([]);
  const [similarCasesLoading, setSimilarCasesLoading] = useState(false);

  // 관련 법령 상태
  const [relatedLaws, setRelatedLaws] = useState<RelatedLawResult[]>([]);
  const [relatedLawsLoading, setRelatedLawsLoading] = useState(false);

  // 수동 추가 법령 태그 상태
  const [manualLawTags, setManualLawTags] = useState<string[]>([]);
  const [lawTagInput, setLawTagInput] = useState("");

  const [bottomSectionOpen, setBottomSectionOpen] = useState(false);

  // API에서 사건 상세 조회
  useEffect(() => {
    if (propCaseData) return;

    const fetchCase = async () => {
      try {
        const token = localStorage.getItem("access_token");
        if (!token) {
          setCaseError("로그인이 필요합니다.");
          setIsLoadingCase(false);
          return;
        }

        const response = await fetch(`http://localhost:8000/api/v1/cases/${id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            setCaseError("사건을 찾을 수 없습니다.");
            return;
          }
          throw new Error("사건 정보를 불러오는데 실패했습니다.");
        }

        const data: CaseApiResponse = await response.json();

        // API 응답을 CaseData 타입으로 변환
        const mappedCase: CaseData = {
          id: String(data.id),
          name: data.title,
          progress: 0,
          status: data.status || "접수",
          date: data.created_at ? new Date(data.created_at).toLocaleDateString("ko-KR") : "",
          evidenceCount: 0,
          riskLevel: "medium" as const,
          client: data.client_name || "미지정",
          opponent: "상대방",
          caseType: data.case_type || "미분류",
          claimAmount: 0,
          description: data.description || "",
          period: data.incident_date && data.incident_date_end
            ? `${data.incident_date} ~ ${data.incident_date_end}`
            : data.incident_date || "",
        };

        setCaseData(mappedCase);

        // 원문 상태 저장
        setOriginalDescription(data.description || "");

        // 사건 분석 API 호출 (description → summary, facts, claims 추출)
        if (data.description) {
          try {
            const analyzeResponse = await fetch(`http://localhost:8000/api/v1/cases/${id}/analyze`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            if (analyzeResponse.ok) {
              const analyzed = await analyzeResponse.json();
              setOverviewData({
                summary: analyzed.summary || "",
                facts: analyzed.facts || "",
                claims: analyzed.claims || "",
                legalBasis: "",
              });
              // 분석된 summary + facts로 관련 법령 검색
              const searchQuery = `${analyzed.summary} ${analyzed.facts}`;
              if (searchQuery.trim()) {
                fetchRelatedLaws(searchQuery);
              }
            }
          } catch (analyzeErr) {
            console.error("사건 분석 실패:", analyzeErr);
            // 분석 실패 시 description 원본 사용
            setOverviewData(prev => ({
              ...prev,
              summary: data.description || "",
            }));
            fetchRelatedLaws(data.description);
          }
        }
      } catch (err) {
        console.error("사건 상세 조회 실패:", err);
        setCaseError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      } finally {
        setIsLoadingCase(false);
      }
    };

    fetchCase();
  }, [id, propCaseData]);

  // 증거 파일 목록 가져오기
  useEffect(() => {
    if (!caseData?.id) return;

    const fetchEvidences = async () => {
      setEvidenceLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        if (!token) return;

        const response = await fetch(
          `http://localhost:8000/api/v1/evidence/list?case_id=${caseData.id}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (response.ok) {
          const data = await response.json();

          // API 응답을 EvidenceData 형식으로 변환
          const evidenceList: EvidenceData[] = data.files.map((file: any) => ({
            id: String(file.evidence_id),
            name: file.file_name,
            type: file.file_type || '문서',
            status: '제출완료',
            date: file.created_at ? new Date(file.created_at).toISOString().split('T')[0] : '',
            time: file.created_at ? new Date(file.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '',
            category: '증거',
            aiSummary: '',
            images: [],
          }));

          setAllEvidence(evidenceList);

          // 사건 데이터에 증거 개수 업데이트
          if (caseData) {
            setCaseData({
              ...caseData,
              evidenceCount: evidenceList.length
            });
          }
        }
      } catch (error) {
        console.error('증거 파일 조회 실패:', error);
      } finally {
        setEvidenceLoading(false);
      }
    };

    fetchEvidences();
  }, [caseData?.id]);

  // AI 분석 결과 저장 (summary, facts, claims)
  const saveSummary = async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !id) return;

    setIsSaving(true);
    try {
      const response = await fetch(`http://localhost:8000/api/v1/cases/${id}/summary`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          summary: overviewData.summary,
          facts: overviewData.facts,
          claims: overviewData.claims,
        }),
      });

      if (!response.ok) {
        throw new Error("AI 분석 결과 저장 실패");
      }

      console.log("✅ AI 분석 결과 저장 완료");
      // 저장 후 관련 법령 재검색
      fetchRelatedLaws(`${overviewData.summary} ${overviewData.facts}`);
    } catch (err) {
      console.error("AI 분석 결과 저장 실패:", err);
      alert("저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
      setIsEditingOverview(false);
    }
  };

  // AI 분석 새로고침 (강제 재분석)
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshAnalysis = async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !id) return;

    setIsRefreshing(true);
    try {
      const response = await fetch(`http://localhost:8000/api/v1/cases/${id}/analyze?force=true`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("AI 분석 새로고침 실패");
      }

      const analyzed = await response.json();
      setOverviewData({
        summary: analyzed.summary || "",
        facts: analyzed.facts || "",
        claims: analyzed.claims || "",
        legalBasis: "",
      });

      console.log("✅ AI 분석 새로고침 완료");
      // 새로고침 후 관련 법령 재검색
      fetchRelatedLaws(`${analyzed.summary} ${analyzed.facts}`);
    } catch (err) {
      console.error("AI 분석 새로고침 실패:", err);
      alert("AI 분석 새로고침에 실패했습니다.");
    } finally {
      setIsRefreshing(false);
    }
  };

  // 원문(description) 저장
  const saveDescription = async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !id) return;

    setIsSaving(true);
    try {
      const response = await fetch(`http://localhost:8000/api/v1/cases/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          description: originalDescription,
        }),
      });

      if (!response.ok) {
        throw new Error("원문 저장 실패");
      }

      console.log("✅ 원문 저장 완료");
      // caseData도 업데이트
      setCaseData(prev => prev ? { ...prev, description: originalDescription } : null);
    } catch (err) {
      console.error("원문 저장 실패:", err);
      alert("저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
      setIsEditingOriginal(false);
    }
  };

  // 유사 판례 검색 (overviewData 기반)
  const fetchSimilarCases = useCallback(async () => {
    if (!caseData) return;

    // 1. 캐시에 있으면 캐시된 결과 사용
    const cached = getSimilarCases(caseData.id);
    if (cached) {
      setSimilarCases(cached);
      return;
    }

    // 2. 캐시에 없으면 API 호출 (요약 + 사실관계 + 청구내용)
    const query = `${overviewData.summary} ${overviewData.facts} ${overviewData.claims}`;
    if (!query.trim()) return;

    setSimilarCasesLoading(true);
    try {
      const response = await fetch("/api/v1/search/cases/similar", {
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

      // 3. 결과를 캐시에 저장
      cacheSimilarCases(caseData.id, data.results);
    } catch (err) {
      console.error("유사 판례 검색 실패:", err);
      setSimilarCases([]);
    } finally {
      setSimilarCasesLoading(false);
    }
  }, [caseData, overviewData.summary, overviewData.facts, overviewData.claims, getSimilarCases, cacheSimilarCases]);

  // 타임라인 데이터 가져오기
  const fetchTimeline = useCallback(async () => {
    if (!caseData) return;

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
  }, [caseData]);

  // 타임라인 생성 (샘플 데이터)
  const generateTimeline = async () => {
    if (!caseData) return;

    console.log("[Timeline Generate] 시작");
    console.log("[Timeline Generate] Case ID:", caseData.id);
    console.log("[Timeline Generate] Case Data:", caseData);

    setTimelineLoading(true);
    try {
      const url = `http://localhost:8000/api/v1/timeline/${caseData.id}/generate?use_llm=false`;
      console.log("[Timeline Generate] 요청 URL:", url);

      const response = await fetch(url, {
        method: 'POST',
      });

      console.log("[Timeline Generate] Response Status:", response.status);
      console.log("[Timeline Generate] Response OK:", response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Timeline Generate] Error Response:", errorText);
        throw new Error(`타임라인 생성 중 오류가 발생했습니다. Status: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Timeline Generate] 생성된 타임라인 개수:", data.length);
      console.log("[Timeline Generate] 타임라인 데이터:", data);

      setTimelineEvents(data);
    } catch (err) {
      console.error("[Timeline Generate] 실패:", err);
      alert("타임라인 생성에 실패했습니다.");
    } finally {
      setTimelineLoading(false);
    }
  };

  // 컴포넌트 마운트 시 유사 판례 검색 및 타임라인 데이터 가져오기
  useEffect(() => {
    fetchSimilarCases();
    fetchTimeline();
  }, [fetchSimilarCases, fetchTimeline]);
  // 관련 법령 검색 (overviewData 기반)
  const fetchRelatedLaws = async (customQuery?: string) => {
    const query = customQuery ?? `${overviewData.summary} ${overviewData.facts}`;

    if (!query.trim()) return;

    setRelatedLawsLoading(true);
    try {
      const response = await fetch("/api/v1/laws/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query,
          limit: 5,
          score_threshold: 0.3,
        }),
      });

      if (!response.ok) {
        throw new Error("관련 법령 검색 중 오류가 발생했습니다.");
      }

      const data: RelatedLawsResponse = await response.json();
      setRelatedLaws(data.results);
    } catch (err) {
      console.error("관련 법령 검색 실패:", err);
      setRelatedLaws([]);
    } finally {
      setRelatedLawsLoading(false);
    }
  };

  // 컴포넌트 마운트 시 유사 판례 및 관련 법령 검색
  useEffect(() => {
    fetchSimilarCases();
    fetchRelatedLaws();
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

  // 로딩 상태
  if (isLoadingCase) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 에러 상태
  if (caseError || !caseData) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">{caseError || "사건을 찾을 수 없습니다."}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/cases")}
        >
          사건 목록으로
        </Button>
      </div>
    );
  }

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
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">
                  사건 상세 정보
                </CardTitle>
                {/* 서브 탭에 따라 다른 버튼 표시 */}
                {detailSubTab === "analysis" ? (
                  <div className="flex items-center gap-2">
                    {/* AI 분석 새로고침 버튼 */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isRefreshing || isSaving}
                      onClick={refreshAnalysis}
                      title="AI 분석 새로고침"
                    >
                      {isRefreshing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                          <path d="M16 21h5v-5" />
                        </svg>
                      )}
                    </Button>
                    {/* 편집/저장 버튼 */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSaving || isRefreshing}
                      onClick={() => {
                        if (isEditingOverview) {
                          saveSummary();
                        } else {
                          setIsEditingOverview(true);
                        }
                      }}
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : isEditingOverview ? (
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
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => {
                      if (isEditingOriginal) {
                        saveDescription();
                      } else {
                        setIsEditingOriginal(true);
                      }
                    }}
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : isEditingOriginal ? (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        저장
                      </>
                    ) : (
                      <>
                        <Edit2 className="h-4 w-4 mr-2" />
                        원문 수정
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 서브 탭 */}
              <div className="flex gap-1 border-b border-border/60 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setDetailSubTab("analysis");
                    setIsEditingOriginal(false);
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${detailSubTab === "analysis"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                    }`}
                >
                  AI 분석
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDetailSubTab("original");
                    setIsEditingOverview(false);
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${detailSubTab === "original"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                    }`}
                >
                  원문 보기
                </button>
              </div>

              {/* 원문 보기 탭 콘텐츠 */}
              {detailSubTab === "original" && (
                <div className="space-y-4">
                  {isEditingOriginal ? (
                    <Textarea
                      value={originalDescription}
                      onChange={(e) => setOriginalDescription(e.target.value)}
                      rows={12}
                      className="text-sm font-mono"
                      placeholder="사건 내용 원문을 입력하세요..."
                    />
                  ) : (
                    <div className="p-4 bg-secondary/30 rounded-lg border border-border/60">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {originalDescription || "원문이 입력되지 않았습니다."}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* AI 분석 탭 콘텐츠 */}
              {detailSubTab === "analysis" && (
                <>
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
                        <div className="space-y-2">
                          {/* 수동 추가된 태그 표시 */}
                          <div className="flex flex-wrap gap-2">
                            {manualLawTags.map((tag, index) => (
                              <Badge
                                key={`manual-${index}`}
                                variant="secondary"
                                className="font-normal text-xs pr-1"
                              >
                                {tag}
                                <button
                                  type="button"
                                  onClick={() => setManualLawTags(prev => prev.filter((_, i) => i !== index))}
                                  className="ml-1 hover:text-destructive"
                                >
                                  <XCircle className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                          {/* 태그 입력창 */}
                          <Input
                            value={lawTagInput}
                            onChange={(e) => setLawTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && lawTagInput.trim()) {
                                e.preventDefault();
                                setManualLawTags(prev => [...prev, lawTagInput.trim()]);
                                setLawTagInput("");
                              }
                            }}
                            placeholder="법령명 입력 후 Enter (예: 형법 제307조)"
                            className="text-sm"
                          />
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {relatedLawsLoading ? (
                            <span className="text-sm text-muted-foreground">검색 중...</span>
                          ) : (
                            <>
                              {/* 수동 추가 태그 */}
                              {manualLawTags.map((tag, index) => (
                                <Badge
                                  key={`manual-${index}`}
                                  variant="secondary"
                                  className="font-normal text-xs"
                                >
                                  {tag}
                                </Badge>
                              ))}
                              {/* API 검색 결과 태그 */}
                              {relatedLaws.map((law, index) => (
                                <Badge
                                  key={`${law.law_name}-${law.article_number}-${index}`}
                                  variant="outline"
                                  className="font-normal text-xs"
                                >
                                  {law.law_name} 제{law.article_number}조({law.article_title})
                                </Badge>
                              ))}
                              {manualLawTags.length === 0 && relatedLaws.length === 0 && (
                                <span className="text-sm text-muted-foreground">관련 법령이 없습니다.</span>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
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
                      onClick={() => navigate(
                        `/precedents/${encodeURIComponent(caseItem.case_number)}?caseId=${caseData.id}`,
                        { state: { originFacts: overviewData.facts, originClaims: overviewData.claims } }
                      )}
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
                <div className="text-center py-12">
                  <p className="text-muted-foreground text-sm mb-4">타임라인 이벤트가 없습니다.</p>
                  <Button onClick={generateTimeline} variant="outline">
                    샘플 타임라인 생성
                  </Button>
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
              {caseData?.id ? (
                <RelationshipEditor
                  caseId={String(caseData.id)}
                />
              ) : (
                <div className="flex items-center justify-center h-[600px] text-muted-foreground">
                  <div className="text-center">
                    <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin" />
                    <p className="text-sm">사건 정보를 불러오는 중...</p>
                  </div>
                </div>
              )}
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
