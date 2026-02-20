import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Mark } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { LawRefDecoration, type LawRefClickData } from "./law-ref-decoration";
import "./tiptap-editor.css";

// AI가 채운 텍스트 전용 인라인 마크
const AiFilledMark = Mark.create({
  name: "aiFilled",
  inclusive: false, // 커서가 마크 경계에 있을 때 새 입력은 마크 밖으로
  parseHTML() {
    return [{ tag: 'span[data-ai-filled]' }];
  },
  renderHTML() {
    return ["span", { "data-ai-filled": "true" }, 0];
  },
});

interface TiptapEditorProps {
  initialContent: string;
  onChange: (html: string) => void;
  onEditorReady?: (editor: Editor) => void;
  onLawRefClick?: (data: LawRefClickData) => void;
  placeholder?: string;
  className?: string;
}

export function TiptapEditor({
  initialContent,
  onChange,
  onEditorReady,
  onLawRefClick,
  placeholder = "",
  className = "",
}: TiptapEditorProps) {
  // useRef로 콜백 안정화 (TipTap extensions는 초기화 시 한 번만 읽힘)
  const lawRefCallbackRef = useRef(onLawRefClick);
  lawRefCallbackRef.current = onLawRefClick;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      AiFilledMark,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Placeholder.configure({
        placeholder,
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableCell,
      TableHeader,
      LawRefDecoration.configure({
        onLawRefClick: (data: LawRefClickData) => {
          lawRefCallbackRef.current?.(data);
        },
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
    },
  });

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Sync initialContent changes from outside (AI generation, template selection)
  useEffect(() => {
    if (editor && initialContent !== undefined) {
      const currentHtml = editor.getHTML();
      if (currentHtml !== initialContent) {
        editor.commands.setContent(initialContent);
      }
    }
  }, [editor, initialContent]);

  return (
    <div className={className}>
      <EditorContent editor={editor} className="h-full overflow-y-auto" />
    </div>
  );
}
