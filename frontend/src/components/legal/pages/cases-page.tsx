"use client";

import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, ArrowUpRight, Loader2, Edit, Trash2, X } from "lucide-react";
import { useState, useEffect } from "react";

// API 응답 타입
interface CaseApiResponse {
  id: number;
  title: string;
  client_name: string | null;
  case_type: string | null;
  status: string | null;
  created_at: string | null;
}

// 화면 표시용 타입
interface CaseDisplayItem {
  id: string;
  title: string;
  clientName: string;
  caseType: string;
  status: string;
  createdAt: string;
}

// 사건 유형별 태그 스타일
function caseTypeStyle(type: string): { bg: string; text: string } {
  if (type.includes("민사")) return { bg: "rgba(180,83,9,0.06)", text: "#B45309" };
  if (type.includes("형사")) return { bg: "rgba(67,56,202,0.06)", text: "#4338CA" };
  if (type.includes("가사")) return { bg: "rgba(109,94,245,0.06)", text: "#6D5EF5" };
  if (type.includes("행정")) return { bg: "rgba(37,99,235,0.06)", text: "#2563EB" };
  return { bg: "rgba(100,116,139,0.06)", text: "#64748B" }; // 기타
}

// 상태별 색상 dot
function statusDot(status: string) {
  switch (status) {
    case "완료":
      return "bg-emerald-400";
    case "분석중":
      return "bg-amber-400";
    case "증거수집":
      return "bg-blue-400";
    default:
      return "bg-slate-300";
  }
}

