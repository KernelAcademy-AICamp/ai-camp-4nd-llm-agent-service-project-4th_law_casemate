import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Scale, ArrowUp, FolderOpen, MessageSquare, HelpCircle, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch } from "@/lib/api";
import type { ChatMessage, ChatResponse } from "@/types/chat";
import { ChatCardRenderer } from "@/components/chat/ChatCard";
import { ExpandableCardList } from "@/components/chat/ExpandableCardList";
import { SuggestionChips } from "@/components/chat/SuggestionChips";

// ── Constants ──
const hintPhrases = [
  "의뢰인 진술과 카톡 내용을 토대로 사실 관계만 정리해줘...",
  "최근 사건 손해배상 청구 소장 초안을 작성해줘...",
  "오늘 상담한 사건과 유사한 판례를 찾아서 비교해줘...",
];

const TYPING_SPEED = 58; // ms per character
const PAUSE_AFTER_COMPLETE = 2000; // ms pause after phrase is fully typed
const FINAL_HINT = "AI 사건 분석, 초안 작성, 유사 판례 검색 등을 도와드립니다.";


// ── Typing Hint Hook ──
function useTypingHint(active: boolean, userStartedTyping: boolean) {
  const [hintText, setHintText] = useState("");
  const [hintDone, setHintDone] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!active || hintDone || userStartedTyping) {
      cancelledRef.current = true;
      return;
    }

    cancelledRef.current = false;
    let timeout: ReturnType<typeof setTimeout>;

    async function run() {
      // 홈 화면 인식 후 타이핑 시작하도록 초기 딜레이
      await new Promise<void>((r) => {
        timeout = setTimeout(r, 800);
      });
      if (cancelledRef.current) return;

      for (let p = 0; p < hintPhrases.length; p++) {
        if (cancelledRef.current) return;
        const phrase = hintPhrases[p];

        // Type each character
        for (let i = 0; i <= phrase.length; i++) {
          if (cancelledRef.current) return;
          await new Promise<void>((r) => {
            timeout = setTimeout(r, TYPING_SPEED);
          });
          if (cancelledRef.current) return;
          setHintText(phrase.slice(0, i));
        }

        // Pause after full phrase
        if (cancelledRef.current) return;
        await new Promise<void>((r) => {
          timeout = setTimeout(r, PAUSE_AFTER_COMPLETE);
        });

        // Clear instantly
        if (cancelledRef.current) return;
        setHintText("");
      }

      // 최종 멘트 타이핑 후 유지
      if (cancelledRef.current) return;
      for (let i = 0; i <= FINAL_HINT.length; i++) {
        if (cancelledRef.current) return;
        await new Promise<void>((r) => {
          timeout = setTimeout(r, TYPING_SPEED);
        });
        if (cancelledRef.current) return;
        setHintText(FINAL_HINT.slice(0, i));
      }

      // All done — hintText stays as FINAL_HINT
      setHintDone(true);
    }

    run();

    return () => {
      cancelledRef.current = true;
      clearTimeout(timeout);
    };
  }, [active, hintDone, userStartedTyping]);

  // If user starts typing, immediately kill the hint
  useEffect(() => {
    if (userStartedTyping) {
      cancelledRef.current = true;
      setHintText("");
      setHintDone(true);
    }
  }, [userStartedTyping]);

  return { hintText, hintDone };
}

// ── Types ──
interface OutletContextType {
  userInfo?: {
    id: number;
    name: string;
    email: string;
    role?: string;
  };
}

function getRoleTitle(role?: string): string {
  if (role === "lawyer") return " 변호사";
  if (role === "legal-officer") return " 법무사";
  return "";
}

