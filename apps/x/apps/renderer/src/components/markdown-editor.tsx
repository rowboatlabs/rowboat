import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useCallback, useRef } from 'react'
import { EditorToolbar } from './editor-toolbar'
import '@/styles/editor.css'

interface MarkdownEditorProps {
  content: string
  onChange: (markdown: string) => void
  placeholder?: string
}

export function MarkdownEditor({ content, onChange, placeholder = 'Start writing...' }: MarkdownEditorProps) {
  const isInternalUpdate = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isInternalUpdate.current) return
      const markdown = editor.storage.markdown.getMarkdown()
      onChange(markdown)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none',
      },
    },
  })

  // Update editor content when prop changes (e.g., file selection changes)
  useEffect(() => {
    if (editor && content !== undefined) {
      const currentContent = editor.storage.markdown?.getMarkdown() || ''
      if (currentContent !== content) {
        isInternalUpdate.current = true
        editor.commands.setContent(content)
        isInternalUpdate.current = false
      }
    }
  }, [editor, content])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      // The parent component handles saving via onChange
    }
  }, [])

  return (
    <div className="tiptap-editor" onKeyDown={handleKeyDown}>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
