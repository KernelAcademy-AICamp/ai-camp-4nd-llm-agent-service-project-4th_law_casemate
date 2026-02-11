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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

interface ExtractedLegalIssues {
  keywords: string[];
  laws: string[];
  search_query: string;
}

interface RelatedLawsResponse {
  total: number;
  results: RelatedLawResult[];
  extracted?: ExtractedLegalIssues;
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
  Clock,
  TrendingUp,
  XCircle,
  User,
  UserX,
  Circle,
  RefreshCw,
} from "lucide-react";
import { RelationshipEditor } from "@/components/legal/relationship-editor";
import { DocumentEditor } from "@/components/legal/document-editor";

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

  // 관계도 상태
  const [relationshipData, setRelationshipData] = useState<{
    persons: any[];
    relationships: any[];
  }>({ persons: [], relationships: [] });
  const [relationshipLoading, setRelationshipLoading] = useState(false);

  const [timelineLayout, setTimelineLayout] = useState<"linear" | "zigzag">("linear");
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

  // 메인 탭 상태
  const [activeTab, setActiveTab] = useState<string>("overview");

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
  const [extractedIssues, setExtractedIssues] = useState<ExtractedLegalIssues | null>(null);

  // 수동 추가 법령 태그 상태
  const [manualLawTags, setManualLawTags] = useState<string[]>([]);
  const [lawTagInput, setLawTagInput] = useState("");

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

              // 백그라운드에서 타임라인과 관계도 자동 생성 - 프론트엔드에서도 자동 로드
              console.log("🔄 타임라인 및 관계도 자동 로드 시작 (초기 분석)");
              // 백그라운드 태스크가 완료될 시간을 주기 위해 약간의 지연 후 fetch
              setTimeout(() => {
                fetchTimeline();
                fetchRelationships();
              }, 2000); // 2초 대기
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
      fetchRelatedLaws();
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

      // 백그라운드에서 타임라인과 관계도 자동 생성 - 프론트엔드에서도 자동 로드
      console.log("🔄 타임라인 및 관계도 자동 로드 시작");
      // 백그라운드 태스크가 완료될 시간을 주기 위해 약간의 지연 후 fetch
      setTimeout(() => {
        fetchTimeline();
        fetchRelationships();
      }, 2000); // 2초 대기
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

  // 관계도 데이터 가져오기
  const fetchRelationships = useCallback(async () => {
    if (!caseData) return;

    setRelationshipLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/api/v1/relationships/${caseData.id}`);
      if (!response.ok) {
        throw new Error("관계도 데이터를 가져오는 중 오류가 발생했습니다.");
      }
      const data = await response.json();
      setRelationshipData(data);
    } catch (err) {
      console.error("관계도 데이터 가져오기 실패:", err);
      setRelationshipData({ persons: [], relationships: [] });
    } finally {
      setRelationshipLoading(false);
    }
  }, [caseData]);

  // 관계도 재생성 (기존 데이터 삭제 후 LLM으로 생성)
  const regenerateRelationships = useCallback(async () => {
    if (!caseData) return;

    console.log("[Relationship Regenerate] 시작 - 기존 데이터 삭제 후 재생성");

    setRelationshipLoading(true);
    try {
      const url = `http://localhost:8000/api/v1/relationships/${caseData.id}/generate?force=true`;
      console.log("[Relationship Regenerate] 요청 URL:", url);

      const response = await fetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Relationship Regenerate] Error Response:", errorText);
        throw new Error(`관계도 재생성 중 오류가 발생했습니다. Status: ${response.status}`);
      }

      const result = await response.json();
      console.log("[Relationship Regenerate] 생성 완료:", result);

      // API 응답 구조가 { message: "...", data: { persons: [...], relationships: [...] } } 형태일 수 있음
      const data = result.data || result;
      setRelationshipData(data);
    } catch (err) {
      console.error("[Relationship Regenerate] 실패:", err);
      alert("관계도 재생성에 실패했습니다.");
    } finally {
      setRelationshipLoading(false);
    }
  }, [caseData]);

  // 사건 삭제
  const handleDeleteCase = useCallback(async () => {
    if (!caseData || !id) return;

    const confirmed = confirm(
      `정말로 "${caseData.name}" 사건을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 관련된 모든 데이터(타임라인, 관계도, 분석 결과 등)가 함께 삭제됩니다.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`http://localhost:8000/api/v1/cases/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('사건 삭제에 실패했습니다.');
      }

      alert('사건이 삭제되었습니다.');
      navigate('/cases');
    } catch (err) {
      console.error('[Case Delete] 실패:', err);
      alert('사건 삭제에 실패했습니다.');
    }
  }, [caseData, id, navigate]);

  // 재분석 필요 여부 확인
  // 타임라인 재생성 (기존 데이터 삭제 후 LLM으로 생성)
  const regenerateTimeline = async () => {
    if (!caseData) return;

    console.log("[Timeline Regenerate] 시작 - 기존 데이터 삭제 후 재생성");

    setTimelineLoading(true);
    try {
      const url = `http://localhost:8000/api/v1/timeline/${caseData.id}/generate?force=true`;
      console.log("[Timeline Regenerate] 요청 URL:", url);

      const response = await fetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Timeline Regenerate] Error Response:", errorText);
        throw new Error(`타임라인 재생성 중 오류가 발생했습니다. Status: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Timeline Regenerate] 생성된 타임라인 개수:", data.length);

      setTimelineEvents(data);
    } catch (err) {
      console.error("[Timeline Regenerate] 실패:", err);
      alert("타임라인 재생성에 실패했습니다.");
    } finally {
      setTimelineLoading(false);
    }
  };

  // 타임라인 생성 (샘플 데이터 - 하위 호환성)
  const generateTimeline = regenerateTimeline;

  // 컴포넌트 마운트 시 유사 판례 검색 (타임라인은 탭 클릭 시에만 로드)
  useEffect(() => {
    fetchSimilarCases();
    // fetchTimeline(); // 타임라인은 탭 클릭 시에만 로드
  }, [fetchSimilarCases]);
  // 관련 법령 검색 (2단계 파이프라인: 법적 쟁점 추출 → 검색)
  const fetchRelatedLaws = async () => {
    if (!id) return;

    setRelatedLawsLoading(true);
    try {
      const response = await fetch(`/api/v1/laws/search-by-case/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 8 }),
      });

      if (!response.ok) {
        throw new Error("관련 법령 검색 중 오류가 발생했습니다.");
      }

      const data: RelatedLawsResponse = await response.json();
      setRelatedLaws(data.results);

      // 추출된 법적 쟁점 저장
      if (data.extracted) {
        setExtractedIssues(data.extracted);
      }
    } catch (err) {
      console.error("관련 법령 검색 실패:", err);
      setRelatedLaws([]);
      setExtractedIssues(null);
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

  // 사실 관계 포맷팅: 배열 또는 문자열 → 불렛 + 날짜 + 말투 변환
  const formatFacts = (facts: string | string[]) => {
    if (!facts) return "";

    // 배열이면 그대로 사용, 문자열이면 줄바꿈으로 분리
    let items: string[] = [];
    if (Array.isArray(facts)) {
      items = facts;
    } else {
      // JSON 배열 문자열인지 확인
      try {
        const parsed = JSON.parse(facts);
        if (Array.isArray(parsed)) {
          items = parsed;
        } else {
          items = facts.split('\n').filter(line => line.trim());
        }
      } catch {
        items = facts.split('\n').filter(line => line.trim());
      }
    }

    // 복합 문장 분리 (1문장 = 1사실)
    const splitCompoundSentence = (sentence: string): string[] => {
      // "~하고,", "~하였고,", "~하며,", "또한," 등으로 분리
      const parts = sentence.split(/(?:,\s*(?:또한|그리고)\s*|(?:하였고|했고|하고|하며|되었고|됐고|되고|되며)[,\s]+)/);
      return parts.map(p => p.trim()).filter(p => p.length > 0);
    };

    // 모든 항목을 분리
    const allItems: string[] = [];
    for (const item of items) {
      const cleaned = String(item).trim().replace(/^[•\-\*\d.]+\s*/, '').trim();
      if (cleaned) {
        const split = splitCompoundSentence(cleaned);
        allItems.push(...split);
      }
    }

    // 각 항목 처리
    return allItems.map(item => {
      let content = item.trim();
      if (!content) return '';

      // 말투 변환: 보고서 말투 (-임, -함, -음)
      content = content
        // -시켰다 계열 → -시킴
        .replace(/시켰습니다\.?$/g, '시킴').replace(/시켰다\.?$/g, '시킴')
        .replace(/시킨다\.?$/g, '시킴').replace(/시켰음\.?$/g, '시킴')
        // -하였다/-했다 계열 → -함
        .replace(/하였습니다\.?$/g, '함').replace(/했습니다\.?$/g, '함')
        .replace(/하였다\.?$/g, '함').replace(/했다\.?$/g, '함')
        .replace(/합니다\.?$/g, '함').replace(/한다\.?$/g, '함')
        .replace(/하였음\.?$/g, '함').replace(/했음\.?$/g, '함')
        // -되었다/-됐다 계열 → -됨
        .replace(/되었습니다\.?$/g, '됨').replace(/됐습니다\.?$/g, '됨')
        .replace(/되었다\.?$/g, '됨').replace(/됐다\.?$/g, '됨')
        .replace(/된다\.?$/g, '됨').replace(/되었음\.?$/g, '됨')
        // -있다 계열 → -있음
        .replace(/있습니다\.?$/g, '있음').replace(/있다\.?$/g, '있음')
        .replace(/있었다\.?$/g, '있었음').replace(/없다\.?$/g, '없음')
        // -이다 계열 → -임
        .replace(/입니다\.?$/g, '임').replace(/이다\.?$/g, '임')
        // 기타 동사 → -ㅁ
        .replace(/났다\.?$/g, '남').replace(/났음\.?$/g, '남')
        .replace(/받았다\.?$/g, '받음').replace(/받다\.?$/g, '받음')
        .replace(/주었다\.?$/g, '줌').replace(/줬다\.?$/g, '줌')
        .replace(/왔다\.?$/g, '옴').replace(/갔다\.?$/g, '감')
        .replace(/냈다\.?$/g, '냄').replace(/썼다\.?$/g, '씀')
        .replace(/봤다\.?$/g, '봄').replace(/알았다\.?$/g, '앎')
        .replace(/모았다\.?$/g, '모음').replace(/샀다\.?$/g, '삼')
        .replace(/팔았다\.?$/g, '팖').replace(/만들었다\.?$/g, '만듦')
        // 마지막 마침표 제거
        .replace(/\.$/g, '');

      // 한글 날짜 → [ YYYY-MM-DD ]
      const koreanDateMatch = content.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일[부터까지]?\s*(.*)/);
      if (koreanDateMatch) {
        const [, year, month, day, rest] = koreanDateMatch;
        return `• [ ${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ] ${rest.trim()}`;
      }

      // [ YYYY-MM-DD ] 형식이 이미 있는 경우
      const bracketDateMatch = content.match(/^\[\s*(\d{4})-(\d{2})-(\d{2})\s*\]\s*[,，]?\s*(.*)/);
      if (bracketDateMatch) {
        const [, year, month, day, rest] = bracketDateMatch;
        return `• [ ${year}-${month}-${day} ] ${rest.replace(/^[,，\s]+/, '').trim()}`;
      }

      // 날짜 없으면 바로 불렛
      return `• ${content}`;
    }).filter(Boolean).join('\n');
  };

  // 청구 내용 포맷팅: 객체 또는 문자열 → • 형사 / • 민사 형태
  const formatClaims = (claims: string | Record<string, string[]>) => {
    if (!claims) return "";

    const categories = ['형사', '민사', '행정', '가정', '가사', '기타'];
    const result: string[] = [];

    // 항목 내 • 분리 및 정리 헬퍼
    const splitAndClean = (item: string): string[] => {
      return String(item)
        .split(/\s*•\s*/)
        .map(s => s.replace(/^[-•*\d.]+\s*/, '').trim())
        .filter(s => s.length > 0);
    };

    // 카테고리별 항목 추가 헬퍼
    const addCategoryItems = (cat: string, items: string[]) => {
      if (!items || items.length === 0) return;
      const allItems: string[] = [];
      for (const item of items) {
        allItems.push(...splitAndClean(item));
      }
      if (allItems.length > 0) {
        result.push(`• ${cat}`);
        for (const cleanItem of allItems) {
          result.push(`  - ${cleanItem}`);
        }
      }
    };

    // 1) 객체 형태 직접 처리
    if (typeof claims === 'object' && claims !== null && !Array.isArray(claims)) {
      for (const cat of categories) {
        const items = (claims as Record<string, string[]>)[cat];
        if (items && Array.isArray(items)) {
          addCategoryItems(cat, items);
        }
      }
      // 정의된 카테고리 외의 키도 처리
      for (const key of Object.keys(claims)) {
        if (!categories.includes(key)) {
          const items = (claims as Record<string, string[]>)[key];
          if (items && Array.isArray(items)) {
            addCategoryItems(key, items);
          }
        }
      }
      if (result.length > 0) return result.join('\n');
    }

    // 2) 문자열인 경우 JSON 파싱 시도
    if (typeof claims === 'string') {
      const claimsStr = claims.trim();

      // JSON 객체 파싱 시도
      if (claimsStr.startsWith('{')) {
        try {
          const parsed = JSON.parse(claimsStr);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            for (const cat of categories) {
              const items = parsed[cat];
              if (items && Array.isArray(items)) {
                addCategoryItems(cat, items);
              }
            }
            // 정의된 카테고리 외의 키도 처리
            for (const key of Object.keys(parsed)) {
              if (!categories.includes(key)) {
                const items = parsed[key];
                if (items && Array.isArray(items)) {
                  addCategoryItems(key, items);
                }
              }
            }
            if (result.length > 0) return result.join('\n');
          }
        } catch {
          // JSON 파싱 실패 - 텍스트로 처리
        }
      }

      // 3) 텍스트 형태 처리 (fallback)
      const cleaned = claimsStr
        .replace(/[{}\[\]"]/g, '')
        .replace(/\n/g, ' ')
        .trim();

      const categorized: Record<string, string[]> = {};
      categories.forEach(c => categorized[c] = []);

      // "형사:" 또는 "민사:" 패턴으로 분리
      const parts = cleaned.split(/(?=형사\s*[:：]|민사\s*[:：]|행정\s*[:：]|가정\s*[:：]|가사\s*[:：]|기타\s*[:：])/);

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const catMatch = categories.find(cat => trimmed.startsWith(cat));
        if (catMatch) {
          const content = trimmed.replace(new RegExp(`^${catMatch}\\s*[:：]?\\s*`), '').trim();
          if (content) {
            // • 또는 , 로 분리
            const items = content.split(/\s*[•,，]\s*/).map(s => s.trim()).filter(Boolean);
            categorized[catMatch].push(...items);
          }
        }
      }

      for (const cat of categories) {
        if (categorized[cat].length > 0) {
          result.push(`• ${cat}`);
          for (const item of categorized[cat]) {
            result.push(`  - ${item.replace(/^[-•*\d.]+\s*/, '').trim()}`);
          }
        }
      }

      return result.join('\n') || cleaned;
    }

    return String(claims);
  };

  const handleSaveEvent = async () => {
    if (!editingEvent || !caseData) return;

    try {
      const response = await fetch(`http://localhost:8000/api/v1/timeline/${editingEvent.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date: editingEvent.date,
          time: editingEvent.time || "00:00",
          title: editingEvent.title,
          description: editingEvent.description || "",
          type: editingEvent.type,
          actor: editingEvent.actor || "",
          firm_id: (caseData as any).law_firm_id || null,
          evidence_id: null,
          order_index: 0,
        }),
      });

      if (!response.ok) {
        throw new Error("타임라인 수정에 실패했습니다.");
      }

      const updatedEvent = await response.json();

      // 로컬 state 업데이트
      setTimelineEvents((prev) =>
        prev.map((e) => (e.id === editingEvent.id ? updatedEvent : e))
      );
      setEditingEvent(null);
      alert("타임라인이 수정되었습니다.");
    } catch (err) {
      console.error("타임라인 수정 실패:", err);
      alert("타임라인 수정에 실패했습니다.");
    }
  };

  const handleAddEvent = async () => {
    if (!newEvent.date || !newEvent.title || !caseData) return;

    try {
      const response = await fetch(`http://localhost:8000/api/v1/timeline/${caseData.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date: newEvent.date,
          time: newEvent.time || "00:00",
          title: newEvent.title,
          description: newEvent.description || "",
          type: (newEvent.type as TimelineEvent["type"]) || "기타",
          actor: newEvent.actor || "",
          firm_id: (caseData as any).law_firm_id || null,
          evidence_id: null,
          order_index: 0,
        }),
      });

      if (!response.ok) {
        throw new Error("타임라인 추가에 실패했습니다.");
      }

      const createdEvent = await response.json();

      // 로컬 state 업데이트 (정렬)
      setTimelineEvents((prev) =>
        [...prev, createdEvent].sort((a, b) => {
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
      alert("타임라인이 추가되었습니다.");
    } catch (err) {
      console.error("타임라인 추가 실패:", err);
      alert("타임라인 추가에 실패했습니다.");
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm("이 타임라인 이벤트를 삭제하시겠습니까?")) return;

    try {
      const response = await fetch(`http://localhost:8000/api/v1/timeline/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("타임라인 삭제에 실패했습니다.");
      }

      // 로컬 state 업데이트
      setTimelineEvents((prev) => prev.filter((e) => e.id !== id));
      alert("타임라인이 삭제되었습니다.");
    } catch (err) {
      console.error("타임라인 삭제 실패:", err);
      alert("타임라인 삭제에 실패했습니다.");
    }
  };

  const getTypeColor = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "의뢰인":
        return "border-[#6D5EF5]/20 bg-[#6D5EF5]/5 text-[#6D5EF5]";
      case "상대방":
        return "border-[#F59E0B]/20 bg-[#F59E0B]/5 text-[#B45309]";
      case "증거":
        return "border-[#38BDF8]/20 bg-[#38BDF8]/5 text-[#0284C7]";
      default:
        return "border-[#94A3B8]/20 bg-[#94A3B8]/5 text-[#64748B]";
    }
  };

  const getTimelineDotColor = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "의뢰인":
        return "bg-gradient-to-br from-[#6D5EF5] to-[#A78BFA]";
      case "상대방":
        return "bg-gradient-to-br from-[#F59E0B] to-[#FBBF24]";
      case "증거":
        return "bg-gradient-to-br from-[#38BDF8] to-[#7DD3FC]";
      default:
        return "bg-gradient-to-br from-[#94A3B8] to-[#CBD5E1]";
    }
  };

  const getTypeIcon = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "의뢰인":
        return <User className="h-4 w-4" />;
      case "상대방":
        return <UserX className="h-4 w-4" />;
      case "증거":
        return <FileText className="h-4 w-4" />;
      default:
        return <Circle className="h-4 w-4" />;
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

  // 타임라인 헬퍼 함수들
  const parseDateParts = (dateStr: string) => {
    const date = new Date(dateStr);
    const dayOfWeekNames = ["일", "월", "화", "수", "목", "금", "토"];
    return {
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      dayOfWeek: dayOfWeekNames[date.getDay()],
    };
  };

  const formatMonthYear = (dateStr: string) => {
    const { year, month } = parseDateParts(dateStr);
    return `${year}년 ${month}월`;
  };

  const isNewMonth = (currentDate: string, previousDate: string | null) => {
    if (!previousDate) return true;
    const current = parseDateParts(currentDate);
    const previous = parseDateParts(previousDate);
    return current.year !== previous.year || current.month !== previous.month;
  };

  const groupEventsByDate = (events: TimelineEvent[]) => {
    const groups: { date: string; events: TimelineEvent[] }[] = [];
    for (const event of events) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.date === event.date) {
        lastGroup.events.push(event);
      } else {
        groups.push({ date: event.date, events: [event] });
      }
    }
    return groups;
  };

  // 로딩 상태
  if (isLoadingCase) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
        <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-28 w-28" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
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
          <div className="flex items-center gap-2">
            <Badge
              variant={caseData.status === "완료" ? "default" : "secondary"}
              className="w-fit text-xs font-normal"
            >
              {caseData.status}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleDeleteCase}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              사건 삭제
            </Button>
          </div>
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
      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value);
        // 타임라인 탭 클릭 시 데이터 로드
        if (value === "timeline" && timelineEvents.length === 0) {
          fetchTimeline();
        }
        // 관계도 탭 클릭 시 데이터 로드
        if (value === "relations" && relationshipData.persons.length === 0) {
          fetchRelationships();
        }
      }} className="w-full">
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
          <TabsTrigger value="documents" className="text-sm">
            문서 작성
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
                      variant="outline"
                      disabled={isRefreshing || isSaving}
                      onClick={refreshAnalysis}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                      새로고침
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
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-[1.8]">
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
                  <div className="space-y-7">
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">사건 요약</Label>
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
                        <div className="text-sm text-muted-foreground leading-[1.8] prose prose-sm max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {overviewData.summary}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">사실 관계</Label>
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
                        <div className="text-sm text-muted-foreground leading-relaxed prose prose-sm max-w-none [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1.5 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:space-y-1.5">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {overviewData.facts?.split('\n')
                              .filter(line => line.trim())
                              .map(line => line.startsWith('-') ? line : `- ${line}`)
                              .join('\n')}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* AI 분석 법적 쟁점 (항상 읽기 전용) */}
                    {extractedIssues?.keywords && extractedIssues.keywords.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-gray-400 italic">AI 분석 법적 쟁점</span>
                        {extractedIssues.keywords.map((keyword, index) => (
                          <Badge
                            key={`keyword-${index}`}
                            variant="default"
                            className="font-normal text-xs bg-primary/10 text-primary"
                          >
                            {keyword}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">청구 내용</Label>
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
                        <div className="text-sm text-muted-foreground leading-relaxed prose prose-sm max-w-none [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1.5 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:space-y-1.5 [&>p]:mb-2">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {(() => {
                              // JSON 형식인지 확인
                              if (overviewData.claims?.startsWith('{') || overviewData.claims?.startsWith('{"')) {
                                try {
                                  const claimsObj = JSON.parse(overviewData.claims);
                                  let markdown = '';
                                  for (const [category, items] of Object.entries(claimsObj)) {
                                    markdown += `**${category}**\n\n`;
                                    if (Array.isArray(items)) {
                                      items.forEach((item: string) => {
                                        markdown += `- ${item}\n`;
                                      });
                                    }
                                    markdown += '\n';
                                  }
                                  return markdown;
                                } catch {
                                  return overviewData.claims;
                                }
                              }
                              return overviewData.claims;
                            })()}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">적용 법률</Label>
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
                            <span className="text-sm text-muted-foreground">관련 법령 검색 중...</span>
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
                        onClick={() => navigate(`/evidence/${evidence.id}?caseId=${id}`)}
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
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-20 w-20 mb-2" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
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
              <div className="flex items-center gap-3">
                {/* Legend */}
                <div className="hidden sm:flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#6D5EF5]/10 text-[#6D5EF5] font-medium">
                    <User className="h-3 w-3" />
                    우리측
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F59E0B]/10 text-[#B45309] font-medium">
                    <UserX className="h-3 w-3" />
                    상대측
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#38BDF8]/10 text-[#0284C7] font-medium">
                    <FileText className="h-3 w-3" />
                    증거
                  </span>
                </div>
                {/* Layout toggle */}
                <div className="flex items-center bg-secondary/50 rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setTimelineLayout("linear")}
                    className={`px-2 py-1 text-xs rounded transition-colors ${timelineLayout === "linear" ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    목록
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimelineLayout("zigzag")}
                    className={`px-2 py-1 text-xs rounded transition-colors ${timelineLayout === "zigzag" ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    지그재그
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={regenerateTimeline}
                  disabled={timelineLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${timelineLoading ? 'animate-spin' : ''}`} />
                  새로고침
                </Button>
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
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-20 w-20 mb-2" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
                  타임라인 데이터 로딩 중...
                </div>
              ) : timelineEvents.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground text-sm mb-4">타임라인 이벤트가 없습니다.</p>
                  <Button onClick={generateTimeline} variant="outline">
                    타임라인 생성
                  </Button>
                </div>
              ) : timelineLayout === "linear" ? (
                /* ===== A. 좌측 날짜 목록형 (max-w 적용) ===== */
                <div className="relative py-4 max-w-2xl mx-auto">
                  {(() => {
                    const dateGroups = groupEventsByDate(timelineEvents);

                    return dateGroups.map((group, groupIdx) => {
                      const prevDate = groupIdx > 0 ? dateGroups[groupIdx - 1].date : null;
                      const showMonthHeader = isNewMonth(group.date, prevDate);
                      const dateParts = parseDateParts(group.date);
                      return (
                        <div key={group.date + groupIdx}>
                          {showMonthHeader && (
                            <div className="flex items-center gap-3 mb-6 mt-2">
                              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[#6D5EF5]/20" />
                              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#6D5EF5]/10 text-[#6D5EF5] text-xs font-semibold">
                                <Calendar className="h-3 w-3" />
                                {formatMonthYear(group.date)}
                              </span>
                              <div className="flex-1 h-px bg-gradient-to-l from-transparent to-[#6D5EF5]/20" />
                            </div>
                          )}

                          {group.events.map((event, eventIdx) => {
                            const isFirstInGroup = eventIdx === 0;
                            const isLastEvent = groupIdx === dateGroups.length - 1 && eventIdx === group.events.length - 1;

                            return (
                              <div key={event.id} className="flex group relative">
                                {/* Date Column */}
                                <div className="w-16 sm:w-20 shrink-0 hidden sm:flex flex-col items-center pt-1">
                                  {isFirstInGroup && (
                                    <>
                                      <span className="text-2xl font-bold text-foreground leading-none">
                                        {dateParts.day}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground mt-0.5">
                                        {dateParts.month}월 {dateParts.dayOfWeek}
                                      </span>
                                    </>
                                  )}
                                </div>

                                {/* Dot + Line */}
                                <div className="w-8 sm:w-10 shrink-0 flex flex-col items-center relative">
                                  {!(groupIdx === 0 && eventIdx === 0) ? (
                                    <div className="w-px flex-1 bg-[#6D5EF5]/15 min-h-[8px]" />
                                  ) : (
                                    <div className="flex-1 min-h-[8px]" />
                                  )}
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getTimelineDotColor(event.type)} text-white ring-[3px] ring-background shadow-sm shrink-0 z-10`}>
                                    {getTypeIcon(event.type)}
                                  </div>
                                  {!isLastEvent ? (
                                    <div className="w-px flex-1 bg-[#6D5EF5]/15 min-h-[8px]" />
                                  ) : (
                                    <div className="flex-1 min-h-[8px]" />
                                  )}
                                </div>

                                {/* Card */}
                                <div className="flex-1 pb-5 pl-3 sm:pl-4">
                                  {/* Mobile date */}
                                  <div className="sm:hidden flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                    <span className="font-semibold text-foreground">{dateParts.month}/{dateParts.day}</span>
                                    <span className="text-muted-foreground/50">{dateParts.dayOfWeek}</span>
                                  </div>

                                  <div className={`px-4 py-3 rounded-xl border shadow-sm hover:shadow-md transition-all duration-200 ${getTypeColor(event.type)}`}>
                                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                      <Badge
                                        variant="outline"
                                        className={`text-[11px] font-medium px-2 py-0 rounded-full border ${event.type === "의뢰인"
                                          ? "border-[#6D5EF5]/30 bg-[#6D5EF5]/10 text-[#6D5EF5]"
                                          : event.type === "상대방"
                                            ? "border-[#F59E0B]/30 bg-[#F59E0B]/10 text-[#B45309]"
                                            : event.type === "증거"
                                              ? "border-[#38BDF8]/30 bg-[#38BDF8]/10 text-[#0284C7]"
                                              : "border-[#94A3B8]/30 bg-[#94A3B8]/10 text-[#64748B]"
                                          }`}
                                      >
                                        {getTypeLabel(event.type)}
                                      </Badge>
                                      {event.time && (
                                        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                          <Clock className="h-3 w-3" />
                                          {event.time}
                                        </span>
                                      )}
                                      {event.actor && (
                                        <span className="text-[11px] text-muted-foreground">· {event.actor}</span>
                                      )}
                                    </div>
                                    <h4 className="text-sm font-semibold text-foreground">
                                      {event.title}
                                    </h4>
                                    {event.description && (
                                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                                        {event.description}
                                      </p>
                                    )}
                                    <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingEvent(event)}>
                                        <Edit2 className="h-3 w-3" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteEvent(event.id)}>
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                /* ===== B. 지그재그 + 큰 날짜 ===== */
                <div className="relative py-8 max-w-3xl mx-auto">
                  {(() => {
                    // 월 헤더를 위해 flat list + 메타 생성
                    const flatEvents: { event: TimelineEvent; showMonth: boolean; showDate: boolean }[] = [];
                    for (let i = 0; i < timelineEvents.length; i++) {
                      const event = timelineEvents[i];
                      const prev = i > 0 ? timelineEvents[i - 1] : null;
                      flatEvents.push({
                        event,
                        showMonth: isNewMonth(event.date, prev?.date || null),
                        showDate: !prev || prev.date !== event.date,
                      });
                    }

                    return flatEvents.map(({ event, showMonth, showDate }, index) => {
                      const isLeft = index % 2 === 0;
                      const dateParts = parseDateParts(event.date);
                      const isFirst = index === 0;
                      const isLast = index === flatEvents.length - 1;

                      return (
                        <div key={event.id}>
                          {/* Month header */}
                          {showMonth && (
                            <div className="flex items-center gap-3 mb-8 mt-4 relative z-10">
                              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[#6D5EF5]/20" />
                              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#6D5EF5]/10 text-[#6D5EF5] text-xs font-semibold">
                                <Calendar className="h-3 w-3" />
                                {formatMonthYear(event.date)}
                              </span>
                              <div className="flex-1 h-px bg-gradient-to-l from-transparent to-[#6D5EF5]/20" />
                            </div>
                          )}

                          <div className={`relative flex items-start mb-10 ${isLeft ? "justify-start" : "justify-end"}`}>
                            {/* Center dot + 세로선 세그먼트 */}
                            <div className="absolute left-1/2 -translate-x-1/2 z-10 flex flex-col items-center">
                              {/* 윗쪽 세로선 (첫 이벤트 제외) */}
                              {!isFirst && (
                                <div className="w-px bg-[#6D5EF5]/15" style={{ height: showMonth ? 52 : 40, marginBottom: -1 }} />
                              )}
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${getTimelineDotColor(event.type)} text-white ring-4 ring-background shadow-md shrink-0`}>
                                {getTypeIcon(event.type)}
                              </div>
                              {/* 아랫쪽 세로선 (마지막 이벤트 제외) */}
                              {!isLast && (
                                <div className="w-px bg-[#6D5EF5]/15 flex-1" style={{ minHeight: 40, marginTop: -1 }} />
                              )}
                            </div>

                            {/* Card area (한쪽에만) */}
                            <div className={`w-[calc(50%-2.5rem)] group ${isLeft ? "pr-2" : "pl-2"}`}>
                              {/* 날짜 — 카드 위에 크게 */}
                              {showDate && (
                                <div className={`flex items-baseline gap-1.5 mb-2 ${isLeft ? "justify-end" : "justify-start"}`}>
                                  <span className="text-xl font-bold text-foreground leading-none tracking-tight">
                                    {dateParts.day}일
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {dateParts.dayOfWeek}
                                  </span>
                                  {event.time && (
                                    <span className="text-xs text-muted-foreground/60 ml-1">
                                      {event.time}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Card */}
                              <div className={`p-4 rounded-xl border shadow-sm hover:shadow-md transition-all duration-200 ${getTypeColor(event.type)} ${isLeft ? "text-right" : "text-left"}`}>
                                <div className={`flex items-center gap-2 mb-1.5 ${isLeft ? "justify-end" : "justify-start"}`}>
                                  <Badge
                                    variant="outline"
                                    className={`text-[11px] font-medium px-2 py-0 rounded-full border ${event.type === "의뢰인"
                                      ? "border-[#6D5EF5]/30 bg-[#6D5EF5]/10 text-[#6D5EF5]"
                                      : event.type === "상대방"
                                        ? "border-[#F59E0B]/30 bg-[#F59E0B]/10 text-[#B45309]"
                                        : event.type === "증거"
                                          ? "border-[#38BDF8]/30 bg-[#38BDF8]/10 text-[#0284C7]"
                                          : "border-[#94A3B8]/30 bg-[#94A3B8]/10 text-[#64748B]"
                                      }`}
                                  >
                                    {getTypeLabel(event.type)}
                                  </Badge>
                                  {event.actor && (
                                    <span className="text-[11px] text-muted-foreground">{event.actor}</span>
                                  )}
                                </div>

                                <h4 className="text-sm font-semibold mb-0.5 text-foreground">
                                  {event.title}
                                </h4>

                                {event.description && (
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    {event.description}
                                  </p>
                                )}

                                <div className={`mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isLeft ? "justify-end" : "justify-start"}`}>
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingEvent(event)}>
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteEvent(event.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
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
                  data={relationshipData}
                  loading={relationshipLoading}
                  onRefresh={regenerateRelationships}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-[600px] text-muted-foreground">
                  <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-20 w-20 mb-3" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
                  <p className="text-sm">사건 정보를 불러오는 중...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 문서 작성 탭 ===== */}
        <TabsContent value="documents" className="mt-8">
          {caseData ? (
            <DocumentEditor caseData={caseData} />
          ) : (
            <div className="flex flex-col items-center justify-center h-[600px] text-muted-foreground">
              <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-20 w-20 mb-3" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
              <p className="text-sm">사건 정보를 불러오는 중...</p>
            </div>
          )}
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
                      <div className="w-2 h-2 rounded-full bg-[#6D5EF5]" />
                      우리측 (의뢰인)
                    </div>
                  </SelectItem>
                  <SelectItem value="상대방">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                      상대측 (피고소인)
                    </div>
                  </SelectItem>
                  <SelectItem value="증거">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#38BDF8]" />
                      증거 발생/확보
                    </div>
                  </SelectItem>
                  <SelectItem value="기타">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#94A3B8]" />
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
                        <div className="w-2 h-2 rounded-full bg-[#6D5EF5]" />
                        우리측 (의뢰인)
                      </div>
                    </SelectItem>
                    <SelectItem value="상대방">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                        상대측 (피고소인)
                      </div>
                    </SelectItem>
                    <SelectItem value="증거">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#38BDF8]" />
                        증거 발생/확보
                      </div>
                    </SelectItem>
                    <SelectItem value="기타">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#94A3B8]" />
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
