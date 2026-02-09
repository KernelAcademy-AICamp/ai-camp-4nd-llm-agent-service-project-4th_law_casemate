import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Scale } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProfileDialog } from "@/components/legal/profile-dialog";

interface MainLayoutProps {
  onLogout: () => void;
  userInfo?: {
    id: number;
    name: string;
    email: string;
    role?: string;
  };
}

export function MainLayout({ onLogout, userInfo }: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [localUserInfo, setLocalUserInfo] = useState(userInfo);
  useEffect(() => { setLocalUserInfo(userInfo); }, [userInfo]);
  const location = useLocation();
  const navigate = useNavigate();

  const isHomePage = location.pathname === "/" || location.pathname === "/home";

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === "/" || path === "/home") return "홈";
    if (path === "/dashboard") return "대시보드";
    if (path === "/cases") return "사건 관리";
    if (path.startsWith("/cases/")) return "사건 상세";
    if (path === "/precedents") return "판례 검색";
    if (path.startsWith("/precedents/")) return "판례 상세";
    if (path.startsWith("/evidence/upload")) return "파일 관리";
    if (path.startsWith("/evidence/")) return "증거 상세";
    if (path === "/new-case") return "새 사건 등록";
    return "대시보드";
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex bg-background">
        {/* Sidebar */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onLogout={onLogout}
        />

        {/* Main Content */}
        <div
          className="flex-1 flex flex-col transition-all duration-300"
          style={{ marginLeft: sidebarCollapsed ? 72 : 256 }}
        >
          {/* Top Header */}
          <header className="h-[60px] glass-panel border-b border-border/30 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-muted-foreground/70">
                <Scale className="h-4 w-4" />
                <span
                  className="text-sm font-medium cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => navigate("/home")}
                >
                  Casemate
                </span>
                <span className="text-muted-foreground/50">/</span>
              </div>
              <h1 className="text-sm font-semibold truncate">{getPageTitle()}</h1>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                  <User className="h-[18px] w-[18px]" />
                  <span className="sr-only">프로필</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 p-0 overflow-hidden">
                <div className="px-4 py-5 bg-muted/30">
                  <p className="text-sm font-semibold text-foreground">
                    {localUserInfo?.name || "사용자"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {localUserInfo?.email || ""}
                  </p>
                  {localUserInfo?.role && (
                    <span className="inline-block text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full mt-2.5">
                      {localUserInfo.role === "lawyer"
                        ? "변호사"
                        : localUserInfo.role === "legal-officer"
                          ? "법무사"
                          : localUserInfo.role}
                    </span>
                  )}
                </div>
                <DropdownMenuSeparator className="m-0" />
                <div className="p-1">
                  <DropdownMenuItem onClick={() => setProfileOpen(true)} className="px-3 py-2 cursor-pointer">
                    <User className="h-4 w-4 mr-2.5" />
                    프로필 수정
                  </DropdownMenuItem>
                </div>
                <DropdownMenuSeparator className="m-0" />
                <div className="p-1">
                  <DropdownMenuItem onClick={onLogout} className="px-3 py-2 text-destructive cursor-pointer">
                    <LogOut className="h-4 w-4 mr-2.5" />
                    로그아웃
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <ProfileDialog
              open={profileOpen}
              onOpenChange={setProfileOpen}
              userInfo={localUserInfo}
              onProfileUpdated={(updated) => {
                setLocalUserInfo((prev) => prev ? { ...prev, ...updated } : prev);
              }}
            />
          </header>

          {/* Page Content */}
          <main className={isHomePage ? "flex-1 flex flex-col" : "flex-1 flex flex-col p-6 lg:p-10 lg:px-[5rem]"}>
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
