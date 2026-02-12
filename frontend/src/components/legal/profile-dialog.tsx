import { useState, useEffect } from "react";
import { User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userInfo?: {
    id: number;
    name: string;
    email: string;
    role?: string;
  };
  onProfileUpdated?: (updated: { name: string; role: string }) => void;
}

export function ProfileDialog({ open, onOpenChange, userInfo, onProfileUpdated }: ProfileDialogProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && userInfo) {
      setName(userInfo.name || "");
      setRole(userInfo.role || "");
      setMessage(null);
    }
  }, [open, userInfo]);

  const handleSave = async () => {
    setMessage(null);

    if (!name.trim()) {
      setMessage({ type: "error", text: "이름을 입력해주세요." });
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("http://localhost:8000/api/v1/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim(), role }),
      });

      if (res.ok) {
        onProfileUpdated?.({ name: name.trim(), role });
        onOpenChange(false);
      } else {
        const data = await res.json().catch(() => null);
        setMessage({ type: "error", text: data?.detail || "저장에 실패했습니다." });
      }
    } catch {
      setMessage({ type: "error", text: "서버 연결에 실패했습니다." });
    } finally {
      setLoading(false);
    }
  };

  const roleLabel = (r: string) =>
    r === "lawyer" ? "변호사" : r === "legal-officer" ? "법무사" : r === "other" ? "기타" : r;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <DialogTitle className="text-base font-bold">프로필 수정</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">기본 정보를 수정할 수 있습니다</p>
          </div>
        </div>

        {/* Form */}
        <div className="px-6 pb-6 space-y-4">
          {/* 이메일 (읽기 전용) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">이메일</label>
            <div className="px-3 py-2 rounded-lg border border-border bg-muted/40 text-sm text-muted-foreground">
              {userInfo?.email || ""}
            </div>
          </div>

          {/* 이름 */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* 직업 */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">직업</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="직업을 선택하세요">
                  {role ? roleLabel(role) : "직업을 선택하세요"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lawyer">변호사</SelectItem>
                <SelectItem value="legal-officer">법무사</SelectItem>
                <SelectItem value="other">기타</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 메시지 */}
          {message && (
            <p className={cn(
              "text-sm",
              message.type === "success" ? "text-green-600" : "text-[#EF4444]"
            )}>
              {message.text}
            </p>
          )}

          {/* 저장 버튼 */}
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? "저장 중..." : "저장"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
