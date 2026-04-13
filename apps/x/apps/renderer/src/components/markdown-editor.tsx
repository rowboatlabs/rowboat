import { useEditor, EditorContent, Extension, Editor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { ImageUploadPlaceholderExtension, createImageUploadHandler } from '@/extensions/image-upload'
import { TaskBlockExtension } from '@/extensions/task-block'
import { ImageBlockExtension } from '@/extensions/image-block'
import { EmbedBlockExtension } from '@/extensions/embed-block'
import { ChartBlockExtension } from '@/extensions/chart-block'
import { TableBlockExtension } from '@/extensions/table-block'
import { CalendarBlockExtension } from '@/extensions/calendar-block'
import { EmailBlockExtension } from '@/extensions/email-block'
import { TranscriptBlockExtension } from '@/extensions/transcript-block'
import { MermaidBlockExtension } from '@/extensions/mermaid-block'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useCallback, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { Calendar, ChevronDown, ExternalLink } from 'lucide-react'

// Zero-width space used as invisible marker for blank lines
const BLANK_LINE_MARKER = '\u200B'

// Pre-process markdown to preserve blank lines before parsing
function preprocessMarkdown(markdown: string): string {
  // Convert sequences of 3+ newlines to paragraphs with zero-width space
  // - 2 newlines = normal paragraph break (0 empty paragraphs)
  // - 3 newlines = 1 blank line = 1 empty paragraph
  // - 4 newlines = 2 blank lines = 2 empty paragraphs
  // Formula: emptyParagraphs = totalNewlines - 2
  return markdown.replace(/\n{3,}/g, (match) => {
    const totalNewlines = match.length
    const emptyParagraphs = totalNewlines - 2
    let result = '\n\n'
    for (let i = 0; i < emptyParagraphs; i++) {
      result += BLANK_LINE_MARKER + '\n\n'
    }
    return result
  })
}

// Post-process to clean up any zero-width spaces in the output
function postprocessMarkdown(markdown: string): string {
  // Remove lines that contain only the zero-width space marker
  return markdown.split('\n').map(line => {
    if (line === BLANK_LINE_MARKER || line.trim() === BLANK_LINE_MARKER) {
      return ''
    }
    // Also remove zero-width spaces from other content
    return line.replace(new RegExp(BLANK_LINE_MARKER, 'g'), '')
  }).join('\n')
}

type JsonNode = {
  type?: string
  content?: JsonNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
}

// Convert a node's inline content (text + marks + wikiLinks + hardBreaks) to markdown text
function nodeToText(node: JsonNode): string {
  if (!node.content) return ''
  return node.content.map(child => {
    if (child.type === 'text') {
      let text = child.text || ''
      if (child.marks) {
        for (const mark of child.marks) {
          if (mark.type === 'bold') text = `**${text}**`
          else if (mark.type === 'italic') text = `*${text}*`
          else if (mark.type === 'code') text = `\`${text}\``
          else if (mark.type === 'link' && mark.attrs?.href) text = `[${text}](${mark.attrs.href})`
        }
      }
      return text
    } else if (child.type === 'wikiLink') {
      const path = (child.attrs?.path as string) || ''
      return path ? `[[${path}]]` : ''
    } else if (child.type === 'hardBreak') {
      return '\n'
    }
    return ''
  }).join('')
}

// Recursively serialize a list node (one line per item; nested lists indented two spaces)
function serializeList(listNode: JsonNode, indent: number): string[] {
  const lines: string[] = []
  const items = (listNode.content || []) as JsonNode[]
  items.forEach((item, index) => {
    const indentStr = '  '.repeat(indent)
    let prefix: string
    if (listNode.type === 'taskList') {
      const checked = item.attrs?.checked ? 'x' : ' '
      prefix = `- [${checked}] `
    } else if (listNode.type === 'orderedList') {
      prefix = `${index + 1}. `
    } else {
      prefix = '- '
    }
    const itemContent = (item.content || []) as JsonNode[]
    let firstPara = true
    itemContent.forEach(child => {
      if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
        lines.push(...serializeList(child, indent + 1))
      } else {
        const text = nodeToText(child)
        if (firstPara) {
          lines.push(indentStr + prefix + text)
          firstPara = false
        } else {
          lines.push(indentStr + '  ' + text)
        }
      }
    })
  })
  return lines
}

