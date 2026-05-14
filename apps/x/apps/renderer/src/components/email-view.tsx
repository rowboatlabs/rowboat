import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Forward, Italic, Link as LinkIcon, List, ListOrdered, LoaderIcon, Quote, RefreshCw, Reply, Search, Send, Sparkles, Strikethrough } from 'lucide-react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import type { blocks } from '@x/shared'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useTheme } from '@/contexts/theme-context'

type GmailThread = blocks.GmailThread
type GmailThreadMessage = blocks.GmailThreadMessage

function formatInboxTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return `${Math.round(diffMin / 60)}h`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yest'
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return date.toLocaleDateString([], { weekday: 'short' })
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
}

function formatFullDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function extractName(from?: string): string {
  if (!from) return 'Unknown'
  const match = from.match(/^([^<]+)</)
  if (match?.[1]) return match[1].replace(/^["']|["']$/g, '').trim()
  const address = from.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1] ?? from
  return address.replace(/@.*/, '').replace(/[._+]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function extractAddress(from?: string): string {
  if (!from) return ''
  return from.match(/<([^>]+)>/)?.[1] ?? from
}

function snippet(text?: string): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

function getInitial(from?: string): string {
  return (extractName(from)[0] || '?').toUpperCase()
}

const AVATAR_COLORS = ['#1a73e8', '#e8453c', '#34a853', '#8430ce', '#f29900', '#00796b', '#c62828', '#1565c0']

function avatarColor(from?: string): string {
  const value = from || 'unknown'
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function latestMessage(thread: GmailThread): GmailThreadMessage | undefined {
  return thread.messages[thread.messages.length - 1]
}

const PREFETCH_HOVER_MS = 180
const PREFETCH_MAX_IMAGES_PER_THREAD = 12

function extractImageUrls(html: string): string[] {
  const urls: string[] = []
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const url = match[1]
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      urls.push(url)
    }
  }
  return urls
}

function prefetchThreadImages(thread: GmailThread): void {
  const seen = new Set<string>()
  for (const msg of thread.messages) {
    if (!msg.bodyHtml) continue
    for (const url of extractImageUrls(msg.bodyHtml)) {
      if (seen.has(url)) continue
      seen.add(url)
      if (seen.size > PREFETCH_MAX_IMAGES_PER_THREAD) return
      const img = new Image()
      img.decoding = 'async'
      img.referrerPolicy = 'no-referrer'
      img.src = url
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function splitPlainTextQuote(text: string): { visible: string; quoted: string | null } {
  const re = /(?:^|\n)On\s+.+?\swrote:\s*(?:\n|$)/
  const match = re.exec(text)
  if (!match) return { visible: text, quoted: null }
  const start = match.index === 0 ? 0 : match.index + 1
  const visible = text.slice(0, start).trimEnd()
  const quoted = text.slice(start)
  if (!quoted.trim()) return { visible: text, quoted: null }
  return { visible, quoted }
}

function buildEmailDocument(
  html: string,
  opts: { theme: 'light' | 'dark'; plainText: boolean }
): string {
  const dark = opts.theme === 'dark' && opts.plainText
  const colorScheme = opts.theme === 'dark' ? 'light dark' : 'light'
  const bodyBg = dark ? '#131317' : 'transparent'
  const bodyColor = dark ? '#d4d4d8' : '#202124'
  const linkColor = dark ? '#a78bfa' : '#1a73e8'
  const quoteColor = dark ? '#71717a' : '#5f6368'
  const quoteBorder = dark ? '#2e2e35' : '#dadce0'

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="color-scheme" content="${colorScheme}">
<base target="_blank">
<style>
  :root { color-scheme: ${colorScheme}; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.6 Arial, sans-serif;
    background: ${bodyBg};
    color: ${bodyColor};
    overflow-x: auto;
    overflow-y: hidden;
    word-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${linkColor}; }
  blockquote {
    margin: 0 0 0 6px;
    padding-left: 12px;
    border-left: 2px solid ${quoteBorder};
    color: ${quoteColor};
  }
  blockquote.gmail_quote,
  blockquote[type="cite"],
  .email-quote-block { display: none; }
  [data-show-quotes="true"] blockquote.gmail_quote,
  [data-show-quotes="true"] blockquote[type="cite"],
  [data-show-quotes="true"] .email-quote-block { display: block; }
</style>
</head><body>${html}</body></html>`
}

function MessageBody({ message, threadId }: { message: GmailThreadMessage; threadId: string }) {
  const { resolvedTheme } = useTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedHeightRef = useRef<number>(message.bodyHeight ?? 0)
  const [height, setHeight] = useState(message.bodyHeight ?? 80)
  const [hasQuote, setHasQuote] = useState(false)
  const [showQuotes, setShowQuotes] = useState(false)

  const isPlainText = !(message.bodyHtml && message.bodyHtml.trim())
  const useDarkBody = isPlainText && resolvedTheme === 'dark'

  const srcDoc = useMemo(() => {
    if (message.bodyHtml && message.bodyHtml.trim()) {
      return buildEmailDocument(message.bodyHtml, { theme: resolvedTheme, plainText: false })
    }
    const text = (message.body || '(No message body)').trim()
    const { visible, quoted } = splitPlainTextQuote(text)
    const visibleBlock = `<pre style="white-space: pre-wrap; font: inherit; margin: 0;">${escapeHtml(visible)}</pre>`
    const quotedBlock = quoted
      ? `<pre class="email-quote-block" style="white-space: pre-wrap; font: inherit; margin: 0;">${escapeHtml(quoted)}</pre>`
      : ''
    return buildEmailDocument(visibleBlock + quotedBlock, { theme: resolvedTheme, plainText: true })
  }, [message.bodyHtml, message.body, resolvedTheme])

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc?.body) return
    setHasQuote(!!doc.querySelector('blockquote.gmail_quote, blockquote[type="cite"], .email-quote-block'))
    const measure = () => {
      const next = Math.max(40, doc.body.scrollHeight)
      setHeight((current) => (current === next ? current : next))
      if (!message.id) return
      if (Math.abs(next - lastSavedHeightRef.current) < 4) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        lastSavedHeightRef.current = next
        void window.ipc.invoke('gmail:saveMessageHeight', {
          threadId,
          messageId: message.id!,
          height: next,
        }).catch(() => {})
      }, 500)
    }
    measure()
    observerRef.current?.disconnect()
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(measure)
      observerRef.current.observe(doc.body)
    }
  }, [message.id, threadId])

  const toggleQuotes = useCallback(() => {
    setShowQuotes((prev) => {
      const next = !prev
      const doc = iframeRef.current?.contentDocument
      if (doc) doc.documentElement.dataset.showQuotes = next ? 'true' : ''
      return next
    })
  }, [])

  useEffect(() => () => {
    observerRef.current?.disconnect()
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  return (
    <>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="Email content"
        className={cn('gmail-message-iframe', useDarkBody && 'gmail-message-iframe-dark')}
        style={{ height }}
        onLoad={handleLoad}
      />
      {hasQuote && (
        <button
          type="button"
          className="gmail-quote-toggle"
          onClick={toggleQuotes}
          aria-label={showQuotes ? 'Hide quoted text' : 'Show quoted text'}
          aria-expanded={showQuotes}
        >
          <span>•••</span>
        </button>
      )}
    </>
  )
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    results.push(...await Promise.all(batch.map(mapper)))
  }
  return results
}

type ComposeMode = 'reply' | 'forward'

function ComposeToolbarButton({
  editor,
  command,
  isActive,
  label,
  children,
}: {
  editor: Editor
  command: () => void
  isActive: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cn('gmail-compose-tool', isActive && 'is-active')}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        command()
        editor.chain().focus().run()
      }}
      aria-label={label}
      aria-pressed={isActive}
      title={label}
    >
      {children}
    </button>
  )
}

function ComposeToolbar({ editor, onOpenLink }: { editor: Editor; onOpenLink: () => void }) {
  return (
    <div className="gmail-compose-toolbar">
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        label="Bold"
      >
        <Bold size={14} />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        label="Italic"
      >
        <Italic size={14} />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        label="Strikethrough"
      >
        <Strikethrough size={14} />
      </ComposeToolbarButton>
      <span className="gmail-compose-tool-sep" />
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        label="Bulleted list"
      >
        <List size={14} />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        label="Numbered list"
      >
        <ListOrdered size={14} />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        label="Quote"
      >
        <Quote size={14} />
      </ComposeToolbarButton>
      <span className="gmail-compose-tool-sep" />
      <button
        type="button"
        className={cn('gmail-compose-tool', editor.isActive('link') && 'is-active')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onOpenLink}
        aria-label="Link"
        aria-pressed={editor.isActive('link')}
        title="Link"
      >
        <LinkIcon size={14} />
      </button>
    </div>
  )
}

function ComposeBox({
  mode,
  thread,
  onClose,
}: {
  mode: ComposeMode
  thread: GmailThread
  onClose: () => void
}) {
  const latest = latestMessage(thread)
  const to = mode === 'reply' ? extractAddress(latest?.from) : ''

  const initialContent = useMemo(() => {
    if (mode !== 'reply') return ''
    // Gmail-side draft (user's own work) wins over the AI-generated draft.
    const source = thread.gmail_draft || thread.draft_response
    if (!source) return ''
    return source
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
      .join('')
  }, [mode, thread.gmail_draft, thread.draft_response])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({
        placeholder: mode === 'reply' ? 'Write your reply…' : 'Write a message…',
      }),
    ],
    editorProps: {
      attributes: { class: 'gmail-compose-content' },
    },
    content: initialContent,
  })

  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  const openLink = () => {
    if (!editor) return
    const { from, to: selTo } = editor.state.selection
    savedSelectionRef.current = { from, to: selTo }
    const existing = editor.getAttributes('link').href as string | undefined
    setLinkUrl(existing || 'https://')
    setLinkOpen(true)
  }

  useEffect(() => {
    if (!linkOpen) return
    const id = window.setTimeout(() => linkInputRef.current?.select(), 0)
    return () => window.clearTimeout(id)
  }, [linkOpen])

  const applyLink = () => {
    if (!editor) {
      setLinkOpen(false)
      return
    }
    const sel = savedSelectionRef.current
    setLinkOpen(false)
    if (!sel) return
    const trimmed = linkUrl.trim()
    if (!trimmed || trimmed === 'https://') {
      editor.chain().focus().setTextSelection(sel).extendMarkRange('link').unsetLink().run()
      return
    }
    const href = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    editor.chain().focus().setTextSelection(sel).extendMarkRange('link').setLink({ href }).run()
  }

  const cancelLink = () => {
    setLinkOpen(false)
    const sel = savedSelectionRef.current
    if (editor && sel) editor.chain().focus().setTextSelection(sel).run()
  }

  const [sending, setSending] = useState(false)
  const sendInGmail = async () => {
    if (!editor || sending) return
    const html = editor.getHTML()
    const text = editor.getText().trim()
    if (!text) {
      toast('Draft is empty.', 'error')
      return
    }

    const recipient = mode === 'reply' ? extractAddress(latest?.from) : ''
    if (!recipient) {
      toast('No recipient found for this thread.', 'error')
      return
    }

    const rawSubject = thread.subject || ''
    const subject = mode === 'reply'
      ? (/^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`.trim())
      : (/^fwd:/i.test(rawSubject) ? rawSubject : `Fwd: ${rawSubject}`.trim())

    // Build References chain from all known message ids (newest last).
    const messageIds = thread.messages
      .map((m) => m.messageIdHeader)
      .filter((v): v is string => Boolean(v))
    const references = messageIds.join(' ')
    const inReplyTo = latest?.messageIdHeader

    setSending(true)
    try {
      const result = await window.ipc.invoke('gmail:sendReply', {
        threadId: thread.threadId,
        to: recipient,
        subject,
        bodyHtml: html,
        bodyText: text,
        inReplyTo,
        references: references || undefined,
      })
      if (result.error) {
        toast(`Send failed: ${result.error}`, 'error')
        return
      }
      toast('Sent.', 'success')
      onClose()
    } catch (err) {
      toast(`Send failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSending(false)
    }
  }

  const refineWithCopilot = () => {
    if (!editor) return
    const currentDraft = editor.getText().trim()
    const subject = thread.subject || '(No subject)'

    const lines: string[] = []
    lines.push(`Help me refine this draft email response. **Please ask me how I want to refine it before making any changes** — wait for my answer, then apply the edits.`)
    lines.push('')
    lines.push(`**Mode:** ${mode === 'reply' ? 'Reply' : 'Forward'}`)
    lines.push(`**Subject:** ${subject}`)
    lines.push('')
    lines.push(`## Thread (${thread.messages.length} message${thread.messages.length === 1 ? '' : 's'})`)
    lines.push('')
    thread.messages.forEach((message, index) => {
      lines.push(`### Message ${index + 1}`)
      if (message.from) lines.push(`**From:** ${message.from}`)
      if (message.to) lines.push(`**To:** ${message.to}`)
      if (message.date) lines.push(`**Date:** ${message.date}`)
      lines.push('')
      lines.push((message.body || '(empty)').trim())
      lines.push('')
    })

    lines.push(`## Current draft`)
    lines.push('')
    lines.push(currentDraft || '(empty — no draft yet)')

    window.__pendingEmailDraft = { prompt: lines.join('\n') }
    window.dispatchEvent(new Event('email-block:draft-with-assistant'))
  }

  return (
    <div className="gmail-compose-card">
      <div className="gmail-compose-header">
        <span>{mode === 'reply' ? 'Reply' : 'Forward'}</span>
        <button type="button" onClick={onClose} aria-label="Close compose">x</button>
      </div>
      <div className="gmail-compose-line">
        <span>{mode === 'reply' ? 'To' : 'Recipients'}</span>
        <input value={to} placeholder="Recipients" readOnly={mode === 'reply'} />
      </div>
      {mode === 'forward' && (
        <div className="gmail-compose-line">
          <span>Subject</span>
          <input value={`Fwd: ${thread.subject || '(No subject)'}`} readOnly />
        </div>
      )}
      <EditorContent editor={editor} className="gmail-compose-editor" />
      {linkOpen && (
        <div className="gmail-compose-link-popover" onMouseDown={(event) => event.preventDefault()}>
          <input
            ref={linkInputRef}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://example.com"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyLink()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelLink()
              }
            }}
          />
          <button type="button" className="gmail-compose-link-popover-apply" onClick={applyLink}>Apply</button>
          <button type="button" className="gmail-compose-link-popover-cancel" onClick={cancelLink}>Cancel</button>
        </div>
      )}
      <div className="gmail-compose-actions">
        <div className="gmail-compose-actions-primary">
          <button
            type="button"
            className="gmail-send-button"
            onClick={() => { void sendInGmail() }}
            disabled={sending}
            title="Send this reply via Gmail"
          >
            {sending ? <LoaderIcon size={15} className="animate-spin" /> : <Send size={15} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
          <button
            type="button"
            className="gmail-refine-button"
            onClick={refineWithCopilot}
            title="Refine this draft with Copilot"
          >
            <Sparkles size={15} />
            Refine
          </button>
        </div>
        {editor && <ComposeToolbar editor={editor} onOpenLink={openLink} />}
        <button type="button" className="gmail-compose-link" onClick={onClose}>Discard</button>
      </div>
    </div>
  )
}

function ThreadDetail({
  thread,
  onClose,
  hidden,
}: {
  thread: GmailThread
  onClose: () => void
  hidden?: boolean
}) {
  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null)
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(
    () => new Set(thread.messages.length > 0 ? [thread.messages.length - 1] : [])
  )

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  return (
    <div className={cn('gmail-detail gmail-detail-inline', hidden && 'gmail-detail-hidden')}>
      <div className="gmail-detail-toolbar">
        <div className="gmail-thread-subject-inline">{thread.subject || '(No subject)'}</div>
        <button type="button" className="gmail-icon-button" onClick={onClose} aria-label="Close thread">
          <span>×</span>
        </button>
      </div>

      <div className="gmail-thread-body">
        {thread.summary && (
          <div className="gmail-thread-summary">
            <span className="gmail-thread-summary-label">Summary</span>
            <span className="gmail-thread-summary-text">{thread.summary}</span>
          </div>
        )}
        <div className="gmail-message-stack">
          {thread.messages.map((message, index) => {
            const isExpanded = expandedIndices.has(index)
            return (
              <div key={message.id || index} className={cn('gmail-message', isExpanded && 'gmail-message-expanded')}>
                <div className="gmail-message-avatar" style={{ backgroundColor: avatarColor(message.from) }}>
                  {getInitial(message.from)}
                </div>
                <div className="gmail-message-main">
                  <button
                    type="button"
                    className="gmail-message-header"
                    onClick={() => toggleExpand(index)}
                    aria-expanded={isExpanded}
                  >
                    <div className="gmail-message-meta">
                      <div className="gmail-message-from">
                        <strong>{extractName(message.from)}</strong>
                        {isExpanded && <span>{extractAddress(message.from)}</span>}
                      </div>
                      <div className="gmail-message-date">
                        {isExpanded ? formatFullDate(message.date) : formatInboxTime(message.date)}
                      </div>
                    </div>
                    {isExpanded ? (
                      <div className="gmail-message-to">to {message.to || 'me'}</div>
                    ) : (
                      <div className="gmail-message-snippet">{snippet(message.body)}</div>
                    )}
                  </button>
                  {isExpanded && (
                    <MessageBody message={message} threadId={thread.threadId} />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="gmail-thread-actions">
          <button type="button" onClick={() => setComposeMode('reply')}>
            <Reply size={16} />
            Reply
          </button>
          <button type="button" onClick={() => setComposeMode('forward')}>
            <Forward size={16} />
            Forward
          </button>
        </div>

        {composeMode && (
          <ComposeBox
            mode={composeMode}
            thread={thread}
            onClose={() => setComposeMode(null)}
          />
        )}
      </div>
    </div>
  )
}

const MAX_KEPT_OPEN = 5
const PAGE_SIZE = 25
const SECTIONS = ['important', 'other'] as const
type InboxSection = (typeof SECTIONS)[number]

interface SectionState {
  threads: GmailThread[]
  nextCursor: string | null
  hasReachedEnd: boolean
  loadingPage: boolean
}

const initialSectionState: SectionState = {
  threads: [],
  nextCursor: null,
  hasReachedEnd: false,
  loadingPage: false,
}

// Module-level survives unmount/remount within the renderer process — so switching
// panels and coming back doesn't reload from scratch.
let persistedImportant: SectionState | null = null
let persistedOther: SectionState | null = null

function clearLoadingFlag(state: SectionState | null): SectionState {
  if (!state) return initialSectionState
  return { ...state, loadingPage: false }
}

export function EmailView() {
  const [important, setImportant] = useState<SectionState>(() => clearLoadingFlag(persistedImportant))
  const [other, setOther] = useState<SectionState>(() => clearLoadingFlag(persistedOther))
  const hadPersistedDataOnMount = useRef(persistedImportant !== null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [openedThreadIds, setOpenedThreadIds] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(!hadPersistedDataOnMount.current)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => { persistedImportant = important }, [important])
  useEffect(() => { persistedOther = other }, [other])

  const setSection = useCallback((section: InboxSection, updater: (prev: SectionState) => SectionState) => {
    if (section === 'important') setImportant(updater)
    else setOther(updater)
  }, [])

  const toggleThread = useCallback((threadId: string) => {
    setSelectedThreadId((current) => {
      const next = current === threadId ? null : threadId
      if (next) {
        setOpenedThreadIds((prev) => {
          const without = prev.filter((id) => id !== next)
          return [...without, next].slice(-MAX_KEPT_OPEN)
        })
      }
      return next
    })
  }, [])

  const prefetchedRef = useRef<Set<string>>(new Set())
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHoverPrefetch = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const scheduleHoverPrefetch = useCallback((thread: GmailThread) => {
    cancelHoverPrefetch()
    if (prefetchedRef.current.has(thread.threadId)) return
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      prefetchedRef.current.add(thread.threadId)
      prefetchThreadImages(thread)
    }, PREFETCH_HOVER_MS)
  }, [cancelHoverPrefetch])

  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  }, [])

  // Track the current "load epoch" so concurrent refreshes don't apply stale results.
  const epochRef = useRef(0)

  const loadNextPage = useCallback(async (section: InboxSection) => {
    const current = section === 'important' ? important : other
    if (current.loadingPage || current.hasReachedEnd) return

    const epoch = epochRef.current
    setSection(section, (prev) => ({ ...prev, loadingPage: true }))
    try {
      const result = await window.ipc.invoke('gmail:listInboxPage', {
        section,
        cursor: current.nextCursor ?? undefined,
        limit: PAGE_SIZE,
      })
      if (epoch !== epochRef.current) return
      setSection(section, (prev) => ({
        threads: [...prev.threads, ...result.threads],
        nextCursor: result.nextCursor,
        hasReachedEnd: result.nextCursor === null,
        loadingPage: false,
      }))
    } catch (err) {
      if (epoch !== epochRef.current) return
      console.warn(`[Gmail] page load failed for ${section}:`, err)
      setSection(section, (prev) => ({ ...prev, loadingPage: false }))
    }
  }, [important, other, setSection])

  const reloadFirstPage = useCallback(async (section: InboxSection) => {
    const epoch = ++epochRef.current
    setSection(section, () => ({ ...initialSectionState, loadingPage: true }))
    try {
      const result = await window.ipc.invoke('gmail:listInboxPage', {
        section,
        limit: PAGE_SIZE,
      })
      if (epoch !== epochRef.current) return
      setSection(section, () => ({
        threads: result.threads,
        nextCursor: result.nextCursor,
        hasReachedEnd: result.nextCursor === null,
        loadingPage: false,
      }))
    } catch (err) {
      if (epoch !== epochRef.current) return
      console.warn(`[Gmail] initial page load failed for ${section}:`, err)
      setSection(section, () => ({ ...initialSectionState, loadingPage: false }))
    }
  }, [setSection])

  // Initial load — fetch page 1 of Important only. Everything else stays hidden
  // until Important is exhausted (see effect below).
  useEffect(() => {
    if (hadPersistedDataOnMount.current) return
    void reloadFirstPage('important')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once Important is exhausted, kick off page 1 of Everything else.
  useEffect(() => {
    if (!important.hasReachedEnd) return
    if (other.threads.length > 0) return
    if (other.loadingPage) return
    void reloadFirstPage('other')
  }, [important.hasReachedEnd, other.threads.length, other.loadingPage, reloadFirstPage])

  // Live updates: watcher on inbox_lists/ → reload page 1 when files change.
  // Suppressed while a thread is open (composing/reading) — instead, mark a
  // pending update and reload once the user closes the thread.
  const pendingReloadRef = useRef(false)
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSelectedRef = useRef<string | null>(null)
  isSelectedRef.current = selectedThreadId
  const isRefreshingRef = useRef(false)
  isRefreshingRef.current = refreshing

  const triggerLiveReload = useCallback(() => {
    if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current)
    reloadDebounceRef.current = setTimeout(() => {
      reloadDebounceRef.current = null
      // Skip if our own refresh is in flight — its writes triggered the watcher.
      if (isRefreshingRef.current) return
      // If a thread is open, defer until it closes.
      if (isSelectedRef.current !== null) {
        pendingReloadRef.current = true
        return
      }
      void reloadFirstPage('important')
      setOther(() => ({ ...initialSectionState }))
    }, 500)
  }, [reloadFirstPage])

  useEffect(() => {
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      const matches = (p: string) => p.startsWith('inbox_lists/')
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (event.path && matches(event.path)) triggerLiveReload()
          break
        case 'moved':
          if ((event.from && matches(event.from)) || (event.to && matches(event.to))) triggerLiveReload()
          break
        case 'bulkChanged':
          if (event.paths?.some(matches)) triggerLiveReload()
          break
      }
    })
    return () => {
      cleanup()
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current)
    }
  }, [triggerLiveReload])

  // When user closes a thread, if updates arrived while they were reading, flush now.
  useEffect(() => {
    if (selectedThreadId !== null) return
    if (!pendingReloadRef.current) return
    pendingReloadRef.current = false
    void reloadFirstPage('important')
    setOther(() => ({ ...initialSectionState }))
  }, [selectedThreadId, reloadFirstPage])

  // Live refresh: hit the Gmail API to validate the freshest threads, then re-render.
  const refreshInFlightRef = useRef(false)
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setRefreshing(true)
    setError(null)
    try {
      // TEMP(pagination-testing): widened from daysAgo: 2 to pull more threads into inbox_lists/ for testing. Revert before shipping.
      const list = await window.ipc.invoke('gmail:listRecentThreads', { daysAgo: 7 })
      if (list.error) throw new Error(list.error)
      await mapWithConcurrency(list.threads, 6, async (item) => {
        const result = await window.ipc.invoke('gmail:getThread', {
          threadId: item.threadId,
          expectedHistoryId: item.historyId,
        })
        if (!result.thread) {
          console.warn('Failed to hydrate Gmail thread', item.threadId, result.error)
        }
      })
      // Reset Other so the auto-load effect re-triggers once Important hits end.
      setOther(() => ({ ...initialSectionState }))
      await reloadFirstPage('important')
    } catch (err) {
      console.warn('[Gmail] live refresh failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      refreshInFlightRef.current = false
      setRefreshing(false)
    }
  }, [reloadFirstPage])

  // Kick off a live refresh on mount only when there's no persisted data —
  // otherwise we'd clobber the snapshot the user already had.
  useEffect(() => {
    if (hadPersistedDataOnMount.current) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filterThreads = useCallback((threads: GmailThread[]) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return threads
    return threads.filter((thread) => {
      const latest = latestMessage(thread)
      return [
        thread.subject,
        latest?.from,
        latest?.to,
        latest?.body,
      ].some(value => (value || '').toLowerCase().includes(normalized))
    })
  }, [query])

  const visibleImportant = useMemo(() => filterThreads(important.threads), [important.threads, filterThreads])
  const visibleOther = useMemo(() => filterThreads(other.threads), [other.threads, filterThreads])

  const hasAny = important.threads.length > 0 || other.threads.length > 0
  const initialLoading = !hasAny && refreshing

  const renderRow = (thread: GmailThread) => {
    const latest = latestMessage(thread)
    const isSelected = thread.threadId === selectedThreadId
    const isUnread = thread.unread === true
    const isMounted = openedThreadIds.includes(thread.threadId)
    return (
      <div key={thread.threadId} className="gmail-row-group">
        <button
          type="button"
          className={cn('gmail-row', isSelected && 'gmail-row-selected', isUnread && 'gmail-row-unread')}
          onClick={() => toggleThread(thread.threadId)}
          onMouseEnter={() => scheduleHoverPrefetch(thread)}
          onMouseLeave={cancelHoverPrefetch}
        >
          <span className="gmail-row-dot" aria-hidden />
          <span className="gmail-row-sender">{extractName(latest?.from || thread.from)}</span>
          <span className="gmail-row-content">
            <strong>{thread.summary || thread.subject || '(No subject)'}</strong>
            <span>{thread.summary ? thread.subject : snippet(latest?.body || thread.latest_email)}</span>
          </span>
          <span className="gmail-row-date">{formatInboxTime(latest?.date || thread.date)}</span>
        </button>
        {isMounted && (
          <ThreadDetail
            thread={thread}
            onClose={() => setSelectedThreadId(null)}
            hidden={!isSelected}
          />
        )}
      </div>
    )
  }

  return (
    <div className="gmail-shell">
      <div className="gmail-main">
        <div className="gmail-topbar">
          <div className="gmail-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search loaded mail"
            />
          </div>
          <button type="button" className="gmail-icon-button" onClick={() => void refresh()} aria-label="Refresh">
            {refreshing ? <LoaderIcon size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          </button>
        </div>

        {error && !hasAny ? (
          <div className="gmail-empty-state">Could not load mail: {error}</div>
        ) : hasAny ? (
          <div className="gmail-list" aria-label="Recent emails">
            {important.threads.length > 0 && (
              <section className="gmail-section">
                <div className="gmail-list-header">
                  <span>Important</span>
                  <span>
                    {important.threads.length}{important.hasReachedEnd ? '' : '+'} thread{important.threads.length === 1 ? '' : 's'}
                  </span>
                </div>
                {visibleImportant.map(renderRow)}
                {!important.hasReachedEnd && (
                  <SectionSentinel
                    disabled={important.loadingPage || important.hasReachedEnd}
                    onIntersect={() => loadNextPage('important')}
                    loading={important.loadingPage}
                  />
                )}
              </section>
            )}
            {important.hasReachedEnd && other.threads.length > 0 && (
              <section className="gmail-section">
                <div className="gmail-list-header">
                  <span>Everything else</span>
                  <span>
                    {other.threads.length}{other.hasReachedEnd ? '' : '+'} thread{other.threads.length === 1 ? '' : 's'}
                  </span>
                </div>
                {visibleOther.map(renderRow)}
                {!other.hasReachedEnd && (
                  <SectionSentinel
                    disabled={other.loadingPage || other.hasReachedEnd}
                    onIntersect={() => loadNextPage('other')}
                    loading={other.loadingPage}
                  />
                )}
              </section>
            )}
          </div>
        ) : (
          <div className="gmail-empty-state">
            {initialLoading ? 'Loading Gmail threads…' : 'No Gmail threads in your inbox cache yet.'}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionSentinel({
  disabled,
  onIntersect,
  loading,
}: {
  disabled: boolean
  onIntersect: () => void
  loading: boolean
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (disabled) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onIntersect()
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [disabled, onIntersect])

  return (
    <div ref={sentinelRef} className="gmail-section-sentinel" aria-hidden>
      {loading ? <LoaderIcon size={14} className="animate-spin" /> : null}
    </div>
  )
}
