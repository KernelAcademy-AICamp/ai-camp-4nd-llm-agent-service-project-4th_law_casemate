"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import mermaid from "mermaid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Plus,
  Trash2,
  User,
  Users,
  AlertCircle,
  Eye,
  Briefcase,
  HelpCircle,
  RefreshCw,
  Pencil,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
export type PersonRole = "피해자" | "가해자" | "증인" | "동료" | "미확인";

export interface PersonNode {
  id: string;
  name: string;
  role: PersonRole;
  x: number;
  y: number;
}

export interface RelationshipEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  memo?: string;
  directed?: boolean;
}

interface RelationshipEditorProps {
  caseId: string;
  data?: { persons: any[]; relationships: any[] };
  loading?: boolean;
  onRefresh?: () => void;
}

// ── Role config ────────────────────────────────────────────────────────────
const ROLE_COLOR: Record<PersonRole, string> = {
  피해자: "#6D5EF5",
  가해자: "#EF4444",
  증인:   "#38BDF8",
  동료:   "#F59E0B",
  미확인: "#94A3B8",
};

const roleConfig: Record<PersonRole, {
  color: string; bgColor: string; borderColor: string;
  iconBg: string; icon: React.ReactNode; mermaidClass: string;
}> = {
  피해자: {
    color: "text-[#6D5EF5]", bgColor: "bg-[#F5F3FF]",
    borderColor: "border-[#6D5EF5]/30",
    iconBg: "bg-gradient-to-br from-[#6D5EF5] to-[#A78BFA]",
    icon: <User className="h-4 w-4 text-white" />,
    mermaidClass: "victim",
  },
  가해자: {
    color: "text-[#EF4444]", bgColor: "bg-[#EF4444]/5",
    borderColor: "border-[#EF4444]/30",
    iconBg: "bg-gradient-to-br from-[#EF4444] to-[#EF4444]/70",
    icon: <AlertCircle className="h-4 w-4 text-white" />,
    mermaidClass: "perpetrator",
  },
  증인: {
    color: "text-[#0284C7]", bgColor: "bg-sky-50",
    borderColor: "border-[#38BDF8]/30",
    iconBg: "bg-gradient-to-br from-[#38BDF8] to-[#7DD3FC]",
    icon: <Eye className="h-4 w-4 text-white" />,
    mermaidClass: "witness",
  },
  동료: {
    color: "text-[#B45309]", bgColor: "bg-amber-50",
    borderColor: "border-[#F59E0B]/30",
    iconBg: "bg-gradient-to-br from-[#F59E0B] to-[#FBBF24]",
    icon: <Briefcase className="h-4 w-4 text-white" />,
    mermaidClass: "colleague",
  },
  미확인: {
    color: "text-[#94A3B8]", bgColor: "bg-slate-50",
    borderColor: "border-[#94A3B8]/30 border-dashed",
    iconBg: "bg-gradient-to-br from-[#94A3B8] to-[#CBD5E1]",
    icon: <HelpCircle className="h-4 w-4 text-white" />,
    mermaidClass: "unknown",
  },
};

// ── Mermaid helpers ────────────────────────────────────────────────────────
let mermaidInitialized = false;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    flowchart: {
      useMaxWidth: false,
      curve: "basis",
      padding: 24,
    },
    themeVariables: {
      fontFamily: "inherit",
      fontSize: "14px",
      edgeLabelBackground: "#ffffff",
    },
  });
  mermaidInitialized = true;
}

function sanitizeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, " ").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
}

/**
 * Mermaid graph LR definition 생성.
 *
 * 핵심 규칙:
 * - 쌍방 관계: A→B 와 B→A 를 각각 별도의 엣지로 렌더링 → Dagre 가 자동 오프셋
 * - 동일 방향 중복: A→B 가 여러 개여도 각 엣지를 별도 라인으로 → Dagre 가 평행선으로 처리
 * - 엣지 라벨: label (+ 메모 앞부분) 으로 각 라인에 표시
 */
