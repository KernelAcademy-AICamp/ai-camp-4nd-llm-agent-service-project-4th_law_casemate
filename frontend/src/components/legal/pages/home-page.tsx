import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Scale, ArrowUp, FolderOpen, MessageSquare, HelpCircle, PanelRightClose, PanelRightOpen, RotateCcw } from "lucide-react";
import { TutorialOverlay, type TutorialStep } from "@/components/legal/tutorial-overlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useChat } from "@/contexts/chat-context";
import { AgentResultsPanel } from "@/components/legal/home-agent/agent-results-panel";
import { AgentStepsList } from "@/components/legal/home-agent/agent-steps-list";
import { MarkdownMessage } from "@/components/legal/home-agent/markdown-message";
import { SuggestionChips } from "@/components/legal/home-agent/suggestion-chips";

// ── Types ──
interface OutletContextType {
  userInfo?: {
    id: number;
    name: string;
    email: string;
    role?: string;
  };
}

// ── Constants ──
const hintPhrases = [
  "의뢰인 진술과 카톡 내용을 토대로 사실 관계만 정리해줘...",
  "최근 사건 손해배상 청구 소장 초안을 작성해줘...",
  "오늘 상담한 사건과 유사한 판례를 찾아서 비교해줘...",
];
const TYPING_SPEED = 58;
const PAUSE_AFTER_COMPLETE = 2000;
const FINAL_HINT = "AI 사건 분석, 초안 작성, 유사 판례 검색 등을 도와드립니다.";

const MIN_PANEL_WIDTH = 280;
const DEFAULT_PANEL_RATIO = 0.38;

const tutorialSteps: TutorialStep[] = [
  { target: "nav-cases", title: "사건 관리", description: "새 사건을 등록하고 AI가 자동으로 분석합니다.", placement: "right" },
  { target: "nav-evidence", title: "파일 관리", description: "증거, 관련 문서 등 원본 파일을 업로드하고 관리합니다.", placement: "right" },
  { target: "nav-precedents", title: "판례 검색", description: "키워드로 참고 판례를 검색할 수 있습니다.", placement: "right" },
  { target: "chat-input", title: "AI 어시스턴트", description: "AI에게 자유롭게 질문하고 법률 업무를 지시하세요.", placement: "top" },
];

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
      await new Promise<void>((r) => { timeout = setTimeout(r, 800); });
      if (cancelledRef.current) return;

      for (let p = 0; p < hintPhrases.length; p++) {
        if (cancelledRef.current) return;
        const phrase = hintPhrases[p];
        for (let i = 0; i <= phrase.length; i++) {
          if (cancelledRef.current) return;
          await new Promise<void>((r) => { timeout = setTimeout(r, TYPING_SPEED); });
          if (cancelledRef.current) return;
          setHintText(phrase.slice(0, i));
        }
        if (cancelledRef.current) return;
        await new Promise<void>((r) => { timeout = setTimeout(r, PAUSE_AFTER_COMPLETE); });
        if (cancelledRef.current) return;
        setHintText("");
      }

      if (cancelledRef.current) return;
      for (let i = 0; i <= FINAL_HINT.length; i++) {
        if (cancelledRef.current) return;
        await new Promise<void>((r) => { timeout = setTimeout(r, TYPING_SPEED); });
        if (cancelledRef.current) return;
        setHintText(FINAL_HINT.slice(0, i));
      }
      setHintDone(true);
    }

    run();
    return () => { cancelledRef.current = true; clearTimeout(timeout); };
  }, [active, hintDone, userStartedTyping]);

  useEffect(() => {
    if (userStartedTyping) {
      cancelledRef.current = true;
      setHintText("");
      setHintDone(true);
    }
  }, [userStartedTyping]);

  return { hintText };
}

// ── Helpers ──
function getRoleTitle(role?: string): string {
  if (role === "lawyer") return " 변호사";
  if (role === "legal-officer") return " 법무사";
  return "";
}

function getRandomGreeting(name?: string, role?: string): string {
  const hour = new Date().getHours();
  const displayName = name ? `${name}${getRoleTitle(role)}님` : undefined;
  const greetings: string[] = ["무엇이든 도와드릴게요.", "어떤 업무를 함께할까요?"];
  if (displayName) greetings.push(`${displayName}, 안녕하세요!`);
  if (hour >= 5 && hour < 12) {
    greetings.push("좋은 아침이에요! 오늘은 어떤 사건을 볼까요?");
  } else if (hour >= 12 && hour < 18) {
    greetings.push("좋은 오후에요! 진행 중인 업무를 이어볼까요?");
  } else {
    greetings.push("오늘도 수고 많으셨어요.");
  }
  return greetings[Math.floor(Math.random() * greetings.length)];
}

