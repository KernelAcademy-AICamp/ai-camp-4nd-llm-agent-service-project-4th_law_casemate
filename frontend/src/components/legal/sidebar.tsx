"use client";

import { NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Scale,
  Home,
  Folder,
  FileText,
  Search,
  Settings,
  LogOut,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  isOpen: boolean;
  onLogout: () => void;
  onClose: () => void;
}

export function Sidebar({
  isOpen,
  onLogout,
  onClose,
}: SidebarProps) {
  const location = useLocation();
  const isCasesActive =
    location.pathname.startsWith("/cases") ||
    location.pathname === "/new-case" ||
    location.pathname === "/dashboard";

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-card flex flex-col transition-transform duration-300 ease-out border-r border-border",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Header - Logo */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Scale className="h-5 w-5 text-foreground" />
          <span className="text-base font-semibold tracking-tight text-foreground">
            Casemate
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground h-8 w-8"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">사이드바 닫기</span>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        <div className="space-y-1">
          {/* Home */}
          <NavLink
            to="/"
            onClick={onClose}
            className={({ isActive }) => cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <Home className="h-[18px] w-[18px]" />
            홈
          </NavLink>

          {/* Cases */}
          <NavLink
            to="/cases"
            onClick={onClose}
            className={({ isActive }) => cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive || isCasesActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <Folder className="h-[18px] w-[18px]" />
            사건 관리
          </NavLink>

          {/* Files */}
          <NavLink
            to="/evidence/upload"
            onClick={onClose}
            className={({ isActive }) => cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <FileText className="h-[18px] w-[18px]" />
            파일 관리
          </NavLink>

          {/* Precedents */}
          <NavLink
            to="/precedents"
            onClick={onClose}
            className={({ isActive }) => cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive || location.pathname.startsWith("/precedents/")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <Search className="h-[18px] w-[18px]" />
            판례 검색
          </NavLink>
        </div>
      </nav>

      {/* Footer - Settings & Logout */}
      <div className="py-3 px-3 border-t border-border space-y-1">
        <button
          type="button"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <Settings className="h-[18px] w-[18px]" />
          설정
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <LogOut className="h-[18px] w-[18px]" />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
