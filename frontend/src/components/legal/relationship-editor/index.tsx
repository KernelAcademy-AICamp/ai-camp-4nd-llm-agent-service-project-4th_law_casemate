import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Connection,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { AlertCircle, Users, Plus } from "lucide-react";

import "./styles.css";

import {
  type PersonRole,
  type PersonNode as DomainPerson,
  type RelationshipEdge as DomainEdge,
  type RelationshipEditorProps,
  type RFNode,
  type RFEdge,
  type PersonNodeData,
  type RelationshipEdgeData,
  roleConfig,
  normalizeRole,
} from "./types";
import { PersonNode } from "./PersonNode";
import { RelationshipEdge } from "./RelationshipEdge";
import { useRelationshipCrud } from "./useRelationshipCrud";
import { AddPersonDialog, EditPersonDialog, EditEdgeDialog } from "./dialogs";
import { Toolbar } from "./toolbar";
import { getLayoutedElements } from "./layout";

// ── Custom node/edge type registrations (must be outside component) ──

const nodeTypes = { person: PersonNode };
const edgeTypes = { relationship: RelationshipEdge };

// ── Helper: domain → React Flow ──

function toRFNodes(
  persons: DomainPerson[],
  onEdit: (id: string) => void,
  onDelete: (id: string) => void,
): RFNode[] {
  return persons.map((p) => ({
    id: p.id,
    type: "person" as const,
    position: { x: p.x, y: p.y },
    data: { name: p.name, role: p.role, onEdit, onDelete } satisfies PersonNodeData,
  }));
}

function toRFEdges(
  rels: DomainEdge[],
  onEdit: (id: string) => void,
): RFEdge[] {
  return rels.map((r) => ({
    id: r.id,
    source: r.sourceId,
    target: r.targetId,
    type: "relationship" as const,
    data: { label: r.label, memo: r.memo, directed: r.directed, onEdit } satisfies RelationshipEdgeData,
    markerEnd: r.directed
      ? { type: MarkerType.ArrowClosed, color: "#C4B5FD", width: 20, height: 20 }
      : undefined,
  }));
}

// ── Convert API raw data to domain model ──

