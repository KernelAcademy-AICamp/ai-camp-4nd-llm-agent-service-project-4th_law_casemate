import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { roleConfig, type PersonNodeData, type RFNode } from "./types";

function PersonNodeComponent({ id, data, selected }: NodeProps<RFNode>) {
  const config = roleConfig[data.role];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`
            w-[140px] rounded-lg border shadow-sm transition-all duration-200
            ${config.bgColor} ${config.borderColor}
            ${selected ? "shadow-lg ring-2 ring-[#6D5EF5]" : "hover:shadow-md"}
          `}
          onDoubleClick={() => data.onEdit(id)}
        >
          {/* Target handle (left) */}
          <Handle
            type="target"
            position={Position.Left}
            className="!w-3 !h-3 !bg-transparent !border-2 !border-transparent hover:!border-[#6D5EF5] hover:!bg-[#6D5EF5]/20 transition-colors !-left-1.5"
          />

          {/* Node content */}
          <div className="p-3 text-center">
            <div
              className={`w-10 h-10 rounded-full ${config.iconBg} flex items-center justify-center mx-auto mb-2`}
            >
              {config.icon}
            </div>
            <p className="text-[13px] font-semibold truncate text-foreground">
              {data.name}
            </p>
            <span
              className={`inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${config.color} ${config.bgColor} border ${config.borderColor}`}
            >
              {data.role}
            </span>
          </div>

          {/* Source handle (right) */}
          <Handle
            type="source"
            position={Position.Right}
            className="!w-4 !h-4 !bg-[#6D5EF5] !border-2 !border-white !shadow !-right-2 hover:!scale-125 transition-transform !cursor-crosshair"
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => data.onEdit(id)}>
          인물 정보 편집
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive"
          onClick={() => data.onDelete(id)}
        >
          인물 삭제
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const PersonNode = memo(PersonNodeComponent);
