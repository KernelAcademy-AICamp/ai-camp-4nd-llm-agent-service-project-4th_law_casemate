import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Scale,
  Home,
  FileText,
  FolderOpen,
  Landmark,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SettingsDialog } from "@/components/legal/settings-dialog";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
}

const navItems = [
  { to: "/", icon: Home, label: "홈", end: true },
  { to: "/cases", icon: FileText, label: "사건 관리" },
  { to: "/evidence/upload", icon: FolderOpen, label: "파일 관리" },
  { to: "/precedents", icon: Landmark, label: "판례 검색" },
];

export function Sidebar({ collapsed, onToggle, onLogout }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isCasesActive =
    location.pathname.startsWith("/cases") ||
    location.pathname === "/new-case" ||
    location.pathname === "/dashboard";

  const isItemActive = (to: string) => {
    if (to === "/") return location.pathname === "/" || location.pathname === "/home";
    if (to === "/cases") return isCasesActive;
    if (to === "/precedents") return location.pathname.startsWith("/precedents");
    return location.pathname === to;
  };

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 bottom-0 z-40 flex flex-col bg-card border-r border-border/30 transition-all duration-300 ease-out"
      )}
      style={{ width: collapsed ? 72 : 256 }}
    >
      {/* Header - Logo */}
      <div className={cn(
        "h-[60px] flex items-center shrink-0 mt-0.5",
        collapsed ? "justify-center px-0" : "justify-between px-4"
      )}>
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            className="p-2 rounded-xl cursor-pointer hover:opacity-80 transition-opacity duration-150"
            style={{ background: "linear-gradient(135deg, #6D5EF5, #A78BFA)" }}
          >
            <Scale className="h-[18px] w-[18px] text-white" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity duration-150"
          >
            <div
              className="p-2 rounded-xl"
              style={{ background: "linear-gradient(135deg, #6D5EF5, #A78BFA)" }}
            >
              <Scale className="h-[18px] w-[18px] text-white" />
            </div>
            <span className="text-base font-bold tracking-tight text-foreground">
              Casemate
            </span>
          </button>
        )}
      </div>

      {/* Navigation — 가이드 발광 대상 */}
      <nav data-guide-target="sidebar-main" className="shrink-0 py-4 px-2 mx-1 rounded-xl">
        <div className="space-y-1.5">
          {/* Toggle button — inside nav list so other icons stay fixed */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggle}
                  data-guide-target="sidebar-toggle"
                  className="w-full flex items-center py-2.5 px-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-150"
                >
                  <span className="w-[52px] flex items-center justify-center shrink-0">
                    <PanelLeftOpen className="h-[18px] w-[18px]" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>사이드바 열기</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              className="w-full flex items-center py-2.5 px-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-150"
            >
              <span className="w-[52px] flex items-center justify-center shrink-0">
                <PanelLeftClose className="h-[18px] w-[18px]" />
              </span>
              <span className="truncate text-sm">사이드바 닫기</span>
            </button>
          )}
          {navItems.map(({ to, icon: Icon, label }) => {
            const active = isItemActive(to);
            const link = (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  "w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-150 py-2.5 px-0",
                  active
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <span className="w-[52px] flex items-center justify-center shrink-0">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {!collapsed && <span className="truncate">{label}</span>}
              </NavLink>
            );

            if (collapsed) {
              return (
                <Tooltip key={to}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {label}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}
        </div>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer - Settings & Logout */}
      <div className="py-3 pb-8 mt-2 space-y-0.5 px-2">
        {collapsed ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="w-full flex items-center py-2.5 px-0 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
                >
                  <span className="w-[52px] flex items-center justify-center shrink-0">
                    <Settings className="h-[18px] w-[18px]" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>설정</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full flex items-center py-2.5 px-0 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
                >
                  <span className="w-[52px] flex items-center justify-center shrink-0">
                    <LogOut className="h-[18px] w-[18px]" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>로그아웃</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center py-2.5 px-0 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
            >
              <span className="w-[52px] flex items-center justify-center shrink-0">
                <Settings className="h-[18px] w-[18px]" />
              </span>
              <span className="truncate">설정</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center py-2.5 px-0 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-150"
            >
              <span className="w-[52px] flex items-center justify-center shrink-0">
                <LogOut className="h-[18px] w-[18px]" />
              </span>
              <span className="truncate">로그아웃</span>
            </button>
          </>
        )}
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </aside>
  );
}
