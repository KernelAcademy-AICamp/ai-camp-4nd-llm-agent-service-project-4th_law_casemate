import { useState, useEffect } from "react";
import { Sun, Moon, Palette, Bell, Lock, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";
type SettingsTab = "general" | "notifications" | "security";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const tabs: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: "general", label: "일반", icon: Palette },
  { id: "notifications", label: "알림", icon: Bell },
  { id: "security", label: "보안", icon: Lock },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "light";
  });

  // 비밀번호 변경 폼
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  // 다이얼로그 닫힐 때 비밀번호 폼 초기화
  useEffect(() => {
    if (!open) {
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setShowCurrentPw(false);
      setShowNewPw(false);
      setShowConfirmPw(false);
      setPwMessage(null);
    }
  }, [open]);

  const handlePasswordChange = async () => {
    setPwMessage(null);

    if (!currentPw || !newPw || !confirmPw) {
      setPwMessage({ type: "error", text: "모든 항목을 입력해주세요." });
      return;
    }
    if (newPw.length < 8) {
      setPwMessage({ type: "error", text: "새 비밀번호는 8자 이상이어야 합니다." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMessage({ type: "error", text: "새 비밀번호가 일치하지 않습니다." });
      return;
    }

    setPwLoading(true);
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("http://localhost:8000/api/v1/change-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          current_password: currentPw,
          new_password: newPw,
        }),
      });

      if (res.ok) {
        setPwMessage({ type: "success", text: "비밀번호가 변경되었습니다." });
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
      } else {
        const data = await res.json().catch(() => null);
        setPwMessage({
          type: "error",
          text: data?.detail || "비밀번호 변경에 실패했습니다.",
        });
      }
    } catch {
      setPwMessage({ type: "error", text: "서버 연결에 실패했습니다." });
    } finally {
      setPwLoading(false);
    }
  };

  const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "라이트", icon: Sun },
    { value: "dark", label: "다크", icon: Moon },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] p-0 gap-0 overflow-hidden">
        <div className="flex h-[480px]">
          {/* Left sidebar */}
          <div className="w-[200px] border-r border-border/40 p-3 flex flex-col gap-1 bg-muted/20">
            <DialogTitle className="px-3 py-2 text-base font-bold">설정</DialogTitle>
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 cursor-pointer",
                  activeTab === id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === "general" && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-4">테마</h3>
                <div className="flex gap-3">
                  {themeOptions.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all duration-150 cursor-pointer",
                        theme === value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "notifications" && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-4">알림 설정</h3>
                <p className="text-sm text-muted-foreground">추후 업데이트 예정입니다.</p>
              </div>
            )}

            {activeTab === "security" && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-4">비밀번호 변경</h3>
                <div className="space-y-4 max-w-[320px]">
                  {/* 현재 비밀번호 */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">현재 비밀번호</label>
                    <div className="relative">
                      <input
                        type={showCurrentPw ? "text" : "password"}
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                        className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPw(!showCurrentPw)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* 새 비밀번호 */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">새 비밀번호</label>
                    <div className="relative">
                      <input
                        type={showNewPw ? "text" : "password"}
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                        placeholder="8자 이상"
                        className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(!showNewPw)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* 새 비밀번호 확인 */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">새 비밀번호 확인</label>
                    <div className="relative">
                      <input
                        type={showConfirmPw ? "text" : "password"}
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                        className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPw(!showConfirmPw)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* 메시지 */}
                  {pwMessage && (
                    <p className={cn(
                      "text-sm",
                      pwMessage.type === "success" ? "text-green-600" : "text-[#EF4444]"
                    )}>
                      {pwMessage.text}
                    </p>
                  )}

                  {/* 변경 버튼 */}
                  <button
                    onClick={handlePasswordChange}
                    disabled={pwLoading}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {pwLoading ? "변경 중..." : "비밀번호 변경"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
