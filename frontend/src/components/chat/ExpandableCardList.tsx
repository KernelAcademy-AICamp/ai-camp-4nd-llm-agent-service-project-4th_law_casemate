/**
 * 카드 목록을 3개까지만 보여주고 "더 보기" 버튼으로 펼치는 컴포넌트
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ChatCard } from "@/types/chat";
import { ChatCardRenderer } from "./ChatCard";

interface ExpandableCardListProps {
  cards: ChatCard[];
  initialCount?: number;
}

export function ExpandableCardList({ cards, initialCount = 3 }: ExpandableCardListProps) {
  const [expanded, setExpanded] = useState(false);

  const visibleCards = expanded ? cards : cards.slice(0, initialCount);
  const remainingCount = cards.length - initialCount;
  const showExpandButton = cards.length > initialCount;

  return (
    <div className="space-y-2">
      {visibleCards.map((card, idx) => (
        <ChatCardRenderer key={idx} card={card} />
      ))}

      {showExpandButton && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2.5 px-4 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors flex items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              접기
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              나머지 {remainingCount}건 더 보기
            </>
          )}
        </button>
      )}
    </div>
  );
}