// ── Component ──
export function HomePage() {
  const navigate = useNavigate();
  const { userInfo } = useOutletContext<OutletContextType>();
  const { messages, addUserMessage, finalizeAssistantMessage, resetChat, hasMessages, agent } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [greeting] = useState(() => getRandomGreeting(userInfo?.name, userInfo?.role));
  const [showTutorial, setShowTutorial] = useState(false);

  // 결과 패널 상태
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const isDraggingRef = useRef(false);
  const panelAutoOpenedRef = useRef(false);

  const userStartedTyping = input.length > 0 || hasMessages;
  const { hintText } = useTypingHint(!hasMessages, userStartedTyping);

  // 첫 tool_start 시 우측 패널 자동 오픈
  useEffect(() => {
    if (agent.toolResults.length > 0 && !panelOpen && !panelAutoOpenedRef.current) {
      panelAutoOpenedRef.current = true;
      if (containerRef.current) {
        setPanelWidth(containerRef.current.offsetWidth * DEFAULT_PANEL_RATIO);
      }
      setPanelOpen(true);
    }
  }, [agent.toolResults.length, panelOpen]);

  // 스트리밍 완료 시 메시지 확정
  useEffect(() => {
    if (!agent.isStreaming && agent.streamingText) {
      finalizeAssistantMessage();
    }
    if (!agent.isStreaming) {
      panelAutoOpenedRef.current = false;
    }
  }, [agent.isStreaming, agent.streamingText, finalizeAssistantMessage]);

  const scrollToBottom = useCallback(() => {
    // Radix ScrollArea: 실제 스크롤 가능한 요소는 Root가 아닌 Viewport
    const viewport = scrollRef.current?.querySelector<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]"
    );
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, agent.streamingText, agent.steps, scrollToBottom]);

  // 리사이즈 핸들러
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(startWidth + delta, containerRef.current.offsetWidth * 0.6));
      setPanelWidth(newWidth);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [panelWidth]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || agent.isStreaming) return;

      addUserMessage(trimmed);
      setInput("");
      // 새 메시지 전송 시 패널 즉시 닫기 (도구 결과 오면 다시 열림)
      setPanelOpen(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      agent.send(trimmed);
    },
    [agent, addUserMessage]
  );

  // 판례번호/법조문 클릭 → 우측 패널 열기
  const handleLegalRefClick = useCallback(() => {
    if (agent.toolResults.length > 0 && !panelOpen) {
      if (containerRef.current) {
        setPanelWidth(containerRef.current.offsetWidth * DEFAULT_PANEL_RATIO);
      }
      setPanelOpen(true);
    }
  }, [agent.toolResults.length, panelOpen]);

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

  // ── Gradient Background ──
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

  // ── Input Bar (공유) ──
  const inputBar = (
    <div className="flex items-end gap-2 bg-card border border-border/50 rounded-2xl px-4 py-3 shadow-sm focus-within:border-primary/40 focus-within:shadow-md transition-all">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onInput={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder={hasMessages ? "메시지를 입력하세요..." : ""}
          rows={1}
          className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none leading-relaxed"
          style={{ maxHeight: 160 }}
        />
        {!hasMessages && !input && (
          <div className="absolute inset-0 flex items-center pointer-events-none text-sm leading-relaxed" style={{ color: "#A0A7B5" }}>
            {hintText}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => sendMessage(input)}
        disabled={!input.trim() || agent.isStreaming}
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        style={{
          background: input.trim() && !agent.isStreaming
            ? "linear-gradient(135deg, #6D5EF5, #A78BFA)"
            : "var(--muted)",
        }}
      >
        <ArrowUp className="h-4 w-4 text-white" />
      </button>
    </div>
  );

  // ── Assistant icon ──
  const assistantIcon = (
    <div
      className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
      style={{ background: "linear-gradient(135deg, #6D5EF5, #A78BFA)" }}
    >
      <Scale className="h-4 w-4 text-white" />
    </div>
  );

  // ── Landing Mode (no messages) ──
  if (!hasMessages) {
    return (
      <div className="relative flex flex-col items-center justify-center" style={{ height: "calc(100vh - 56px)" }}>
        {gradientBg}
        <div className="relative z-10 flex flex-col items-center w-full max-w-2xl px-4">
          <div className="mb-12 text-center">
            <h1 className="text-[32px] font-semibold text-foreground tracking-tight">{greeting}</h1>
            <p className="mt-2 text-muted-foreground" style={{ fontSize: "0.935rem" }}>
              업무와 관련된 질문을 입력해 주세요.
            </p>
          </div>

          <div className="w-full relative mb-12">
            <div data-guide="chat-input">{inputBar}</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setShowTutorial(true)}
                  className="absolute top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-muted/60"
                  style={{ color: "var(--text-light)", right: "-3rem" }}
                >
                  <HelpCircle className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={4} className="bg-[var(--card)] text-[var(--text-muted)] border border-[var(--soft-border)] shadow-sm">
                도움말
              </TooltipContent>
            </Tooltip>
            {showTutorial && <TutorialOverlay steps={tutorialSteps} onClose={() => setShowTutorial(false)} />}
          </div>

          <div className="flex gap-5 justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate("/cases")}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-medium transition-opacity hover:opacity-85"
                  style={{ background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)", color: "#fff" }}
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
                  style={{ background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)", color: "#fff" }}
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

  // ── Chat Mode (has messages) ──
  return (
    <div ref={containerRef} className="relative flex" style={{ height: "calc(100vh - 56px)" }}>
      {gradientBg}

      {/* Left: Chat Area */}
      <div className="flex-1 flex flex-col relative z-10 min-w-0">
        {/* Chat header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/20">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => resetChat()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>새 대화</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>대화를 초기화하고 처음으로</TooltipContent>
          </Tooltip>

          {agent.toolResults.length > 0 && (
            <button
              onClick={() => {
                if (!panelOpen && containerRef.current) {
                  setPanelWidth(containerRef.current.offsetWidth * DEFAULT_PANEL_RATIO);
                }
                setPanelOpen(!panelOpen);
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted/60 transition-colors"
            >
              {panelOpen ? <PanelRightClose className="h-4 w-4 text-muted-foreground" /> : <PanelRightOpen className="h-4 w-4 text-muted-foreground" />}
            </button>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.map((msg, idx) => (
              <div key={msg.id}>
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div
                      className="max-w-[75%] px-4 py-3 rounded-2xl rounded-br-md text-sm text-primary-foreground whitespace-pre-wrap leading-relaxed"
                      style={{ background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)" }}
                    >
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-start gap-3">
                      {assistantIcon}
                      <div className="max-w-[75%] flex flex-col gap-1">
                        {msg.steps && msg.steps.length > 0 && (
                          <AgentStepsList steps={msg.steps} />
                        )}
                        <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-card border border-border/40">
                          <MarkdownMessage content={msg.content} onLegalRefClick={handleLegalRefClick} />
                        </div>
                      </div>
                    </div>
                    {msg.suggestions && msg.suggestions.length > 0 && idx === messages.length - 1 && !agent.isStreaming && (
                      <SuggestionChips
                        suggestions={msg.suggestions}
                        onQuestionClick={sendMessage}
                        disabled={agent.isStreaming}
                      />
                    )}
                  </>
                )}
              </div>
            ))}

            {/* 스트리밍 중인 응답 */}
            {agent.isStreaming && (
              <div className="flex justify-start gap-3">
                {assistantIcon}
                <div className="max-w-[75%] flex flex-col gap-1">
                  {agent.steps.length > 0 && (
                    <AgentStepsList steps={agent.steps} />
                  )}

                  {agent.streamingText ? (
                    <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-card border border-border/40">
                      <MarkdownMessage content={agent.streamingText} onLegalRefClick={handleLegalRefClick} />
                      <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
                    </div>
                  ) : agent.steps.length === 0 ? (
                    <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-card border border-border/40 flex items-center gap-1.5">
                      <span className="typing-dot w-2 h-2 rounded-full bg-muted-foreground/50" />
                      <span className="typing-dot w-2 h-2 rounded-full bg-muted-foreground/50" />
                      <span className="typing-dot w-2 h-2 rounded-full bg-muted-foreground/50" />
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Error */}
            {agent.error && (
              <div className="flex justify-start gap-3">
                <div className="px-4 py-3 rounded-2xl bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                  {agent.error}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Bottom Input */}
        <div className="relative z-10 border-t border-border/30 bg-card/80 backdrop-blur-sm px-4 py-3">
          <div className="max-w-3xl mx-auto">{inputBar}</div>
        </div>
      </div>

      {/* Resize Divider */}
      {panelOpen && (
        <div
          onMouseDown={onResizeStart}
          className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20 flex-shrink-0"
        />
      )}

      {/* Right: Results Panel */}
      {panelOpen && (
        <div style={{ width: panelWidth, flexShrink: 0 }}>
          <AgentResultsPanel
            toolResults={agent.toolResults}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
