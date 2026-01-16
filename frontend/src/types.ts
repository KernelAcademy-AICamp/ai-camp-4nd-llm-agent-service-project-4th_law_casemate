export interface Message {
  id: string;
  content: string;
  type: 'user' | 'assistant' | 'system';
  loading?: boolean;
}

export interface ChatRequest {
  message: string;
  conversation_id: string | null;
}

export interface ChatResponse {
  response: string;
  conversation_id: string;
}