function generateMermaidDef(nodes: PersonNode[], edges: RelationshipEdge[]): string {
  if (nodes.length === 0) return "";

  const lines: string[] = ["graph LR"];

  // classDef — 역할별 스타일
  lines.push("  classDef victim      fill:#F5F3FF,stroke:#6D5EF5,color:#4C3DB0,font-weight:bold");
  lines.push("  classDef perpetrator fill:#FEF2F2,stroke:#EF4444,color:#B91C1C,font-weight:bold");
  lines.push("  classDef witness     fill:#F0F9FF,stroke:#38BDF8,color:#0369A1,font-weight:bold");
  lines.push("  classDef colleague   fill:#FFFBEB,stroke:#F59E0B,color:#92400E,font-weight:bold");
  lines.push("  classDef unknown     fill:#F8FAFC,stroke:#94A3B8,color:#64748B,stroke-dasharray:5 5");

  // 노드 정의: 숫자 ID는 'p' 접두어 필요
  for (const node of nodes) {
    const safeId = `p${node.id}`;
    const label = `${sanitizeLabel(node.name)} (${node.role})`;
    lines.push(`  ${safeId}["${label}"]`);
  }

  // 클래스 적용
  for (const node of nodes) {
    lines.push(`  class p${node.id} ${roleConfig[node.role].mermaidClass}`);
  }

  // 엣지 정의 — 각 관계는 반드시 별도 라인
  for (const edge of edges) {
    const sourceId = `p${edge.sourceId}`;
    const targetId = `p${edge.targetId}`;

    const edgeLabel = sanitizeLabel(edge.label || "관계");

    if (edge.directed !== false) {
      // 방향성 있는 관계: 화살표
      // 쌍방 관계(A→B + B→A)는 각각 별도 엣지로 저장되므로
      // Dagre 레이아웃이 자동으로 두 화살표를 평행하게 오프셋 처리함
      lines.push(`  ${sourceId} -->|"${edgeLabel}"| ${targetId}`);
    } else {
      // 방향성 없는 관계: 선만 표시 (화살표 없음)
      lines.push(`  ${sourceId} ---|"${edgeLabel}"| ${targetId}`);
    }
  }

  return lines.join("\n");
}

