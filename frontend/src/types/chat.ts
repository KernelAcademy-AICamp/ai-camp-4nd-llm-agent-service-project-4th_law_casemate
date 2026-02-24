/**
 * 채팅 관련 타입 정의
 */

// ==================== 기본 메시지 타입 ====================

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;

  // 확장 필드 (AI 응답)
  intent?: string;
  cards?: ChatCard[];
  action?: ChatAction;
  suggestions?: string[];
}

// ==================== 카드 타입 ====================

export type ChatCardType = "precedent" | "case" | "document" | "law";

export interface ChatCard {
  type: ChatCardType;
  data: PrecedentCardData | CaseCardData | DocumentCardData | LawCardData;
}

export interface PrecedentCardData {
  case_number: string;
  case_name: string;
  court: string;
  date: string;
  summary: string;
  similarity?: number;
}

export interface CaseCardData {
  id: number;
  title: string;
  case_type: string;
  client_name: string;
  created_at: string | null;
}

export interface DocumentCardData {
  id: number;
  title: string;
  document_type: string;
  created_at: string;
}

export interface LawCardData {
  law_name: string;
  article_number: string;
  article_title: string;
  content: string;
}

// ==================== 액션 타입 ====================

export type ChatActionType = "navigate" | "show_card" | "confirm";

export interface ChatAction {
  type: ChatActionType;
  url?: string;
  data?: Record<string, unknown>;
}

// ==================== API 요청/응답 ====================

export interface ChatContext {
  current_page: string;
  case_id?: number | null;
  precedent_id?: string | null;
  conversation_id?: string | null;
}

export interface ChatRequest {
  message: string;
  context?: ChatContext;
}

export interface ChatResponse {
  response: string;
  intent: string;
  action?: ChatAction | null;
  cards?: ChatCard[] | null;
  suggestions?: string[] | null;
}
