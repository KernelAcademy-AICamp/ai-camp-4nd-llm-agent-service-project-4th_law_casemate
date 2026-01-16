import { ChatRequest, ChatResponse } from '../types';

const API_BASE_URL = '/api';

export const sendMessage = async (data: ChatRequest): Promise<ChatResponse> => {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('서버 응답 오류');
  }

  return response.json();
};

export const deleteConversation = async (conversationId: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('삭제 실패');
  }
};
