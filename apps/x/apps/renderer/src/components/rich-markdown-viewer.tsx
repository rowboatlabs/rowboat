import { useEffect, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
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

export function RichMarkdownViewer({ content, onToggleTask, onOpenLink }: {
  content: string
  /** Makes read-only checkboxes tappable — called with the task's index in document order. The content prop is the source of truth: pass the updated markdown back in. */
  onToggleTask?: (index: number, checked: boolean) => void
  /** Anchor-click interception; return true when handled (e.g. an in-app relative link). Unhandled links keep the default open-in-browser behavior. */
  onOpenLink?: (href: string) => boolean
}) {
  // The editor is created once; these refs keep late callback props live, and
  // editorRef lets extension callbacks (configured before useEditor returns)
  // reach the instance.
  const onToggleTaskRef = useRef(onToggleTask)
  onToggleTaskRef.current = onToggleTask
  const onOpenLinkRef = useRef(onOpenLink)
  onOpenLinkRef.current = onOpenLink
  const editorRef = useRef<Editor | null>(null)
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
        // Only when a handler is mounted: otherwise read-only checkboxes stay
        // disabled (configuring this at all makes TipTap enable them).
        ...(onToggleTask
          ? {
              onReadOnlyChecked: (node, checked) => {
                const cb = onToggleTaskRef.current
                const instance = editorRef.current
                if (!cb || !instance) return false
                let index = -1
                let seen = 0
                instance.state.doc.descendants((n) => {
                  if (n.type.name === 'taskItem') {
                    if (n === node) index = seen
                    seen += 1
                  }
                  return true
                })
                if (index === -1) return false
                cb(index, checked)
                // false: the flipped markdown comes back through `content`.
                return false
              },
            }
          : {}),
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
      handleDOMEvents: {
        // Runs before Link's openOnClick plugin; returning true stops it.
        click: (_view, event) => {
          const cb = onOpenLinkRef.current
          if (!cb) return false
          const anchor = (event.target as HTMLElement | null)?.closest?.('a')
          const href = anchor?.getAttribute('href')
          if (!href) return false
          if (!cb(href)) return false
          event.preventDefault()
          return true
        },
      },
    },
  })
  editorRef.current = editor

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
