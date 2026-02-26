import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 판례번호: 2023도12345, 2024가합67890, 99나1234 등
const CASE_NUM_RE = /(\d{2,4}[가-힣]{1,3}\d+)/g;
// 법조문: 형법 제307조, 민법 제750조의2, 형사소송법 제200조 제1항 등
const LAW_ARTICLE_RE = /([가-힣]+(?:법|령|규칙)\s*제\d+조(?:의\d+)?(?:\s*제\d+항)?)/g;

// 두 패턴을 합친 통합 정규식
const LEGAL_REF_RE = new RegExp(
  `(${CASE_NUM_RE.source}|${LAW_ARTICLE_RE.source})`,
  "g"
);

interface MarkdownMessageProps {
  content: string;
  onLegalRefClick?: (ref: string) => void;
}

/**
 * 텍스트에서 판례번호/법조문을 감지하여 클릭 가능한 요소로 변환
 */
function injectLegalLinks(
  text: string,
  onClick?: (ref: string) => void,
): React.ReactNode[] {
  if (!onClick) return [text];

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(LEGAL_REF_RE.source, "g");
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const ref = match[1];
    parts.push(
      <span
        key={match.index}
        onClick={(e) => {
          e.stopPropagation();
          onClick(ref);
        }}
        className="text-primary underline decoration-primary/30 hover:decoration-primary cursor-pointer transition-colors"
      >
        {ref}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * React children을 순회하면서 문자열 노드에 법률 링크 주입
 */
function processChildren(
  children: React.ReactNode,
  onClick?: (ref: string) => void,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const parts = injectLegalLinks(child, onClick);
      return parts.length === 1 && typeof parts[0] === "string"
        ? child
        : <>{parts}</>;
    }
    if (React.isValidElement(child)) {
      const props = child.props as { children?: React.ReactNode };
      if (props.children) {
        return React.cloneElement(
          child as React.ReactElement<{ children?: React.ReactNode }>,
          {},
          processChildren(props.children, onClick),
        );
      }
    }
    return child;
  });
}

export function MarkdownMessage({ content, onLegalRefClick }: MarkdownMessageProps) {
  const components = useMemo(() => ({
    p: ({ children, ...props }: React.ComponentPropsWithoutRef<"p">) => (
      <p {...props}>{processChildren(children, onLegalRefClick)}</p>
    ),
    li: ({ children, ...props }: React.ComponentPropsWithoutRef<"li">) => (
      <li {...props}>{processChildren(children, onLegalRefClick)}</li>
    ),
  }), [onLegalRefClick]);

  return (
    <div className="text-sm prose prose-sm dark:prose-invert max-w-none
      prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-headings:text-foreground
      prose-h2:text-[15px] prose-h3:text-sm
      prose-p:my-1.5 prose-p:text-sm prose-p:leading-relaxed prose-p:text-card-foreground
      prose-li:text-sm prose-li:leading-relaxed prose-li:text-card-foreground prose-li:my-0.5
      prose-strong:text-foreground
      prose-table:text-xs
      prose-th:px-2 prose-th:py-1 prose-th:text-left
      prose-td:px-2 prose-td:py-1
      prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
