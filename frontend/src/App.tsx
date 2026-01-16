import { useState, useRef, useEffect } from 'react';
import { Message } from './types';
import { sendMessage, deleteConversation } from './services/api';
import './App.css';

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'system-1',
      content: '안녕하세요! 무엇을 도와드릴까요?',
      type: 'system'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 스크롤을 최신 메시지로 이동
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 텍스트 영역 자동 높이 조절
  const autoResize = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }
  };

  useEffect(() => {
    autoResize();
  }, [inputValue]);

  const handleSendMessage = async () => {
    const message = inputValue.trim();
    if (!message || isLoading) return;

    // 사용자 메시지 추가
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: message,
      type: 'user'
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');

    // 로딩 메시지 추가
    const loadingId = `loading-${Date.now()}`;
    const loadingMessage: Message = {
      id: loadingId,
      content: '응답을 생성하는 중입니다...',
      type: 'assistant',
      loading: true
    };
    setMessages(prev => [...prev, loadingMessage]);
    setIsLoading(true);

    try {
      const response = await sendMessage({
        message,
        conversation_id: conversationId
      });

      setConversationId(response.conversation_id);

      // 로딩 메시지 제거 및 실제 응답 추가
      setMessages(prev => prev.filter(msg => msg.id !== loadingId));
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        content: response.response,
        type: 'assistant'
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => prev.filter(msg => msg.id !== loadingId));
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        content: '오류가 발생했습니다. 다시 시도해주세요.',
        type: 'system'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewChat = () => {
    if (window.confirm('새 대화를 시작하시겠습니까?')) {
      setConversationId(null);
      setMessages([
        {
          id: 'system-1',
          content: '안녕하세요! 무엇을 도와드릴까요?',
          type: 'system'
        }
      ]);
    }
  };

  const handleClearChat = async () => {
    if (!conversationId) {
      alert('삭제할 대화가 없습니다.');
      return;
    }

    if (!window.confirm('현재 대화를 삭제하시겠습니까?')) {
      return;
    }

    try {
      await deleteConversation(conversationId);
      handleNewChat();
    } catch (error) {
      console.error('Error:', error);
      alert('대화 삭제 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="container">
      <header>
        <h1>🤖 CaseMate</h1>
        <p className="subtitle">AI 기반 대화 시스템</p>
      </header>

      <div className="chat-container">
        <div className="chat-header">
          <button onClick={handleNewChat} className="btn btn-secondary">
            새 대화
          </button>
          <button onClick={handleClearChat} className="btn btn-danger">
            대화 삭제
          </button>
        </div>

        <div className="chat-messages">
          {messages.map(message => (
            <div key={message.id} className={`message ${message.type}`}>
              <div className="message-content">
                {message.loading ? (
                  <span className="loading">{message.content}</span>
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-container">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요..."
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSendMessage}
            disabled={isLoading || !inputValue.trim()}
            className="btn btn-primary"
          >
            <span>전송</span>
          </button>
        </div>
      </div>

      <footer>
        <p>Powered by FastAPI, React & TypeScript</p>
      </footer>
    </div>
  );
}

export default App;
