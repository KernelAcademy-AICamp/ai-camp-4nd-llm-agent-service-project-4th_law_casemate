import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { SuggestionItem } from "@/hooks/useAgentSSE";

interface Props {
  suggestions: SuggestionItem[];
  onQuestionClick: (text: string) => void;
  disabled?: boolean;
}

export function SuggestionChips({ suggestions, onQuestionClick, disabled }: Props) {
  const navigate = useNavigate();

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2 ml-11">
      {suggestions.map((item, i) => {
        if (item.type === "action" && item.action?.navigate) {
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => navigate(item.action!.navigate)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border disabled:opacity-40 disabled:cursor-not-allowed bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
            >
              {item.text}
              <ArrowRight className="h-3 w-3" />
            </button>
          );
        }

        return (
          <button
            key={i}
            disabled={disabled}
            onClick={() => onQuestionClick(item.text)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all border disabled:opacity-40 disabled:cursor-not-allowed bg-muted/50 text-foreground border-border/50 hover:bg-muted hover:border-border"
          >
            {item.text}
          </button>
        );
      })}
    </div>
  );
}
