"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useState } from "react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import "./json-editor.css";

const lowlight = createLowlight(common);

interface JsonEditorProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
}

export function JsonEditor({ content, onChange, readOnly = false }: JsonEditorProps) {
  const [lineCount, setLineCount] = useState(1);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Disable default code block
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "json",
      }),
    ],
    immediatelyRender: false,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "json-editor-content",
      },
    },
    onUpdate: ({ editor }) => {
      // Extract text content from the code block
      const text = editor.getText();
      onChange(text);
      // Update line count
      setLineCount(text.split("\n").length || 1);
    },
  });

  // Set initial content and update when content prop changes
  useEffect(() => {
    if (!editor) return;
    
    const currentText = editor.getText().trim();
    if (currentText !== content.trim()) {
      // Set content using ProseMirror JSON structure
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: {
              language: "json",
            },
            content: content ? [
              {
                type: "text",
                text: content,
              },
            ] : [],
          },
        ],
      });
      setLineCount(content.split("\n").length || 1);
    }
  }, [editor, content]);

  if (!editor) {
    return null;
  }

  return (
    <div className="json-editor-wrapper">
      <div className="json-editor-line-numbers">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="json-editor-line-number">
            {i + 1}
          </div>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

