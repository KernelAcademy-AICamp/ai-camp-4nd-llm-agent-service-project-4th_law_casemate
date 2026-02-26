import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { User, Camera } from "lucide-react";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userInfo?: {
    id: number;
    name: string;
    email: string;
    role?: string;
    avatar_url?: string;
  };
  onProfileUpdated?: (updated: { name: string; role: string; avatar_url?: string }) => void;
}

export function ProfileDialog({ open, onOpenChange, userInfo, onProfileUpdated }: ProfileDialogProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && userInfo) {
      setName(userInfo.name || "");
      setRole(userInfo.role || "");
      setAvatarUrl(userInfo.avatar_url);
      setMessage(null);
    }
  }, [open, userInfo]);

  const compressImage = (file: File, maxSize = 512, quality = 0.8): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("압축 실패"))),
          "image/webp",
          quality,
        );
      };
      img.onerror = () => reject(new Error("이미지 로드 실패"));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarLoading(true);
    setMessage(null);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressed, "avatar.webp");

      const res = await apiFetch("/api/v1/me/avatar", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setAvatarUrl(data.avatar_url);
        onProfileUpdated?.({ name, role, avatar_url: data.avatar_url });
        setMessage({ type: "success", text: "프로필 사진이 변경되었습니다." });
      } else {
        const data = await res.json().catch(() => null);
        setMessage({ type: "error", text: data?.detail || "사진 업로드에 실패했습니다." });
      }
    } catch {
      setMessage({ type: "error", text: "서버 연결에 실패했습니다." });
    } finally {
      setAvatarLoading(false);
      // 같은 파일 재선택 가능하도록 초기화
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setMessage(null);

    if (!name.trim()) {
      setMessage({ type: "error", text: "이름을 입력해주세요." });
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name.trim(), role }),
      });

      if (res.ok) {
        onProfileUpdated?.({ name: name.trim(), role, avatar_url: avatarUrl });
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
          <div
            className="relative group cursor-pointer shrink-0"
            onClick={() => fileInputRef.current?.click()}
          >
            <Avatar className="h-10 w-10">
              {avatarUrl ? (
                <AvatarImage src={avatarUrl} alt="프로필 사진" />
              ) : null}
              <AvatarFallback className="bg-muted">
                <User className="h-5 w-5 text-muted-foreground" />
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {avatarLoading ? (
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera className="h-4 w-4 text-white" />
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
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
