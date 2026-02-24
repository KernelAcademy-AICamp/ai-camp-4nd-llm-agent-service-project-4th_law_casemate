/**
 * 채팅 카드 분기 컴포넌트
 * 카드 타입에 따라 적절한 카드 컴포넌트를 렌더링
 */

import type { ChatCard } from "@/types/chat";
import { PrecedentCard } from "./PrecedentCard";
import { CaseCard } from "./CaseCard";
import { DocumentCard } from "./DocumentCard";
import { LawCard } from "./LawCard";

interface ChatCardRendererProps {
  card: ChatCard;
}

export function ChatCardRenderer({ card }: ChatCardRendererProps) {
  switch (card.type) {
    case "precedent":
      return <PrecedentCard data={card.data as any} />;
    case "case":
      return <CaseCard data={card.data as any} />;
    case "document":
      return <DocumentCard data={card.data as any} />;
    case "law":
      return <LawCard data={card.data as any} />;
    default:
      return null;
  }
}