// Serialize a single top-level block to its markdown string. Empty paragraphs (or blank-marker
// paragraphs) return '' to signal "blank line slot" for the join logic in serializeBlocksToMarkdown.
function blockToMarkdown(node: JsonNode): string {
  switch (node.type) {
    case 'paragraph': {
      const text = nodeToText(node)
      if (!text || text === BLANK_LINE_MARKER || text.trim() === BLANK_LINE_MARKER) return ''
      return text
    }
    case 'heading': {
      const level = (node.attrs?.level as number) || 1
      return '#'.repeat(level) + ' ' + nodeToText(node)
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return serializeList(node, 0).join('\n')
    case 'taskBlock':
      return '```task\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'imageBlock':
      return '```image\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'embedBlock':
      return '```embed\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'chartBlock':
      return '```chart\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'tableBlock':
      return '```table\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'calendarBlock':
      return '```calendar\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'emailBlock':
      return '```email\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'transcriptBlock':
      return '```transcript\n' + (node.attrs?.data as string || '{}') + '\n```'
    case 'mermaidBlock':
      return '```mermaid\n' + (node.attrs?.data as string || '') + '\n```'
    case 'codeBlock': {
      const lang = (node.attrs?.language as string) || ''
      return '```' + lang + '\n' + nodeToText(node) + '\n```'
    }
    case 'blockquote': {
      const content = (node.content || []) as JsonNode[]
      return content.map(para => '> ' + nodeToText(para)).join('\n')
    }
    case 'horizontalRule':
      return '---'
    case 'wikiLink': {
      const path = (node.attrs?.path as string) || ''
      return `[[${path}]]`
    }
    case 'image': {
      const src = (node.attrs?.src as string) || ''
      const alt = (node.attrs?.alt as string) || ''
      return `![${alt}](${src})`
    }
    default:
      return ''
  }
}

// Pure helper: serialize a slice of top-level block nodes to markdown.
// Custom join: content blocks get \n\n before them, empty blocks add \n each.
// 1 empty paragraph = 3 newlines on disk (1 blank line).
function serializeBlocksToMarkdown(blocks: JsonNode[]): string {
  if (blocks.length === 0) return ''
  let result = ''
  for (let i = 0; i < blocks.length; i++) {
    const block = blockToMarkdown(blocks[i])
    const isContent = block !== ''
    if (i === 0) {
      result = block
    } else if (isContent) {
      result += '\n\n' + block
    } else {
      result += '\n'
    }
  }
  return result
}

// Custom function to get markdown that preserves empty paragraphs as blank lines
function getMarkdownWithBlankLines(editor: Editor): string {
  const json = editor.getJSON() as JsonNode
  if (!json.content) return ''
  return serializeBlocksToMarkdown(json.content as JsonNode[])
}

// Compute the cursor's 1-indexed line number in the markdown that getMarkdownWithBlankLines
// would produce. Used to attach precise line-references when inserting editor-context mentions.
function getCursorContextLine(editor: Editor): number {
  const $from = editor.state.selection.$from
  const json = editor.getJSON() as JsonNode
  const blocks = (json.content ?? []) as JsonNode[]
  if (blocks.length === 0) return 1

  const blockIndex = $from.index(0)
  if (blockIndex < 0 || blockIndex >= blocks.length) return 1

  // Line where the cursor's top-level block starts.
  // Joining: prefix + '\n\n' + nextContentBlock → next block sits two lines below the prefix's last line.
  let blockStartLine: number
  if (blockIndex === 0) {
    blockStartLine = 1
  } else {
    const prefix = serializeBlocksToMarkdown(blocks.slice(0, blockIndex))
    const prefixLineCount = prefix === '' ? 0 : prefix.split('\n').length
    blockStartLine = prefixLineCount + 2
  }

  return blockStartLine + computeWithinBlockOffset(blocks[blockIndex], $from)
}

// Lines into the cursor's top-level block. 0 for the common single-line cases (paragraph/heading);
// for multi-line containers, computed against how the block serializes.
function computeWithinBlockOffset(
  block: JsonNode,
  $from: { parentOffset: number; depth: number; index: (depth: number) => number }
): number {
  switch (block.type) {
    case 'paragraph':
    case 'heading': {
      // Each hardBreak before the cursor moves us down one rendered line.
      const offset = $from.parentOffset
      let pos = 0
      let hbCount = 0
      for (const child of (block.content ?? [])) {
        if (pos >= offset) break
        const size = child.type === 'text' ? (child.text?.length ?? 0) : 1
        if (child.type === 'hardBreak' && pos < offset) hbCount++
        pos += size
      }
      return hbCount
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
    case 'blockquote':
      // Item index within the container = lines into the block (one item per line for shallow lists/quotes).
      return $from.depth >= 1 ? $from.index(1) : 0
    case 'codeBlock': {
      // +1 for the opening ``` fence line, plus newlines within the code text before the cursor.
      const text = block.content?.[0]?.text ?? ''
      const before = text.substring(0, $from.parentOffset)
      return 1 + (before.match(/\n/g)?.length ?? 0)
    }
    default:
      return 0
  }
}
import { EditorToolbar } from './editor-toolbar'
import { FrontmatterProperties } from './frontmatter-properties'
import { WikiLink } from '@/extensions/wiki-link'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { ensureMarkdownExtension, normalizeWikiPath, wikiLabel } from '@/lib/wiki-links'
import { extractAllFrontmatterValues, buildFrontmatter } from '@/lib/frontmatter'
import { RowboatMentionPopover } from './rowboat-mention-popover'
import '@/styles/editor.css'

type RowboatMentionMatch = {
  range: { from: number; to: number }
}

type RowboatBlockEdit = {
  /** ProseMirror position of the taskBlock node */
  nodePos: number
  /** Existing instruction text */
  existingText: string
}

type WikiLinkConfig = {
  files: string[]
  recent: string[]
  onOpen: (path: string) => void
  onCreate: (path: string) => void | Promise<void>
}

// --- Meeting Event Banner ---

interface ParsedCalendarEvent {
  summary?: string
  start?: string
  end?: string
  location?: string
  htmlLink?: string
  conferenceLink?: string
  source?: string
}

function parseCalendarEvent(raw: string | undefined): ParsedCalendarEvent | null {
  if (!raw) return null
  // Strip surrounding quotes if present (YAML single-quoted string)
  let json = raw
  if ((json.startsWith("'") && json.endsWith("'")) || (json.startsWith('"') && json.endsWith('"'))) {
    json = json.slice(1, -1)
  }
  // Unescape doubled single quotes from YAML
  json = json.replace(/''/g, "'")
  try {
    return JSON.parse(json) as ParsedCalendarEvent
  } catch {
    return null
  }
}

function formatEventTime(start?: string, end?: string): string {
  if (!start) return ''
  const s = new Date(start)
  const startStr = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const startTime = s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (!end) return `${startStr} \u00b7 ${startTime}`
  const e = new Date(end)
  const endTime = e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${startStr} \u00b7 ${startTime} \u2013 ${endTime}`
}

function formatEventDate(start?: string): string {
  if (!start) return ''
  const s = new Date(start)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (s.toDateString() === today.toDateString()) return 'Today'
  if (s.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (s.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function MeetingEventBanner({ frontmatter }: { frontmatter: string | null | undefined }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!frontmatter) return null
  const fields = extractAllFrontmatterValues(frontmatter)
  if (fields.type !== 'meeting') return null

  const calStr = typeof fields.calendar_event === 'string' ? fields.calendar_event : undefined
  const cal = parseCalendarEvent(calStr)
  if (!cal) return null

  return (
    <div className="meeting-event-banner" ref={ref}>
      <button
        className="meeting-event-pill"
        onClick={() => setOpen(!open)}
      >
        <Calendar size={13} />
        {formatEventDate(cal.start)}
        <ChevronDown size={12} className={`meeting-event-chevron ${open ? 'meeting-event-chevron-open' : ''}`} />
      </button>
      {open && (
        <div className="meeting-event-dropdown">
          <div className="meeting-event-dropdown-header">
            <span className="meeting-event-dropdown-dot" />
            <div className="meeting-event-dropdown-info">
              <div className="meeting-event-dropdown-title">{cal.summary || 'Meeting'}</div>
              <div className="meeting-event-dropdown-time">{formatEventTime(cal.start, cal.end)}</div>
            </div>
          </div>
          {cal.htmlLink && (
            <button
              className="meeting-event-dropdown-link"
              onClick={() => window.open(cal.htmlLink, '_blank')}
            >
              <ExternalLink size={14} />
              Open in Google Calendar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// --- Editor ---

interface MarkdownEditorProps {
  content: string
  onChange: (markdown: string) => void
  onPrimaryHeadingCommit?: () => void
  preserveUntitledTitleHeading?: boolean
  placeholder?: string
  wikiLinks?: WikiLinkConfig
  onImageUpload?: (file: File) => Promise<string | null>
  editorSessionKey?: number
  onHistoryHandlersChange?: (handlers: { undo: () => boolean; redo: () => boolean } | null) => void
  editable?: boolean
  frontmatter?: string | null
  onFrontmatterChange?: (raw: string | null) => void
  onExport?: (format: 'md' | 'pdf' | 'docx') => void
  notePath?: string
}

type WikiLinkMatch = {
  range: { from: number; to: number }
  query: string
}

type SelectionHighlightRange = { from: number; to: number } | null

// Plugin key for the selection highlight
const selectionHighlightKey = new PluginKey('selectionHighlight')

// Create the selection highlight extension
const createSelectionHighlightExtension = (getRange: () => SelectionHighlightRange) => {
  return Extension.create({
    name: 'selectionHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: selectionHighlightKey,
          props: {
            decorations(state) {
              const range = getRange()
              if (!range) return DecorationSet.empty

              const { from, to } = range
              if (from >= to || from < 0 || to > state.doc.content.size) {
                return DecorationSet.empty
              }

              const decoration = Decoration.inline(from, to, {
                class: 'selection-highlight',
              })
              return DecorationSet.create(state.doc, [decoration])
            },
          },
        }),
      ]
    },
  })
}

const TabIndentExtension = Extension.create({
  name: 'tabIndent',
  addKeyboardShortcuts() {
    const indentText = '  '
    return {
      Tab: () => {
        // Always handle Tab so focus never leaves the editor.
        // First try list indentation; otherwise insert spaces.
        if (this.editor.can().sinkListItem('taskItem')) {
          void this.editor.commands.sinkListItem('taskItem')
          return true
        }
        if (this.editor.can().sinkListItem('listItem')) {
          void this.editor.commands.sinkListItem('listItem')
          return true
        }
        void this.editor.commands.insertContent(indentText)
        return true
      },
      'Shift-Tab': () => {
        // Always handle Shift+Tab so focus never leaves the editor.
        if (this.editor.can().liftListItem('taskItem')) {
          void this.editor.commands.liftListItem('taskItem')
          return true
        }
        if (this.editor.can().liftListItem('listItem')) {
          void this.editor.commands.liftListItem('listItem')
          return true
        }
        return true
      },
    }
  },
})

export interface MarkdownEditorHandle {
  /** Returns {path, lineNumber} for the cursor's current position, or null if no notePath / no editor. */
  getCursorContext: () => { path: string; lineNumber: number } | null
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  content,
  onChange,
  onPrimaryHeadingCommit,
  preserveUntitledTitleHeading = false,
  placeholder = 'Start writing...',
  wikiLinks,
  onImageUpload,
  editorSessionKey = 0,
  onHistoryHandlersChange,
  editable = true,
  frontmatter,
  onFrontmatterChange,
  onExport,
  notePath,
}, ref) {
  const isInternalUpdate = useRef(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [activeWikiLink, setActiveWikiLink] = useState<WikiLinkMatch | null>(null)
  const [anchorPosition, setAnchorPosition] = useState<{ left: number; top: number } | null>(null)
  const [selectionHighlight, setSelectionHighlight] = useState<SelectionHighlightRange>(null)
  const selectionHighlightRef = useRef<SelectionHighlightRange>(null)
  const [wikiCommandValue, setWikiCommandValue] = useState<string>('')
  const onPrimaryHeadingCommitRef = useRef(onPrimaryHeadingCommit)
  const wikiKeyStateRef = useRef<{ open: boolean; options: string[]; value: string }>({ open: false, options: [], value: '' })
  const handleSelectWikiLinkRef = useRef<(path: string) => void>(() => {})
  const [activeRowboatMention, setActiveRowboatMention] = useState<RowboatMentionMatch | null>(null)
  const [rowboatBlockEdit, setRowboatBlockEdit] = useState<RowboatBlockEdit | null>(null)
  const [rowboatAnchorTop, setRowboatAnchorTop] = useState<{ top: number; left: number; width: number } | null>(null)
  const rowboatBlockEditRef = useRef<RowboatBlockEdit | null>(null)

  // @ mention autocomplete state (analogous to wiki-link state)
  const [activeAtMention, setActiveAtMention] = useState<{ range: { from: number; to: number }; query: string } | null>(null)
  const [atAnchorPosition, setAtAnchorPosition] = useState<{ left: number; top: number } | null>(null)
  const [atCommandValue, setAtCommandValue] = useState<string>('')
  const atKeyStateRef = useRef<{ open: boolean; options: string[]; value: string }>({ open: false, options: [], value: '' })
  const handleSelectAtMentionRef = useRef<(value: string) => void>(() => {})

  // Keep ref in sync with state for the plugin to access
  selectionHighlightRef.current = selectionHighlight

  // Memoize the selection highlight extension
  const selectionHighlightExtension = useMemo(
    () => createSelectionHighlightExtension(() => selectionHighlightRef.current),
    []
  )

  useEffect(() => {
    onPrimaryHeadingCommitRef.current = onPrimaryHeadingCommit
  }, [onPrimaryHeadingCommit])

  const maybeCommitPrimaryHeading = useCallback((view: EditorView) => {
    const onCommit = onPrimaryHeadingCommitRef.current
    if (!onCommit) return
    const { selection, doc } = view.state
    if (!selection.empty) return

    const { $from } = selection
    if ($from.depth < 1 || $from.index(0) !== 0) return
    if (!['heading', 'paragraph'].includes($from.parent.type.name)) return

    const firstNode = doc.firstChild
    if (!firstNode || !['heading', 'paragraph'].includes(firstNode.type.name)) return

    onCommit()
  }, [])

  const preventTitleHeadingDemotion = useCallback((view: EditorView, event: KeyboardEvent) => {
    if (!preserveUntitledTitleHeading) return false
    if (event.key !== 'Backspace' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false

    const { selection } = view.state
    if (!selection.empty) return false

    const { $from } = selection
    if ($from.depth < 1 || $from.index(0) !== 0) return false
    if ($from.parent.type.name !== 'heading') return false

    const headingLevel = ((
      $from.parent.attrs as { level?: number } | null | undefined
    )?.level) ?? 0
    if (headingLevel !== 1) return false
    if ($from.parentOffset !== 0) return false
    if ($from.parent.textContent.length > 0) return false

    event.preventDefault()
    return true
  }, [preserveUntitledTitleHeading])

  const promoteFirstParagraphToTitleHeading = useCallback((view: EditorView) => {
    if (!preserveUntitledTitleHeading) return

    const { state, dispatch } = view
    const { selection } = state
    if (!selection.empty) return

    const { $from } = selection
    if ($from.depth < 1 || $from.index(0) !== 0) return
    if ($from.parent.type.name !== 'paragraph') return
    if ($from.parentOffset !== 0) return
    if ($from.parent.textContent.length > 0) return

    const headingType = state.schema.nodes.heading
    if (!headingType) return

    const tr = state.tr.setNodeMarkup($from.before(1), headingType, { level: 1 })
    dispatch(tr)
  }, [preserveUntitledTitleHeading])

  const editor = useEditor({
    editable,
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
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      ImageUploadPlaceholderExtension,
      TaskBlockExtension,
      ImageBlockExtension,
      EmbedBlockExtension,
      ChartBlockExtension,
      TableBlockExtension,
      CalendarBlockExtension,
      EmailBlockExtension,
      TranscriptBlockExtension,
      MermaidBlockExtension,
      WikiLink.configure({
        onCreate: wikiLinks?.onCreate
          ? (path) => {
              void wikiLinks.onCreate(path)
            }
          : undefined,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown.configure({
        html: true,
        breaks: true,
        tightLists: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      selectionHighlightExtension,
      TabIndentExtension,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isInternalUpdate.current) return
      let markdown = getMarkdownWithBlankLines(editor)
      // Post-process to clean up any markers and ensure blank lines are preserved
      markdown = postprocessMarkdown(markdown)
      onChange(markdown)
    },
    onBlur: ({ editor }) => {
      maybeCommitPrimaryHeading(editor.view)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none',
      },
      handleKeyDown: (view, event) => {
        const state = wikiKeyStateRef.current
        if (state.open) {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setActiveWikiLink(null)
            setAnchorPosition(null)
            setWikiCommandValue('')
            return true
          }

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (state.options.length === 0) return true
            event.preventDefault()
            event.stopPropagation()
            const currentIndex = Math.max(0, state.options.indexOf(state.value))
            const delta = event.key === 'ArrowDown' ? 1 : -1
            const nextIndex = (currentIndex + delta + state.options.length) % state.options.length
            setWikiCommandValue(state.options[nextIndex])
            return true
          }

          if (event.key === 'Enter' || event.key === 'Tab') {
            if (state.options.length === 0) return true
            event.preventDefault()
            event.stopPropagation()
            const selected = state.options.includes(state.value) ? state.value : state.options[0]
            handleSelectWikiLinkRef.current(selected)
            return true
          }
        }

        // @ mention autocomplete keyboard handling
        const atState = atKeyStateRef.current
        if (atState.open) {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setActiveAtMention(null)
            setAtAnchorPosition(null)
            setAtCommandValue('')
            return true
          }

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (atState.options.length === 0) return true
            event.preventDefault()
            event.stopPropagation()
            const currentIndex = Math.max(0, atState.options.indexOf(atState.value))
            const delta = event.key === 'ArrowDown' ? 1 : -1
            const nextIndex = (currentIndex + delta + atState.options.length) % atState.options.length
            setAtCommandValue(atState.options[nextIndex])
            return true
          }

          if (event.key === 'Enter' || event.key === 'Tab') {
            if (atState.options.length === 0) return true
            event.preventDefault()
            event.stopPropagation()
            const selected = atState.options.includes(atState.value) ? atState.value : atState.options[0]
            handleSelectAtMentionRef.current(selected)
            return true
          }
        }

        if (preventTitleHeadingDemotion(view, event)) {
          return true
        }

        const isPrintableKey = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
        if (isPrintableKey) {
          promoteFirstParagraphToTitleHeading(view)
        }

        if (
          event.key === 'Enter'
          && !event.shiftKey
          && !event.ctrlKey
          && !event.metaKey
          && !event.altKey
        ) {
          maybeCommitPrimaryHeading(view)
        }

        return false
      },
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        if (node.type.name === 'wikiLink') {
          event.preventDefault()
          wikiLinks?.onOpen?.(node.attrs.path)
          return true
        }
        return false
      },
    },
  }, [
    editorSessionKey,
    maybeCommitPrimaryHeading,
    preventTitleHeadingDemotion,
    promoteFirstParagraphToTitleHeading,
  ])

  const orderedFiles = useMemo(() => {
    if (!wikiLinks) return []
    const seen = new Set<string>()
    const ordered: string[] = []

    const addPath = (path: string) => {
      const normalized = normalizeWikiPath(path)
      if (!normalized || seen.has(normalized)) return
      seen.add(normalized)
      ordered.push(normalized)
    }

    wikiLinks.recent.forEach(addPath)
    wikiLinks.files.forEach(addPath)

    return ordered
  }, [wikiLinks])

  const updateWikiLinkState = useCallback(() => {
    if (!editor || !wikiLinks) return
    const { selection } = editor.state
    if (!selection.empty) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }

    const { $from } = selection
    if ($from.parent.type.spec.code) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }
    if ($from.marks().some((mark) => mark.type.spec.code)) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }

    const text = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\n')
    const textBefore = text.slice(0, $from.parentOffset)
    const triggerIndex = textBefore.lastIndexOf('[[')
    if (triggerIndex === -1 || textBefore.indexOf(']]', triggerIndex) !== -1) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }

    const matchText = textBefore.slice(triggerIndex)
    const query = matchText.slice(2)
    const range = { from: selection.from - matchText.length, to: selection.from }
    setActiveWikiLink({ range, query })

    const wrapper = wrapperRef.current
    if (!wrapper) {
      setAnchorPosition(null)
      return
    }

    const coords = editor.view.coordsAtPos(selection.from)
    const wrapperRect = wrapper.getBoundingClientRect()
    setAnchorPosition({
      left: coords.left - wrapperRect.left,
      top: coords.bottom - wrapperRect.top,
    })
  }, [editor, wikiLinks])

  useImperativeHandle(ref, () => ({
    getCursorContext: () => {
      if (!notePath || !editor) return null
      try {
        return { path: notePath, lineNumber: getCursorContextLine(editor) }
      } catch {
        return null
      }
    },
  }), [notePath, editor])

  const updateRowboatMentionState = useCallback(() => {
    if (!editor) return
    const { selection } = editor.state
    if (!selection.empty) {
      setActiveRowboatMention(null)
      setRowboatAnchorTop(null)
      return
    }

    const { $from } = selection
    if ($from.parent.type.spec.code) {
      setActiveRowboatMention(null)
      setRowboatAnchorTop(null)
      return
    }

    const text = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\n')
    const textBefore = text.slice(0, $from.parentOffset)

    // Match @rowboat at a word boundary (preceded by nothing or whitespace)
    const match = textBefore.match(/(^|\s)@rowboat$/)
    if (!match) {
      setActiveRowboatMention(null)
      setRowboatAnchorTop(null)
      return
    }

    const triggerStart = textBefore.length - '@rowboat'.length
    const from = selection.from - (textBefore.length - triggerStart)
    const to = selection.from
    setActiveRowboatMention({ range: { from, to } })

    const wrapper = wrapperRef.current
    if (!wrapper) {
      setRowboatAnchorTop(null)
      return
    }

    const coords = editor.view.coordsAtPos(selection.from)
    const wrapperRect = wrapper.getBoundingClientRect()
    const proseMirrorEl = wrapper.querySelector('.ProseMirror') as HTMLElement | null
    const pmRect = proseMirrorEl?.getBoundingClientRect()
    setRowboatAnchorTop({
      top: coords.top - wrapperRect.top + wrapper.scrollTop,
      left: pmRect ? pmRect.left - wrapperRect.left : 0,
      width: pmRect ? pmRect.width : wrapperRect.width,
    })
  }, [editor])

  // Detect @ trigger for autocomplete popover (similar to [[ detection)
  const updateAtMentionState = useCallback(() => {
    if (!editor) return
    const { selection } = editor.state
    if (!selection.empty) {
      setActiveAtMention(null)
      setAtAnchorPosition(null)
      return
    }

    const { $from } = selection
    // Skip code blocks
    if ($from.parent.type.spec.code) {
      setActiveAtMention(null)
      setAtAnchorPosition(null)
      return
    }
    // Skip inline code marks
    if ($from.marks().some((mark) => mark.type.spec.code)) {
      setActiveAtMention(null)
      setAtAnchorPosition(null)
      return
    }

    const text = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\n')
    const textBefore = text.slice(0, $from.parentOffset)

    // Find @ at a word boundary (start of line or preceded by whitespace)
    const atMatch = textBefore.match(/(^|[\s])@([a-zA-Z0-9]*)$/)
    if (!atMatch) {
      setActiveAtMention(null)
      setAtAnchorPosition(null)
      return
    }

    const query = atMatch[2] // text after @

    // If the full "@rowboat" is already typed, let updateRowboatMentionState handle it
    if (query === 'rowboat') {
      setActiveAtMention(null)
      setAtAnchorPosition(null)
      return
    }

    const atSymbolOffset = textBefore.lastIndexOf('@')
    const matchText = textBefore.slice(atSymbolOffset)
    const range = { from: selection.from - matchText.length, to: selection.from }
    setActiveAtMention({ range, query })

    const wrapper = wrapperRef.current
    if (!wrapper) {
      setAtAnchorPosition(null)
      return
    }

    const coords = editor.view.coordsAtPos(selection.from)
    const wrapperRect = wrapper.getBoundingClientRect()
    setAtAnchorPosition({
      left: coords.left - wrapperRect.left,
      top: coords.bottom - wrapperRect.top,
    })
  }, [editor])

  useEffect(() => {
    if (!editor || !wikiLinks) return
    editor.on('update', updateWikiLinkState)
    editor.on('selectionUpdate', updateWikiLinkState)
    return () => {
      editor.off('update', updateWikiLinkState)
      editor.off('selectionUpdate', updateWikiLinkState)
    }
  }, [editor, wikiLinks, updateWikiLinkState])

  useEffect(() => {
    if (!editor) return
    editor.on('update', updateRowboatMentionState)
    editor.on('selectionUpdate', updateRowboatMentionState)
    return () => {
      editor.off('update', updateRowboatMentionState)
      editor.off('selectionUpdate', updateRowboatMentionState)
    }
  }, [editor, updateRowboatMentionState])

  useEffect(() => {
    if (!editor) return
    editor.on('update', updateAtMentionState)
    editor.on('selectionUpdate', updateAtMentionState)
    return () => {
      editor.off('update', updateAtMentionState)
      editor.off('selectionUpdate', updateAtMentionState)
    }
  }, [editor, updateAtMentionState])

  // When a tell-rowboat block is clicked, compute anchor and open popover
  useEffect(() => {
    if (!rowboatBlockEdit || !editor) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const coords = editor.view.coordsAtPos(rowboatBlockEdit.nodePos)
    const wrapperRect = wrapper.getBoundingClientRect()
    const proseMirrorEl = wrapper.querySelector('.ProseMirror') as HTMLElement | null
    const pmRect = proseMirrorEl?.getBoundingClientRect()
    setRowboatAnchorTop({
      top: coords.top - wrapperRect.top + wrapper.scrollTop,
      left: pmRect ? pmRect.left - wrapperRect.left : 0,
      width: pmRect ? pmRect.width : wrapperRect.width,
    })
  }, [editor, rowboatBlockEdit])

  // Update editor content when prop changes (e.g., file selection changes)
  useEffect(() => {
    if (editor && content !== undefined) {
      const currentContent = getMarkdownWithBlankLines(editor)
      // Normalize for comparison (trim trailing whitespace from lines)
      const normalizeForCompare = (s: string) => s.split('\n').map(line => line.trimEnd()).join('\n').trim()
      if (normalizeForCompare(currentContent) !== normalizeForCompare(content)) {
        isInternalUpdate.current = true
        // Pre-process to preserve blank lines
        const preprocessed = preprocessMarkdown(content)
        // Treat tab-open content as baseline: do not add hydration to undo history.
        editor.chain().setMeta('addToHistory', false).setContent(preprocessed).run()
        isInternalUpdate.current = false
      }
    }
  }, [editor, content])

  useEffect(() => {
    if (!onHistoryHandlersChange) return
    if (!editor) {
      onHistoryHandlersChange(null)
      return
    }

    onHistoryHandlersChange({
      undo: () => editor.chain().focus().undo().run(),
      redo: () => editor.chain().focus().redo().run(),
    })

    return () => {
      onHistoryHandlersChange(null)
    }
  }, [editor, onHistoryHandlersChange])

  // Update editable state when prop changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  // Force re-render decorations when selection highlight changes
  useEffect(() => {
    if (editor) {
      // Trigger a transaction to force decoration re-render
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, selectionHighlight])

  const normalizedQuery = normalizeWikiPath(activeWikiLink?.query ?? '').toLowerCase()
  const filteredFiles = useMemo(() => {
    if (!activeWikiLink) return []
    if (!normalizedQuery) return orderedFiles
    return orderedFiles.filter((path) => path.toLowerCase().includes(normalizedQuery))
  }, [activeWikiLink, normalizedQuery, orderedFiles])

  const visibleFiles = filteredFiles.slice(0, 12)
  const rawCreateCandidate = activeWikiLink ? normalizeWikiPath(activeWikiLink.query) : ''
  const createCandidate = rawCreateCandidate && !rawCreateCandidate.endsWith('/')
    ? ensureMarkdownExtension(rawCreateCandidate)
    : ''
  const canCreate = Boolean(
    createCandidate
      && !orderedFiles.some((path) => path.toLowerCase() === createCandidate.toLowerCase())
  )

  const handleSelectWikiLink = useCallback((path: string) => {
    if (!editor || !activeWikiLink) return
    const normalized = normalizeWikiPath(path)
    if (!normalized) return
    const finalPath = ensureMarkdownExtension(normalized)
    void wikiLinks?.onCreate?.(finalPath)

    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: activeWikiLink.range.from, to: activeWikiLink.range.to },
        { type: 'wikiLink', attrs: { path: finalPath } }
      )
      .run()

    setActiveWikiLink(null)
    setAnchorPosition(null)
  }, [editor, activeWikiLink, wikiLinks])

  useEffect(() => {
    handleSelectWikiLinkRef.current = handleSelectWikiLink
  }, [handleSelectWikiLink])

  const handleRowboatAdd = useCallback(async (instruction: string) => {
    if (!editor) return

    if (rowboatBlockEdit) {
      // Editing existing taskBlock — update its data attribute
      const { nodePos } = rowboatBlockEdit
      const node = editor.state.doc.nodeAt(nodePos)
      if (node && node.type.name === 'taskBlock') {
        // Preserve existing schedule data
        let updated: Record<string, unknown> = { instruction }
        try {
          const existing = JSON.parse(node.attrs.data || '{}')
          updated = { ...existing, instruction }
        } catch {
          // Invalid JSON — just write new
        }
        const tr = editor.state.tr.setNodeMarkup(nodePos, undefined, { data: JSON.stringify(updated) })
        editor.view.dispatch(tr)
      }
      setRowboatBlockEdit(null)
      rowboatBlockEditRef.current = null
      setRowboatAnchorTop(null)
      return
    }

    if (activeRowboatMention) {
      // Insert a temporary processing block
      const blockData: Record<string, unknown> = { instruction, processing: true }

      const insertFrom = activeRowboatMention.range.from
      const insertTo = activeRowboatMention.range.to

      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: insertFrom, to: insertTo },
          [
            { type: 'taskBlock', attrs: { data: JSON.stringify(blockData) } },
            { type: 'paragraph' },
          ],
        )
        .run()

      setActiveRowboatMention(null)
      setRowboatAnchorTop(null)

      // Get editor content for the agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editorContent = (editor.storage as any).markdown?.getMarkdown?.() ?? ''

      // Helper to find the processing block
      const findProcessingBlock = (): number | null => {
        let pos: number | null = null
        editor.state.doc.descendants((node, p) => {
          if (pos !== null) return false
          if (node.type.name === 'taskBlock') {
            try {
              const data = JSON.parse(node.attrs.data || '{}')
              if (data.instruction === instruction && data.processing === true) {
                pos = p
                return false
              }
            } catch { /* skip */ }
          }
        })
        return pos
      }

      try {
        // Call the copilot assistant for both one-time and recurring tasks
        const result = await window.ipc.invoke('inline-task:process', {
          instruction,
          noteContent: editorContent,
          notePath: notePath ?? '',
        })

        const currentPos = findProcessingBlock()
        if (currentPos === null) return

        const node = editor.state.doc.nodeAt(currentPos)
        if (!node) return

        if (result.schedule) {
          // Recurring/scheduled task: update block with schedule, write target tags to disk
          const targetId = Math.random().toString(36).slice(2, 10)
          const updatedData: Record<string, unknown> = {
            instruction: result.instruction,
            schedule: result.schedule,
            'schedule-label': result.scheduleLabel,
            targetId,
          }
          const tr = editor.state.tr.setNodeMarkup(currentPos, undefined, {
            data: JSON.stringify(updatedData),
          })
          editor.view.dispatch(tr)

          // Mark note as live
          if (onFrontmatterChange) {
            const fields = extractAllFrontmatterValues(frontmatter ?? null)
            fields['live_note'] = 'true'
            onFrontmatterChange(buildFrontmatter(fields))
          }

          // Write target tags directly to the file on disk after a short delay
          // to let the editor save the updated content first
          if (notePath) {
            setTimeout(async () => {
              try {
                const file = await window.ipc.invoke('workspace:readFile', { path: notePath })
                const content = file.data
                const openTag = `<!--task-target:${targetId}-->`
                const closeTag = `<!--/task-target:${targetId}-->`

                // Only add if not already present
                if (content.includes(openTag)) return

                // Find the task block in the raw markdown and insert target tags after it
                const blockJson = JSON.stringify(updatedData)
                const blockStart = content.indexOf('```task\n' + blockJson)
                if (blockStart !== -1) {
                  const blockEnd = content.indexOf('\n```', blockStart + 8)
                  if (blockEnd !== -1) {
                    const insertAt = blockEnd + 4 // after the closing ```
                    const before = content.slice(0, insertAt)
                    const after = content.slice(insertAt)
                    const updated = before + '\n\n' + openTag + '\n' + closeTag + after
                    await window.ipc.invoke('workspace:writeFile', {
                      path: notePath,
                      data: updated,
                      opts: { encoding: 'utf8' },
                    })
                  }
                }
              } catch (err) {
                console.error('[RowboatAdd] Failed to write target tags:', err)
              }
            }, 500)
          }
        } else {
          // One-time task: remove the processing block, insert response in its place
          const insertPos = currentPos
          const deleteEnd = currentPos + node.nodeSize
          editor.chain().focus().deleteRange({ from: insertPos, to: deleteEnd }).run()

          if (result.response) {
            editor.chain().insertContentAt(insertPos, result.response).run()
          }
        }
      } catch (error) {
        console.error('[RowboatAdd] Processing failed:', error)

        // Remove the processing block on error
        const currentPos = findProcessingBlock()
        if (currentPos !== null) {
          const node = editor.state.doc.nodeAt(currentPos)
          if (node) {
            editor.chain().focus().deleteRange({ from: currentPos, to: currentPos + node.nodeSize }).run()
          }
        }
      }
    }
  }, [editor, activeRowboatMention, rowboatBlockEdit, frontmatter, onFrontmatterChange, notePath])

  const handleRowboatRemove = useCallback(() => {
    if (!editor || !rowboatBlockEdit) return
    const { nodePos } = rowboatBlockEdit
    const node = editor.state.doc.nodeAt(nodePos)
    if (node) {
      editor
        .chain()
        .focus()
        .deleteRange({ from: nodePos, to: nodePos + node.nodeSize })
        .run()
    }
    setRowboatBlockEdit(null)
    rowboatBlockEditRef.current = null
    setRowboatAnchorTop(null)
  }, [editor, rowboatBlockEdit])

  const handleScroll = useCallback(() => {
    updateWikiLinkState()
    updateAtMentionState()
  }, [updateWikiLinkState, updateAtMentionState])

  const showWikiPopover = Boolean(wikiLinks && activeWikiLink && anchorPosition)
  const wikiOptions = useMemo(() => {
    if (!showWikiPopover) return []
    const options: string[] = []
    if (canCreate) options.push(createCandidate)
    options.push(...visibleFiles)
    return options
  }, [showWikiPopover, canCreate, createCandidate, visibleFiles])

  useEffect(() => {
    wikiKeyStateRef.current = { open: showWikiPopover, options: wikiOptions, value: wikiCommandValue }
  }, [showWikiPopover, wikiOptions, wikiCommandValue])

  // Keep cmdk selection in sync with available options
  useEffect(() => {
    if (!showWikiPopover) {
      setWikiCommandValue('')
      return
    }
    if (wikiOptions.length === 0) {
      setWikiCommandValue('')
      return
    }
    setWikiCommandValue((prev) => (wikiOptions.includes(prev) ? prev : wikiOptions[0]))
  }, [showWikiPopover, wikiOptions])

  // @ mention autocomplete options
  const atMentionOptions = useMemo(() => [
    { value: 'rowboat', label: '@rowboat', description: 'Research, schedule, or run tasks with AI' },
  ], [])

  const filteredAtOptions = useMemo(() => {
    if (!activeAtMention) return []
    const q = activeAtMention.query.toLowerCase()
    if (!q) return atMentionOptions
    return atMentionOptions.filter((opt) => opt.value.toLowerCase().startsWith(q))
  }, [activeAtMention, atMentionOptions])

  const atOptionValues = useMemo(() => filteredAtOptions.map((o) => o.value), [filteredAtOptions])
  const showAtPopover = Boolean(activeAtMention && atAnchorPosition && filteredAtOptions.length > 0)

  useEffect(() => {
    atKeyStateRef.current = { open: showAtPopover, options: atOptionValues, value: atCommandValue }
  }, [showAtPopover, atOptionValues, atCommandValue])

  // Keep @ cmdk selection in sync
  useEffect(() => {
    if (!showAtPopover) {
      setAtCommandValue('')
      return
    }
    if (atOptionValues.length === 0) {
      setAtCommandValue('')
      return
    }
    setAtCommandValue((prev) => (atOptionValues.includes(prev) ? prev : atOptionValues[0]))
  }, [showAtPopover, atOptionValues])

  // @ mention selection handler
  const handleSelectAtMention = useCallback((value: string) => {
    if (!editor || !activeAtMention) return

    if (value === 'rowboat') {
      // Replace "@<partial>" with "@rowboat" — this triggers updateRowboatMentionState
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: activeAtMention.range.from, to: activeAtMention.range.to },
          '@rowboat'
        )
        .run()
    }

    setActiveAtMention(null)
    setAtAnchorPosition(null)
    setAtCommandValue('')
  }, [editor, activeAtMention])

  useEffect(() => {
    handleSelectAtMentionRef.current = handleSelectAtMention
  }, [handleSelectAtMention])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      // The parent component handles saving via onChange
    }
  }, [])

  // Create image upload handler that shows placeholder
  const handleImageUploadWithPlaceholder = useMemo(() => {
    if (!editor || !onImageUpload) return undefined
    return createImageUploadHandler(editor, onImageUpload)
  }, [editor, onImageUpload])

  return (
    <div className="tiptap-editor" onKeyDown={handleKeyDown}>
      <EditorToolbar
        editor={editor}
        onSelectionHighlight={setSelectionHighlight}
        onImageUpload={handleImageUploadWithPlaceholder}
        onExport={onExport}
      />
      {(frontmatter !== undefined) && onFrontmatterChange && (
        <FrontmatterProperties
          raw={frontmatter}
          onRawChange={onFrontmatterChange}
          editable={editable}
        />
      )}
      <MeetingEventBanner frontmatter={frontmatter} />
      <div className="editor-content-wrapper" ref={wrapperRef} onScroll={handleScroll}>
        <EditorContent editor={editor} />
        {wikiLinks ? (
          <Popover
            open={showWikiPopover}
            onOpenChange={(open) => {
              if (!open) {
                setActiveWikiLink(null)
                setAnchorPosition(null)
                setWikiCommandValue('')
              }
            }}
          >
            <PopoverAnchor asChild>
              <span
                className="wiki-link-anchor"
                style={
                  anchorPosition
                    ? { left: anchorPosition.left, top: anchorPosition.top }
                    : undefined
                }
              />
            </PopoverAnchor>
            <PopoverContent
              className="w-72 p-1"
              align="start"
              side="bottom"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <Command shouldFilter={false} value={wikiCommandValue} onValueChange={setWikiCommandValue}>
                <CommandList>
                  {canCreate ? (
                    <CommandItem
                      value={createCandidate}
                      onSelect={() => handleSelectWikiLink(createCandidate)}
                    >
                      Create "{wikiLabel(createCandidate) || createCandidate}"
                    </CommandItem>
                  ) : null}
                  {visibleFiles.map((path) => (
                    <CommandItem
                      key={path}
                      value={path}
                      onSelect={() => handleSelectWikiLink(path)}
                    >
                      {wikiLabel(path)}
                    </CommandItem>
                  ))}
                  {visibleFiles.length === 0 && !canCreate ? (
                    <CommandEmpty>No matches found.</CommandEmpty>
                  ) : null}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : null}
        {/* @ mention autocomplete popover */}
        <Popover
          open={showAtPopover}
          onOpenChange={(open) => {
            if (!open) {
              setActiveAtMention(null)
              setAtAnchorPosition(null)
              setAtCommandValue('')
            }
          }}
        >
          <PopoverAnchor asChild>
            <span
              className="wiki-link-anchor"
              style={
                atAnchorPosition
                  ? { left: atAnchorPosition.left, top: atAnchorPosition.top }
                  : undefined
              }
            />
          </PopoverAnchor>
          <PopoverContent
            className="w-72 p-1"
            align="start"
            side="bottom"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <Command shouldFilter={false} value={atCommandValue} onValueChange={setAtCommandValue}>
              <CommandList>
                {filteredAtOptions.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => handleSelectAtMention(opt.value)}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <RowboatMentionPopover
          open={Boolean((activeRowboatMention || rowboatBlockEdit) && rowboatAnchorTop)}
          anchor={rowboatAnchorTop}
          initialText={rowboatBlockEdit?.existingText ?? ''}
          onAdd={handleRowboatAdd}
          onRemove={rowboatBlockEdit ? handleRowboatRemove : undefined}
          onClose={() => {
            setActiveRowboatMention(null)
            setRowboatBlockEdit(null)
            rowboatBlockEditRef.current = null
            setRowboatAnchorTop(null)
          }}
        />
      </div>
    </div>
  )
})
