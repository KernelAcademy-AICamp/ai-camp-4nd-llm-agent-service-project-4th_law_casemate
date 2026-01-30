import { useState } from "react";
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
import { Menu, User, LogOut, Settings, Scale } from "lucide-react";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

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
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onLogout={onLogout}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col transition-all duration-300">
        {/* Top Header */}
        <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="shrink-0 h-9 w-9"
            >
              <Menu className="h-[18px] w-[18px]" />
              <span className="sr-only">메뉴 토글</span>
            </Button>
            <div className="hidden sm:flex items-center gap-2 text-muted-foreground">
              <Scale className="h-4 w-4" />
              <span
                className="text-sm font-medium cursor-pointer hover:text-foreground transition-colors"
                onClick={() => navigate('/home')}
              >
                Casemate
              </span>
              <span className="text-muted-foreground/50">/</span>
            </div>
            <h1 className="text-sm font-medium truncate">{getPageTitle()}</h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <User className="h-[18px] w-[18px]" />
                <span className="sr-only">프로필</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{userInfo?.name || '사용자'}</p>
                <p className="text-xs text-muted-foreground">{userInfo?.email || ''}</p>
                {userInfo?.role && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {userInfo.role === 'lawyer' ? '변호사' : userInfo.role === 'legal-officer' ? '법무사' : userInfo.role}
                  </p>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="h-4 w-4 mr-2" />
                내 프로필
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="h-4 w-4 mr-2" />
                설정
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-8 lg:px-[4.5rem]">
          <Outlet />
        </main>
      </div>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 z-40"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="사이드바 닫기"
        />
      )}
    </div>
  );
}
