"use client";

import React from "react"

import { useState, useRef, useCallback, useEffect } from "react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Plus,
  Trash2,
  User,
  UserX,
  Users,
  AlertCircle,
  Eye,
  Briefcase,
  HelpCircle,
  GripVertical,
} from "lucide-react";

// Types
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
}

const roleConfig: Record<
  PersonRole,
  { color: string; bgColor: string; borderColor: string; icon: React.ReactNode }
> = {
  피해자: {
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-500",
    icon: <User className="h-5 w-5" />,
  },
  가해자: {
    color: "text-red-700",
    bgColor: "bg-red-50",
    borderColor: "border-red-500",
    icon: <AlertCircle className="h-5 w-5" />,
  },
  증인: {
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-500",
    icon: <Eye className="h-5 w-5" />,
  },
  동료: {
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-500",
    icon: <Briefcase className="h-5 w-5" />,
  },
  미확인: {
    color: "text-gray-600",
    bgColor: "bg-gray-100",
    borderColor: "border-gray-400 border-dashed",
    icon: <HelpCircle className="h-5 w-5" />,
  },
};

export function RelationshipEditor({
  caseId,
}: RelationshipEditorProps) {
  // State
  const [nodes, setNodes] = useState<PersonNode[]>([]);
  const [edges, setEdges] = useState<RelationshipEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load relationship data from API
  useEffect(() => {
    const loadRelationships = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log("[RelationshipEditor] Loading relationships for caseId:", caseId);

        const response = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}`
        );

        console.log("[RelationshipEditor] Response status:", response.status);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || "관계도를 불러오는데 실패했습니다");
        }

        const data = await response.json();
        console.log("[RelationshipEditor] Received data:", data);

        // Validate response data
        if (!data || !Array.isArray(data.persons) || !Array.isArray(data.relationships)) {
          throw new Error("잘못된 응답 형식입니다");
        }

        // Valid role mapping
        const validRoles: PersonRole[] = ["피해자", "가해자", "증인", "동료", "미확인"];
        const normalizeRole = (role: string): PersonRole => {
          if (validRoles.includes(role as PersonRole)) {
            return role as PersonRole;
          }
          // Map common alternative roles
          const roleMap: Record<string, PersonRole> = {
            "원고": "피해자",
            "피고": "가해자",
            "피고소인": "가해자",
            "상사": "동료",
            "관련자": "미확인",
          };
          return roleMap[role] || "미확인";
        };

        // Convert backend format to frontend format with validation
        const convertedNodes: PersonNode[] = data.persons
          .filter((person: any) => person && person.id && person.name && person.role)
          .map((person: any, index: number) => ({
            id: String(person.id),
            name: person.name,
            role: normalizeRole(person.role),
            x: person.position_x ?? (300 + (index % 3) * 200),
            y: person.position_y ?? (200 + Math.floor(index / 3) * 150),
          }));

        // Create a set of valid person IDs
        const validPersonIds = new Set(convertedNodes.map(node => node.id));

        const convertedEdges: RelationshipEdge[] = data.relationships
          .filter((rel: any) => {
            if (!rel || !rel.id || !rel.source_person_id || !rel.target_person_id) {
              console.warn("[RelationshipEditor] Invalid relationship:", rel);
              return false;
            }
            // Check if source and target persons exist
            const sourceId = String(rel.source_person_id);
            const targetId = String(rel.target_person_id);
            if (!validPersonIds.has(sourceId) || !validPersonIds.has(targetId)) {
              console.warn("[RelationshipEditor] Relationship references non-existent person:", rel);
              return false;
            }
            return true;
          })
          .map((rel: any) => ({
            id: String(rel.id),
            sourceId: String(rel.source_person_id),
            targetId: String(rel.target_person_id),
            label: rel.label || rel.relationship_type || "관계",
            memo: rel.memo || "",
            directed: rel.is_directed ?? true,
          }));

        console.log("[RelationshipEditor] Converted nodes:", convertedNodes.length);
        console.log("[RelationshipEditor] Converted edges:", convertedEdges.length);

        setNodes(convertedNodes);
        setEdges(convertedEdges);
      } catch (err) {
        console.error("[RelationshipEditor] Failed to load relationships:", err);
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다");
      } finally {
        setLoading(false);
      }
    };

    if (caseId) {
      loadRelationships();
    } else {
      console.warn("[RelationshipEditor] No caseId provided");
      setLoading(false);
      setError("사건 ID가 필요합니다");
    }
  }, [caseId]);

  // State for interactions
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connecting, setConnecting] = useState<{
    sourceId: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Dialog states
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isEditEdgeOpen, setIsEditEdgeOpen] = useState(false);

  // Form states
  const [newPerson, setNewPerson] = useState<Partial<PersonNode>>({
    name: "",
    role: "미확인",
  });
  const [editingPerson, setEditingPerson] = useState<PersonNode | null>(null);
  const [editingEdge, setEditingEdge] = useState<RelationshipEdge | null>(null);
  const [newEdgeData, setNewEdgeData] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Get node position for edge drawing
  const getNodeCenter = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return { x: 0, y: 0 };
      return { x: node.x + 60, y: node.y + 40 }; // Center of node (120x80)
    },
    [nodes]
  );

  // Handle mouse move for dragging and connecting
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (draggingNode) {
        setNodes((prev) =>
          prev.map((node) =>
            node.id === draggingNode
              ? {
                  ...node,
                  x: Math.max(0, Math.min(x - dragOffset.x, rect.width - 120)),
                  y: Math.max(0, Math.min(y - dragOffset.y, rect.height - 80)),
                }
              : node
          )
        );
      }

      if (connecting) {
        setConnecting((prev) => (prev ? { ...prev, mouseX: x, mouseY: y } : null));
      }
    },
    [draggingNode, dragOffset, connecting]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    async (e: React.MouseEvent) => {
      if (connecting && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if mouse is over a node
        const targetNode = nodes.find(
          (node) =>
            node.id !== connecting.sourceId &&
            x >= node.x &&
            x <= node.x + 120 &&
            y >= node.y &&
            y <= node.y + 80
        );

        if (targetNode) {
          // Check if edge already exists
          const existingEdge = edges.find(
            (e) =>
              (e.sourceId === connecting.sourceId &&
                e.targetId === targetNode.id) ||
              (e.sourceId === targetNode.id &&
                e.targetId === connecting.sourceId)
          );

          if (!existingEdge) {
            setNewEdgeData({
              sourceId: connecting.sourceId,
              targetId: targetNode.id,
            });
            setEditingEdge({
              id: "",
              sourceId: connecting.sourceId,
              targetId: targetNode.id,
              label: "",
              memo: "",
              directed: true,
            });
            setIsEditEdgeOpen(true);
          }
        }
      }

      // Save node position to DB after dragging
      if (draggingNode) {
        const draggedNode = nodes.find((n) => n.id === draggingNode);
        if (draggedNode) {
          try {
            const response = await fetch(
              `http://localhost:8000/api/v1/relationships/${caseId}/persons/${draggingNode}/position?position_x=${Math.round(draggedNode.x)}&position_y=${Math.round(draggedNode.y)}`,
              { method: "PATCH" }
            );
            if (!response.ok) {
              console.error("[RelationshipEditor] Failed to save position");
            } else {
              console.log(`[RelationshipEditor] Position saved: ${draggedNode.name} (${Math.round(draggedNode.x)}, ${Math.round(draggedNode.y)})`);
            }
          } catch (err) {
            console.error("[RelationshipEditor] Error saving position:", err);
          }
        }
      }

      setDraggingNode(null);
      setConnecting(null);
    },
    [connecting, nodes, edges, draggingNode, caseId]
  );

  // Start dragging node
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return; // Only left click
      e.stopPropagation();

      const node = nodes.find((n) => n.id === nodeId);
      if (!node || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - node.x,
        y: e.clientY - rect.top - node.y,
      });
      setDraggingNode(nodeId);
      setSelectedNode(nodeId);
      setSelectedEdge(null);
    },
    [nodes]
  );

  // Start connecting from node
  const handleConnectStart = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const nodeCenter = getNodeCenter(nodeId);
      setConnecting({
        sourceId: nodeId,
        mouseX: e.clientX - rect.left,
        mouseY: e.clientY - rect.top,
      });
    },
    [getNodeCenter]
  );

  // Add new person
  const handleAddPerson = useCallback(() => {
    if (!newPerson.name) return;

    const id = Date.now().toString();
    const newNode: PersonNode = {
      id,
      name: newPerson.name,
      role: (newPerson.role as PersonRole) || "미확인",
      x: 350 + Math.random() * 100 - 50,
      y: 200 + Math.random() * 100 - 50,
    };

    setNodes((prev) => [...prev, newNode]);
    setNewPerson({ name: "", role: "미확인" });
    setIsAddPersonOpen(false);
  }, [newPerson]);

  // Update person
  const handleUpdatePerson = useCallback(() => {
    if (!editingPerson) return;

    setNodes((prev) =>
      prev.map((node) => (node.id === editingPerson.id ? editingPerson : node))
    );
    setEditingPerson(null);
    setIsEditPersonOpen(false);
  }, [editingPerson]);

  // Delete person
  const handleDeletePerson = useCallback((nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) =>
      prev.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId)
    );
    setSelectedNode(null);
  }, []);

  // Add or update edge
  const handleSaveEdge = useCallback(() => {
    if (!editingEdge || !editingEdge.label) return;

    if (newEdgeData) {
      // New edge
      const newEdge: RelationshipEdge = {
        id: Date.now().toString(),
        sourceId: newEdgeData.sourceId,
        targetId: newEdgeData.targetId,
        label: editingEdge.label,
        memo: editingEdge.memo,
        directed: editingEdge.directed,
      };
      setEdges((prev) => [...prev, newEdge]);
      setNewEdgeData(null);
    } else {
      // Update existing
      setEdges((prev) =>
        prev.map((e) => (e.id === editingEdge.id ? editingEdge : e))
      );
    }

    setEditingEdge(null);
    setIsEditEdgeOpen(false);
  }, [editingEdge, newEdgeData]);

  // Delete edge
  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    setSelectedEdge(null);
  }, []);

  // Open edit person dialog
  const openEditPerson = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setEditingPerson({ ...node });
        setIsEditPersonOpen(true);
      }
    },
    [nodes]
  );

  // Open edit edge dialog
  const openEditEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) {
        setEditingEdge({ ...edge });
        setIsEditEdgeOpen(true);
      }
    },
    [edges]
  );

  // Handle edge click
  const handleEdgeClick = useCallback((e: React.MouseEvent, edgeId: string) => {
    e.stopPropagation();
    setSelectedEdge(edgeId);
    setSelectedNode(null);
  }, []);

  // Clear selection on canvas click
  const handleCanvasClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  // Draw edge path
  const getEdgePath = useCallback(
    (edge: RelationshipEdge) => {
      const source = getNodeCenter(edge.sourceId);
      const target = getNodeCenter(edge.targetId);

      // Calculate control point for curved line
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const offset = Math.min(30, Math.sqrt(dx * dx + dy * dy) * 0.2);

      // Perpendicular offset for curve
      const len = Math.sqrt(dx * dx + dy * dy);
      const perpX = -dy / len;
      const perpY = dx / len;

      const ctrlX = midX + perpX * offset;
      const ctrlY = midY + perpY * offset;

      return { source, target, ctrl: { x: ctrlX, y: ctrlY }, mid: { x: midX, y: midY } };
    },
    [getNodeCenter]
  );

  return (
    <div className="flex flex-col h-[600px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-border/60 bg-secondary/20">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddPersonOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            인물 추가
          </Button>
          {selectedNode && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditPerson(selectedNode)}
              >
                인물 편집
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive bg-transparent"
                onClick={() => handleDeletePerson(selectedNode)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
          {selectedEdge && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditEdge(selectedEdge)}
              >
                관계 편집
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive bg-transparent"
                onClick={() => handleDeleteEdge(selectedEdge)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span>피해자</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span>가해자</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span>증인</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span>동료</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border border-dashed border-gray-400 bg-gray-100" />
            <span>미확인</span>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] bg-[size:20px_20px] overflow-hidden cursor-default select-none"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
      >
        {/* SVG for edges */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
            </marker>
            <marker
              id="arrowhead-selected"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((edge) => {
            const path = getEdgePath(edge);
            const isSelected = selectedEdge === edge.id;

            return (
              <g key={edge.id}>
                {/* Clickable area (wider, invisible) */}
                <path
                  d={`M ${path.source.x} ${path.source.y} Q ${path.ctrl.x} ${path.ctrl.y} ${path.target.x} ${path.target.y}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="20"
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => handleEdgeClick(e, edge.id)}
                  onDoubleClick={() => openEditEdge(edge.id)}
                />
                {/* Visible edge */}
                <path
                  d={`M ${path.source.x} ${path.source.y} Q ${path.ctrl.x} ${path.ctrl.y} ${path.target.x} ${path.target.y}`}
                  fill="none"
                  stroke={isSelected ? "#3b82f6" : "#94a3b8"}
                  strokeWidth={isSelected ? 3 : 2}
                  markerEnd={
                    edge.directed
                      ? isSelected
                        ? "url(#arrowhead-selected)"
                        : "url(#arrowhead)"
                      : undefined
                  }
                />
                {/* Edge label */}
                <text
                  x={path.ctrl.x}
                  y={path.ctrl.y - 8}
                  textAnchor="middle"
                  className={`text-xs fill-current pointer-events-none ${isSelected ? "text-blue-600 font-medium" : "text-muted-foreground"}`}
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {/* Connecting line */}
          {connecting && (
            <line
              x1={getNodeCenter(connecting.sourceId).x}
              y1={getNodeCenter(connecting.sourceId).y}
              x2={connecting.mouseX}
              y2={connecting.mouseY}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="5,5"
            />
          )}
        </svg>

        {/* Person nodes */}
        {nodes.map((node) => {
          const config = roleConfig[node.role];
          const isSelected = selectedNode === node.id;

          return (
            <ContextMenu key={node.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={`absolute w-[120px] rounded-lg border-2 transition-shadow ${config.bgColor} ${config.borderColor} ${isSelected ? "shadow-lg ring-2 ring-blue-500" : "shadow-sm hover:shadow-md"} ${draggingNode === node.id ? "cursor-grabbing" : "cursor-grab"}`}
                  style={{ left: node.x, top: node.y }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onDoubleClick={() => openEditPerson(node.id)}
                >
                  {/* Connect handle */}
                  <div
                    className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow cursor-crosshair hover:scale-125 transition-transform"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      handleConnectStart(e, node.id);
                    }}
                  />

                  {/* Node content */}
                  <div className="p-3 text-center">
                    <div
                      className={`w-10 h-10 rounded-full ${config.bgColor} border ${config.borderColor} flex items-center justify-center mx-auto mb-2 ${config.color}`}
                    >
                      {config.icon}
                    </div>
                    <p className="text-sm font-medium truncate">{node.name}</p>
                    <p className={`text-xs ${config.color}`}>{node.role}</p>
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => openEditPerson(node.id)}>
                  인물 정보 편집
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive"
                  onClick={() => handleDeletePerson(node.id)}
                >
                  인물 삭제
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}

        {/* Loading state */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/80">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-3" />
              <p className="text-sm">관계도를 불러오는 중...</p>
              <p className="text-xs mt-1 text-muted-foreground/60">AI가 인물 관계를 분석하고 있습니다</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
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

        {/* Empty state hint */}
        {!loading && !error && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">인물을 추가하여 관계도를 구성하세요</p>
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
      </div>

      {/* Help text */}
      <div className="p-2 border-t border-border/60 bg-secondary/20 text-xs text-muted-foreground flex items-center justify-center gap-6">
        <span>드래그: 인물 이동</span>
        <span>파란 점 드래그: 관계 연결</span>
        <span>더블클릭: 편집</span>
        <span>우클릭: 메뉴</span>
      </div>

      {/* Add Person Dialog */}
      <Dialog open={isAddPersonOpen} onOpenChange={setIsAddPersonOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>새 인물 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>이름</Label>
              <Input
                value={newPerson.name || ""}
                onChange={(e) =>
                  setNewPerson((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="예: 홍OO, 미확인 관리자"
              />
            </div>
            <div className="space-y-2">
              <Label>역할</Label>
              <Select
                value={newPerson.role || "미확인"}
                onValueChange={(value) =>
                  setNewPerson((prev) => ({ ...prev, role: value as PersonRole }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="피해자">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      피해자
                    </div>
                  </SelectItem>
                  <SelectItem value="가해자">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      가해자
                    </div>
                  </SelectItem>
                  <SelectItem value="증인">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      증인
                    </div>
                  </SelectItem>
                  <SelectItem value="동료">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      동료
                    </div>
                  </SelectItem>
                  <SelectItem value="미확인">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded border border-dashed border-gray-400 bg-gray-100" />
                      미확인
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddPersonOpen(false)}>
              취소
            </Button>
            <Button onClick={handleAddPerson}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Person Dialog */}
      <Dialog open={isEditPersonOpen} onOpenChange={setIsEditPersonOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>인물 정보 편집</DialogTitle>
          </DialogHeader>
          {editingPerson && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>이름</Label>
                <Input
                  value={editingPerson.name}
                  onChange={(e) =>
                    setEditingPerson((prev) =>
                      prev ? { ...prev, name: e.target.value } : null
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>역할</Label>
                <Select
                  value={editingPerson.role}
                  onValueChange={(value) =>
                    setEditingPerson((prev) =>
                      prev ? { ...prev, role: value as PersonRole } : null
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="피해자">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        피해자
                      </div>
                    </SelectItem>
                    <SelectItem value="가해자">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        가해자
                      </div>
                    </SelectItem>
                    <SelectItem value="증인">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        증인
                      </div>
                    </SelectItem>
                    <SelectItem value="동료">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        동료
                      </div>
                    </SelectItem>
                    <SelectItem value="미확인">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded border border-dashed border-gray-400 bg-gray-100" />
                        미확인
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditPersonOpen(false)}>
              취소
            </Button>
            <Button onClick={handleUpdatePerson}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Edge Dialog */}
      <Dialog open={isEditEdgeOpen} onOpenChange={setIsEditEdgeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {newEdgeData ? "새 관계 추가" : "관계 편집"}
            </DialogTitle>
          </DialogHeader>
          {editingEdge && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>관계 유형</Label>
                <Input
                  value={editingEdge.label}
                  onChange={(e) =>
                    setEditingEdge((prev) =>
                      prev ? { ...prev, label: e.target.value } : null
                    )
                  }
                  placeholder="예: 상사, 동료, 목격, 갈등, 진술"
                />
              </div>
              <div className="space-y-2">
                <Label>메모 (선택)</Label>
                <Textarea
                  value={editingEdge.memo || ""}
                  onChange={(e) =>
                    setEditingEdge((prev) =>
                      prev ? { ...prev, memo: e.target.value } : null
                    )
                  }
                  placeholder="관계에 대한 추가 설명"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="directed"
                  checked={editingEdge.directed}
                  onChange={(e) =>
                    setEditingEdge((prev) =>
                      prev ? { ...prev, directed: e.target.checked } : null
                    )
                  }
                  className="rounded border-border"
                />
                <Label htmlFor="directed" className="text-sm font-normal">
                  방향성 있는 관계 (화살표 표시)
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditEdgeOpen(false);
                setNewEdgeData(null);
              }}
            >
              취소
            </Button>
            <Button onClick={handleSaveEdge}>
              {newEdgeData ? "추가" : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