// ── Mermaid 렌더 컴포넌트 ──────────────────────────────────────────────────
function MermaidDiagram({ definition }: { definition: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!definition) {
      containerRef.current.innerHTML = "";
      return;
    }

    initMermaid();

    // 고유 ID (mermaid 내부에서 DOM id로 사용)
    const id = `mermaid-rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    mermaid
      .render(id, definition)
      .then(({ svg }) => {
        if (!containerRef.current) return;
        containerRef.current.innerHTML = svg;

        // SVG를 부모 컨테이너에 맞게 조정
        const svgEl = containerRef.current.querySelector("svg");
        if (svgEl) {
          svgEl.style.width = "100%";
          svgEl.style.height = "auto";
          svgEl.style.minHeight = "280px";
          svgEl.removeAttribute("width");
          svgEl.removeAttribute("height");
        }
        setRenderError(null);
      })
      .catch((err) => {
        console.error("[MermaidDiagram] render error:", err);
        setRenderError("다이어그램 렌더링 오류");
      });
  }, [definition]);

  if (renderError) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-destructive gap-2 p-4">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {renderError}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full min-h-[280px] p-4 flex justify-center items-start"
    />
  );
}

// ── 역할 선택 아이템 ───────────────────────────────────────────────────────
function RoleItem({ role }: { role: PersonRole }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full" style={{ background: ROLE_COLOR[role] }} />
      {role}
    </div>
  );
}

const ALL_ROLES: PersonRole[] = ["피해자", "가해자", "증인", "동료", "미확인"];

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────
export function RelationshipEditor({
  caseId,
  data,
  loading: externalLoading = false,
  onRefresh,
}: RelationshipEditorProps) {
  const [nodes, setNodes] = useState<PersonNode[]>([]);
  const [edges, setEdges] = useState<RelationshipEdge[]>([]);
  const [internalLoading, setInternalLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = externalLoading || internalLoading;

  // ── 데이터 변환 ──────────────────────────────────────────────────────────
  const convertData = useCallback(
    (raw: { persons: any[]; relationships: any[] }) => {
      const normalizeRole = (role: string): PersonRole => {
        if ((ALL_ROLES as string[]).includes(role)) return role as PersonRole;
        const map: Record<string, PersonRole> = {
          원고: "피해자", 피고: "가해자", 피고소인: "가해자",
          고소인: "피해자", 상사: "동료", 관련자: "미확인",
        };
        return map[role] || "미확인";
      };

      const convertedNodes: PersonNode[] = raw.persons
        .filter((p: any) => p && p.id && p.name && p.role)
        .map((p: any, idx: number) => ({
          id: String(p.id),
          name: p.name,
          role: normalizeRole(p.role),
          x: p.position_x ?? 300 + (idx % 3) * 200,
          y: p.position_y ?? 200 + Math.floor(idx / 3) * 150,
        }));

      const validIds = new Set(convertedNodes.map((n) => n.id));
      const convertedEdges: RelationshipEdge[] = raw.relationships
        .filter((r: any) => {
          if (!r?.id || !r.source_person_id || !r.target_person_id) return false;
          return validIds.has(String(r.source_person_id)) && validIds.has(String(r.target_person_id));
        })
        .map((r: any) => ({
          id: String(r.id),
          sourceId: String(r.source_person_id),
          targetId: String(r.target_person_id),
          label: r.label || r.relationship_type || "관계",
          memo: r.memo || "",
          directed: r.is_directed ?? true,
        }));

      return { nodes: convertedNodes, edges: convertedEdges };
    },
    []
  );

  // ── 데이터 로드 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (data) {
      const { nodes: n, edges: e } = convertData(data);
      setNodes(n);
      setEdges(e);
      setError(null);
      return;
    }

    if (!caseId) {
      setError("사건 ID가 필요합니다");
      return;
    }

    const load = async () => {
      try {
        setInternalLoading(true);
        setError(null);
        const res = await fetch(`http://localhost:8000/api/v1/relationships/${caseId}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "관계도를 불러오는데 실패했습니다");
        }
        const raw = await res.json();
        if (!raw || !Array.isArray(raw.persons) || !Array.isArray(raw.relationships)) {
          throw new Error("잘못된 응답 형식입니다");
        }
        const { nodes: n, edges: e } = convertData(raw);
        setNodes(n);
        setEdges(e);
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다");
      } finally {
        setInternalLoading(false);
      }
    };

    load();
  }, [caseId, data, convertData]);

  // ── Mermaid 정의 ─────────────────────────────────────────────────────────
  const mermaidDef = useMemo(() => generateMermaidDef(nodes, edges), [nodes, edges]);

  // ── 다이얼로그 상태 ──────────────────────────────────────────────────────
  const [isAddPersonOpen, setIsAddPersonOpen]   = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isAddEdgeOpen, setIsAddEdgeOpen]       = useState(false);
  const [isEditEdgeOpen, setIsEditEdgeOpen]     = useState(false);

  // ── 폼 상태 ─────────────────────────────────────────────────────────────
  const [newPerson, setNewPerson] = useState<{ name: string; role: PersonRole }>({
    name: "", role: "미확인",
  });
  const [editingPerson, setEditingPerson] = useState<PersonNode | null>(null);
  const [editingEdge, setEditingEdge]     = useState<RelationshipEdge | null>(null);
  const [newEdgeForm, setNewEdgeForm] = useState({
    sourceId: "", targetId: "", label: "", memo: "", directed: true,
  });

  // ── CRUD: 인물 ──────────────────────────────────────────────────────────
  const handleAddPerson = useCallback(async () => {
    if (!newPerson.name.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `http://localhost:8000/api/v1/relationships/${caseId}/persons`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newPerson.name,
            role: newPerson.role,
            description: "",
            position_x: 300,
            position_y: 200,
          }),
        }
      );
      if (!res.ok) throw new Error();
      const created = await res.json();
      setNodes((prev) => [
        ...prev,
        {
          id: String(created.id),
          name: created.name,
          role: created.role as PersonRole,
          x: created.position_x,
          y: created.position_y,
        },
      ]);
      setNewPerson({ name: "", role: "미확인" });
      setIsAddPersonOpen(false);
    } catch {
      alert("인물 추가에 실패했습니다");
    } finally {
      setIsSaving(false);
    }
  }, [newPerson, caseId]);

  const handleUpdatePerson = useCallback(async () => {
    if (!editingPerson) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `http://localhost:8000/api/v1/relationships/${caseId}/persons/${editingPerson.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editingPerson.name,
            role: editingPerson.role,
            description: "",
          }),
        }
      );
      if (!res.ok) throw new Error();
      setNodes((prev) => prev.map((n) => (n.id === editingPerson.id ? editingPerson : n)));
      setEditingPerson(null);
      setIsEditPersonOpen(false);
    } catch {
      alert("인물 수정에 실패했습니다");
    } finally {
      setIsSaving(false);
    }
  }, [editingPerson, caseId]);

  const handleDeletePerson = useCallback(
    async (nodeId: string) => {
      if (!confirm("이 인물을 삭제하시겠습니까?")) return;
      try {
        const res = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}/persons/${nodeId}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error();
        setNodes((prev) => prev.filter((n) => n.id !== nodeId));
        setEdges((prev) => prev.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId));
      } catch {
        alert("인물 삭제에 실패했습니다");
      }
    },
    [caseId]
  );

  // ── CRUD: 관계 ──────────────────────────────────────────────────────────
  const handleAddEdge = useCallback(async () => {
    const { sourceId, targetId, label, memo, directed } = newEdgeForm;
    if (!sourceId || !targetId || !label.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `http://localhost:8000/api/v1/relationships/${caseId}/relationships`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_person_id: parseInt(sourceId),
            target_person_id: parseInt(targetId),
            relationship_type: label,
            label,
            memo,
            is_directed: directed,
          }),
        }
      );
      if (!res.ok) throw new Error();
      const created = await res.json();
      setEdges((prev) => [
        ...prev,
        {
          id: String(created.id),
          sourceId: String(created.source_person_id),
          targetId: String(created.target_person_id),
          label: created.label,
          memo: created.memo,
          directed: created.is_directed,
        },
      ]);
      setNewEdgeForm({ sourceId: "", targetId: "", label: "", memo: "", directed: true });
      setIsAddEdgeOpen(false);
    } catch {
      alert("관계 추가에 실패했습니다");
    } finally {
      setIsSaving(false);
    }
  }, [newEdgeForm, caseId]);

  const handleUpdateEdge = useCallback(async () => {
    if (!editingEdge) return;

    // 출발/도착 인물이 변경된 경우: 백엔드가 person 변경을 미지원이므로
    // 기존 관계 삭제 → 새 관계 생성으로 처리
    const originalEdge = edges.find((e) => e.id === editingEdge.id);
    const personChanged =
      originalEdge &&
      (originalEdge.sourceId !== editingEdge.sourceId ||
        originalEdge.targetId !== editingEdge.targetId);

    setIsSaving(true);
    try {
      if (personChanged) {
        // 1) 기존 삭제
        const delRes = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}/relationships/${editingEdge.id}`,
          { method: "DELETE" }
        );
        if (!delRes.ok) throw new Error();

        // 2) 새로 생성
        const createRes = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}/relationships`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_person_id: parseInt(editingEdge.sourceId),
              target_person_id: parseInt(editingEdge.targetId),
              relationship_type: editingEdge.label,
              label: editingEdge.label,
              memo: editingEdge.memo,
              is_directed: editingEdge.directed,
            }),
          }
        );
        if (!createRes.ok) throw new Error();
        const created = await createRes.json();

        setEdges((prev) => [
          ...prev.filter((e) => e.id !== editingEdge.id),
          {
            id: String(created.id),
            sourceId: String(created.source_person_id),
            targetId: String(created.target_person_id),
            label: created.label,
            memo: created.memo,
            directed: created.is_directed,
          },
        ]);
      } else {
        // 인물 변경 없음: 일반 PUT
        const res = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}/relationships/${editingEdge.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              relationship_type: editingEdge.label,
              label: editingEdge.label,
              memo: editingEdge.memo,
              is_directed: editingEdge.directed,
            }),
          }
        );
        if (!res.ok) throw new Error();
        setEdges((prev) => prev.map((e) => (e.id === editingEdge.id ? editingEdge : e)));
      }

      setEditingEdge(null);
      setIsEditEdgeOpen(false);
    } catch {
      alert("관계 수정에 실패했습니다");
    } finally {
      setIsSaving(false);
    }
  }, [editingEdge, edges, caseId]);

  const handleDeleteEdge = useCallback(
    async (edgeId: string) => {
      if (!confirm("이 관계를 삭제하시겠습니까?")) return;
      try {
        const res = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}/relationships/${edgeId}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error();
        setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      } catch {
        alert("관계 삭제에 실패했습니다");
      }
    },
    [caseId]
  );

  const openEditPerson = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) { setEditingPerson({ ...node }); setIsEditPersonOpen(true); }
    },
    [nodes]
  );

  const openEditEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) { setEditingEdge({ ...edge }); setIsEditEdgeOpen(true); }
    },
    [edges]
  );

  const getPersonName = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[640px]">

      {/* ─ 툴바 ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-[#FBFBFF] shrink-0">
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              새로고침
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setIsAddPersonOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            인물 추가
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddEdgeOpen(true)}
            disabled={nodes.length < 2}
          >
            <Plus className="h-4 w-4 mr-1" />
            관계 추가
          </Button>
        </div>

        {/* 역할 범례 */}
        <div className="flex items-center gap-1.5 text-xs">
          {ALL_ROLES.map((role) => (
            <span
              key={role}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
              style={{
                background: `${ROLE_COLOR[role]}18`,
                color: ROLE_COLOR[role],
              }}
            >
              {role}
            </span>
          ))}
        </div>
      </div>

      {/* ─ 메인 영역 ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Mermaid 다이어그램 */}
        <div className="flex-1 overflow-auto bg-[#FBFBFF] relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">관계도를 불러오는 중…</p>
                <p className="text-xs mt-1 text-muted-foreground/60">AI가 인물 관계를 분석하고 있습니다</p>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center">
                <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive opacity-50" />
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => window.location.reload()}
                >
                  다시 시도
                </Button>
              </div>
            </div>
          ) : nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">인물을 추가하여 관계도를 구성하세요</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setIsAddPersonOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  첫 번째 인물 추가
                </Button>
              </div>
            </div>
          ) : (
            <MermaidDiagram definition={mermaidDef} />
          )}
        </div>

        {/* ─ 사이드 패널 (인물/관계 목록) ──────────────────────────────── */}
        <div className="w-52 shrink-0 border-l border-border/60 flex flex-col overflow-hidden bg-white">

          {/* 인물 목록 */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="sticky top-0 px-2.5 py-1.5 bg-[#FBFBFF] border-b border-border/40">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                인물 ({nodes.length})
              </p>
            </div>
            <div className="divide-y divide-border/30">
              {nodes.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/40 group"
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: ROLE_COLOR[node.role] }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate leading-tight">{node.name}</p>
                    <p className="text-[10px] truncate" style={{ color: ROLE_COLOR[node.role] }}>
                      {node.role}
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEditPerson(node.id)}
                      className="p-0.5 rounded hover:text-primary"
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" />
                    </button>
                    <button
                      onClick={() => handleDeletePerson(node.id)}
                      className="p-0.5 rounded hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
              {nodes.length === 0 && (
                <p className="text-[11px] text-muted-foreground/60 text-center py-4">
                  인물 없음
                </p>
              )}
            </div>
          </div>

          {/* 관계 목록 */}
          <div className="flex-1 overflow-y-auto min-h-0 border-t border-border/40">
            <div className="sticky top-0 px-2.5 py-1.5 bg-[#FBFBFF] border-b border-border/40">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                관계 ({edges.length})
              </p>
            </div>
            <div className="divide-y divide-border/30">
              {edges.map((edge) => (
                <div
                  key={edge.id}
                  className="px-2.5 py-1.5 hover:bg-muted/40 group"
                >
                  <div className="flex items-start gap-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground truncate">
                        {getPersonName(edge.sourceId)}{" "}
                        <span className="font-mono">
                          {edge.directed !== false ? "→" : "↔"}
                        </span>{" "}
                        {getPersonName(edge.targetId)}
                      </p>
                      <p className="text-xs font-semibold text-foreground truncate leading-tight">
                        {edge.label}
                      </p>
                      {edge.memo && (
                        <p className="text-[10px] text-muted-foreground line-clamp-3">{edge.memo}</p>
                      )}
                    </div>
                    <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEditEdge(edge.id)}
                        className="p-0.5 rounded"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" />
                      </button>
                      <button
                        onClick={() => handleDeleteEdge(edge.id)}
                        className="p-0.5 rounded"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {edges.length === 0 && (
                <p className="text-[11px] text-muted-foreground/60 text-center py-4">
                  관계 없음
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─ 다이얼로그 모음 ───────────────────────────────────────────────── */}

      {/* 인물 추가 */}
      <Dialog open={isAddPersonOpen} onOpenChange={setIsAddPersonOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>새 인물 추가</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>이름</Label>
              <Input
                value={newPerson.name}
                onChange={(e) => setNewPerson((p) => ({ ...p, name: e.target.value }))}
                placeholder="예: 홍OO, 미확인 관리자"
              />
            </div>
            <div className="space-y-2">
              <Label>역할</Label>
              <Select
                value={newPerson.role}
                onValueChange={(v) => setNewPerson((p) => ({ ...p, role: v as PersonRole }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}><RoleItem role={r} /></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddPersonOpen(false)} disabled={isSaving}>취소</Button>
            <Button onClick={handleAddPerson} disabled={!newPerson.name.trim() || isSaving}>
              {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />저장 중…</> : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 인물 편집 */}
      <Dialog open={isEditPersonOpen} onOpenChange={setIsEditPersonOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>인물 정보 편집</DialogTitle></DialogHeader>
          {editingPerson && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>이름</Label>
                <Input
                  value={editingPerson.name}
                  onChange={(e) =>
                    setEditingPerson((p) => p ? { ...p, name: e.target.value } : null)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>역할</Label>
                <Select
                  value={editingPerson.role}
                  onValueChange={(v) =>
                    setEditingPerson((p) => p ? { ...p, role: v as PersonRole } : null)
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r}><RoleItem role={r} /></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditPersonOpen(false)} disabled={isSaving}>취소</Button>
            <Button onClick={handleUpdatePerson} disabled={isSaving}>
              {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />저장 중…</> : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 관계 추가 */}
      <Dialog open={isAddEdgeOpen} onOpenChange={setIsAddEdgeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>새 관계 추가</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>출발 인물</Label>
                <Select
                  value={newEdgeForm.sourceId}
                  onValueChange={(v) => setNewEdgeForm((f) => ({ ...f, sourceId: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {nodes.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: ROLE_COLOR[n.role] }}
                          />
                          {n.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>도착 인물</Label>
                <Select
                  value={newEdgeForm.targetId}
                  onValueChange={(v) => setNewEdgeForm((f) => ({ ...f, targetId: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {nodes
                      .filter((n) => n.id !== newEdgeForm.sourceId)
                      .map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          <span className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: ROLE_COLOR[n.role] }}
                            />
                            {n.name}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>관계 유형</Label>
              <Input
                value={newEdgeForm.label}
                onChange={(e) => setNewEdgeForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="예: 상사, 동료, 목격, 폭행, 협박"
              />
            </div>
            <div className="space-y-2">
              <Label>메모 <span className="text-muted-foreground font-normal">(선택)</span></Label>
              <Textarea
                value={newEdgeForm.memo}
                onChange={(e) => setNewEdgeForm((f) => ({ ...f, memo: e.target.value }))}
                placeholder="관계에 대한 추가 설명"
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="new-directed"
                checked={newEdgeForm.directed}
                onChange={(e) => setNewEdgeForm((f) => ({ ...f, directed: e.target.checked }))}
                className="rounded border-border"
              />
              <Label htmlFor="new-directed" className="text-sm font-normal cursor-pointer">
                방향성 있는 관계 (화살표 →)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddEdgeOpen(false)} disabled={isSaving}>취소</Button>
            <Button
              onClick={handleAddEdge}
              disabled={!newEdgeForm.sourceId || !newEdgeForm.targetId || !newEdgeForm.label.trim() || isSaving}
            >
              {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />저장 중…</> : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 관계 편집 */}
      <Dialog open={isEditEdgeOpen} onOpenChange={setIsEditEdgeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>관계 편집</DialogTitle></DialogHeader>
          {editingEdge && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>출발 인물</Label>
                  <Select
                    value={editingEdge.sourceId}
                    onValueChange={(v) =>
                      setEditingEdge((p) => p ? { ...p, sourceId: v } : null)
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {nodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          <span className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: ROLE_COLOR[n.role] }}
                            />
                            {n.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>도착 인물</Label>
                  <Select
                    value={editingEdge.targetId}
                    onValueChange={(v) =>
                      setEditingEdge((p) => p ? { ...p, targetId: v } : null)
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {nodes
                        .filter((n) => n.id !== editingEdge.sourceId)
                        .map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            <span className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ background: ROLE_COLOR[n.role] }}
                              />
                              {n.name}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>관계 유형</Label>
                <Input
                  value={editingEdge.label}
                  onChange={(e) =>
                    setEditingEdge((p) => p ? { ...p, label: e.target.value } : null)
                  }
                  placeholder="예: 상사, 동료, 목격, 폭행"
                />
              </div>
              <div className="space-y-2">
                <Label>메모 <span className="text-muted-foreground font-normal">(선택)</span></Label>
                <Textarea
                  value={editingEdge.memo || ""}
                  onChange={(e) =>
                    setEditingEdge((p) => p ? { ...p, memo: e.target.value } : null)
                  }
                  placeholder="관계에 대한 추가 설명"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="edit-directed"
                  checked={editingEdge.directed !== false}
                  onChange={(e) =>
                    setEditingEdge((p) => p ? { ...p, directed: e.target.checked } : null)
                  }
                  className="rounded border-border"
                />
                <Label htmlFor="edit-directed" className="text-sm font-normal cursor-pointer">
                  방향성 있는 관계 (화살표 →)
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditEdgeOpen(false)} disabled={isSaving}>취소</Button>
            <Button onClick={handleUpdateEdge} disabled={isSaving}>
              {isSaving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />저장 중…</> : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
