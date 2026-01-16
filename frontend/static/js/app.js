// API 설정
const API_BASE_URL = 'http://localhost:8000/api';

// 전역 상태 관리
let conversationId = null;
let isLoading = false;

// DOM 요소
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const clearChatBtn = document.getElementById('clearChatBtn');

// 이벤트 리스너 설정
document.addEventListener('DOMContentLoaded', () => {
    sendBtn.addEventListener('click', sendMessage);
    newChatBtn.addEventListener('click', startNewChat);
    clearChatBtn.addEventListener('click', clearChat);

    // Enter 키로 전송 (Shift+Enter는 줄바꿈)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 텍스트 영역 자동 높이 조절
    messageInput.addEventListener('input', autoResize);
});

// 메시지 전송
async function sendMessage() {
    const message = messageInput.value.trim();

    if (!message || isLoading) return;

    // 사용자 메시지 표시
    addMessage(message, 'user');
    messageInput.value = '';
    autoResize();

    // 로딩 상태 설정
    isLoading = true;
    sendBtn.disabled = true;

    // 로딩 메시지 추가
    const loadingId = addMessage('응답을 생성하는 중입니다', 'assistant', true);

    try {
        // API 호출
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                conversation_id: conversationId
            })
        });

        if (!response.ok) {
            throw new Error('서버 응답 오류');
        }

        const data = await response.json();

        // 대화 ID 저장
        conversationId = data.conversation_id;

        // 로딩 메시지 제거
        removeMessage(loadingId);

        // 어시스턴트 응답 표시
        addMessage(data.response, 'assistant');

    } catch (error) {
        console.error('Error:', error);
        removeMessage(loadingId);
        addMessage('오류가 발생했습니다. 다시 시도해주세요.', 'system');
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

// 메시지 추가
function addMessage(content, type, loading = false) {
    const messageDiv = document.createElement('div');
    const messageId = `msg-${Date.now()}-${Math.random()}`;
    messageDiv.id = messageId;
    messageDiv.className = `message ${type}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (loading) {
        contentDiv.innerHTML = `<span class="loading">${content}</span>`;
    } else {
        contentDiv.textContent = content;
    }

    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);

    // 스크롤을 최신 메시지로 이동
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return messageId;
}

// 메시지 제거
function removeMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) {
        message.remove();
    }
}

// 새 대화 시작
function startNewChat() {
    if (confirm('새 대화를 시작하시겠습니까?')) {
        conversationId = null;
        chatMessages.innerHTML = `
            <div class="message system">
                <div class="message-content">
                    안녕하세요! 무엇을 도와드릴까요?
                </div>
            </div>
        `;
    }
}

// 대화 삭제
async function clearChat() {
    if (!conversationId) {
        alert('삭제할 대화가 없습니다.');
        return;
    }

    if (!confirm('현재 대화를 삭제하시겠습니까?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            startNewChat();
        } else {
            throw new Error('삭제 실패');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('대화 삭제 중 오류가 발생했습니다.');
    }
}

// 텍스트 영역 자동 높이 조절
function autoResize() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
}
