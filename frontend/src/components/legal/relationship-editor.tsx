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
  Move,
  Link2,
  MousePointer,
  MousePointerClick,
  RefreshCw,
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
  data?: {
    persons: any[];
    relationships: any[];
  };
  loading?: boolean;
  onRefresh?: () => void;
}

const roleConfig: Record<
  PersonRole,
  { color: string; bgColor: string; borderColor: string; iconBg: string; icon: React.ReactNode }
> = {
  피해자: {
    color: "text-[#6D5EF5]",
    bgColor: "bg-[#F5F3FF]",
    borderColor: "border-[#6D5EF5]/30",
    iconBg: "bg-gradient-to-br from-[#6D5EF5] to-[#A78BFA]",
    icon: <User className="h-5 w-5 text-white" />,
  },
  가해자: {
    color: "text-[#EF4444]",
    bgColor: "bg-red-50",
    borderColor: "border-[#EF4444]/30",
    iconBg: "bg-gradient-to-br from-[#EF4444] to-[#F87171]",
    icon: <AlertCircle className="h-5 w-5 text-white" />,
  },
  증인: {
    color: "text-[#0284C7]",
    bgColor: "bg-sky-50",
    borderColor: "border-[#38BDF8]/30",
    iconBg: "bg-gradient-to-br from-[#38BDF8] to-[#7DD3FC]",
    icon: <Eye className="h-5 w-5 text-white" />,
  },
  동료: {
    color: "text-[#B45309]",
    bgColor: "bg-amber-50",
    borderColor: "border-[#F59E0B]/30",
    iconBg: "bg-gradient-to-br from-[#F59E0B] to-[#FBBF24]",
    icon: <Briefcase className="h-5 w-5 text-white" />,
  },
  미확인: {
    color: "text-[#94A3B8]",
    bgColor: "bg-slate-50",
    borderColor: "border-[#94A3B8]/30 border-dashed",
    iconBg: "bg-gradient-to-br from-[#94A3B8] to-[#CBD5E1]",
    icon: <HelpCircle className="h-5 w-5 text-white" />,
  },
};

