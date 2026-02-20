import type { Node, Edge } from "@xyflow/react";
import {
  User,
  AlertCircle,
  Eye,
  Briefcase,
  HelpCircle,
} from "lucide-react";
import { createElement } from "react";

// ── Domain types ──

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

export interface RelationshipEditorProps {
  caseId: string;
  data?: {
    persons: any[];
    relationships: any[];
  };
  loading?: boolean;
  onRefresh?: () => void;
}

// ── React Flow node/edge data ──

export interface PersonNodeData {
  name: string;
  role: PersonRole;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  [key: string]: unknown;
}

export interface RelationshipEdgeData {
  label: string;
  memo?: string;
  directed?: boolean;
  onEdit: (id: string) => void;
  [key: string]: unknown;
}

export type RFNode = Node<PersonNodeData, "person">;
export type RFEdge = Edge<RelationshipEdgeData>;

// ── Role config ──

export interface RoleStyle {
  color: string;
  bgColor: string;
  borderColor: string;
  iconBg: string;
  hex: string;           // for MiniMap nodeColor
  icon: React.ReactNode;
}

export const roleConfig: Record<PersonRole, RoleStyle> = {
  피해자: {
    color: "text-[#6D5EF5]",
    bgColor: "bg-[#F5F3FF]",
    borderColor: "border-[#6D5EF5]/30",
    iconBg: "bg-gradient-to-br from-[#6D5EF5] to-[#A78BFA]",
    hex: "#6D5EF5",
    icon: createElement(User, { className: "h-5 w-5 text-white" }),
  },
  가해자: {
    color: "text-[#EF4444]",
    bgColor: "bg-[#EF4444]/5",
    borderColor: "border-[#EF4444]/30",
    iconBg: "bg-gradient-to-br from-[#EF4444] to-[#EF4444]/70",
    hex: "#EF4444",
    icon: createElement(AlertCircle, { className: "h-5 w-5 text-white" }),
  },
  증인: {
    color: "text-[#0284C7]",
    bgColor: "bg-sky-50",
    borderColor: "border-[#38BDF8]/30",
    iconBg: "bg-gradient-to-br from-[#38BDF8] to-[#7DD3FC]",
    hex: "#38BDF8",
    icon: createElement(Eye, { className: "h-5 w-5 text-white" }),
  },
  동료: {
    color: "text-[#B45309]",
    bgColor: "bg-amber-50",
    borderColor: "border-[#F59E0B]/30",
    iconBg: "bg-gradient-to-br from-[#F59E0B] to-[#FBBF24]",
    hex: "#F59E0B",
    icon: createElement(Briefcase, { className: "h-5 w-5 text-white" }),
  },
  미확인: {
    color: "text-[#94A3B8]",
    bgColor: "bg-slate-50",
    borderColor: "border-[#94A3B8]/30 border-dashed",
    iconBg: "bg-gradient-to-br from-[#94A3B8] to-[#CBD5E1]",
    hex: "#94A3B8",
    icon: createElement(HelpCircle, { className: "h-5 w-5 text-white" }),
  },
};

export const validRoles: PersonRole[] = ["피해자", "가해자", "증인", "동료", "미확인"];

export const normalizeRole = (role: string): PersonRole => {
  if (validRoles.includes(role as PersonRole)) return role as PersonRole;
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