function convertData(rawData: { persons: any[]; relationships: any[] }) {
  const convertedNodes: DomainPerson[] = rawData.persons
    .filter((p: any) => p && p.id && p.name && p.role)
    .map((p: any, i: number) => ({
      id: String(p.id),
      name: p.name,
      role: normalizeRole(p.role),
      x: p.position_x ?? (300 + (i % 3) * 200),
      y: p.position_y ?? (200 + Math.floor(i / 3) * 150),
    }));

  const validIds = new Set(convertedNodes.map((n) => n.id));

  const convertedEdges: DomainEdge[] = rawData.relationships
    .filter((r: any) => {
      if (!r || !r.id || !r.source_person_id || !r.target_person_id) return false;
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

  return { persons: convertedNodes, edges: convertedEdges };
}

// ── Outer wrapper: provides ReactFlowProvider ──

export function RelationshipEditor(props: RelationshipEditorProps) {
  return (
    <ReactFlowProvider>
      <RelationshipEditorInner {...props} />
    </ReactFlowProvider>
  );
}

// ── Inner component: all hooks live inside ReactFlowProvider ──

function RelationshipEditorInner({
  caseId,
  data,
  loading: externalLoading = false,
  onRefresh,
}: RelationshipEditorProps) {
  // Domain-level state
  const [domainPersons, setDomainPersons] = useState<DomainPerson[]>([]);
  const [domainEdges, setDomainEdges] = useState<DomainEdge[]>([]);

  const [internalLoading, setInternalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = externalLoading || internalLoading;

  // Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Dialogs
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isEditEdgeOpen, setIsEditEdgeOpen] = useState(false);

  // Form state
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonRole, setNewPersonRole] = useState<PersonRole>("미확인");
  const [editingPerson, setEditingPerson] = useState<DomainPerson | null>(null);
  const [editingEdge, setEditingEdge] = useState<DomainEdge | null>(null);
  const [isNewEdge, setIsNewEdge] = useState(false);

  // CRUD hook
  const crud = useRelationshipCrud(caseId);

  // ── React Flow state (now inside Provider) ──

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);

  // ── Callbacks ──

  const openEditPerson = useCallback((nodeId: string) => {
    setDomainPersons((prev) => {
      const found = prev.find((p) => p.id === nodeId);
      if (found) {
        setEditingPerson({ ...found });
        setIsEditPersonOpen(true);
      }
      return prev;
    });
  }, []);

  const handleDeletePerson = useCallback(
    async (nodeId: string) => {
      if (!confirm("이 인물을 삭제하시겠습니까?")) return;
      try {
        await crud.deletePerson(nodeId);
        setDomainPersons((prev) => prev.filter((p) => p.id !== nodeId));
        setDomainEdges((prev) =>
          prev.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId),
        );
        setNodes((prev) => prev.filter((n) => n.id !== nodeId));
        setEdges((prev) =>
          prev.filter((e) => e.source !== nodeId && e.target !== nodeId),
        );
        setSelectedNodeId(null);
      } catch (err) {
        console.error("[RelationshipEditor] Failed to delete person:", err);
        alert("인물 삭제에 실패했습니다");
      }
    },
    [crud],
  );

  const openEditEdge = useCallback((edgeId: string) => {
    setDomainEdges((prev) => {
      const found = prev.find((e) => e.id === edgeId);
      if (found) {
        setEditingEdge({ ...found });
        setIsNewEdge(false);
        setIsEditEdgeOpen(true);
      }
      return prev;
    });
  }, []);

  // ── Sync domain → RF whenever domain changes ──

  useEffect(() => {
    const rfNodes = toRFNodes(domainPersons, openEditPerson, handleDeletePerson);
    const rfEdges = toRFEdges(domainEdges, openEditEdge);

    // If ALL nodes have default grid positions, apply Dagre auto-layout
    const needsLayout =
      domainPersons.length > 1 &&
      domainPersons.every(
        (p, i) =>
          p.x === 300 + (i % 3) * 200 && p.y === 200 + Math.floor(i / 3) * 150,
      );

    if (needsLayout) {
      const layouted = getLayoutedElements(rfNodes, rfEdges);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
    } else {
      setNodes(rfNodes);
      setEdges(rfEdges);
    }
  }, [domainPersons, domainEdges, openEditPerson, handleDeletePerson, openEditEdge]);

  // ── Load data ──

  useEffect(() => {
    if (data) {
      const { persons, edges: convertedEdges } = convertData(data);
      setDomainPersons(persons);
      setDomainEdges(convertedEdges);
      setError(null);
      return;
    }

    const loadRelationships = async () => {
      try {
        setInternalLoading(true);
        setError(null);
        const response = await apiFetch(
          `/api/v1/relationships/${caseId}`,
        );
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || "관계도를 불러오는데 실패했습니다");
        }
        const rawData = await response.json();
        if (
          !rawData ||
          !Array.isArray(rawData.persons) ||
          !Array.isArray(rawData.relationships)
        ) {
          throw new Error("잘못된 응답 형식입니다");
        }
        const { persons, edges: convertedEdges } = convertData(rawData);
        setDomainPersons(persons);
        setDomainEdges(convertedEdges);
      } catch (err) {
        console.error("[RelationshipEditor] Failed to load:", err);
        setError(
          err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다",
        );
      } finally {
        setInternalLoading(false);
      }
    };

    if (caseId) {
      loadRelationships();
    } else {
      setError("사건 ID가 필요합니다");
    }
  }, [caseId, data]);

  // ── Node drag stop → save position ──

  const handleNodeDragStop = useCallback(
    (_: any, node: RFNode) => {
      const { x, y } = node.position;
      setDomainPersons((prev) =>
        prev.map((p) => (p.id === node.id ? { ...p, x, y } : p)),
      );
      crud.savePosition(node.id, x, y);
    },
    [crud],
  );

  // ── Connect (handle drag → new edge) ──

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      const exists = domainEdges.some(
        (e) =>
          (e.sourceId === connection.source && e.targetId === connection.target) ||
          (e.sourceId === connection.target && e.targetId === connection.source),
      );
      if (exists) return;

      setEditingEdge({
        id: "",
        sourceId: connection.source,
        targetId: connection.target,
        label: "",
        memo: "",
        directed: true,
      });
      setIsNewEdge(true);
      setIsEditEdgeOpen(true);
    },
    [domainEdges],
  );

  // ── Selection ──

  const handleSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      setSelectedNodeId(selNodes.length > 0 ? selNodes[0].id : null);
      setSelectedEdgeId(selEdges.length > 0 ? selEdges[0].id : null);
    },
    [],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  // ── CRUD handlers ──

  const handleAddPerson = useCallback(async () => {
    if (!newPersonName) return;
    try {
      const px = 350 + Math.random() * 60 - 30;
      const py = 200 + Math.random() * 60 - 30;
      const created = await crud.addPerson(newPersonName, newPersonRole, px, py);
      setDomainPersons((prev) => [...prev, created]);
      setNewPersonName("");
      setNewPersonRole("미확인");
      setIsAddPersonOpen(false);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to add person:", err);
      alert("인물 추가에 실패했습니다");
    }
  }, [newPersonName, newPersonRole, crud]);

  const handleUpdatePerson = useCallback(async () => {
    if (!editingPerson) return;
    try {
      await crud.updatePerson(editingPerson.id, editingPerson.name, editingPerson.role);
      setDomainPersons((prev) =>
        prev.map((p) => (p.id === editingPerson.id ? editingPerson : p)),
      );
      setEditingPerson(null);
      setIsEditPersonOpen(false);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to update person:", err);
      alert("인물 수정에 실패했습니다");
    }
  }, [editingPerson, crud]);

  const handleSaveEdge = useCallback(async () => {
    if (!editingEdge || !editingEdge.label) return;
    try {
      if (isNewEdge) {
        const created = await crud.addRelationship(
          editingEdge.sourceId,
          editingEdge.targetId,
          editingEdge.label,
          editingEdge.memo || "",
          editingEdge.directed ?? true,
        );
        setDomainEdges((prev) => [...prev, created]);
      } else {
        await crud.updateRelationship(
          editingEdge.id,
          editingEdge.label,
          editingEdge.memo || "",
          editingEdge.directed ?? true,
        );
        setDomainEdges((prev) =>
          prev.map((e) => (e.id === editingEdge.id ? editingEdge : e)),
        );
      }
      setEditingEdge(null);
      setIsEditEdgeOpen(false);
      setIsNewEdge(false);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to save edge:", err);
      alert("관계 저장에 실패했습니다");
    }
  }, [editingEdge, isNewEdge, crud]);

  const handleDeleteSelectedEdge = useCallback(async () => {
    if (!selectedEdgeId) return;
    if (!confirm("이 관계를 삭제하시겠습니까?")) return;
    try {
      await crud.deleteRelationship(selectedEdgeId);
      setDomainEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
      setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to delete edge:", err);
      alert("관계 삭제에 실패했습니다");
    }
  }, [selectedEdgeId, crud]);

  // ── MiniMap node color ──

  const miniMapNodeColor = useCallback((node: RFNode) => {
    const role = node.data?.role;
    return role ? (roleConfig[role]?.hex ?? "#94A3B8") : "#94A3B8";
  }, []);

  // ── Render ──

  const showEmpty = !loading && !error && domainPersons.length === 0;

  return (
    <div className="flex flex-col h-[600px]">
      <Toolbar
        loading={loading}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        onRefresh={onRefresh}
        onAddPerson={() => setIsAddPersonOpen(true)}
        onEditPerson={() => selectedNodeId && openEditPerson(selectedNodeId)}
        onDeletePerson={() => selectedNodeId && handleDeletePerson(selectedNodeId)}
        onEditEdge={() => selectedEdgeId && openEditEdge(selectedEdgeId)}
        onDeleteEdge={handleDeleteSelectedEdge}
      />

      <div className="flex-1 relative relationship-flow" style={{ minHeight: 0 }}>
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">관계도를 불러오는 중...</p>
              <p className="text-xs mt-1 text-muted-foreground/60">
                AI가 인물 관계를 분석하고 있습니다
              </p>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 text-destructive opacity-50" />
              <p className="text-sm text-destructive">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 bg-transparent"
                onClick={() => window.location.reload()}
              >
                다시 시도
              </Button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-center">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm text-muted-foreground">
                인물을 추가하여 관계도를 구성하세요
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 bg-transparent"
                onClick={() => setIsAddPersonOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                첫 번째 인물 추가
              </Button>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          onConnect={handleConnect}
          onSelectionChange={handleSelectionChange}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2.0}
          defaultEdgeOptions={{ type: "relationship" }}
          connectionLineStyle={{
            stroke: "#6D5EF5",
            strokeWidth: 2,
            strokeDasharray: "5 5",
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#E2E0FF" gap={20} size={1} />
          <MiniMap
            nodeColor={miniMapNodeColor}
            nodeStrokeWidth={3}
            pannable
            zoomable
            style={{ width: 150, height: 100 }}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Dialogs */}
      <AddPersonDialog
        open={isAddPersonOpen}
        onOpenChange={setIsAddPersonOpen}
        name={newPersonName}
        role={newPersonRole}
        onNameChange={setNewPersonName}
        onRoleChange={setNewPersonRole}
        onSubmit={handleAddPerson}
      />

      <EditPersonDialog
        open={isEditPersonOpen}
        onOpenChange={setIsEditPersonOpen}
        person={editingPerson}
        onPersonChange={setEditingPerson}
        onSubmit={handleUpdatePerson}
      />

      <EditEdgeDialog
        open={isEditEdgeOpen}
        onOpenChange={setIsEditEdgeOpen}
        edge={editingEdge}
        isNew={isNewEdge}
        onEdgeChange={setEditingEdge}
        onSubmit={handleSaveEdge}
        onCancel={() => {
          setIsEditEdgeOpen(false);
          setIsNewEdge(false);
          setEditingEdge(null);
        }}
      />
    </div>
  );
}
