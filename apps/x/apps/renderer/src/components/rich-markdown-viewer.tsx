import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import { TaskBlockExtension } from '@/extensions/task-block'
import { PromptBlockExtension } from '@/extensions/prompt-block'
import { ImageBlockExtension } from '@/extensions/image-block'
import { EmbedBlockExtension } from '@/extensions/embed-block'
import { IframeBlockExtension } from '@/extensions/iframe-block'
import { ChartBlockExtension } from '@/extensions/chart-block'
import { TableBlockExtension } from '@/extensions/table-block'
import { CalendarBlockExtension } from '@/extensions/calendar-block'
import { EmailBlockExtension, EmailsBlockExtension } from '@/extensions/email-block'
import { TranscriptBlockExtension } from '@/extensions/transcript-block'
import { MermaidBlockExtension } from '@/extensions/mermaid-block'
import { WikiLink } from '@/extensions/wiki-link'
import '@/styles/editor.css'

const BLANK_LINE_MARKER = '\u200B'

function preprocessMarkdown(markdown: string): string {
  return markdown.replace(/\n{3,}/g, (match) => {
    const emptyParagraphs = match.length - 2
    let result = '\n\n'
    for (let i = 0; i < emptyParagraphs; i += 1) {
      result += BLANK_LINE_MARKER + '\n\n'
    }
    return result
  })
}

export function RichMarkdownViewer({ content }: { content: string }) {
  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        link: false,
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      TaskBlockExtension,
      PromptBlockExtension,
      ImageBlockExtension,
      EmbedBlockExtension,
      IframeBlockExtension,
      ChartBlockExtension,
      TableBlockExtension,
      CalendarBlockExtension,
      EmailsBlockExtension,
      EmailBlockExtension,
      TranscriptBlockExtension,
      MermaidBlockExtension,
      WikiLink,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TableKit.configure({
        table: { resizable: false },
      }),
      Markdown.configure({
        html: true,
        breaks: true,
        tightLists: false,
        transformCopiedText: false,
        transformPastedText: false,
      }),
    ],
    content: preprocessMarkdown(content),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none',
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.chain().setMeta('addToHistory', false).setContent(preprocessMarkdown(content)).run()
  }, [content, editor])

  return (
    <div className="tiptap-editor rich-markdown-viewer">
      <EditorContent editor={editor} />
    </div>
  )
}