export function CasesPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<CaseDisplayItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedCases, setSelectedCases] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // API에서 사건 목록 조회
  useEffect(() => {
    const fetchCases = async () => {
      try {
        const token = localStorage.getItem("access_token");
        if (!token) {
          setError("로그인이 필요합니다.");
          setIsLoading(false);
          return;
        }

        const response = await fetch("http://localhost:8000/api/v1/cases", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            setError("로그인이 만료되었습니다. 다시 로그인해주세요.");
            return;
          }
          throw new Error("사건 목록을 불러오는데 실패했습니다.");
        }

        const data = await response.json();

        // API 응답을 화면 표시용 타입으로 변환
        const displayCases: CaseDisplayItem[] = data.cases.map(
          (c: CaseApiResponse) => ({
            id: String(c.id),
            title: c.title,
            clientName: c.client_name || "",
            caseType: c.case_type || "",
            status: c.status || "접수",
            createdAt: c.created_at
              ? new Date(c.created_at).toLocaleDateString("ko-KR")
              : "",
          })
        );

        setCases(displayCases);
      } catch (err) {
        console.error("사건 목록 조회 실패:", err);
        setError(
          err instanceof Error ? err.message : "오류가 발생했습니다."
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchCases();
  }, []);

  // 검색 필터링
  const filteredCases = cases.filter(
    (c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.clientName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 편집 모드 토글
  const toggleEditMode = () => {
    setIsEditMode(!isEditMode);
    if (isEditMode) {
      // 편집 모드 종료 시 선택 초기화
      setSelectedCases(new Set());
    }
  };

  // 사건 선택 토글
  const toggleCaseSelection = (caseId: string) => {
    const newSelected = new Set(selectedCases);
    if (newSelected.has(caseId)) {
      newSelected.delete(caseId);
    } else {
      newSelected.add(caseId);
    }
    setSelectedCases(newSelected);
  };

  // 전체 선택/해제
  const toggleSelectAll = () => {
    if (selectedCases.size === filteredCases.length) {
      setSelectedCases(new Set());
    } else {
      setSelectedCases(new Set(filteredCases.map((c) => c.id)));
    }
  };

  // 일괄 삭제
  const handleBulkDelete = async () => {
    if (selectedCases.size === 0) {
      alert("삭제할 사건을 선택해주세요.");
      return;
    }

    const confirmed = confirm(
      `선택한 ${selectedCases.size}개의 사건을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 관련된 모든 데이터가 함께 삭제됩니다.`
    );

    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        alert("로그인이 필요합니다.");
        return;
      }

      // 선택된 사건들을 순차적으로 삭제
      const deletePromises = Array.from(selectedCases).map((caseId) =>
        fetch(`http://localhost:8000/api/v1/cases/${caseId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
      );

      const results = await Promise.all(deletePromises);
      const failedCount = results.filter((r) => !r.ok).length;

      if (failedCount > 0) {
        alert(
          `${selectedCases.size - failedCount}개 삭제 완료, ${failedCount}개 실패`
        );
      } else {
        alert(`${selectedCases.size}개의 사건이 삭제되었습니다.`);
      }

      // 삭제된 사건들을 목록에서 제거
      setCases((prev) =>
        prev.filter((c) => !selectedCases.has(c.id))
      );
      setSelectedCases(new Set());
      setIsEditMode(false);
    } catch (err) {
      console.error("일괄 삭제 실패:", err);
      alert("사건 삭제에 실패했습니다.");
    } finally {
      setIsDeleting(false);
    }
  };

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
        <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-28 w-28" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
      </div>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/")}
        >
          로그인 페이지로
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">사건 목록</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            총 {filteredCases.length}건
            {isEditMode && selectedCases.size > 0 && ` · ${selectedCases.size}개 선택됨`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditMode ? (
            <>
              {selectedCases.size > 0 && (
                <Button
                  onClick={handleBulkDelete}
                  variant="destructive"
                  className="gap-2 h-9 text-sm"
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      삭제 중...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      삭제 ({selectedCases.size})
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={toggleEditMode}
                variant="outline"
                className="gap-2 h-9 text-sm"
                disabled={isDeleting}
              >
                <X className="h-4 w-4" />
                취소
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={toggleEditMode}
                variant="outline"
                className="gap-2 h-9 text-sm"
              >
                <Edit className="h-4 w-4" />
                편집
              </Button>
              <Button onClick={() => navigate("/new-case")} className="gap-2 h-9 text-sm">
                <Plus className="h-4 w-4" />
                새 사건 등록
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <Input
            placeholder="사건명 또는 의뢰인 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-9 text-sm"
          />
        </div>
        {isEditMode && filteredCases.length > 0 && (
          <Button
            onClick={toggleSelectAll}
            variant="outline"
            className="h-9 text-sm"
            disabled={isDeleting}
          >
            {selectedCases.size === filteredCases.length ? "전체 해제" : "전체 선택"}
          </Button>
        )}
      </div>

      {/* Cases Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredCases.map((caseItem) => {
          const isSelected = selectedCases.has(caseItem.id);

          return (
            <Card
              key={caseItem.id}
              className={`border-border/40 cursor-pointer group hover:border-border/70 transition-all duration-200 hover:shadow-md ${
                isEditMode && isSelected ? "ring-2 ring-primary bg-primary/5" : ""
              } ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
              onClick={() => {
                if (isDeleting) return;
                if (isEditMode) {
                  toggleCaseSelection(caseItem.id);
                } else {
                  navigate(`/cases/${caseItem.id}`);
                }
              }}
            >
              <CardContent className="p-5">
                {/* Row 1: 사건 유형 태그 + 화살표/체크박스 */}
                <div className="flex items-center justify-between mb-3">
                  {caseItem.caseType ? (
                    <span
                      className="text-[11px] font-normal px-2.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: caseTypeStyle(caseItem.caseType).bg,
                        color: caseTypeStyle(caseItem.caseType).text,
                      }}
                    >
                      {caseItem.caseType}
                    </span>
                  ) : (
                    <span />
                  )}
                  {isEditMode ? (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleCaseSelection(caseItem.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
                  )}
                </div>

              {/* Row 2: 사건명 (주요 정보) */}
              <h3 className="font-semibold text-[15px] leading-snug line-clamp-2 text-foreground mb-1.5">
                {caseItem.title}
              </h3>

              {/* Row 3: 의뢰인 */}
              {caseItem.clientName && (
                <p className="text-xs text-muted-foreground/60 mb-4">
                  {caseItem.clientName}
                </p>
              )}

              {/* Row 4: 하단 메타 — 상태 + 날짜 */}
              <div className="flex items-center justify-between pt-3 border-t border-border/30">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot(caseItem.status)}`} />
                  <span className="text-xs text-muted-foreground/70">{caseItem.status}</span>
                </div>
                <span className="text-[11px] text-muted-foreground/45">{caseItem.createdAt}</span>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredCases.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground">
            {searchQuery ? "검색 결과가 없습니다." : "등록된 사건이 없습니다."}
          </p>
          {!searchQuery && (
            <Button
              variant="outline"
              className="mt-4 gap-2"
              onClick={() => navigate("/new-case")}
            >
              <Plus className="h-4 w-4" />
              첫 사건 등록하기
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
