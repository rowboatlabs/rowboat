import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { assistantEditorExtensions, assistantMarkdown, clipboardTable, tableContent } from '@/lib/assistant-editor'
import { usePromptInputController, useProviderKnowledgeFiles } from './ai-elements/prompt-input'
import { MentionPopover, ROWBOAT_MENTION_SENTINEL } from './mention-popover'
import { toKnowledgePath } from '@/lib/wiki-links'
import type { CaretCoordinates } from '@/lib/textarea-caret'
import '@/styles/assistant-composer.css'

interface Mention { from: number; to: number; query: string; position: CaretCoordinates }

export function AssistantComposer({ placeholder = 'Type your message...', active, focusTrigger, onSubmit, onEscape }: {
  placeholder?: string
  active: boolean
  focusTrigger: string
  onSubmit: () => void
  onEscape?: () => void
}) {
  const controller = usePromptInputController()
  const knowledge = useProviderKnowledgeFiles()
  const container = useRef<HTMLDivElement>(null)
  const [mention, setMention] = useState<Mention | null>(null)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const mentionOpen = !!mention && dismissed !== mention.from
  const latest = useRef({ controller, placeholder, onSubmit, onEscape, mentionOpen })
  useLayoutEffect(() => {
    latest.current = { controller, placeholder, onSubmit, onEscape, mentionOpen }
  }, [controller, placeholder, onSubmit, onEscape, mentionOpen])

  const updateCaret = (view: EditorView) => {
    const { selection } = view.state
    const { $from } = selection
    if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') {
      setMention(null); setDismissed(null); return
    }
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before)
    if (!match) { setMention(null); setDismissed(null); return }
    const from = selection.from - match[1].length - 1
    const rect = container.current?.getBoundingClientRect()
    const coords = view.coordsAtPos(from)
    setMention({ from, to: selection.from, query: match[1], position: {
      left: coords.left - (rect?.left ?? 0), top: coords.top - (rect?.top ?? 0), height: coords.bottom - coords.top,
    } })
  }

  const editor = useEditor({
    // TipTap calls this getter from its decoration plugin, after rendering.
    // eslint-disable-next-line react-hooks/refs
    extensions: assistantEditorExtensions(() => latest.current.placeholder),
    content: controller.textInput.value,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'Message', 'aria-multiline': 'true', class: 'assistant-composer-editor', dir: 'auto' },
      handleKeyDown: (view, event) => {
        if (view.composing || event.isComposing || event.keyCode === 229) return false
        if (latest.current.mentionOpen && ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return true
        if (event.key === 'Enter' && !event.shiftKey) {
          latest.current.onSubmit(); return true
        }
        if (event.key === 'Escape' && latest.current.onEscape) {
          latest.current.onEscape(); return true
        }
        return false
      },
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData
        if (!clipboard) return false
        // Spreadsheet apps can include an image representation alongside HTML.
        if (/<table[\s>]/i.test(clipboard.getData('text/html'))) return false
        const files = Array.from(clipboard.files)
        if (files.length) {
          latest.current.controller.attachments.add(files)
          return true
        }
        // HTML is parsed by the editor schema: tables, lists, links and marks
        // survive while scripts, handlers and unsupported markup are discarded.
        if (clipboard.getData('text/html') || view.state.selection.$from.parent.type.name === 'codeBlock') return false
        const rows = clipboardTable(clipboard.getData('text/plain'))
        if (!rows) return false
        const node = view.state.schema.nodeFromJSON(tableContent(rows))
        view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
        return true
      },
    },
    onUpdate: ({ editor }) => {
      latest.current.controller.textInput.setInput(assistantMarkdown(editor))
      const paths = new Set<string>()
      editor.state.doc.descendants(node => { if (node.type.name === 'assistantFileMention') paths.add(node.attrs.path) })
      for (const entry of latest.current.controller.mentions.mentions) {
        if (!paths.has(entry.path) && !editor.getText().includes(`@${entry.displayName}`)) latest.current.controller.mentions.removeMention(entry.id)
      }
    },
    onSelectionUpdate: ({ editor }) => updateCaret(editor.view),
    onTransaction: ({ editor, transaction }) => { if (transaction.docChanged) updateCaret(editor.view) },
  })

  useEffect(() => {
    if (editor && assistantMarkdown(editor) !== controller.textInput.value) {
      editor.commands.setContent(controller.textInput.value, { emitUpdate: false })
    }
  }, [editor, controller.textInput.value])

  useEffect(() => {
    if (!active || !editor) return
    editor.commands.focus(undefined, { scrollIntoView: false })
  }, [active, editor, focusTrigger])

  return <div ref={container} className="assistant-composer relative min-w-0">
    <EditorContent editor={editor} />
    <MentionPopover
      files={knowledge?.files ?? []} recentFiles={knowledge?.recentFiles} visibleFiles={knowledge?.visibleFiles}
      query={mention?.query ?? ''} position={mention?.position ?? null} containerRef={container} open={mentionOpen}
      onClose={() => setDismissed(mention?.from ?? null)}
      onSelect={(path, label) => {
        if (!editor || !mention) return
        const filePath = path === ROWBOAT_MENTION_SENTINEL ? null : toKnowledgePath(path)
        editor.chain().focus().insertContentAt({ from: mention.from, to: mention.to }, filePath
          ? [{ type: 'assistantFileMention', attrs: { path: filePath, label } }, { type: 'text', text: ' ' }]
          : `@${label} `).run()
        if (filePath) controller.mentions.addMention(filePath, label)
        setMention(null)
      }}
    />
  </div>
}