export function RelationshipEditor({
  caseId,
  data,
  loading: externalLoading = false,
  onRefresh,
}: RelationshipEditorProps) {
  // State
  const [nodes, setNodes] = useState<PersonNode[]>([]);
  const [edges, setEdges] = useState<RelationshipEdge[]>([]);
  const [internalLoading, setInternalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = externalLoading || internalLoading;

  // Convert API data to editor format
  const convertData = useCallback((rawData: { persons: any[], relationships: any[] }) => {
    // Valid role mapping
    const validRoles: PersonRole[] = ["피해자", "가해자", "증인", "동료", "미확인"];
    const normalizeRole = (role: string): PersonRole => {
      if (validRoles.includes(role as PersonRole)) {
        return role as PersonRole;
      }
      const roleMap: Record<string, PersonRole> = {
        "원고": "피해자",
        "피고": "가해자",
        "피고소인": "가해자",
        "고소인": "피해자",
        "상사": "동료",
        "관련자": "미확인",
      };
      return roleMap[role] || "미확인";
    };

    const convertedNodes: PersonNode[] = rawData.persons
      .filter((person: any) => person && person.id && person.name && person.role)
      .map((person: any, index: number) => ({
        id: String(person.id),
        name: person.name,
        role: normalizeRole(person.role),
        x: person.position_x ?? (300 + (index % 3) * 200),
        y: person.position_y ?? (200 + Math.floor(index / 3) * 150),
      }));

    const validPersonIds = new Set(convertedNodes.map(node => node.id));

    const convertedEdges: RelationshipEdge[] = rawData.relationships
      .filter((rel: any) => {
        if (!rel || !rel.id || !rel.source_person_id || !rel.target_person_id) {
          return false;
        }
        const sourceId = String(rel.source_person_id);
        const targetId = String(rel.target_person_id);
        if (!validPersonIds.has(sourceId) || !validPersonIds.has(targetId)) {
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

    return { nodes: convertedNodes, edges: convertedEdges };
  }, []);

  // Load relationship data (from props or API)
  useEffect(() => {
    // If data is provided via props, use it directly
    if (data) {
      console.log("[RelationshipEditor] Using data from props");
      const { nodes: convertedNodes, edges: convertedEdges } = convertData(data);
      setNodes(convertedNodes);
      setEdges(convertedEdges);
      setError(null);
      return;
    }

    // Otherwise, fetch from API (fallback for backward compatibility)
    const loadRelationships = async () => {
      try {
        setInternalLoading(true);
        setError(null);

        console.log("[RelationshipEditor] Fetching from API for caseId:", caseId);

        const response = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || "관계도를 불러오는데 실패했습니다");
        }

        const rawData = await response.json();

        // Validate response data
        if (!rawData || !Array.isArray(rawData.persons) || !Array.isArray(rawData.relationships)) {
          throw new Error("잘못된 응답 형식입니다");
        }

        const { nodes: convertedNodes, edges: convertedEdges } = convertData(rawData);

        console.log("[RelationshipEditor] Converted nodes:", convertedNodes.length);
        console.log("[RelationshipEditor] Converted edges:", convertedEdges.length);

        setNodes(convertedNodes);
        setEdges(convertedEdges);
      } catch (err) {
        console.error("[RelationshipEditor] Failed to load relationships:", err);
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다");
      } finally {
        setInternalLoading(false);
      }
    };

    if (caseId) {
      loadRelationships();
    } else {
      console.warn("[RelationshipEditor] No caseId provided");
      setError("사건 ID가 필요합니다");
    }
  }, [caseId, data, convertData]);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Convert screen coordinates to canvas (world) coordinates
  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvasRef.current) return { x: 0, y: 0 };
      const rect = canvasRef.current.getBoundingClientRect();
      return {
        x: (clientX - rect.left - panOffset.x) / zoom,
        y: (clientY - rect.top - panOffset.y) / zoom,
      };
    },
    [zoom, panOffset]
  );

  // Fit all nodes into view
  const fitToView = useCallback(() => {
    if (!canvasRef.current || nodes.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const padding = 80;
    const nodeW = 130;
    const nodeH = 90;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.x + nodeW > maxX) maxX = node.x + nodeW;
      if (node.y + nodeH > maxY) maxY = node.y + nodeH;
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;

    const scaleX = (rect.width - padding * 2) / contentW;
    const scaleY = (rect.height - padding * 2) / contentH;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.3), 2.0);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const newPanX = rect.width / 2 - centerX * newZoom;
    const newPanY = rect.height / 2 - centerY * newZoom;

    setZoom(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  }, [nodes]);

  // State for interactions (원본 로직 그대로)
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

  // Wheel zoom (cursor-centered)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const canvasX = (mouseX - panOffset.x) / zoom;
      const canvasY = (mouseY - panOffset.y) / zoom;

      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(zoom * delta, 0.3), 2.0);

      const newPanX = mouseX - canvasX * newZoom;
      const newPanY = mouseY - canvasY * newZoom;

      setZoom(newZoom);
      setPanOffset({ x: newPanX, y: newPanY });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [zoom, panOffset]);

  // Get node position for edge drawing
  const getNodeCenter = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return { x: 0, y: 0 };
      return { x: node.x + 65, y: node.y + 45 };
    },
    [nodes]
  );

  // Handle mouse move (원본 로직 + zoom/pan 적용)
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!canvasRef.current) return;

      // Panning
      if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      const { x, y } = screenToCanvas(e.clientX, e.clientY);

      if (draggingNode) {
        setNodes((prev) =>
          prev.map((node) =>
            node.id === draggingNode
              ? { ...node, x: x - dragOffset.x, y: y - dragOffset.y }
              : node
          )
        );
      }

      if (connecting) {
        setConnecting((prev) => (prev ? { ...prev, mouseX: x, mouseY: y } : null));
      }
    },
    [draggingNode, dragOffset, connecting, isPanning, panStart, screenToCanvas]
  );

  // Handle mouse up (원본 로직 + zoom/pan 적용)
  const handleMouseUp = useCallback(
    async (e: React.MouseEvent) => {
      if (isPanning) {
        setIsPanning(false);
      }

      if (connecting && canvasRef.current) {
        const { x, y } = screenToCanvas(e.clientX, e.clientY);

        const targetNode = nodes.find(
          (node) =>
            node.id !== connecting.sourceId &&
            x >= node.x &&
            x <= node.x + 130 &&
            y >= node.y &&
            y <= node.y + 90
        );

        if (targetNode) {
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
    [connecting, nodes, edges, draggingNode, caseId, isPanning, screenToCanvas]
  );

  // Start dragging node (원본 로직 + zoom 적용)
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const node = nodes.find((n) => n.id === nodeId);
      if (!node || !canvasRef.current) return;

      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      setDragOffset({
        x: canvasPos.x - node.x,
        y: canvasPos.y - node.y,
      });
      setDraggingNode(nodeId);
      setSelectedNode(nodeId);
      setSelectedEdge(null);
    },
    [nodes, screenToCanvas]
  );

  // Start connecting from node (원본 로직 + zoom 적용)
  const handleConnectStart = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      if (!canvasRef.current) return;

      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      setConnecting({
        sourceId: nodeId,
        mouseX: canvasPos.x,
        mouseY: canvasPos.y,
      });
    },
    [screenToCanvas]
  );

  // Add new person (place at viewport center)
  const handleAddPerson = useCallback(async () => {
    if (!newPerson.name) return;

    let cx = 350, cy = 200;
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      cx = (rect.width / 2 - panOffset.x) / zoom - 65;
      cy = (rect.height / 2 - panOffset.y) / zoom - 45;
    }

    const position_x = Math.round(cx + Math.random() * 60 - 30);
    const position_y = Math.round(cy + Math.random() * 60 - 30);

    try {
      // Save to database
      const response = await fetch(
        `http://localhost:8000/api/v1/relationships/${caseId}/persons`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newPerson.name,
            role: newPerson.role || "미확인",
            description: "",
            position_x,
            position_y,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("인물 추가에 실패했습니다");
      }

      const createdPerson = await response.json();

      // Add to local state with DB-generated ID
      const newNode: PersonNode = {
        id: String(createdPerson.id),
        name: createdPerson.name,
        role: createdPerson.role as PersonRole,
        x: createdPerson.position_x,
        y: createdPerson.position_y,
      };

      setNodes((prev) => [...prev, newNode]);
      setNewPerson({ name: "", role: "미확인" });
      setIsAddPersonOpen(false);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to add person:", err);
      alert("인물 추가에 실패했습니다");
    }
  }, [newPerson, zoom, panOffset, caseId]);

  // Update person
  const handleUpdatePerson = useCallback(async () => {
    if (!editingPerson) return;

    try {
      // Save to database
      const response = await fetch(
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

      if (!response.ok) {
        throw new Error("인물 수정에 실패했습니다");
      }

      // Update local state
      setNodes((prev) =>
        prev.map((node) => (node.id === editingPerson.id ? editingPerson : node))
      );
      setEditingPerson(null);
      setIsEditPersonOpen(false);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to update person:", err);
      alert("인물 수정에 실패했습니다");
    }
  }, [editingPerson, caseId]);

  // Delete person
  const handleDeletePerson = useCallback(async (nodeId: string) => {
    if (!confirm("이 인물을 삭제하시겠습니까?")) return;

    try {
      // Delete from database
      const response = await fetch(
        `http://localhost:8000/api/v1/relationships/${caseId}/persons/${nodeId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("인물 삭제에 실패했습니다");
      }

      // Update local state
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) =>
        prev.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId)
      );
      setSelectedNode(null);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to delete person:", err);
      alert("인물 삭제에 실패했습니다");
    }
  }, [caseId]);

  // Add or update edge
  const handleSaveEdge = useCallback(async () => {
    if (!editingEdge || !editingEdge.label) return;

    try {
      if (newEdgeData) {
        // Create new relationship
        const response = await fetch(
          `http://localhost:8000/api/v1/relationships/${caseId}/relationships`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_person_id: parseInt(newEdgeData.sourceId),
              target_person_id: parseInt(newEdgeData.targetId),
              relationship_type: editingEdge.label,
              label: editingEdge.label,
              memo: editingEdge.memo || "",
              is_directed: editingEdge.directed ?? true,
            }),
          }
        );

        if (!response.ok) {
          throw new Error("관계 추가에 실패했습니다");
        }

        const createdRelationship = await response.json();

        const newEdge: RelationshipEdge = {
          id: String(createdRelationship.id),
          sourceId: String(createdRelationship.source_person_id),
          targetId: String(createdRelationship.target_person_id),
          label: createdRelationship.label,
          memo: createdRelationship.memo,
          directed: createdRelationship.is_directed,
        };
        setEdges((prev) => [...prev, newEdge]);
        setNewEdgeData(null);
      } else {
        // Update existing relationship
        const response = await fetch(
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

        if (!response.ok) {
          throw new Error("관계 수정에 실패했습니다");
        }

        setEdges((prev) =>
          prev.map((e) => (e.id === editingEdge.id ? editingEdge : e))
        );
      }

      setEditingEdge(null);
      setIsEditEdgeOpen(false);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to save relationship:", err);
      alert("관계 저장에 실패했습니다");
    }
  }, [editingEdge, newEdgeData, caseId]);

  // Delete edge
  const handleDeleteEdge = useCallback(async (edgeId: string) => {
    if (!confirm("이 관계를 삭제하시겠습니까?")) return;

    try {
      // Delete from database
      const response = await fetch(
        `http://localhost:8000/api/v1/relationships/${caseId}/relationships/${edgeId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("관계 삭제에 실패했습니다");
      }

      // Update local state
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      setSelectedEdge(null);
    } catch (err) {
      console.error("[RelationshipEditor] Failed to delete relationship:", err);
      alert("관계 삭제에 실패했습니다");
    }
  }, [caseId]);

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
    if (!isPanning) {
      setSelectedNode(null);
      setSelectedEdge(null);
    }
  }, [isPanning]);

  // Start panning on empty canvas mousedown (left-click) or anywhere (middle-click)
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }
      if (e.button !== 0) return;
      if (e.target === canvasRef.current || (e.target as HTMLElement).dataset?.pannable === "true") {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
      }
    },
    []
  );

  // Draw edge path
  const getEdgePath = useCallback(
    (edge: RelationshipEdge) => {
      const source = getNodeCenter(edge.sourceId);
      const target = getNodeCenter(edge.targetId);

      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const offset = Math.min(30, Math.sqrt(dx * dx + dy * dy) * 0.2);

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
      <div className="flex items-center justify-between p-3 border-b border-border/60 bg-[#FBFBFF]">
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </Button>
          )}
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
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6D5EF5]/10 text-[#6D5EF5] font-medium">피해자</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EF4444]/10 text-[#EF4444] font-medium">가해자</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#38BDF8]/10 text-[#0284C7] font-medium">증인</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#F59E0B]/10 text-[#B45309] font-medium">동료</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#94A3B8]/10 text-[#94A3B8] font-medium">미확인</span>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`flex-1 relative overflow-hidden select-none ${isPanning ? "cursor-grabbing" : "cursor-default"}`}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
        onMouseDown={handleCanvasMouseDown}
        onAuxClick={(e) => e.preventDefault()}
      >
        {/* Background grid (adjusts with zoom) */}
        <div
          className="absolute inset-0 bg-[#FBFBFF]"
          data-pannable="true"
          style={{
            backgroundImage: "radial-gradient(circle, #E2E0FF 1px, transparent 1px)",
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
          }}
        />

        {/* Transform container */}
        <div
          className="absolute origin-top-left"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          }}
        >
          {/* SVG for edges */}
          <svg
            className="absolute overflow-visible pointer-events-none"
            style={{ top: 0, left: 0 }}
            width="2000"
            height="2000"
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#C4B5FD" />
              </marker>
              <marker
                id="arrowhead-selected"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#6D5EF5" />
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
                    stroke={isSelected ? "#6D5EF5" : "#C4B5FD"}
                    strokeWidth={isSelected ? 3 : 2}
                    markerEnd={
                      edge.directed
                        ? isSelected
                          ? "url(#arrowhead-selected)"
                          : "url(#arrowhead)"
                        : undefined
                    }
                  />
                  {/* Edge label with pill background */}
                  <rect
                    x={path.ctrl.x - edge.label.length * 5 - 8}
                    y={path.ctrl.y - 20}
                    width={edge.label.length * 10 + 16}
                    height={20}
                    rx={10}
                    fill="white"
                    stroke={isSelected ? "#6D5EF5" : "#E2E8F0"}
                    strokeWidth="1"
                    className="pointer-events-none"
                  />
                  <text
                    x={path.ctrl.x}
                    y={path.ctrl.y - 7}
                    textAnchor="middle"
                    className={`text-xs pointer-events-none ${isSelected ? "fill-[#6D5EF5] font-medium" : "fill-[#64748B]"}`}
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}

            {/* Connecting line (원본 로직 그대로) */}
            {connecting && (
              <line
                x1={getNodeCenter(connecting.sourceId).x}
                y1={getNodeCenter(connecting.sourceId).y}
                x2={connecting.mouseX}
                y2={connecting.mouseY}
                stroke="#6D5EF5"
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
                    className={`absolute w-[130px] rounded-lg border shadow-sm transition-all duration-200 ${config.bgColor} ${config.borderColor} ${isSelected ? "shadow-lg ring-2 ring-[#6D5EF5]" : "hover:shadow-md"} ${draggingNode === node.id ? "cursor-grabbing" : "cursor-grab"}`}
                    style={{ left: node.x, top: node.y }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    onDoubleClick={() => openEditPerson(node.id)}
                  >
                    {/* Connect handle (원본: 우측 파란 점) */}
                    <div
                      className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#6D5EF5] border-2 border-white shadow cursor-crosshair hover:scale-125 transition-transform z-10"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        handleConnectStart(e, node.id);
                      }}
                    />

                    {/* Node content */}
                    <div className="p-3 text-center">
                      <div
                        className={`w-10 h-10 rounded-full ${config.iconBg} flex items-center justify-center mx-auto mb-2`}
                      >
                        {config.icon}
                      </div>
                      <p className="text-[13px] font-semibold truncate text-foreground">{node.name}</p>
                      <span className={`inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${config.color} ${config.bgColor} border ${config.borderColor}`}>
                        {node.role}
                      </span>
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
        </div>

        {/* Loading state (outside transform) */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background/80 z-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-3" />
              <p className="text-sm">관계도를 불러오는 중...</p>
              <p className="text-xs mt-1 text-muted-foreground/60">AI가 인물 관계를 분석하고 있습니다</p>
            </div>
          </div>
        )}

        {/* Error state (outside transform) */}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground z-20">
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

        {/* Empty state hint (outside transform) */}
        {!loading && !error && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground z-20">
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

        {/* Zoom controls overlay (bottom-right) */}
        <div className="absolute bottom-4 right-4 z-30 flex items-center gap-0.5 bg-white/90 backdrop-blur-sm rounded-lg border border-border/60 shadow-sm p-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              const newZoom = Math.max(zoom - 0.1, 0.3);
              if (canvasRef.current) {
                const rect = canvasRef.current.getBoundingClientRect();
                const cx = rect.width / 2, cy = rect.height / 2;
                const canvasX = (cx - panOffset.x) / zoom;
                const canvasY = (cy - panOffset.y) / zoom;
                setPanOffset({ x: cx - canvasX * newZoom, y: cy - canvasY * newZoom });
              }
              setZoom(newZoom);
            }}
          >
            <span className="text-sm font-medium">-</span>
          </Button>
          <span className="text-xs font-medium text-muted-foreground w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              const newZoom = Math.min(zoom + 0.1, 2.0);
              if (canvasRef.current) {
                const rect = canvasRef.current.getBoundingClientRect();
                const cx = rect.width / 2, cy = rect.height / 2;
                const canvasX = (cx - panOffset.x) / zoom;
                const canvasY = (cy - panOffset.y) / zoom;
                setPanOffset({ x: cx - canvasX * newZoom, y: cy - canvasY * newZoom });
              }
              setZoom(newZoom);
            }}
          >
            <span className="text-sm font-medium">+</span>
          </Button>
          <div className="w-px h-5 bg-border/60 mx-0.5" />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={fitToView}
            title="전체 보기"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
            </svg>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              setZoom(1);
              setPanOffset({ x: 0, y: 0 });
            }}
            title="1:1"
          >
            <span className="text-[10px] font-bold">1:1</span>
          </Button>
        </div>
      </div>

      {/* Help text */}
      <div className="p-2 border-t border-border/60 bg-[#FBFBFF] text-xs text-muted-foreground flex items-center justify-center gap-4 flex-wrap">
        <span className="inline-flex items-center gap-1"><Move className="h-3 w-3" /> 드래그: 이동</span>
        <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> 보라 점 드래그: 관계 연결</span>
        <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3 w-3" /> 더블클릭: 편집</span>
        <span className="inline-flex items-center gap-1"><MousePointer className="h-3 w-3" /> 우클릭: 메뉴</span>
        <span className="inline-flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
          스크롤: 확대/축소
        </span>
        <span className="inline-flex items-center gap-1"><GripVertical className="h-3 w-3" /> 빈 공간/휠클릭: 화면 이동</span>
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
                      <div className="w-2 h-2 rounded-full bg-[#6D5EF5]" />
                      피해자
                    </div>
                  </SelectItem>
                  <SelectItem value="가해자">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#EF4444]" />
                      가해자
                    </div>
                  </SelectItem>
                  <SelectItem value="증인">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#38BDF8]" />
                      증인
                    </div>
                  </SelectItem>
                  <SelectItem value="동료">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                      동료
                    </div>
                  </SelectItem>
                  <SelectItem value="미확인">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded border border-dashed border-[#94A3B8] bg-slate-50" />
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
                        <div className="w-2 h-2 rounded-full bg-[#6D5EF5]" />
                        피해자
                      </div>
                    </SelectItem>
                    <SelectItem value="가해자">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#EF4444]" />
                        가해자
                      </div>
                    </SelectItem>
                    <SelectItem value="증인">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#38BDF8]" />
                        증인
                      </div>
                    </SelectItem>
                    <SelectItem value="동료">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                        동료
                      </div>
                    </SelectItem>
                    <SelectItem value="미확인">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded border border-dashed border-[#94A3B8] bg-slate-50" />
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
