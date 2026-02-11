"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Scale, ArrowUp, FolderOpen, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// ── Types ──
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// ── Constants ──
const hintPhrases = [
  "의뢰인 진술과 카톡 내용을 토대로 사실 관계만 정리해줘...",
  "오늘 상담한 사건과 유사한 사건 및 판례를 검색해줘...",
];

const TYPING_SPEED = 58; // ms per character
const PAUSE_AFTER_COMPLETE = 2000; // ms pause after phrase is fully typed

const dummyResponses: Record<string, string> = {
  분석: "사건의 주요 쟁점을 분석해 드리겠습니다.\n\n1. **계약 위반 여부**: 당사자 간 계약서 제3조의 이행 의무 충족 여부가 핵심입니다.\n2. **손해배상 범위**: 직접 손해와 간접 손해의 인과관계를 입증해야 합니다.\n3. **시효 문제**: 청구권 소멸시효(3년)의 기산점 확인이 필요합니다.\n\n추가 정보를 입력해 주시면 더 상세한 분석이 가능합니다.",
  판례: "유사 판례를 검색하고 있습니다.\n\n**대법원 2023다12345** - 계약 불이행에 따른 손해배상 청구 사건\n- 판결 요지: 계약상 의무 불이행 시 통상손해와 특별손해를 구분하여 배상 범위를 산정\n- 시사점: 예견 가능성 입증이 특별손해 인정의 핵심\n\n**서울고등법원 2022나56789** - 용역계약 해지 분쟁\n- 판결 요지: 일방적 해지 시 신뢰이익 보호 원칙 적용",
  계약서: "계약서 검토를 도와드리겠습니다.\n\n검토할 계약서를 업로드해 주시거나, 주요 내용을 입력해 주시면 다음 항목을 중심으로 분석합니다:\n\n- **당사자 정보** 및 권리/의무 관계\n- **위험 조항** (면책, 손해배상 제한, 준거법)\n- **해지/해제 조건**\n- **분쟁 해결 방법** (중재/소송)\n\n사건 관리 페이지에서 파일을 첨부할 수도 있습니다.",
  소장: "소장 초안 작성을 도와드리겠습니다.\n\n기본 구조를 안내해 드립니다:\n\n1. **당사자 표시**: 원고/피고 인적사항\n2. **청구취지**: 구체적 청구 내용\n3. **청구원인**: 사실관계 및 법률적 근거\n4. **입증방법**: 증거 목록\n\n어떤 유형의 소송인지 알려주시면 맞춤형 초안을 작성해 드리겠습니다.\n(예: 손해배상, 임금청구, 부당해고 등)",
};

function getDummyResponse(input: string): string {
  const lower = input.toLowerCase();
  for (const [keyword, response] of Object.entries(dummyResponses)) {
    if (lower.includes(keyword)) return response;
  }
  return `말씀하신 내용을 확인했습니다.\n\n"${input}"\n\n해당 요청에 대해 분석을 진행하겠습니다. 사건 관리 페이지에서 관련 사건을 선택하시면 더 정확한 결과를 받으실 수 있습니다.\n\n추가 질문이 있으시면 언제든지 물어보세요.`;
}

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

      // All done
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasMessages = messages.length > 0;
  const [greeting] = useState(() =>
    getRandomGreeting(userInfo?.name, userInfo?.role)
  );

  const userStartedTyping = input.length > 0 || hasMessages;
  const { hintText, hintDone } = useTypingHint(
    !hasMessages,
    userStartedTyping
  );

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isTyping) return;

      const userMsg: Message = {
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

      setTimeout(() => {
        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: getDummyResponse(trimmed),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setIsTyping(false);
      }, 1500);
    },
    [isTyping]
  );

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
            <p className="mt-2 text-sm text-muted-foreground">
              업무와 관련된 질문을 입력해 주세요.
            </p>
          </div>

          {/* Chat Input */}
          <div className="w-full relative mb-12">
            <div className="flex items-end gap-2 bg-card border border-border/50 rounded-2xl px-4 py-3 shadow-sm focus-within:border-primary/40 focus-within:shadow-md transition-all">
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
                    {hintText || (hintDone ? "AI 사건 분석, 초안 작성, 유사 판례 검색 등을 도와드립니다." : "")}
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
          {messages.map((msg) => (
            <div
              key={msg.id}
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
                    : "max-w-[75%] px-4 py-3 rounded-2xl rounded-tl-md bg-card border border-border/40 text-sm text-card-foreground whitespace-pre-wrap leading-relaxed"
                }
                style={
                  msg.role === "user"
                    ? { background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)" }
                    : undefined
                }
              >
                {msg.content}
              </div>
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