function getRandomGreeting(name?: string, role?: string): string {
  const hour = new Date().getHours();
  const displayName = name
    ? `${name}${getRoleTitle(role)}님`
    : undefined;

  const greetings: string[] = [
    "무엇이든 도와드릴게요.",
    "어떤 업무를 함께할까요?",
  ];

  if (displayName) {
    greetings.push(`${displayName}, 안녕하세요!`);
  }

  if (hour >= 5 && hour < 12) {
    greetings.push("좋은 아침이에요! 오늘은 어떤 사건을 볼까요?");
    if (displayName) greetings.push(`${displayName}, 새로운 하루가 시작됐어요.`);
  } else if (hour >= 12 && hour < 18) {
    greetings.push("좋은 오후에요! 진행 중인 업무를 이어볼까요?");
    if (displayName) greetings.push(`${displayName}, 좋은 오후에요.`);
  } else {
    greetings.push("오늘도 수고 많으셨어요.");
    greetings.push("마무리할 업무가 있으신가요?");
    if (displayName) greetings.push(`${displayName}, 늦은 시간까지 고생이 많아요.`);
  }

  return greetings[Math.floor(Math.random() * greetings.length)];
}

// ── Component ──
export function HomePage() {
  const navigate = useNavigate();
  const { userInfo } = useOutletContext<OutletContextType>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasMessages = messages.length > 0;
  const [greeting] = useState(() =>
    getRandomGreeting(userInfo?.name, userInfo?.role)
  );
  const [showHelp, setShowHelp] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const helpPopupRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLDivElement>(null);

  const userStartedTyping = input.length > 0 || hasMessages;
  const { hintText, hintDone } = useTypingHint(
    !hasMessages,
    userStartedTyping
  );

  // 도움말 팝업 외부 클릭 시 닫기
  useEffect(() => {
    if (!showHelp) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        helpPopupRef.current && !helpPopupRef.current.contains(target) &&
        helpBtnRef.current && !helpBtnRef.current.contains(target)
      ) {
        setShowHelp(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHelp]);

  // 도움말 가이드 애니메이션 시퀀스
  useEffect(() => {
    if (!showHelp) return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Step 1: 사이드바 기능 아이콘 발광 (2회, 1.6s × 2 = 3.2s)
    const sidebarMain = document.querySelector('[data-guide-target="sidebar-main"]');
    if (sidebarMain) {
      sidebarMain.classList.add("guide-pulse");
      timers.push(setTimeout(() => sidebarMain.classList.remove("guide-pulse"), 3200));
    }

    // Step 2: 사이드바 발광 종료 0.5초 후 채팅창 발광 (2회, 3.2s)
    timers.push(setTimeout(() => {
      if (chatInputRef.current) {
        chatInputRef.current.classList.add("guide-glow-soft");
        timers.push(setTimeout(() => {
          chatInputRef.current?.classList.remove("guide-glow-soft");
        }, 3200));
      }
    }, 3700));

    return () => {
      timers.forEach(clearTimeout);
      sidebarMain?.classList.remove("guide-pulse");
      chatInputRef.current?.classList.remove("guide-glow-soft");
    };
  }, [showHelp]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // 제안 클릭 처리
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      sendMessageToApi(suggestion);
    },
    []
  );

  const sendMessageToApi = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isTyping) return;

      setError(null);

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsTyping(true);

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      try {
        const res = await apiFetch("/api/v1/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            context: {
              current_page: "/",
              case_id: null,
              precedent_id: null,
            },
          }),
        });

        if (!res.ok) {
          throw new Error("채팅 요청에 실패했습니다.");
        }

        const data: ChatResponse = await res.json();
        console.log("[Chat] API 응답:", data);

        // navigate 액션이면 바로 이동
        if (data.action?.type === "navigate" && data.action.url) {
          console.log("[Chat] navigate 실행:", data.action.url);
          setIsTyping(false);
          navigate(data.action.url);
          return;
        }

        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.response,
          intent: data.intent,
          cards: data.cards ?? undefined,
          action: data.action ?? undefined,
          suggestions: data.suggestions ?? undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
        // 에러 시에도 메시지 표시
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "죄송합니다. 요청을 처리하지 못했어요. 다시 시도해주세요.",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsTyping(false);
      }
    },
    [isTyping, navigate]
  );

  const sendMessage = sendMessageToApi;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleTextareaInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  };

  // Show native placeholder only when hint is done and input is empty
  const showNativePlaceholder = hintDone && !input;

  // --- Gradient Background ---
  const gradientBg = (
    <div
      className="absolute inset-0 pointer-events-none transition-opacity duration-700"
      style={{
        opacity: hasMessages ? 0.35 : 1,
        background: "linear-gradient(135deg, #FEF0DC 0%, #FEF0E6 25%, #FCEDF3 50%, #F4EFFE 75%, #EFEBFD 100%)",
        maskImage: "linear-gradient(to top, white 0%, white 20%, rgba(255,255,255,0) 65%)",
        WebkitMaskImage: "linear-gradient(to top, white 0%, white 20%, rgba(255,255,255,0) 65%)",
      }}
    />
  );

  // --- Landing Mode (no messages) ---
  if (!hasMessages) {
    return (
      <div
        className="relative flex flex-col items-center justify-center"
        style={{ height: "calc(100vh - 56px)" }}
      >
        {gradientBg}

        <div className="relative z-10 flex flex-col items-center w-full max-w-2xl px-4">
          {/* Greeting */}
          <div className="mb-12 text-center">
            <h1 className="text-[32px] font-semibold text-foreground tracking-tight">
              {greeting}
            </h1>
            <p className="mt-2 text-muted-foreground" style={{ fontSize: '0.935rem' }}>
              업무와 관련된 질문을 입력해 주세요.
            </p>
          </div>

          {/* Chat Input */}
          <div className="w-full relative mb-12">
            <div ref={chatInputRef} className="w-full flex items-end gap-2 bg-card border border-border/50 rounded-2xl px-4 py-3 shadow-sm focus-within:border-primary/40 focus-within:shadow-md transition-all">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onInput={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  placeholder=""
                  rows={1}
                  className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none leading-relaxed"
                  style={{ maxHeight: 160 }}
                />
                {/* Typing hint overlay / placeholder (동일 위치) */}
                {!input && (
                  <div className="absolute inset-0 flex items-center pointer-events-none text-sm leading-relaxed" style={{ color: '#A0A7B5' }}>
                    {hintText}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: input.trim()
                    ? "linear-gradient(135deg, #6D5EF5, #A78BFA)"
                    : "var(--muted)",
                }}
              >
                <ArrowUp className="h-4 w-4 text-white" />
              </button>
            </div>

            {/* Help icon — absolute, 채팅창 레이아웃에 영향 없음 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={helpBtnRef}
                  type="button"
                  onClick={() => setShowHelp((v) => !v)}
                  className="absolute top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-muted/60"
                  style={{ color: 'var(--text-light)', right: '-3rem' }}
                >
                  <HelpCircle className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={4} className="bg-[var(--card)] text-[var(--text-muted)] border border-[var(--soft-border)] shadow-sm">도움말</TooltipContent>
            </Tooltip>

            {/* Help popup */}
            {showHelp && (
              <div ref={helpPopupRef} className="absolute right-0 top-full mt-2 w-80 bg-card rounded-xl border border-border/60 shadow-lg p-5 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-semibold text-foreground">좌측 사이드바</span>
                  <button type="button" onClick={() => setShowHelp(false)} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-2 text-[13px] text-muted-foreground leading-relaxed">
                  <p><span className="font-medium text-foreground">①</span> <strong className="text-foreground">사건 관리</strong> - 새 사건 등록 & AI 분석</p>
                  <p><span className="font-medium text-foreground">②</span> <strong className="text-foreground">파일 관리</strong> — 증거 · 관련 문서 등 원본 파일 관리</p>
                  <p><span className="font-medium text-foreground">③</span> <strong className="text-foreground">판례 검색</strong> — 참고 판례 검색</p>
                </div>
                <div className="border-t border-border/40 mt-3 pt-3 text-[13px] leading-relaxed">
                  <p className="font-semibold text-foreground mb-1.5">채팅 에이전트</p>
                  <p className="text-muted-foreground">AI 어시스턴트에게 자유롭게 지시하세요.</p>
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex gap-5 justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate("/cases")}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-medium transition-opacity hover:opacity-85"
                  style={{
                    background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)",
                    color: "#fff",
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                  최근 사건
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>최근 사건 바로가기</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => sendMessage("마지막 대화를 이어서 진행해줘")}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-medium transition-opacity hover:opacity-85"
                  style={{
                    background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)",
                    color: "#fff",
                  }}
                >
                  <MessageSquare className="h-4 w-4" />
                  지난 대화
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>이전 대화 이어가기</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  }

  // --- Chat Mode (has messages) ---
  return (
    <div
      className="relative flex flex-col"
      style={{ height: "calc(100vh - 56px)" }}
    >
      {gradientBg}

      {/* Messages */}
      <ScrollArea className="flex-1 relative z-10" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          {messages.map((msg, idx) => (
            <div key={msg.id} className="space-y-3">
              <div
                className={
                  msg.role === "user" ? "flex justify-end" : "flex justify-start gap-3"
                }
              >
                {msg.role === "assistant" && (
                  <div
                    className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
                    style={{
                      background: "linear-gradient(135deg, #6D5EF5, #A78BFA)",
                    }}
                  >
                    <Scale className="h-4 w-4 text-white" />
                  </div>
                )}
                <div
                  className={
                    msg.role === "user"
                      ? "max-w-[75%] px-4 py-3 rounded-2xl rounded-br-md text-sm text-primary-foreground whitespace-pre-wrap leading-relaxed"
                      : "max-w-[75%] px-4 py-3 rounded-2xl rounded-tl-md bg-card border border-border/40 text-sm text-card-foreground leading-relaxed prose prose-sm prose-slate dark:prose-invert max-w-none"
                  }
                  style={
                    msg.role === "user"
                      ? { background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)" }
                      : undefined
                  }
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>

              {/* 리치 카드 렌더링 */}
              {msg.role === "assistant" && msg.cards && msg.cards.length > 0 && (
                <div className="ml-11">
                  <ExpandableCardList cards={msg.cards} initialCount={3} />
                </div>
              )}

              {/* 제안 칩 렌더링 (마지막 AI 메시지에만) */}
              {msg.role === "assistant" &&
                msg.suggestions &&
                msg.suggestions.length > 0 &&
                idx === messages.length - 1 && (
                  <div className="ml-11">
                    <SuggestionChips
                      suggestions={msg.suggestions}
                      onSelect={handleSuggestionClick}
                    />
                  </div>
                )}
            </div>
          ))}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex justify-start gap-3">
              <div
                className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
                style={{
                  background: "linear-gradient(135deg, #6D5EF5, #A78BFA)",
                }}
              >
                <Scale className="h-4 w-4 text-white" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-card border border-border/40 flex items-center gap-1.5">
                <span className="typing-dot w-2 h-2 rounded-full bg-muted-foreground/50" />
                <span className="typing-dot w-2 h-2 rounded-full bg-muted-foreground/50" />
                <span className="typing-dot w-2 h-2 rounded-full bg-muted-foreground/50" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom Fixed Input */}
      <div className="relative z-10 border-t border-border/30 bg-card/80 backdrop-blur-sm px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 bg-card border border-border/50 rounded-2xl px-4 py-3 shadow-sm focus-within:border-primary/40 focus-within:shadow-md transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none leading-relaxed"
              style={{ maxHeight: 160 }}
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isTyping}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background:
                  input.trim() && !isTyping
                    ? "linear-gradient(135deg, #6D5EF5, #A78BFA)"
                    : "var(--muted)",
              }}
            >
              <ArrowUp className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
