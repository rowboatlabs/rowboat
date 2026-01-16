"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";
import TurndownService from "turndown";
import { marked } from "marked";
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./tiptap-markdown-editor.css";

interface TiptapMarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

// Configure marked to parse markdown
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Configure turndown to convert HTML back to markdown
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

type ToolbarButtonProps = {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

function ToolbarButton({ icon: Icon, label, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`tiptap-toolbar-button ${active ? "is-active" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} strokeWidth={2.25} />
    </button>
  );
}

export function TiptapMarkdownEditor({
  content,
  onChange,
  readOnly = false,
  placeholder = "Start typing...",
}: TiptapMarkdownEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    content: content ? (marked.parse(content) as string) : "",
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: {
          HTMLAttributes: {
            class: "code-block",
          },
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
        autolink: true,
      }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap-markdown-editor-content",
      },
    },
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const markdown = turndownService.turndown(html);
      onChange(markdown);
    },
  });

  // Keep editor content in sync when a new artifact is selected
  useEffect(() => {
    if (!editor) return;

    const currentMarkdown = turndownService.turndown(editor.getHTML());
    if ((currentMarkdown || "").trim() === (content || "").trim()) return;

    editor.commands.setContent(content ? (marked.parse(content) as string) : "");
  }, [editor, content]);

  if (!editor) {
    return null;
  }

  const handleLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Paste or type a link", previousUrl ?? "");

    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="tiptap-markdown-editor">
      {!readOnly && (
        <div className="tiptap-markdown-toolbar">
          <div className="tiptap-toolbar-group">
            <ToolbarButton
              icon={Undo2}
              label="Undo"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
            />
            <ToolbarButton
              icon={Redo2}
              label="Redo"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
            />
          </div>
          <div className="tiptap-toolbar-separator" aria-hidden />
          <div className="tiptap-toolbar-group">
            <ToolbarButton
              icon={Bold}
              label="Bold"
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolbarButton
              icon={Italic}
              label="Italic"
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolbarButton
              icon={Strikethrough}
              label="Strike"
              active={editor.isActive("strike")}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <ToolbarButton
              icon={Code2}
              label="Code"
              active={editor.isActive("code")}
              onClick={() => editor.chain().focus().toggleCode().run()}
            />
          </div>
          <div className="tiptap-toolbar-separator" aria-hidden />
          <div className="tiptap-toolbar-group">
            <ToolbarButton
              icon={Heading1}
              label="Heading 1"
              active={editor.isActive("heading", { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            />
            <ToolbarButton
              icon={Heading2}
              label="Heading 2"
              active={editor.isActive("heading", { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolbarButton
              icon={Heading3}
              label="Heading 3"
              active={editor.isActive("heading", { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            />
          </div>
          <div className="tiptap-toolbar-separator" aria-hidden />
          <div className="tiptap-toolbar-group">
            <ToolbarButton
              icon={List}
              label="Bullet list"
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            />
            <ToolbarButton
              icon={ListOrdered}
              label="Numbered list"
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            />
            <ToolbarButton
              icon={Quote}
              label="Quote"
              active={editor.isActive("blockquote")}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            />
            <ToolbarButton
              icon={Code2}
              label="Code block"
              active={editor.isActive("codeBlock")}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            />
            <ToolbarButton
              icon={Minus}
              label="Divider"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
            />
          </div>
          <div className="tiptap-toolbar-separator" aria-hidden />
          <div className="tiptap-toolbar-group">
            <ToolbarButton
              icon={Link2}
              label="Link"
              active={editor.isActive("link")}
              onClick={handleLink}
            />
          </div>
          <div className="tiptap-toolbar-pill">Markdown</div>
        </div>
      )}
      <div className="tiptap-editor-pane">
        <div className="tiptap-pane-header">
          <span className="tiptap-pane-title">Editor</span>
          <span className="tiptap-pane-hint">Markdown + shortcuts</span>
        </div>
        <div className="tiptap-editor-surface">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
