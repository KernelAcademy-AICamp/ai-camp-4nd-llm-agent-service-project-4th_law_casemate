import { Button } from "@/components/ui/button";
import { Plus, Trash2, RefreshCw } from "lucide-react";

interface ToolbarProps {
  loading: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onRefresh?: () => void;
  onAddPerson: () => void;
  onEditPerson: () => void;
  onDeletePerson: () => void;
  onEditEdge: () => void;
  onDeleteEdge: () => void;
}

export function Toolbar({
  loading,
  selectedNodeId,
  selectedEdgeId,
  onRefresh,
  onAddPerson,
  onEditPerson,
  onDeletePerson,
  onEditEdge,
  onDeleteEdge,
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between p-3 border-b border-border/60 bg-[#FBFBFF]">
      <div className="flex items-center gap-2">
        {onRefresh && (
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onAddPerson}>
          <Plus className="h-4 w-4 mr-2" />
          인물 추가
        </Button>
        {selectedNodeId && (
          <>
            <Button size="sm" variant="outline" onClick={onEditPerson}>
              인물 편집
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive bg-transparent"
              onClick={onDeletePerson}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
        {selectedEdgeId && (
          <>
            <Button size="sm" variant="outline" onClick={onEditEdge}>
              관계 편집
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive bg-transparent"
              onClick={onDeleteEdge}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6D5EF5]/10 text-[#6D5EF5] font-medium">
          피해자
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EF4444]/10 text-[#EF4444] font-medium">
          가해자
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#38BDF8]/10 text-[#0284C7] font-medium">
          증인
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#F59E0B]/10 text-[#B45309] font-medium">
          동료
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#94A3B8]/10 text-[#94A3B8] font-medium">
          미확인
        </span>
      </div>
    </div>
  );
}
