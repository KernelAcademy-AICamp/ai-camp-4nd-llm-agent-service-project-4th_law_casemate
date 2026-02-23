import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed
      prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-headings:text-foreground
      prose-h2:text-base prose-h3:text-sm
      prose-p:my-1.5 prose-p:text-sm prose-p:text-card-foreground
      prose-li:text-sm prose-li:text-card-foreground prose-li:my-0.5
      prose-strong:text-foreground
      prose-table:text-xs
      prose-th:px-2 prose-th:py-1 prose-th:text-left
      prose-td:px-2 prose-td:py-1
      prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
