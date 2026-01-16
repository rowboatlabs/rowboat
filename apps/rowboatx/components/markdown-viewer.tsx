"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown-viewer.css";

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div className="markdown-viewer-wrapper markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}


