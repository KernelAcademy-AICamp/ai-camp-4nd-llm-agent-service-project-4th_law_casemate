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
import type { PersonRole, PersonNode, RelationshipEdge } from "./types";

// ── Role select items (shared between Add / Edit person) ──

function RoleSelectItems() {
  return (
    <>
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
    </>
  );
}

// ── Add Person Dialog ──

interface AddPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  role: PersonRole;
  onNameChange: (v: string) => void;
  onRoleChange: (v: PersonRole) => void;
  onSubmit: () => void;
}

export function AddPersonDialog({
  open,
  onOpenChange,
  name,
  role,
  onNameChange,
  onRoleChange,
  onSubmit,
}: AddPersonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 인물 추가</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>이름</Label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="예: 홍OO, 미확인 관리자"
            />
          </div>
          <div className="space-y-2">
            <Label>역할</Label>
            <Select value={role} onValueChange={(v) => onRoleChange(v as PersonRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <RoleSelectItems />
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={onSubmit}>추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Person Dialog ──

interface EditPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: PersonNode | null;
  onPersonChange: (p: PersonNode | null) => void;
  onSubmit: () => void;
}

export function EditPersonDialog({
  open,
  onOpenChange,
  person,
  onPersonChange,
  onSubmit,
}: EditPersonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>인물 정보 편집</DialogTitle>
        </DialogHeader>
        {person && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>이름</Label>
              <Input
                value={person.name}
                onChange={(e) =>
                  onPersonChange({ ...person, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>역할</Label>
              <Select
                value={person.role}
                onValueChange={(v) =>
                  onPersonChange({ ...person, role: v as PersonRole })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <RoleSelectItems />
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={onSubmit}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Edge Dialog (also used for adding new edges) ──

interface EditEdgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edge: RelationshipEdge | null;
  isNew: boolean;
  onEdgeChange: (e: RelationshipEdge | null) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function EditEdgeDialog({
  open,
  onOpenChange,
  edge,
  isNew,
  onEdgeChange,
  onSubmit,
  onCancel,
}: EditEdgeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "새 관계 추가" : "관계 편집"}</DialogTitle>
        </DialogHeader>
        {edge && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>관계 유형</Label>
              <Input
                value={edge.label}
                onChange={(e) =>
                  onEdgeChange({ ...edge, label: e.target.value })
                }
                placeholder="예: 상사, 동료, 목격, 갈등, 진술"
              />
            </div>
            <div className="space-y-2">
              <Label>메모 (선택)</Label>
              <Textarea
                value={edge.memo || ""}
                onChange={(e) =>
                  onEdgeChange({ ...edge, memo: e.target.value })
                }
                placeholder="관계에 대한 추가 설명"
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="directed"
                checked={edge.directed}
                onChange={(e) =>
                  onEdgeChange({ ...edge, directed: e.target.checked })
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
          <Button variant="outline" onClick={onCancel}>
            취소
          </Button>
          <Button onClick={onSubmit}>{isNew ? "추가" : "저장"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
