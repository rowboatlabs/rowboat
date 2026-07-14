import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Bold, CheckCheck, Forward, Italic, Link as LinkIcon, List, ListOrdered, LoaderIcon, Mail, Paperclip, Quote, Redo2, RefreshCw, Reply, ReplyAll, Search, Send, SlidersHorizontal, Sparkles, SquarePen, Star, StarOff, Strikethrough, Trash2, Undo2, X } from 'lucide-react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import type { blocks } from '@x/shared'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { prepareEmailHtml, splitPlainTextQuote, stripQuotedReplyText, QUOTED_CLASS } from '@/lib/email-quotes'
import { useTheme } from '@/contexts/theme-context'
import { SettingsDialog } from '@/components/settings-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type GmailThread = blocks.GmailThread
type GmailThreadMessage = blocks.GmailThreadMessage
type GmailConnectionStatus = {
  connected: boolean
  hasRequiredScope: boolean
  missingScopes: string[]
  email: string | null
}

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

// The label set (chips, filter pills, correction dropdown) comes from the
// backend label registry: built-ins (display names follow Superhuman's Auto
// Label vocabulary — Marketing / Pitch / News / Calendar) plus any labels the
// user defined in their agent instructions. This static copy of the built-ins
// is the fallback used until the registry loads, and for ids the registry no
// longer knows (a custom label the user later removed).
type EmailCategory = string

interface EmailLabelInfo {
  id: string
  name: string
  kind: 'builtin' | 'custom'
}

const BUILTIN_LABELS: EmailLabelInfo[] = [
  { id: 'correspondence', name: 'Direct', kind: 'builtin' },
  { id: 'meeting', name: 'Calendar', kind: 'builtin' },
  { id: 'notification', name: 'Notification', kind: 'builtin' },
  { id: 'newsletter', name: 'News', kind: 'builtin' },
  { id: 'promotion', name: 'Marketing', kind: 'builtin' },
  { id: 'cold_outreach', name: 'Pitch', kind: 'builtin' },
  { id: 'receipt', name: 'Receipt', kind: 'builtin' },
]

// Pill order in the "Everything else" filter row: noise first (that's what
// gets bulk-archived), then the rest of the built-ins; custom labels are
// appended in registry order at render time. 'unclassified' (threads the
// classifier hasn't reached yet) is always last and unarchivable.
const BUILTIN_PILL_ORDER = ['newsletter', 'promotion', 'notification', 'cold_outreach', 'receipt', 'meeting', 'correspondence']

// Fallback for ids the registry doesn't know: "portfolio_updates" → "Portfolio updates".
function prettifyLabelId(id: string): string {
  const words = id.replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : id
}

function labelNameFor(labels: EmailLabelInfo[], category: string): string {
  if (category === 'unclassified') return 'Uncategorized'
  return labels.find((l) => l.id === category)?.name ?? prettifyLabelId(category)
}

// The user sent the latest message and someone else is in the conversation —
// the ball is in their court. Derived from the messages on every render (never
// stored) so it can't go stale the way an arrival-time label would.
function isAwaitingThem(thread: GmailThread, selfEmail: string | null | undefined): boolean {
  const self = (selfEmail || '').trim().toLowerCase()
  if (!self) return false
  const latest = latestMessage(thread)
  if (!(latest?.from || '').toLowerCase().includes(self)) return false
  return thread.messages.some((m) => m.from && !m.from.toLowerCase().includes(self))
}

function daysSince(value?: string): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
}

function waitingChip(thread: GmailThread): string {
  const days = daysSince(latestMessage(thread)?.date || thread.date)
  return days && days > 0 ? `Waiting ${days}d` : 'Waiting'
}

// Split a raw header recipient string (e.g. `"Jo Bloggs" <jo@x.com>, b@y.com`) into
// individual address tokens, respecting commas inside quotes/angle brackets.
function splitAddresses(raw?: string): string[] {
  if (!raw) return []
  const tokens: string[] = []
  let buf = ''
  let inQuote = false
  let depth = 0
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote
    else if (ch === '<') depth += 1
    else if (ch === '>') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';' || ch === '\n') && !inQuote && depth === 0) {
      const token = buf.trim()
      if (token) tokens.push(token)
      buf = ''
      continue
    }
    buf += ch
  }
  const last = buf.trim()
  if (last) tokens.push(last)
  return tokens
}

// Display label for a recipient chip: the display name if present, else the bare address.
function recipientLabel(token: string): string {
  const named = token.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
  if (named?.[1]?.trim()) return named[1].trim()
  return extractAddress(token)
}

// Dedupe tokens by lowercased email address, dropping any whose address is in `exclude`.
function dedupeRecipients(tokens: string[], exclude: Set<string>): string[] {
  const seen = new Set<string>(exclude)
  const out: string[] = []
  for (const token of tokens) {
    const addr = extractAddress(token).toLowerCase()
    if (!addr || seen.has(addr)) continue
    seen.add(addr)
    out.push(token)
  }
  return out
}

// Compute the To / Cc recipients for a reply, reply-all, or forward, excluding "me".
function buildRecipients(
  mode: ComposeMode,
  thread: GmailThread,
  selfEmail: string,
): { to: string[]; cc: string[] } {
  if (mode === 'forward') return { to: [], cc: [] }
  // Editing an existing draft: recipients are whatever the draft already has.
  if (mode === 'draft') {
    const draftMsg = latestMessage(thread)
    return { to: splitAddresses(draftMsg?.to), cc: splitAddresses(draftMsg?.cc) }
  }

  const latest = latestMessage(thread)
  const self = selfEmail.toLowerCase()
  const fromAddr = latest?.from ? extractAddress(latest.from).toLowerCase() : ''
  const iAmSender = Boolean(self) && fromAddr === self

  // If my own message is the latest, reply to whoever I sent it to; otherwise reply to the sender.
  const rawTo = iAmSender ? splitAddresses(latest?.to) : (latest?.from ? [latest.from] : [])
  const ccPool = iAmSender
    ? splitAddresses(latest?.cc)
    : [...splitAddresses(latest?.to), ...splitAddresses(latest?.cc)]

  const selfSet = new Set<string>(self ? [self] : [])
  const to = dedupeRecipients(rawTo, selfSet)
  if (iAmSender && to.length === 0 && self && rawTo.some((token) => extractAddress(token).toLowerCase() === self)) {
    to.push(self)
  }

  if (mode === 'reply') return { to, cc: [] }

  const ccExclude = new Set<string>(selfSet)
  for (const token of to) ccExclude.add(extractAddress(token).toLowerCase())
  const cc = dedupeRecipients(ccPool, ccExclude)
  return { to, cc }
}

// Reply-chain headers (and thread placement) for the outgoing message.
// Replies rebuild the chain from the thread's messages. An edited draft is a
// single-message pseudo-thread whose own Message-ID must never be referenced
// (it dies on send, which would break recipients' threading) — reuse the
// In-Reply-To/References the draft already carries instead. Forwards and new
// messages start fresh.
function threadingHeaders(
  mode: ComposeMode,
  thread: GmailThread | undefined,
): { threadId?: string; inReplyTo?: string; references?: string } {
  if (!thread || mode === 'forward' || mode === 'new') return {}
  if (mode === 'draft') {
    const draftMsg = latestMessage(thread)
    return {
      // Only a reply draft stays on its thread — a standalone draft's
      // threadId is the phantom thread holding just the draft itself.
      threadId: draftMsg?.inReplyToHeader ? thread.threadId : undefined,
      inReplyTo: draftMsg?.inReplyToHeader,
      references: draftMsg?.referencesHeader,
    }
  }
  const messageIds = thread.messages
    .map((m) => m.messageIdHeader)
    .filter((v): v is string => Boolean(v))
  return {
    threadId: thread.threadId,
    inReplyTo: latestMessage(thread)?.messageIdHeader,
    references: messageIds.join(' ') || undefined,
  }
}

// Subject line for a reply ("Re: …") or forward ("Fwd: …"), avoiding double prefixes.
function composeSubject(mode: ComposeMode, rawSubject?: string): string {
  const raw = (rawSubject || '').trim()
  if (mode === 'draft') return raw // keep the draft's own subject verbatim
  if (mode === 'forward') return /^fwd:/i.test(raw) ? raw : `Fwd: ${raw}`.trim()
  return /^re:/i.test(raw) ? raw : `Re: ${raw}`.trim()
}

function buildForwardedContent(thread: GmailThread): string {
  const message = latestMessage(thread)
  if (!message) return ''
  const rows = [
    '---------- Forwarded message ---------',
    message.from ? `From: ${message.from}` : null,
    message.date ? `Date: ${formatFullDate(message.date)}` : null,
    message.subject || thread.subject ? `Subject: ${message.subject || thread.subject}` : null,
    message.to ? `To: ${message.to}` : null,
    message.cc ? `Cc: ${message.cc}` : null,
  ].filter((line): line is string => Boolean(line))
  const body = (message.body || snippet(message.bodyHtml)).trim()
  return [
    '<p></p>',
    '<blockquote>',
    ...rows.map((line) => `<p>${escapeHtml(line)}</p>`),
    body ? `<p>${escapeHtml(body).replace(/\n/g, '<br />')}</p>` : '',
    '</blockquote>',
  ].join('')
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

// Convert AI-generated plain text into the simple paragraph HTML the Tiptap
// editor expects (blank lines → paragraphs, single newlines → <br />).
function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

function buildEmailDocument(
  html: string,
  opts: { theme: 'light' | 'dark'; adaptToTheme: boolean },
): string {
  const useDark = opts.theme === 'dark' && opts.adaptToTheme
  // Only opt into the dark color scheme when the email actually adapts to the
  // theme — otherwise Chromium paints the canvas dark under emails that
  // assume a white background.
  const colorScheme = useDark ? 'light dark' : 'light'
  const bodyColor = useDark ? '#d4d4d8' : '#202124'
  const linkColor = useDark ? '#a78bfa' : '#1a73e8'
  const quoteBorder = useDark ? '#2e2e35' : '#dadce0'
  const quoteColor = useDark ? '#71717a' : '#5f6368'
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
    background: transparent;
    color: ${bodyColor};
    overflow-x: auto;
    overflow-y: hidden;
    word-wrap: break-word;
    padding-bottom: 4px;
    /* Contain the first child's top margin. Without this it collapses through
       <body>, shifting the box down while body.scrollHeight stays short — so
       the height we hand the iframe cuts the last line off. */
    display: flow-root;
  }
  body > *:last-child { margin-bottom: 0; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${linkColor}; }
  blockquote {
    margin: 0 0 0 6px;
    padding-left: 12px;
    border-left: 2px solid ${quoteBorder};
    color: ${quoteColor};
  }
  .${QUOTED_CLASS} { display: none; }
  [data-show-quotes="true"] .${QUOTED_CLASS} { display: revert; }
</style>
</head><body>${html}</body></html>`
}

function MessageBody({ message, threadId }: { message: GmailThreadMessage; threadId: string }) {
  const isPlainText = !(message.bodyHtml && message.bodyHtml.trim())
  return isPlainText
    ? <PlainTextBody message={message} />
    : <HtmlMessageBody message={message} threadId={threadId} />
}

function PlainTextBody({ message }: { message: GmailThreadMessage }) {
  const text = (message.body || '(No message body)').trim()
  const { visible, quoted } = splitPlainTextQuote(text)
  const [showQuote, setShowQuote] = useState(false)
  return (
    <>
      <div className="gmail-message-plain">
        <pre className="gmail-message-pre">{visible}</pre>
        {quoted && showQuote && <pre className="gmail-message-pre gmail-message-pre-quoted">{quoted}</pre>}
      </div>
      {quoted && (
        <button
          type="button"
          className="gmail-quote-toggle"
          onClick={() => setShowQuote((v) => !v)}
          aria-label={showQuote ? 'Hide quoted text' : 'Show quoted text'}
          aria-expanded={showQuote}
        >
          <span>•••</span>
        </button>
      )}
      {message.attachments && message.attachments.length > 0 && (
        <MessageAttachments attachments={message.attachments} />
      )}
    </>
  )
}

function HtmlMessageBody({ message, threadId }: { message: GmailThreadMessage; threadId: string }) {
  const { resolvedTheme } = useTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedHeightRef = useRef<number>(message.bodyHeight ?? 0)
  const [height, setHeight] = useState(message.bodyHeight ?? 80)
  const [showQuotes, setShowQuotes] = useState(false)
  // Read by handleLoad so a reload (theme switch rebuilds srcDoc) restores the
  // expanded-quotes state on the fresh document.
  const showQuotesRef = useRef(showQuotes)
  useEffect(() => { showQuotesRef.current = showQuotes }, [showQuotes])

  // Tag the quotes before the iframe ever paints, so quoted history is hidden
  // on the first frame and the height we measure is the collapsed height.
  const { html, hasQuote, styled } = useMemo(() => prepareEmailHtml(message.bodyHtml!), [message.bodyHtml])
  const adaptToTheme = !styled
  const srcDoc = useMemo(
    () => buildEmailDocument(html, { theme: resolvedTheme, adaptToTheme }),
    [html, resolvedTheme, adaptToTheme],
  )

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc?.body) return
    if (showQuotesRef.current) doc.documentElement.dataset.showQuotes = 'true'
    // Clicking into the email body focuses the iframe document, which would
    // otherwise swallow every list/thread shortcut (the parent's document
    // keydown listeners never fire). The sandbox has allow-same-origin but no
    // allow-scripts, so we forward from out here; the listener dies with the
    // document on the next load.
    doc.addEventListener('keydown', (event) => {
      const clone = new KeyboardEvent('keydown', event)
      if (!document.dispatchEvent(clone)) event.preventDefault()
    })
    const measure = () => {
      // Measure off body only. documentElement.scrollHeight stretches to fill
      // the iframe viewport, so once we size the iframe up (e.g. user expanded
      // the quote) it never shrinks back when the body collapses. The body's
      // own padding-bottom + last-child margin reset (see buildEmailDocument)
      // already prevent under-reporting from collapsed bottom margins.
      const next = Math.max(40, doc.body.scrollHeight, doc.body.offsetHeight)
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
        className={cn('gmail-message-iframe', adaptToTheme && 'gmail-message-iframe-adaptive')}
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
      {message.attachments && message.attachments.length > 0 && (
        <MessageAttachments attachments={message.attachments} />
      )}
    </>
  )
}

function formatAttachmentSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function MessageAttachments({ attachments }: { attachments: NonNullable<GmailThreadMessage['attachments']> }) {
  const openAttachment = async (att: NonNullable<GmailThreadMessage['attachments']>[number]) => {
    try {
      // Ensure the file is on disk before handing off to the OS opener. Inbox
      // attachments are saved during sync, but search-result attachments are
      // only fetched on demand. gmail:downloadAttachment short-circuits when the
      // file already exists, so calling it first is cheap and guarantees the
      // file is present — we can't rely on shell:openPath reporting a missing
      // file as an error (xdg-open on Linux reports success even when the path
      // doesn't exist, so the old open-then-download fallback never fired).
      if (att.messageId) {
        const dl = await window.ipc.invoke('gmail:downloadAttachment', {
          messageId: att.messageId,
          savedPath: att.savedPath,
          attachmentId: att.attachmentId,
        })
        if (!dl.ok) {
          toast(`Could not download ${att.filename}: ${dl.error ?? 'unknown error'}`, 'error')
          return
        }
      }
      const result = await window.ipc.invoke('shell:openPath', { path: att.savedPath })
      if (result?.error) toast(`Could not open ${att.filename}: ${result.error}`, 'error')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast(`Could not open ${att.filename}: ${message}`, 'error')
    }
  }

  return (
    <div className="gmail-message-attachments">
      {attachments.map((att) => {
        const size = formatAttachmentSize(att.sizeBytes)
        return (
          <button
            key={att.savedPath}
            type="button"
            className="gmail-attachment"
            onClick={() => void openAttachment(att)}
            title={`Open ${att.filename}`}
          >
            <Paperclip size={13} />
            <span className="gmail-attachment-name">{att.filename}</span>
            {size && <span className="gmail-attachment-size">{size}</span>}
          </button>
        )
      })}
    </div>
  )
}

type ComposeMode = 'reply' | 'replyAll' | 'forward' | 'new' | 'draft'

// Platform-aware modifier: Cmd on macOS, Ctrl on Windows/Linux (App.tsx pattern).
const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

// True when a keyboard event originated in a text-entry context, so
// single-letter shortcuts must stay inert.
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(
    el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  )
}

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
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('size-7 text-muted-foreground', isActive && 'bg-accent text-foreground')}
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
    </Button>
  )
}

function ComposeToolbar({ editor, onOpenLink }: { editor: Editor; onOpenLink: () => void }) {
  // Content-sized (no flex-1: a 0 basis always "fits" the current flex line,
  // so the toolbar would never wrap — it would get squeezed until its
  // fixed-size buttons overflowed the neighbors). The inner flex-wrap stacks
  // the buttons if even a full line is too narrow to hold them.
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-l border-border pl-2.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 text-muted-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        aria-label="Undo"
        title="Undo"
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 text-muted-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        aria-label="Redo"
        title="Redo"
      >
        <Redo2 className="size-3.5" />
      </Button>
      <span className="mx-1.5 h-4 w-px bg-border" />
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        label="Bold"
      >
        <Bold className="size-3.5" />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        label="Italic"
      >
        <Italic className="size-3.5" />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        label="Strikethrough"
      >
        <Strikethrough className="size-3.5" />
      </ComposeToolbarButton>
      <span className="mx-1.5 h-4 w-px bg-border" />
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        label="Bulleted list"
      >
        <List className="size-3.5" />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        label="Numbered list"
      >
        <ListOrdered className="size-3.5" />
      </ComposeToolbarButton>
      <ComposeToolbarButton
        editor={editor}
        command={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        label="Quote"
      >
        <Quote className="size-3.5" />
      </ComposeToolbarButton>
      <span className="mx-1.5 h-4 w-px bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn('size-7 text-muted-foreground', editor.isActive('link') && 'bg-accent text-foreground')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onOpenLink}
        aria-label="Link"
        aria-pressed={editor.isActive('link')}
        title="Link"
      >
        <LinkIcon className="size-3.5" />
      </Button>
    </div>
  )
}

type ContactSuggestion = {
  name: string
  email: string
}

function formatContactToken(c: ContactSuggestion): string {
  return c.name ? `${c.name} <${c.email}>` : c.email
}

// Stable hue per email so the avatar circle keeps a consistent color.
function contactHue(email: string): number {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  return h % 360
}

function contactInitial(c: ContactSuggestion): string {
  const src = (c.name || c.email).trim()
  return (src[0] || '?').toUpperCase()
}

// Renders a string with the matched substring wrapped in <mark>.
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent p-0 font-bold text-inherit">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
  trailing,
  focusSignal,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  autoFocus?: boolean
  trailing?: React.ReactNode
  /** Bump to move focus into this field (e.g. after a Cc/Bcc shortcut). */
  focusSignal?: number
}) {
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isFocused, setIsFocused] = useState(false)
  const [queryShown, setQueryShown] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const queryTokenRef = useRef(0)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus()
  }, [focusSignal])

  const excludeEmails = useMemo(
    () => value.map((token) => extractAddress(token).toLowerCase()).filter(Boolean),
    [value],
  )

  // Debounced contact search — only runs when the user has actually typed
  // something. An emptied draft closes the menu via the onChange handler (and
  // commit() clears it after a pick); here we just invalidate in-flight
  // queries so a stale response can't reopen it.
  useEffect(() => {
    const trimmed = draft.trim()
    if (!isFocused || !trimmed) {
      queryTokenRef.current++
      return
    }
    const token = ++queryTokenRef.current
    const timer = window.setTimeout(async () => {
      try {
        const result = (await window.ipc.invoke('gmail:searchContacts', {
          query: draft,
          limit: 8,
          excludeEmails,
        })) as { contacts?: ContactSuggestion[] } | undefined
        if (token !== queryTokenRef.current) return
        setSuggestions(result?.contacts ?? [])
        setQueryShown(trimmed)
        setActiveIndex(0)
      } catch {
        if (token !== queryTokenRef.current) return
        setSuggestions([])
      }
    }, 60)
    return () => window.clearTimeout(timer)
  }, [draft, isFocused, excludeEmails])

  // Keep the active row scrolled into view during keyboard navigation.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const node = list.children[activeIndex] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, suggestions])

  const commit = (raw: string) => {
    const additions = splitAddresses(raw)
    if (additions.length === 0) return
    onChange(dedupeRecipients([...value, ...additions], new Set()))
    setDraft('')
    setSuggestions([])
  }

  const pickSuggestion = (c: ContactSuggestion) => {
    commit(formatContactToken(c))
    // Keep focus in the input so the user can keep typing more recipients.
    inputRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const hasSuggestions = suggestions.length > 0
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      // Cmd/Ctrl+Enter is "send" — commit any half-typed address on the way
      // and let the event bubble to the composer's send handler.
      if (draft.trim()) commit(draft)
      return
    }
    if (event.key === 'ArrowDown' && hasSuggestions) {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && hasSuggestions) {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
      return
    }
    if (event.key === 'Escape' && hasSuggestions) {
      event.preventDefault()
      event.stopPropagation()
      setSuggestions([])
      return
    }
    if (event.key === 'Enter' || (event.key === 'Tab' && hasSuggestions)) {
      // Prefer the highlighted suggestion when one is present.
      if (hasSuggestions) {
        event.preventDefault()
        pickSuggestion(suggestions[activeIndex])
        return
      }
      if (event.key === 'Enter' && draft.trim()) {
        event.preventDefault()
        commit(draft)
        return
      }
    }
    if (event.key === ',' || event.key === ';') {
      if (draft.trim()) {
        event.preventDefault()
        commit(draft)
      }
      return
    }
    if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const showSuggestions = isFocused && suggestions.length > 0

  return (
    <div
      className="flex items-start gap-2 border-b border-border px-3 py-1.5 text-sm"
      data-suggestions-open={showSuggestions || undefined}
    >
      <span className="min-w-7 pt-1.5 text-muted-foreground">{label}</span>
      <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1" ref={fieldRef}>
        {value.map((token, index) => (
          <span
            key={`${token}-${index}`}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted pl-2 pr-1 text-xs text-foreground"
            title={extractAddress(token)}
          >
            <span className="max-w-[240px] truncate">{recipientLabel(token)}</span>
            <button
              type="button"
              className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={`Remove ${extractAddress(token)}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(value.filter((_, idx) => idx !== index))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="h-6 min-w-[80px] flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          value={draft}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            if (!next.trim()) setSuggestions([])
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            // Defer so a mousedown on a suggestion can pick it before the menu closes.
            window.setTimeout(() => {
              setIsFocused(false)
              if (inputRef.current && draft.trim() && document.activeElement !== inputRef.current) {
                commit(draft)
              }
            }, 80)
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text')
            if (text && /[,;\n]/.test(text)) {
              event.preventDefault()
              commit(text)
            }
          }}
        />
        {showSuggestions && (
          <ul
            className="absolute left-0 top-[calc(100%+6px)] z-30 m-0 max-h-[296px] w-max min-w-[280px] max-w-[min(440px,100%)] list-none overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
            role="listbox"
            ref={listRef}
          >
            {suggestions.map((c, idx) => {
              const hue = contactHue(c.email)
              return (
                <li
                  key={c.email}
                  role="option"
                  aria-selected={idx === activeIndex}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-colors',
                    idx === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                  )}
                  onMouseDown={(event) => {
                    // Prevent input blur before click fires.
                    event.preventDefault()
                    pickSuggestion(c)
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <span
                    className="inline-flex size-6 flex-none items-center justify-center rounded-full text-xs font-semibold uppercase text-white"
                    style={{ background: `hsl(${hue}, 60%, 42%)` }}
                    aria-hidden="true"
                  >
                    {contactInitial(c)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium">
                      <HighlightedText text={c.name || c.email} query={queryShown} />
                    </span>
                    {c.name && (
                      <span className="mt-0.5 truncate text-xs text-muted-foreground">
                        <HighlightedText text={c.email} query={queryShown} />
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {trailing && <div className="flex-none pt-1.5">{trailing}</div>}
    </div>
  )
}

const AI_GENERATE_SYSTEM =
  'You write complete emails. Given an instruction, produce a subject line and a body. ' +
  'Respond in EXACTLY this format and nothing else:\n' +
  'Subject: <a concise, specific subject line>\n' +
  '\n' +
  '<the email body as plain text>\n' +
  'Do not use markdown. Do not add any commentary, labels, or surrounding quotes. ' +
  'When recipient names are provided, address them naturally (e.g. "Hi <first name>,"). ' +
  'When the sender\'s first name is provided, sign off with that first name only; otherwise omit the sign-off name ' +
  '(never write a placeholder like "[Your Name]").'

const AI_REWRITE_SYSTEM =
  'You rewrite emails. Given the current subject and body plus an edit instruction, ' +
  'produce the revised subject line and body. Keep the subject if it still fits, or ' +
  'refine it so it matches the rewritten body. Respond in EXACTLY this format and nothing else:\n' +
  'Subject: <the subject line>\n' +
  '\n' +
  '<the rewritten email body as plain text>\n' +
  'Do not use markdown. Do not add any commentary, labels, or surrounding quotes. ' +
  'Preserve the existing sign-off; do not invent placeholder names like "[Your Name]".'

// Split AI output of the form "Subject: …\n\n<body>" into its parts. If no
// subject line is present, the whole text is treated as the body.
function parseGeneratedEmail(text: string): { subject: string | null; body: string } {
  const match = text.match(/^\s*Subject:\s*(.+?)(?:\r?\n|$)/i)
  if (match) {
    const subject = match[1].trim()
    const body = text.slice(match.index! + match[0].length).replace(/^\s+/, '')
    return { subject, body }
  }
  return { subject: null, body: text }
}

function firstNameFromDisplayName(name: string): string {
  const trimmed = name.trim().replace(/^["']|["']$/g, '')
  return trimmed.split(/\s+/)[0] || ''
}

// Guarantee the sender's first name signs off the email. If the model already
// ended with the name (e.g. "Best,\nHarsh"), leave it; otherwise append it.
function ensureSignature(body: string, name: string): string {
  const signer = name.trim()
  if (!signer) return body
  const trimmed = body.replace(/\s+$/, '')
  // Check the last couple of lines so we don't double up an existing sign-off.
  const tail = trimmed.split('\n').slice(-2).join('\n').toLowerCase()
  if (tail.includes(signer.toLowerCase())) return trimmed
  return `${trimmed}\n\n${signer}`
}

const TONE_PRESETS: Array<{ key: string; label: string; instruction: string }> = [
  { key: 'formal', label: 'Formal', instruction: 'Rewrite this email to be more formal and professional.' },
  { key: 'casual', label: 'Casual', instruction: 'Rewrite this email to be more casual and friendly.' },
  { key: 'shorter', label: 'Shorter', instruction: 'Rewrite this email to be more concise, keeping the key points.' },
  { key: 'longer', label: 'Longer', instruction: 'Rewrite this email to be more detailed and thorough.' },
]

// Debounce before autosaving the composer to a Gmail draft after the last edit.
const DRAFT_AUTOSAVE_MS = 1500

// Shape of the gmail:saveDraft request, kept here so we can stash a snapshot in
// a ref for the close/unmount flush without re-reading a torn-down editor.
type DraftPayload = {
  draftId?: string
  threadId?: string
  to?: string
  cc?: string
  bcc?: string
  subject: string
  bodyHtml: string
  bodyText: string
  inReplyTo?: string
  references?: string
  attachments?: Array<{ filename: string; mimeType: string; contentBase64: string }>
}

// Composer for replies, forwards, and (mode 'new') from-scratch emails. With a
// thread it renders as an inline card under the thread; in 'new' mode it has no
// thread and renders as a centered modal with the AI writing bar.
const ComposeBox = memo(function ComposeBox({
  mode,
  thread,
  selfEmail = '',
  onClose,
}: {
  mode: ComposeMode
  thread?: GmailThread
  selfEmail?: string
  onClose: () => void
}) {
  const isNew = mode === 'new'
  // Drafts and new messages share the full-modal layout (subject line, AI bar).
  const isModal = isNew || mode === 'draft'
  const initialRecipients = useMemo(
    () => (thread ? buildRecipients(mode, thread, selfEmail) : { to: [], cc: [] }),
    [mode, thread, selfEmail],
  )

  const [toList, setToList] = useState<string[]>(initialRecipients.to)
  const [ccList, setCcList] = useState<string[]>(initialRecipients.cc)
  const [bccList, setBccList] = useState<string[]>([])
  const [showCc, setShowCc] = useState<boolean>(initialRecipients.cc.length > 0)
  const [showBcc, setShowBcc] = useState<boolean>(false)
  // Bumped by the Cc/Bcc shortcuts so the freshly revealed field grabs focus.
  const [ccFocusSignal, setCcFocusSignal] = useState(0)
  const [bccFocusSignal, setBccFocusSignal] = useState(0)
  const [subject, setSubject] = useState<string>(() => (thread ? composeSubject(mode, thread.subject) : ''))
  const modeLabel = mode === 'draft' ? 'Draft' : isNew ? 'New message' : mode === 'forward' ? 'Forward' : mode === 'replyAll' ? 'Reply All' : 'Reply'

  const initialContent = useMemo(() => {
    if (!thread) return ''
    if (mode === 'forward') return buildForwardedContent(thread)
    // For a saved draft, reopen the exact HTML we stored so formatting survives.
    if (mode === 'draft') {
      const draftMsg = latestMessage(thread)
      if (draftMsg?.bodyHtml) return draftMsg.bodyHtml
    }
    // Gmail-side draft (user's own work) wins over the AI-generated draft.
    const source = stripQuotedReplyText(thread.gmail_draft || thread.draft_response || '')
    if (!source) return ''
    return source
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
      .join('')
  }, [mode, thread])

  // Ref so the Tiptap keydown handler (captured once at editor creation)
  // always calls the latest send closure; assigned below sendInGmail.
  const sendRef = useRef<() => void>(() => {})

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({
        placeholder: isModal || mode === 'forward' ? 'Write a message…' : 'Write your reply…',
      }),
    ],
    editorProps: {
      attributes: { class: 'compose-content' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey) {
          sendRef.current()
          return true
        }
        return false
      },
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

  // The signed-in account's display name, used to sign off AI-generated emails.
  // Loaded in every mode (new, reply, forward) since the AI writer is available
  // throughout and needs a name to sign off with.
  const [selfName, setSelfName] = useState<string>('')
  const selfFirstName = useMemo(() => firstNameFromDisplayName(selfName), [selfName])
  useEffect(() => {
    let cancelled = false
    window.ipc.invoke('gmail:getAccountName', {})
      .then((res) => { if (!cancelled && res?.name) setSelfName(res.name) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const [aiPrompt, setAiPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  // Once a draft has been generated, show a follow-up bar for iterative edits
  // ("add a line about…", "remove the last paragraph", etc.). It hides again if
  // the draft is emptied (e.g. undone), tracked via hasContent below.
  const [hasGenerated, setHasGenerated] = useState(false)
  const [hasContent, setHasContent] = useState(false)

  // Keep hasContent in sync with the editor across typing, undo/redo, and clears.
  useEffect(() => {
    if (!editor) return
    const sync = () => setHasContent(!editor.isEmpty)
    sync()
    editor.on('update', sync)
    return () => { editor.off('update', sync) }
  }, [editor])

  // Clearing the body reverts the AI control to its "Write" state and drops the
  // generated subject, so an emptied composer behaves like a fresh one. The
  // hasGenerated guard avoids wiping a subject typed before any generation.
  useEffect(() => {
    if (hasGenerated && !hasContent) {
      setHasGenerated(false)
      setSubject('')
    }
  }, [hasGenerated, hasContent])

  const runAi = async (instruction: string, aiMode: 'generate' | 'rewrite') => {
    if (!editor || generating) return
    const current = editor.getText().trim()
    let prompt: string
    let system: string
    if (aiMode === 'generate') {
      if (!instruction.trim()) { toast('Describe what to write.', 'error'); return }
      system = AI_GENERATE_SYSTEM
      const ctx: string[] = []
      // When replying or forwarding, give the model the thread it's responding
      // to (oldest first) so the draft is on-topic and references the right
      // points. New emails have no thread and skip this.
      if (thread) {
        const threadText = thread.messages
          .map((message, index) => {
            const header = message.from ? `From: ${message.from}\n` : ''
            return `--- Message ${index + 1} ---\n${header}${(message.body || '').trim()}`
          })
          .join('\n\n')
        ctx.push(`This is a ${modeLabel.toLowerCase()} to the following email thread (oldest first):\n${threadText}`)
      }
      // Use the recipients' names (from the contacts picker) so the AI can
      // address them naturally; fall back to the address when there's no name.
      const recipientNames = toList
        .map((token) => {
          const name = extractName(token)
          return name && name !== 'Unknown' ? name : extractAddress(token)
        })
        .filter(Boolean)
      if (recipientNames.length) ctx.push(`Recipient(s): ${recipientNames.join(', ')}`)
      if (selfFirstName) ctx.push(`Sender's first name (sign off as this): ${selfFirstName}`)
      if (isNew && subject.trim()) ctx.push(`Desired subject hint: ${subject.trim()}`)
      if (current) ctx.push(`Existing draft (revise or build on it):\n${current}`)
      prompt = `${ctx.length ? ctx.join('\n') + '\n\n' : ''}Instruction: ${instruction.trim()}`
    } else {
      if (!instruction.trim()) { toast('Describe the edit to make.', 'error'); return }
      if (!current) { toast('Write something first.', 'error'); return }
      system = AI_REWRITE_SYSTEM
      const subjectLine = subject.trim() ? `Subject: ${subject.trim()}\n\n` : ''
      prompt = `Instruction: ${instruction}\n\n---\n${subjectLine}${current}`
    }

    setGenerating(true)
    try {
      // The user's standing email-agent instructions steer this writer too —
      // otherwise "keep drafts short, sign off with X" would apply to the
      // auto-drafted replies but silently not to the Write-with-AI bar.
      try {
        const { instructions } = await window.ipc.invoke('gmail:getEmailInstructions', {})
        if (instructions.trim()) {
          system = `${system}\n\nThe user's standing email preferences — follow any that concern how emails should be written (tone, length, sign-off, what not to write):\n${instructions.trim()}`
        }
      } catch { /* draft without them */ }
      // Draft through Copilot: no model override, so the backend resolves the
      // same default model/provider the Copilot chat uses (models.json).
      const res = await window.ipc.invoke('llm:generate', { prompt, system })
      if (res.error || !res.text) {
        toast(res.error || 'No text was generated.', 'error')
        return
      }
      // Replace via a tracked transaction (selectAll + insertContent) so the AI
      // draft lands in the editor's undo history and the toolbar's Undo reverts it.
      if (aiMode === 'generate') {
        const { subject: generatedSubject, body } = parseGeneratedEmail(res.text)
        // Only new emails take the AI's subject; replies/forwards keep their
        // derived "Re:"/"Fwd:" subject (and don't expose a subject field).
        if (generatedSubject && isNew) setSubject(generatedSubject)
        // Always sign off with the account first name, even if the model omitted it.
        const signed = ensureSignature(body, selfFirstName)
        editor.chain().focus().selectAll().insertContent(plainTextToHtml(signed)).run()
        setHasGenerated(true)
      } else {
        // Rewrites also regenerate the subject so it stays in sync with the body —
        // but only for new emails, to preserve a reply/forward's threaded subject.
        const { subject: rewrittenSubject, body } = parseGeneratedEmail(res.text)
        if (rewrittenSubject && isNew) setSubject(rewrittenSubject)
        editor.chain().focus().selectAll().insertContent(plainTextToHtml(body)).run()
      }
    } catch (err) {
      toast(`Generation failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  // The single Write/Edit bar: generate a fresh draft until one exists, then
  // switch to rewriting it. Clears the prompt after a run kicks off.
  const runAiBar = async () => {
    await runAi(aiPrompt, hasGenerated ? 'rewrite' : 'generate')
    setAiPrompt('')
  }

  // Attachments staged for this message. contentBase64 is the raw file bytes,
  // read in the renderer; the main process wraps them into the MIME on send.
  const [attachments, setAttachments] = useState<
    Array<{ id: string; filename: string; mimeType: string; size: number; contentBase64: string }>
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Gmail rejects messages over ~25MB; base64 inflates bytes by ~33%.
  const MAX_TOTAL_BYTES = 25 * 1024 * 1024

  // Read a file's bytes as raw base64 (the part after the data: URL prefix).
  const readAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('read failed'))
      reader.onload = () => {
        const result = String(reader.result)
        const comma = result.indexOf(',')
        resolve(comma >= 0 ? result.slice(comma + 1) : result)
      }
      reader.readAsDataURL(file)
    })

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const staged: typeof attachments = []
    for (const file of Array.from(files)) {
      try {
        staged.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          contentBase64: await readAsBase64(file),
        })
      } catch {
        toast(`Could not read ${file.name}.`, 'error')
      }
    }
    setAttachments((prev) => {
      const merged = [...prev]
      for (const item of staged) {
        if (!merged.some((a) => a.id === item.id)) merged.push(item)
      }
      const total = merged.reduce((sum, a) => sum + a.size, 0)
      if (total > MAX_TOTAL_BYTES) {
        toast('Attachments exceed the 25MB limit.', 'error')
        return prev
      }
      return merged
    })
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // ── Draft autosave ─────────────────────────────────────────────────────────
  // Keep a real Gmail draft in sync with the composer while the user types
  // (debounced) and flush a final save on close, so closing keeps the work in
  // Gmail's Drafts folder (synced to every device) instead of discarding it.
  // Empty/whitespace drafts are skipped. The core saveThreadDraft reuses an
  // existing thread draft and tracks the id so edits update in place.
  // Seeded when editing an existing draft so the first save updates it in place.
  const draftIdRef = useRef<string | undefined>(thread?.draftId)
  const lastPayloadRef = useRef<DraftPayload | null>(null)
  const savingRef = useRef(false)        // a saveDraft IPC is in flight
  const pendingRef = useRef(false)        // edits arrived mid-flight; save once more
  const sentRef = useRef(false)           // suppress autosave after a successful send
  const discardedRef = useRef(false)      // suppress autosave after discard
  const closedRef = useRef(false)         // close already handled; skip unmount flush
  const dirtyRef = useRef(false)          // user has edited since open
  const fieldsMounted = useRef(false)     // skip the field effect's initial run
  const autosaveTimer = useRef<number | null>(null)
  const saveDraftNowRef = useRef<() => Promise<void>>(undefined)

  const buildDraftPayload = useCallback((): DraftPayload | null => {
    if (!editor || editor.isDestroyed) return null
    const text = editor.getText().trim()
    if (!text) return null // skip empty/whitespace drafts
    const html = editor.getHTML()
    const { threadId, inReplyTo, references } = threadingHeaders(mode, thread)
    return {
      draftId: draftIdRef.current,
      threadId,
      to: toList.join(', '),
      cc: ccList.length ? ccList.join(', ') : undefined,
      bcc: bccList.length ? bccList.join(', ') : undefined,
      subject: subject.trim() || (thread ? composeSubject(mode, thread.subject) : ''),
      bodyHtml: html,
      bodyText: text,
      inReplyTo,
      references,
      attachments: attachments.length
        ? attachments.map(({ filename, mimeType, contentBase64 }) => ({ filename, mimeType, contentBase64 }))
        : undefined,
    }
  }, [editor, thread, mode, toList, ccList, bccList, subject, attachments])

  const saveDraftNow = useCallback(async () => {
    if (sentRef.current || discardedRef.current) return
    if (savingRef.current) { pendingRef.current = true; return }
    const payload = lastPayloadRef.current
    if (!payload && !draftIdRef.current) return
    savingRef.current = true
    pendingRef.current = false
    try {
      if (!payload) {
        // The composer was deliberately emptied after edits — mirror Gmail and
        // delete the autosaved draft rather than leaving its stale content.
        const id = draftIdRef.current
        if (id && dirtyRef.current) {
          await window.ipc.invoke('gmail:deleteDraft', { draftId: id })
          // Only forget the id once the delete succeeded (404/410 count as
          // success server-side); a thrown failure keeps it for a retry.
          if (draftIdRef.current === id) draftIdRef.current = undefined
        }
        return
      }
      payload.draftId = draftIdRef.current
      const res = await window.ipc.invoke('gmail:saveDraft', payload)
      if (res?.draftId && !discardedRef.current) draftIdRef.current = res.draftId
    } catch {
      // Autosave is best-effort; a failure just leaves the prior draft in place.
    } finally {
      savingRef.current = false
      // Coalesce edits that landed mid-flight into one more save.
      if (pendingRef.current && !sentRef.current && !discardedRef.current) {
        pendingRef.current = false
        void saveDraftNowRef.current?.()
      }
    }
  }, [])
  useEffect(() => { saveDraftNowRef.current = saveDraftNow }, [saveDraftNow])

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current)
    autosaveTimer.current = window.setTimeout(() => { void saveDraftNow() }, DRAFT_AUTOSAVE_MS)
  }, [saveDraftNow])

  // Wait (briefly, capped) for any in-flight autosave to settle so send/discard
  // don't race it into a duplicate or orphaned draft.
  const waitForSaveIdle = useCallback(async () => {
    for (let guard = 0; savingRef.current && guard < 40; guard++) {
      await new Promise((r) => window.setTimeout(r, 50))
    }
  }, [])

  // Autosave on body edits (typing, AI insert, undo/redo).
  useEffect(() => {
    if (!editor) return
    const onUpdate = () => {
      dirtyRef.current = true
      lastPayloadRef.current = buildDraftPayload()
      scheduleAutosave()
    }
    editor.on('update', onUpdate)
    return () => { editor.off('update', onUpdate) }
  }, [editor, buildDraftPayload, scheduleAutosave])

  // Autosave on header edits (recipients, subject, attachments), skipping mount.
  useEffect(() => {
    if (!fieldsMounted.current) { fieldsMounted.current = true; return }
    dirtyRef.current = true
    lastPayloadRef.current = buildDraftPayload()
    scheduleAutosave()
  }, [toList, ccList, bccList, subject, attachments, buildDraftPayload, scheduleAutosave])

  // Safety net: if the composer is torn down without an explicit close (e.g.
  // navigating away), still flush unsaved edits. closedRef guards the common
  // path where handleClose already saved.
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current)
      if (closedRef.current || sentRef.current || discardedRef.current || savingRef.current) return
      if (!dirtyRef.current) return
      const payload = lastPayloadRef.current
      if (!payload) {
        // Edited down to empty, then torn down — drop the stale draft.
        if (draftIdRef.current) {
          void window.ipc.invoke('gmail:deleteDraft', { draftId: draftIdRef.current }).catch(() => {})
        }
        return
      }
      payload.draftId = draftIdRef.current
      void window.ipc.invoke('gmail:saveDraft', payload).catch(() => {})
    }
  }, [])

  // Close (X / click-away): keep the draft. Flush a final save when there are
  // unsaved edits. If a save is already in flight it will persist the latest
  // content, so we skip here to avoid creating a duplicate.
  const handleClose = useCallback(() => {
    closedRef.current = true
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current)
    if (!sentRef.current && !discardedRef.current && !savingRef.current && dirtyRef.current) {
      const payload = buildDraftPayload()
      if (payload) {
        payload.draftId = draftIdRef.current
        void window.ipc.invoke('gmail:saveDraft', payload).catch(() => {})
      } else if (draftIdRef.current) {
        // Closed with the body edited down to empty — mirror Gmail and drop
        // the autosaved draft instead of keeping its stale content.
        void window.ipc.invoke('gmail:deleteDraft', { draftId: draftIdRef.current }).catch(() => {})
      }
    }
    onClose()
  }, [buildDraftPayload, onClose])

  // Discard: delete the autosaved draft (if any), then close.
  const handleDiscard = useCallback(() => {
    discardedRef.current = true
    closedRef.current = true
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current)
    void (async () => {
      await waitForSaveIdle()
      const id = draftIdRef.current
      if (id) await window.ipc.invoke('gmail:deleteDraft', { draftId: id }).catch(() => {})
    })()
    onClose()
  }, [onClose, waitForSaveIdle])

  const [sending, setSending] = useState(false)
  const sendInGmail = async () => {
    if (!editor || sending) return
    const html = editor.getHTML()
    const text = editor.getText().trim()
    if (!text) {
      toast(isNew ? 'Message is empty.' : 'Draft is empty.', 'error')
      return
    }

    if (toList.length === 0) {
      toast('Add at least one recipient.', 'error')
      return
    }

    const { threadId, inReplyTo, references } = threadingHeaders(mode, thread)

    // Stop autosave from racing the send (it would leave an orphaned draft), and
    // let any in-flight save settle so we know the draft id to clean up.
    sentRef.current = true
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current)
    setSending(true)
    await waitForSaveIdle()
    try {
      const result = await window.ipc.invoke('gmail:sendReply', {
        threadId,
        to: toList.join(', '),
        cc: ccList.length ? ccList.join(', ') : undefined,
        bcc: bccList.length ? bccList.join(', ') : undefined,
        subject: subject.trim() || (thread ? composeSubject(mode, thread.subject) : '(No subject)'),
        bodyHtml: html,
        bodyText: text,
        inReplyTo,
        references,
        attachments: attachments.length
          ? attachments.map(({ filename, mimeType, contentBase64 }) => ({ filename, mimeType, contentBase64 }))
          : undefined,
      })
      if (result.error) {
        sentRef.current = false // allow autosave to resume on a failed send
        toast(`Send failed: ${result.error}`, 'error')
        return
      }
      // Gmail only auto-cleans drafts on a threaded send; remove any draft we
      // autosaved for a brand-new message so it doesn't linger after sending.
      const leftover = draftIdRef.current
      if (leftover) {
        draftIdRef.current = undefined
        void window.ipc.invoke('gmail:deleteDraft', { draftId: leftover }).catch(() => {})
      }
      toast('Sent.', 'success')
      closedRef.current = true
      onClose()
    } catch (err) {
      sentRef.current = false
      toast(`Send failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSending(false)
    }
  }
  sendRef.current = () => { void sendInGmail() }

  // Composer-level shortcuts, on the wrapper so they work from any field.
  // Inner handlers (recipient menu, link bar, AI Enter) preventDefault first
  // and keep priority via the defaultPrevented check.
  const onComposerKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      // Deferred one tick: a recipient field may have just committed a
      // half-typed address, and send must read the re-rendered list.
      window.setTimeout(() => sendRef.current(), 0)
      return
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      e.stopPropagation()
      setShowCc(true)
      setCcFocusSignal((n) => n + 1)
      return
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      e.stopPropagation()
      setShowBcc(true)
      setBccFocusSignal((n) => n + 1)
      return
    }
    // The modal variant closes via Radix's own Escape handling.
    if (!isModal && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (linkOpen) cancelLink()
      else handleClose()
    }
  }

  const refineWithCopilot = () => {
    if (!editor || !thread) return
    const currentDraft = editor.getText().trim()
    const threadSubject = thread.subject || '(No subject)'

    const lines: string[] = []
    lines.push(`Help me refine this draft email response. **Please ask me how I want to refine it before making any changes** — wait for my answer, then apply the edits.`)
    lines.push('')
    lines.push(`**Mode:** ${modeLabel}`)
    lines.push(`**Subject:** ${threadSubject}`)
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

  const inner = (
    <>
      <RecipientField
        label="To"
        value={toList}
        onChange={setToList}
        autoFocus={isNew || mode === 'forward'}
        trailing={
          <div className="flex gap-2.5">
            {!showCc && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setShowCc(true)}
              >Cc</button>
            )}
            {!showBcc && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setShowBcc(true)}
              >Bcc</button>
            )}
          </div>
        }
      />
      {showCc && <RecipientField label="Cc" value={ccList} onChange={setCcList} focusSignal={ccFocusSignal} />}
      {showBcc && <RecipientField label="Bcc" value={bccList} onChange={setBccList} focusSignal={bccFocusSignal} />}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input
          className="h-8"
          value={aiPrompt}
          onChange={(event) => setAiPrompt(event.target.value)}
          placeholder={hasGenerated
            ? 'Edit the draft (e.g. add a line about…, remove the last paragraph)…'
            : isNew
              ? 'Describe the email and let AI write it…'
              : 'Describe your reply and let AI write it…'}
          disabled={generating}
          onKeyDown={(event) => {
            // Plain Enter runs the AI writer; Cmd/Ctrl+Enter bubbles to send.
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
              event.preventDefault()
              void runAiBar()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => { void runAiBar() }}
          disabled={generating}
          title={hasGenerated ? 'Apply this edit to the draft' : 'Write a draft with AI'}
        >
          {generating ? <LoaderIcon className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {generating
            ? (hasGenerated ? 'Editing…' : 'Writing…')
            : (hasGenerated ? 'Edit' : 'Write')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-1.5 gap-y-2 border-b border-border px-3 pb-2.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="rounded-md"
          onClick={() => { void runAi('Improve the clarity, grammar, and flow of this email while preserving its meaning.', 'rewrite') }}
          disabled={generating}
        >Improve</Button>
        {TONE_PRESETS.map((preset) => (
          <Button
            key={preset.key}
            type="button"
            variant="outline"
            size="xs"
            className="rounded-md"
            onClick={() => { void runAi(preset.instruction, 'rewrite') }}
            disabled={generating}
          >{preset.label}</Button>
        ))}
      </div>
      {(isModal || mode === 'forward') && (
        <div className="flex min-h-8 items-center gap-2 border-b border-border px-3 text-sm">
          <span className="text-muted-foreground">Subject</span>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
      )}
      <EditorContent
        editor={editor}
        className={cn('w-full overflow-y-auto', isModal ? 'min-h-0 flex-1' : 'max-h-[360px]')}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          void addFiles(event.target.value ? event.currentTarget.files : null)
          event.currentTarget.value = ''
        }}
      />
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="inline-flex max-w-60 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground"
              title={att.filename}
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{att.filename}</span>
              <span className="shrink-0 text-muted-foreground">{formatAttachmentSize(att.size)}</span>
              <button
                type="button"
                className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => removeAttachment(att.id)}
                aria-label={`Remove ${att.filename}`}
              ><X className="size-3" /></button>
            </div>
          ))}
        </div>
      )}
      {linkOpen && (
        <div
          className="flex items-center gap-1.5 border-t border-border bg-muted/30 px-3 py-2"
          onMouseDown={(event) => event.preventDefault()}
        >
          <Input
            ref={linkInputRef}
            className="h-7 flex-1 text-xs"
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
          <Button type="button" size="xs" onClick={applyLink}>Apply</Button>
          <Button type="button" variant="outline" size="xs" onClick={cancelLink}>Cancel</Button>
        </div>
      )}
      {/* flex-wrap: every button here is shrink-0, so on a narrow pane the
          formatting toolbar wraps to its own line instead of overflowing
          into (and clipping) the Discard button. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => { void sendInGmail() }}
            disabled={sending}
            title={isNew ? 'Send this email via Gmail' : 'Send this reply via Gmail'}
          >
            {sending ? <LoaderIcon className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sending ? 'Sending…' : 'Send'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            title="Attach files"
          >
            <Paperclip className="size-4" />
            Attach
          </Button>
          {thread && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refineWithCopilot}
              title="Refine this draft with Copilot"
            >
              <Sparkles className="size-4" />
              Refine
            </Button>
          )}
        </div>
        {/* Toolbar + Discard share one wrap unit so Discard never strands on
            a line of its own: wide panes show a single row (unit grows, so
            ml-auto pins Discard to the right edge); narrow panes wrap the
            whole unit to a second full-width row with the same alignment.
            flex-auto (content basis) is what makes the unit wrap at all —
            a flex-1 zero basis would "fit" forever and squeeze instead. */}
        <div className="flex flex-auto flex-wrap items-center gap-x-3 gap-y-2">
          {editor && <ComposeToolbar editor={editor} onOpenLink={openLink} />}
          <Button type="button" variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={handleDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </>
  )

  if (isModal) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) handleClose() }}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="flex h-[min(720px,calc(100vh-4rem))] flex-col gap-0 overflow-hidden p-0 font-sans sm:max-w-[840px]"
          onKeyDown={onComposerKeyDown}
          onEscapeKeyDown={(event) => {
            // Radix's Escape runs document-capture, before the inner fields
            // can claim it — let the link bar and an open recipient-suggestion
            // menu win; only a bare Escape closes the whole composer.
            if (linkOpen) {
              event.preventDefault()
              cancelLink()
              return
            }
            const target = event.target as HTMLElement | null
            if (target?.closest('[data-suggestions-open]')) event.preventDefault()
          }}
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <DialogTitle className="flex-1 text-sm font-medium text-foreground">{modeLabel}</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              onClick={handleClose}
              aria-label="Close compose"
            >
              <X className="size-4" />
            </Button>
          </div>
          {inner}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <div
      className="gmail-compose-inline ml-10 max-w-[720px] overflow-hidden rounded-lg border border-border bg-background font-sans"
      onKeyDown={onComposerKeyDown}
    >
      <div className="flex h-8 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium text-muted-foreground">{modeLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={handleClose}
          aria-label="Close compose"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {inner}
    </div>
  )
})

function ThreadDetail({
  thread,
  onClose,
  hidden,
  keysDisabled,
  onComposingChange,
  onSetCategory,
  labels = BUILTIN_LABELS,
}: {
  thread: GmailThread
  onClose: () => void
  hidden?: boolean
  /** True while a dialog is open above the inbox; suspends the reply keys. */
  keysDisabled?: boolean
  /** Reports whether the inline composer is open, so list shortcuts pause. */
  onComposingChange?: (composing: boolean) => void
  /** Present for inbox threads only — search results aren't in the cache the correction writes to. */
  onSetCategory?: (threadId: string, category: EmailCategory) => Promise<void>
  /** The label registry (built-ins + user-defined) for the chip and correction dropdown. */
  labels?: EmailLabelInfo[]
}) {
  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null)
  const [selfEmail, setSelfEmail] = useState<string>('')
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(
    () => new Set(thread.messages.length > 0 ? [thread.messages.length - 1] : [])
  )

  // The connected Gmail address, so reply-all can exclude "me".
  useEffect(() => {
    let cancelled = false
    window.ipc.invoke('gmail:getAccountEmail', {})
      .then((res) => { if (!cancelled && res?.email) setSelfEmail(res.email) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const replyAllRecipients = useMemo(
    () => buildRecipients('replyAll', thread, selfEmail),
    [thread, selfEmail],
  )
  const canReplyAll = replyAllRecipients.cc.length > 0 || replyAllRecipients.to.length > 1
  const replyAllButton = canReplyAll ? (
    <button type="button" onClick={() => setComposeMode('replyAll')}>
      <ReplyAll size={16} />
      Reply All
    </button>
  ) : null

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  // Let EmailView pause its list shortcuts while our composer is open. The
  // cleanup resets on hide/unmount so a hidden-but-mounted detail (up to 5 are
  // kept alive) can't block them.
  useEffect(() => {
    if (hidden) return
    onComposingChange?.(composeMode !== null)
    return () => onComposingChange?.(false)
  }, [hidden, composeMode, onComposingChange])

  // Superhuman-style reply keys for the visible thread. Scoped by `hidden` so
  // only the on-screen ThreadDetail listens. Escape closes the inline composer
  // first; with none open it falls through to EmailView's close-thread.
  useEffect(() => {
    if (hidden || keysDisabled) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key === 'Escape') {
        if (composeMode !== null) {
          e.preventDefault()
          setComposeMode(null)
        }
        return
      }
      if (composeMode !== null || isEditableTarget(e.target)) return
      if (e.key === 'r') {
        e.preventDefault()
        setComposeMode('reply')
      } else if (e.key === 'a') {
        e.preventDefault()
        setComposeMode(canReplyAll ? 'replyAll' : 'reply')
      } else if (e.key === 'f') {
        e.preventDefault()
        setComposeMode('forward')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [hidden, keysDisabled, composeMode, canReplyAll])

  return (
    <div className={cn('gmail-detail gmail-detail-inline', hidden && 'gmail-detail-hidden')}>
      <div className="gmail-detail-toolbar">
        <div className="gmail-thread-subject-inline">{thread.subject || '(No subject)'}</div>
        {onSetCategory && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="gmail-row-chip gmail-category-chip"
                title="Correct the category — the classifier learns from this"
              >
                {thread.category ? labelNameFor(labels, thread.category) : 'Categorize'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="font-sans">
              {labels.map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onSelect={() => { void onSetCategory(thread.threadId, l.id) }}
                  className={cn(l.id === thread.category && 'font-semibold')}
                >
                  {l.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
                      <>
                        <div className="gmail-message-to">to {message.to || 'me'}</div>
                        {message.cc && <div className="gmail-message-cc">cc {message.cc}</div>}
                      </>
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
          {replyAllButton}
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
            key={composeMode}
            mode={composeMode}
            thread={thread}
            selfEmail={selfEmail}
            onClose={() => setComposeMode(null)}
          />
        )}
      </div>
    </div>
  )
}

// One inbox/search row (plus its kept-alive ThreadDetail). Memoized so cursor
// moves and page appends only re-render the rows whose props actually changed
// — re-rendering the whole list mid-scroll is what janks the frame.
const ThreadRow = memo(function ThreadRow({
  thread,
  isSelected,
  isFocused,
  isMounted,
  isLeaving,
  keysDisabled,
  section,
  chip,
  chipWaiting,
  onSetCategory,
  labels,
  onToggle,
  onMarkRead,
  onArchive,
  onTrash,
  onSetImportance,
  onHoverIn,
  onHoverOut,
  onCloseThread,
  onComposingChange,
}: {
  thread: GmailThread
  isSelected: boolean
  isFocused: boolean
  isMounted: boolean
  isLeaving: boolean
  keysDisabled: boolean
  /** Which inbox section the row is rendered in; null hides the importance toggle (e.g. search results). */
  section: 'important' | 'other' | null
  /** Status pill after the subject — "Reply ready" or waiting age ("Waiting 3d"). The category chip renders automatically from thread.category. */
  chip?: string | null
  chipWaiting?: boolean
  onSetCategory?: (threadId: string, category: EmailCategory) => Promise<void>
  /** Label registry — stable reference from EmailView state (this row is memoized). */
  labels: EmailLabelInfo[]
  onToggle: (thread: GmailThread) => void
  onMarkRead: (threadId: string, read?: boolean) => Promise<void>
  onArchive: (threadId: string) => Promise<void>
  onTrash: (threadId: string) => Promise<void>
  onSetImportance: (threadId: string, importance: 'important' | 'other') => Promise<void>
  onHoverIn: (thread: GmailThread) => void
  onHoverOut: () => void
  onCloseThread: () => void
  onComposingChange: (composing: boolean) => void
}) {
  const latest = latestMessage(thread)
  const isUnread = thread.unread === true
  // Category chip on classified rows so the list itself answers "worth
  // opening?". Plain correspondence gets none — with granular labels
  // (Investor, Customer, …) available, "Direct" is the default case and
  // absence reads cleaner than a chip stating it. It stays available in the
  // correction dropdown and the Everything-else filter pills.
  const categoryChip = thread.category && thread.category !== 'correspondence'
    ? labelNameFor(labels, thread.category)
    : null
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
  }
  return (
    <div className={cn('gmail-row-group', !isMounted && 'gmail-row-group-cv', isLeaving && 'gmail-row-group-leaving')}>
      <div
        className={cn('gmail-row-shell', isSelected && 'gmail-row-shell-selected')}
        data-thread-id={thread.threadId}
        onMouseEnter={() => onHoverIn(thread)}
        onMouseLeave={onHoverOut}
      >
        <button
          type="button"
          className={cn('gmail-row', isSelected && 'gmail-row-selected', isUnread && 'gmail-row-unread', isFocused && 'gmail-row-focused')}
          onClick={() => onToggle(thread)}
        >
          <span className="gmail-row-dot" aria-hidden />
          <span className="gmail-row-sender">{extractName(latest?.from || thread.from)}</span>
          <span className="gmail-row-content">
            <strong>{thread.summary || thread.subject || '(No subject)'}</strong>
            <span>{thread.summary ? thread.subject : snippet(latest?.body || thread.latest_email)}</span>
            {categoryChip && <span className="gmail-row-chip">{categoryChip}</span>}
            {chip && <span className={cn('gmail-row-chip', chipWaiting ? 'gmail-row-chip-waiting' : 'gmail-row-chip-ready')}>{chip}</span>}
          </span>
          <span className="gmail-row-date">{formatInboxTime(latest?.date || thread.date)}</span>
        </button>
        <div className="gmail-row-actions" onMouseDown={stop} onClick={stop}>
          {section && (
            <button
              type="button"
              className="gmail-row-action"
              title={section === 'important' ? 'Not important — teach the classifier' : 'Important — teach the classifier'}
              aria-label={section === 'important' ? 'Mark as not important' : 'Mark as important'}
              onClick={(e) => { stop(e); void onSetImportance(thread.threadId, section === 'important' ? 'other' : 'important') }}
            >
              {section === 'important' ? <StarOff size={15} /> : <Star size={15} />}
            </button>
          )}
          <button
            type="button"
            className="gmail-row-action"
            title={isUnread ? 'Mark as read' : 'Mark as unread'}
            aria-label={isUnread ? 'Mark as read' : 'Mark as unread'}
            onClick={(e) => { stop(e); void onMarkRead(thread.threadId, isUnread) }}
          >
            {isUnread ? <CheckCheck size={15} /> : <Mail size={15} />}
          </button>
          <button
            type="button"
            className="gmail-row-action"
            title="Archive"
            aria-label="Archive"
            onClick={(e) => { stop(e); void onArchive(thread.threadId) }}
          >
            <Archive size={15} />
          </button>
          <button
            type="button"
            className="gmail-row-action gmail-row-action-danger"
            title="Delete"
            aria-label="Delete"
            onClick={(e) => { stop(e); void onTrash(thread.threadId) }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {/* Drop the detail as soon as the row starts leaving — the collapse
          keyframe assumes row height, and the thread is being removed anyway. */}
      {isMounted && !isLeaving && (
        <ThreadDetail
          thread={thread}
          onClose={onCloseThread}
          hidden={!isSelected}
          keysDisabled={keysDisabled}
          onComposingChange={onComposingChange}
          onSetCategory={onSetCategory}
          labels={labels}
        />
      )}
    </div>
  )
})

// Free-text standing instructions for the email agent. Saved to
// config/email_instructions.md and injected into every classification /
// draft call as the highest-priority section of the system prompt.
function EmailInstructionsDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved?: () => void }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    window.ipc.invoke('gmail:getEmailInstructions', {})
      .then((res) => { if (!cancelled) setText(res.instructions) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const save = async () => {
    setSaving(true)
    try {
      const result = await window.ipc.invoke('gmail:setEmailInstructions', { instructions: text })
      if (result.ok) {
        toast('Instructions saved — they apply to every email from now on.', 'success')
        onOpenChange(false)
        onSaved?.()
      } else {
        toast(`Could not save: ${result.error ?? 'unknown error'}`, 'error')
      }
    } catch (err) {
      toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="font-sans sm:max-w-[560px]">
        <DialogTitle className="text-base font-semibold">Email agent instructions</DialogTitle>
        <p className="text-sm text-muted-foreground">
          Standing instructions for how your email is labeled, prioritized, and how draft replies are written.
          The agent follows these over its defaults, on every new email. You can also define your own labels
          here — e.g. “Create a label Clients for emails from active client accounts.”
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={loading}
          rows={10}
          maxLength={8000}
          placeholder={
            'Examples:\n' +
            '- Emails from my investors are always important.\n' +
            '- Investor updates I receive are direct emails, not news.\n' +
            '- Never draft replies to recruiters or cold outreach.\n' +
            '- Keep drafts short and casual; sign off with my first name.\n' +
            '- Payment failure alerts are important; other billing emails are receipts.\n' +
            '- Create a label "Customers" for emails from paying customers.'
          }
          className="min-h-[220px] font-sans text-sm leading-relaxed"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  )
}

// One shortcut line: `combo` keys render as adjacent chips (a chord or a
// two-key sequence); `alt` is an equivalent alternative shown after "or".
function ShortcutRow({ combo, alt, label }: { combo: string[]; alt?: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {combo.map((key) => <ShortcutKey key={key}>{key}</ShortcutKey>)}
        {alt && (
          <>
            <span className="px-0.5 text-xs text-muted-foreground">or</span>
            {alt.map((key) => <ShortcutKey key={key}>{key}</ShortcutKey>)}
          </>
        )}
      </span>
    </div>
  )
}

function ShortcutSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

// The "?" cheat sheet. Static list — keep in sync with the handlers in
// EmailView, ThreadDetail, and ComposeBox.
function ShortcutsHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mod = isMac ? '⌘' : 'Ctrl'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="font-sans sm:max-w-[620px]">
        <DialogTitle className="text-base font-semibold">Keyboard shortcuts</DialogTitle>
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
          <ShortcutSection title="Inbox">
            <ShortcutRow combo={['J']} alt={['↓']} label="Next thread" />
            <ShortcutRow combo={['K']} alt={['↑']} label="Previous thread" />
            <ShortcutRow combo={['Enter']} alt={['O']} label="Open / close thread" />
            <ShortcutRow combo={['Esc']} label="Close thread / clear search" />
            <ShortcutRow combo={['E']} label="Archive" />
            <ShortcutRow combo={['#']} label="Move to trash" />
            <ShortcutRow combo={['U']} label="Mark read / unread" />
            <ShortcutRow combo={['I']} label="Toggle important (teaches the classifier)" />
            <ShortcutRow combo={['C']} alt={['N']} label="New message" />
            <ShortcutRow combo={['/']} label="Search" />
            <ShortcutRow combo={['G', 'I']} label="Go to inbox" />
            <ShortcutRow combo={['G', 'D']} label="Go to drafts" />
            <ShortcutRow combo={['?']} label="Keyboard shortcuts" />
          </ShortcutSection>
          <div className="flex flex-col gap-5">
            <ShortcutSection title="Thread">
              <ShortcutRow combo={['R']} label="Reply" />
              <ShortcutRow combo={['A']} label="Reply all" />
              <ShortcutRow combo={['F']} label="Forward" />
            </ShortcutSection>
            <ShortcutSection title="Composer">
              <ShortcutRow combo={[mod, 'Enter']} label="Send" />
              <ShortcutRow combo={[mod, 'Shift', 'C']} label="Add Cc" />
              <ShortcutRow combo={[mod, 'Shift', 'B']} label="Add Bcc" />
              <ShortcutRow combo={['Esc']} label="Close (saves draft)" />
            </ShortcutSection>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const MAX_KEPT_OPEN = 5
const PAGE_SIZE = 25
// Duration of the row slide-out on archive/trash — matches gmail-row-leave.
const ROW_LEAVE_MS = 160
// Sticky .gmail-list-header height — rows scrolled to the top stay clear of it.
const LIST_STICKY_HEADER_PX = 32

function listScrollerFor(row: HTMLElement): HTMLElement | null {
  const list = row.closest('.gmail-list')
  return list instanceof HTMLElement ? list : null
}
type InboxSection = 'important' | 'other'

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
// Last-loaded drafts, kept across EmailView remounts so reopening is instant.
let persistedDrafts: GmailThread[] | null = null

function clearLoadingFlag(state: SectionState | null): SectionState {
  if (!state) return initialSectionState
  return { ...state, loadingPage: false }
}

export type EmailViewProps = {
  /** If provided, the view opens with this thread already expanded. */
  initialThreadId?: string | null
  /** Bump to re-focus on the same threadId after navigating away inside the view. */
  threadIdVersion?: number
  /** Query to load into the search box (e.g. the assistant's read-view email search). */
  initialSearchQuery?: string | null
  /** Bump to re-apply the same search query. */
  searchQueryVersion?: number
}

export function EmailView({ initialThreadId, threadIdVersion, initialSearchQuery, searchQueryVersion }: EmailViewProps = {}) {
  const [important, setImportant] = useState<SectionState>(() => clearLoadingFlag(persistedImportant))
  const [other, setOther] = useState<SectionState>(() => clearLoadingFlag(persistedOther))
  const hadPersistedDataOnMount = useRef(persistedImportant !== null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId ?? null)
  const [openedThreadIds, setOpenedThreadIds] = useState<string[]>(initialThreadId ? [initialThreadId] : [])
  useEffect(() => {
    setSelectedThreadId(initialThreadId ?? null)
    setFocusedThreadId(initialThreadId ?? null)
    if (initialThreadId) {
      setOpenedThreadIds((prev) => {
        const without = prev.filter((id) => id !== initialThreadId)
        return [...without, initialThreadId].slice(-MAX_KEPT_OPEN)
      })
    }
  }, [initialThreadId, threadIdVersion])
  const [refreshing, setRefreshing] = useState(!hadPersistedDataOnMount.current)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Externally-driven search (assistant read-view email query): load it into
  // the search box so the debounced full-mailbox search below runs — matched
  // threads get real rows even when they're not in the synced inbox.
  useEffect(() => {
    const q = initialSearchQuery?.trim()
    if (q) setQuery(q)
  }, [initialSearchQuery, searchQueryVersion])
  const [composeOpen, setComposeOpen] = useState(false)
  // Stable so the open composer isn't re-rendered on every inbox sync tick.
  const closeCompose = useCallback(() => setComposeOpen(false), [])
  // Inbox vs Drafts. Drafts are fetched live (they're not in the inbox cache).
  const [view, setView] = useState<'inbox' | 'drafts'>('inbox')
  // Category filter for "Everything else" (null = all) + whole-section counts
  // from the last backend response, which drive the filter pills.
  const [otherCategory, setOtherCategory] = useState<string | null>(null)
  const otherCategoryRef = useRef<string | null>(null)
  otherCategoryRef.current = otherCategory
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [bulkArchiving, setBulkArchiving] = useState(false)
  const [drafts, setDrafts] = useState<GmailThread[]>(() => persistedDrafts ?? [])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<GmailThread | null>(null)
  // Server-side search across the whole Gmail mailbox (results indexed locally).
  const [searchResults, setSearchResults] = useState<GmailThread[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchEpoch = useRef(0)
  // Gmail sync uses the native Google OAuth connection.
  const [emailConnection, setEmailConnection] = useState<GmailConnectionStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  // Label registry (built-ins + user-defined). Fetched on mount and again
  // after the instructions dialog saves, since saving can create labels.
  const [emailLabels, setEmailLabels] = useState<EmailLabelInfo[]>(BUILTIN_LABELS)
  const refreshLabels = useCallback(async () => {
    try {
      const res = await window.ipc.invoke('gmail:getEmailLabels', {})
      if (res.labels?.length) setEmailLabels(res.labels)
    } catch { /* keep built-ins */ }
  }, [])
  useEffect(() => { void refreshLabels() }, [refreshLabels])
  // Keyboard navigation: the j/k focus cursor over the visible rows, plus the
  // "?" shortcuts overlay. lastFocusedIndexRef remembers the cursor's position
  // so it can re-anchor when the focused row disappears (archive/trash/reload).
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  // Set while the visible ThreadDetail's inline composer is open; list
  // shortcuts stay inert so typing a reply can't archive threads.
  const [activeThreadComposing, setActiveThreadComposing] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastFocusedIndexRef = useRef(0)
  const listModeRef = useRef<string | null>(null)
  // Timestamp of a pending "g" for the two-key g→i / g→d sequences.
  const gPendingRef = useRef(0)
  // Rows currently animating out (archive/trash/draft-delete in flight).
  const [leavingThreadIds, setLeavingThreadIds] = useState<ReadonlySet<string>>(() => new Set())
  const markLeaving = useCallback((rowId: string, leaving: boolean) => {
    setLeavingThreadIds((prev) => {
      if (prev.has(rowId) === leaving) return prev
      const next = new Set(prev)
      if (leaving) next.add(rowId)
      else next.delete(rowId)
      return next
    })
  }, [])

  const loadDrafts = useCallback(async () => {
    setDraftsLoading(true)
    setDraftsError(null)
    try {
      const res = await window.ipc.invoke('gmail:getDrafts', {})
      if (res.error) setDraftsError(res.error)
      setDrafts(res.threads ?? [])
    } catch (err) {
      setDraftsError(err instanceof Error ? err.message : String(err))
    } finally {
      setDraftsLoading(false)
    }
  }, [])

  // Load drafts when the Drafts view is opened.
  useEffect(() => {
    if (view === 'drafts') void loadDrafts()
  }, [view, loadDrafts])

  // Debounced full-mailbox search. Each keystroke bumps an epoch so stale
  // responses are ignored; an empty query clears results.
  useEffect(() => {
    const q = query.trim()
    searchEpoch.current += 1
    const epoch = searchEpoch.current
    if (!q) {
      setSearchResults([])
      setSearchError(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const handle = window.setTimeout(async () => {
      try {
        const res = await window.ipc.invoke('gmail:search', { query: q, limit: 100 })
        if (searchEpoch.current !== epoch) return
        setSearchError(res.error ?? null)
        setSearchResults(res.threads ?? [])
      } catch (err) {
        if (searchEpoch.current === epoch) setSearchError(err instanceof Error ? err.message : String(err))
      } finally {
        if (searchEpoch.current === epoch) setSearching(false)
      }
    }, 400)
    return () => window.clearTimeout(handle)
  }, [query])

  const deleteDraftAction = useCallback(async (thread: GmailThread) => {
    const id = thread.draftId
    if (!id) return
    // Slide the row out before dropping it from the list.
    markLeaving(id, true)
    await new Promise((resolve) => window.setTimeout(resolve, ROW_LEAVE_MS))
    setDrafts((prev) => prev.filter((d) => d.draftId !== id))
    markLeaving(id, false)
    try {
      await window.ipc.invoke('gmail:deleteDraft', { draftId: id })
    } catch (err) {
      toast(`Could not delete draft: ${err instanceof Error ? err.message : String(err)}`, 'error')
      void loadDrafts()
    }
  }, [loadDrafts, markLeaving])

  // Closing the draft composer may have edited/sent/deleted it — refresh.
  const closeDraftEditor = useCallback(() => {
    setEditingDraft(null)
    void loadDrafts()
  }, [loadDrafts])

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const status = await window.ipc.invoke('gmail:getConnectionStatus', {})
        if (!cancelled) setEmailConnection(status)
      } catch {
        if (!cancelled) {
          setEmailConnection({
            connected: false,
            hasRequiredScope: false,
            missingScopes: [],
            email: null,
          })
        }
      }
    }
    void check()
    const cleanupOAuthConnect = window.ipc.on('oauth:didConnect', () => { void check() })
    return () => {
      cancelled = true
      cleanupOAuthConnect()
    }
  }, [])

  useEffect(() => { persistedImportant = important }, [important])
  useEffect(() => { persistedOther = other }, [other])
  useEffect(() => { persistedDrafts = drafts }, [drafts])

  const setSection = useCallback((section: InboxSection, updater: (prev: SectionState) => SectionState) => {
    if (section === 'important') setImportant(updater)
    else setOther(updater)
  }, [])

  const updateThreadInState = useCallback((threadId: string, updater: (t: GmailThread) => GmailThread) => {
    const mapSection = (prev: SectionState): SectionState => ({
      ...prev,
      threads: prev.threads.map((t) => (t.threadId === threadId ? updater(t) : t)),
    })
    setImportant(mapSection)
    setOther(mapSection)
    setSearchResults((prev) => prev.map((t) => (t.threadId === threadId ? updater(t) : t)))
  }, [])

  const removeThreadFromState = useCallback((threadId: string) => {
    const filterSection = (prev: SectionState): SectionState => ({
      ...prev,
      threads: prev.threads.filter((t) => t.threadId !== threadId),
    })
    setImportant(filterSection)
    setOther(filterSection)
    setSearchResults((prev) => prev.filter((t) => t.threadId !== threadId))
    setSelectedThreadId((current) => (current === threadId ? null : current))
    setOpenedThreadIds((prev) => prev.filter((id) => id !== threadId))
  }, [])

  const markThreadReadAction = useCallback(async (threadId: string, read: boolean = true) => {
    updateThreadInState(threadId, (t) => ({
      ...t,
      unread: !read,
      messages: t.messages.map((m) => ({ ...m, unread: !read })),
    }))
    try {
      const result = await window.ipc.invoke('gmail:markThreadRead', { threadId, read })
      if (!result.ok && result.error) console.warn('[Gmail] mark-read failed:', result.error)
    } catch (err) {
      console.warn('[Gmail] mark-read failed:', err)
    }
  }, [updateThreadInState])

  const archiveThreadAction = useCallback(async (threadId: string) => {
    // Start the slide-out right away; the row is removed once both the IPC
    // and the animation have finished. A failure clears the flag → snap back.
    markLeaving(threadId, true)
    try {
      const [result] = await Promise.all([
        window.ipc.invoke('gmail:archiveThread', { threadId }),
        new Promise((resolve) => window.setTimeout(resolve, ROW_LEAVE_MS)),
      ])
      if (result.ok) {
        removeThreadFromState(threadId)
      } else if (result.error) {
        toast(`Archive failed: ${result.error}`, 'error')
      }
    } catch (err) {
      toast(`Archive failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      markLeaving(threadId, false)
    }
  }, [removeThreadFromState, markLeaving])

  // User flips a thread's verdict: sticky on the thread + recorded as a
  // correction the importance classifier learns from. The row slides out of
  // its current section and lands on top of the other one.
  const setImportanceAction = useCallback(async (threadId: string, importance: 'important' | 'other') => {
    const source = [...important.threads, ...other.threads].find((t) => t.threadId === threadId)
    markLeaving(threadId, true)
    try {
      const [result] = await Promise.all([
        window.ipc.invoke('gmail:setImportance', { threadId, importance }),
        new Promise((resolve) => window.setTimeout(resolve, ROW_LEAVE_MS)),
      ])
      if (result.ok) {
        const from = importance === 'important' ? 'other' as const : 'important' as const
        setSection(from, (prev) => ({ ...prev, threads: prev.threads.filter((t) => t.threadId !== threadId) }))
        if (source) {
          setSection(importance, (prev) => ({
            ...prev,
            threads: [source, ...prev.threads.filter((t) => t.threadId !== threadId)],
          }))
        }
        toast(importance === 'important' ? 'Marked important — noted for future emails.' : 'Marked not important — noted for future emails.', 'success')
      } else if (result.error) {
        toast(`Could not update importance: ${result.error}`, 'error')
      }
    } catch (err) {
      toast(`Could not update importance: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      markLeaving(threadId, false)
    }
  }, [important.threads, other.threads, markLeaving, setSection])

  // User corrects a thread's category: sticky on the thread + recorded as a
  // correction the classifier learns from (few-shot).
  const setCategoryAction = useCallback(async (threadId: string, category: EmailCategory) => {
    try {
      const result = await window.ipc.invoke('gmail:setCategory', { threadId, category })
      if (result.ok) {
        updateThreadInState(threadId, (t) => ({ ...t, category }))
        setCategoryCounts((prev) => {
          const next = { ...prev }
          // Only 'other'-section threads are counted; adjust optimistically and
          // let the next backend response correct any drift.
          const prevCat = [...important.threads, ...other.threads].find((t) => t.threadId === threadId)?.category ?? 'unclassified'
          if (other.threads.some((t) => t.threadId === threadId)) {
            next[prevCat] = Math.max(0, (next[prevCat] ?? 1) - 1)
            next[category] = (next[category] ?? 0) + 1
          }
          return next
        })
        toast(`Filed as ${labelNameFor(emailLabels, category)} — noted for similar emails.`, 'success')
      } else if (result.error) {
        toast(`Could not update category: ${result.error}`, 'error')
      }
    } catch (err) {
      toast(`Could not update category: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [updateThreadInState, important.threads, other.threads, emailLabels])

  const trashThreadAction = useCallback(async (threadId: string) => {
    markLeaving(threadId, true)
    try {
      const [result] = await Promise.all([
        window.ipc.invoke('gmail:trashThread', { threadId }),
        new Promise((resolve) => window.setTimeout(resolve, ROW_LEAVE_MS)),
      ])
      if (result.ok) {
        removeThreadFromState(threadId)
      } else if (result.error) {
        toast(`Delete failed: ${result.error}`, 'error')
      }
    } catch (err) {
      toast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      markLeaving(threadId, false)
    }
  }, [removeThreadFromState, markLeaving])

  const toggleThread = useCallback((thread: GmailThread) => {
    setFocusedThreadId(thread.threadId)
    setSelectedThreadId((current) => {
      const next = current === thread.threadId ? null : thread.threadId
      if (next) {
        setOpenedThreadIds((prev) => {
          const without = prev.filter((id) => id !== next)
          return [...without, next].slice(-MAX_KEPT_OPEN)
        })
        if (thread.unread) {
          void markThreadReadAction(thread.threadId)
        }
      }
      return next
    })
  }, [markThreadReadAction])

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

  // Per-section load epochs so concurrent reloads of different sections don't
  // trample each other. (A single shared epoch caused Important's silent
  // reload to be discarded whenever Other was reloaded in the same tick.)
  const epochsRef = useRef<Record<InboxSection, number>>({ important: 0, other: 0 })

  const fetchSectionPage = useCallback(async (section: InboxSection, cursor?: string) => {
    const result = section === 'important'
      ? await window.ipc.invoke('gmail:getImportant', { cursor, limit: PAGE_SIZE })
      : await window.ipc.invoke('gmail:getEverythingElse', {
          cursor,
          limit: PAGE_SIZE,
          category: otherCategoryRef.current ?? undefined,
        })
    // Counts describe the whole 'other' section regardless of filter/page —
    // keep the pills fresh on every response that carries them.
    if (section === 'other' && result.categoryCounts) {
      setCategoryCounts(result.categoryCounts)
    }
    return result
  }, [])

  const loadNextPage = useCallback(async (section: InboxSection) => {
    const current = section === 'important' ? important : other
    if (current.loadingPage || current.hasReachedEnd) return

    const epoch = epochsRef.current[section]
    setSection(section, (prev) => ({ ...prev, loadingPage: true }))
    try {
      const result = await fetchSectionPage(section, current.nextCursor ?? undefined)
      if (epoch !== epochsRef.current[section]) return
      setSection(section, (prev) => ({
        threads: [...prev.threads, ...result.threads],
        nextCursor: result.nextCursor,
        hasReachedEnd: result.nextCursor === null,
        loadingPage: false,
      }))
    } catch (err) {
      if (epoch !== epochsRef.current[section]) return
      console.warn(`[Gmail] page load failed for ${section}:`, err)
      setSection(section, (prev) => ({ ...prev, loadingPage: false }))
    }
  }, [important, other, setSection, fetchSectionPage])

  const reloadFirstPage = useCallback(async (section: InboxSection, options: { silent?: boolean } = {}) => {
    const epoch = ++epochsRef.current[section]
    if (options.silent) {
      setSection(section, (prev) => ({ ...prev, loadingPage: true }))
    } else {
      setSection(section, () => ({ ...initialSectionState, loadingPage: true }))
    }
    try {
      const result = await fetchSectionPage(section)
      if (epoch !== epochsRef.current[section]) return
      setSection(section, () => ({
        threads: result.threads,
        nextCursor: result.nextCursor,
        hasReachedEnd: result.nextCursor === null,
        loadingPage: false,
      }))
    } catch (err) {
      if (epoch !== epochsRef.current[section]) return
      console.warn(`[Gmail] initial page load failed for ${section}:`, err)
      setSection(section, (prev) => ({ ...prev, loadingPage: false }))
    }
  }, [setSection, fetchSectionPage])


  // Initial load — fetch page 1 of BOTH sections. Everything else used to
  // load lazily once Important was exhausted, but that chained on
  // hasReachedEnd, which every silent live reload resets (back to page 1) —
  // under sustained sync writes the chain never fired and the section never
  // appeared at all. Both lists are cheap local reads (mtime-cached file
  // scan), so eager is fine. On first-ever mount we do a non-silent load
  // (shows loading state); on re-mount with persisted state we do a silent
  // reconcile against the cache — necessary because the watcher subscription
  // only runs while mounted, so any cache changes that happened while the
  // panel was unmounted would otherwise stay invisible.
  useEffect(() => {
    const silent = hadPersistedDataOnMount.current
    void reloadFirstPage('important', { silent })
    void reloadFirstPage('other', { silent })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Changing the category filter refetches Everything else from page 1
  // (fetchSectionPage reads the filter from otherCategoryRef). Skipped on
  // mount — the initial-load effect above covers it.
  const otherCategoryMounted = useRef(false)
  useEffect(() => {
    if (!otherCategoryMounted.current) {
      otherCategoryMounted.current = true
      return
    }
    void reloadFirstPage('other')
  }, [otherCategory, reloadFirstPage])

  // Bulk gesture behind the filter pills: archive the whole category at once.
  const archiveCategoryAction = useCallback(async (category: string) => {
    setBulkArchiving(true)
    try {
      const result = await window.ipc.invoke('gmail:archiveCategory', { category })
      if (result.error) {
        toast(`Bulk archive failed: ${result.error}`, 'error')
      } else {
        toast(
          `Archived ${result.archived} thread${result.archived === 1 ? '' : 's'}${result.failed ? ` (${result.failed} failed)` : ''}. They stay searchable in Gmail.`,
          result.failed ? 'error' : 'success',
        )
      }
      setOtherCategory(null) // triggers the Everything else reload above
      void reloadFirstPage('important', { silent: true })
    } catch (err) {
      toast(`Bulk archive failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBulkArchiving(false)
    }
  }, [reloadFirstPage])

  // Live updates: watcher on inbox_lists/ → silently refresh visible sections
  // when files change. Throttled to at most one reload per ~3s so a burst of
  // backend writes (sync processing many threads sequentially) coalesces into
  // a small number of in-place updates rather than a flicker storm.
  // Suppressed while a thread is open (reading/replying) or the compose-new
  // modal is open; deferred until whichever is open closes. A reload replaces
  // the threads array and re-renders the whole inbox list (and any mounted
  // ThreadDetail iframes) on the main thread — that re-render janks an open
  // composer even though ComposeBox itself is memoized, so we pause it.
  const pendingReloadRef = useRef(false)
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastReloadAtRef = useRef(0)
  const isSelectedRef = useRef<string | null>(null)
  isSelectedRef.current = selectedThreadId
  const composeOpenRef = useRef(false)
  composeOpenRef.current = composeOpen
  const isRefreshingRef = useRef(false)
  isRefreshingRef.current = refreshing

  const RELOAD_THROTTLE_MS = 3000

  const doReload = useCallback(() => {
    if (isRefreshingRef.current) return
    if (isSelectedRef.current !== null || composeOpenRef.current) {
      pendingReloadRef.current = true
      return
    }
    lastReloadAtRef.current = Date.now()
    void reloadFirstPage('important', { silent: true })
    void reloadFirstPage('other', { silent: true })
  }, [reloadFirstPage])

  // Leading-edge throttle:
  // - First event after a quiet period (≥ THROTTLE) → fire immediately.
  // - During an active burst → queue a trailing fire at the next throttle
  //   boundary. Subsequent events while a trailing fire is pending do nothing
  //   (so a continuous stream of writes can't starve the reload).
  const triggerLiveReload = useCallback(() => {
    const sinceLast = Date.now() - lastReloadAtRef.current
    if (sinceLast >= RELOAD_THROTTLE_MS && !reloadDebounceRef.current) {
      doReload()
      return
    }
    if (reloadDebounceRef.current) return
    const wait = Math.max(200, RELOAD_THROTTLE_MS - sinceLast)
    reloadDebounceRef.current = setTimeout(() => {
      reloadDebounceRef.current = null
      doReload()
    }, wait)
  }, [doReload])

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

  // When the user closes the open thread or the compose-new modal, if updates
  // arrived while it was open, flush them now.
  useEffect(() => {
    if (selectedThreadId !== null || composeOpen) return
    if (!pendingReloadRef.current) return
    pendingReloadRef.current = false
    lastReloadAtRef.current = Date.now()
    void reloadFirstPage('important', { silent: true })
    void reloadFirstPage('other', { silent: true })
  }, [selectedThreadId, composeOpen, reloadFirstPage])

  // Manual refresh: wake the background sync loop. It updates inbox_lists/,
  // the watcher fires, and triggerLiveReload picks up the changes. The
  // spinner is a UX cue — we stop it shortly after the sync poke.
  const refreshInFlightRef = useRef(false)
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setRefreshing(true)
    setError(null)
    try {
      await window.ipc.invoke('gmail:triggerSync', {})
    } catch (err) {
      console.warn('[Gmail] triggerSync failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Leave the spinner on briefly so the user sees feedback; the watcher
      // will refresh the visible state once the sync cycle writes new files.
      setTimeout(() => {
        refreshInFlightRef.current = false
        setRefreshing(false)
      }, 800)
    }
  }, [])

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
  const visibleDrafts = useMemo(() => filterThreads(drafts), [drafts, filterThreads])

  // Split "Important" into what still needs the user vs. what they've already
  // answered and are waiting on. Derived per render from the messages — thread
  // state, unlike a label, can't be allowed to go stale.
  const selfEmail = emailConnection?.email ?? null
  const visibleNeedsYou = useMemo(
    () => visibleImportant.filter((t) => !isAwaitingThem(t, selfEmail)),
    [visibleImportant, selfEmail],
  )
  const visibleWaiting = useMemo(
    () => visibleImportant.filter((t) => isAwaitingThem(t, selfEmail)),
    [visibleImportant, selfEmail],
  )

  // ── Keyboard shortcuts (Superhuman-style) ───────────────────────────────────
  // EmailView only mounts while the email tab is open, so these are naturally
  // scoped to that view. Single-letter keys stay inert while typing in any
  // field, while a dialog is up, or while the inline reply composer is open.

  const listMode: 'search' | 'drafts' | 'inbox' = query.trim() ? 'search' : view === 'drafts' ? 'drafts' : 'inbox'
  const anyModalOpen = composeOpen || settingsOpen || Boolean(editingDraft) || helpOpen || instructionsOpen

  // Row identity for the focus cursor — must match each row's data-thread-id.
  const rowIdOf = useCallback((thread: GmailThread) => (
    listMode === 'drafts' ? (thread.draftId || thread.threadId) : thread.threadId
  ), [listMode])

  // Flattened, ordered list of the rows currently on screen — the domain of
  // the j/k cursor. Mirrors the render branches below: search results, drafts,
  // or Important followed by Everything else (which only renders once
  // Important is exhausted).
  const visibleList = useMemo<GmailThread[]>(() => {
    if (query.trim()) return searchResults
    if (view === 'drafts') return visibleDrafts
    if (other.threads.length > 0) return [...visibleNeedsYou, ...visibleWaiting, ...visibleOther]
    return [...visibleNeedsYou, ...visibleWaiting]
  }, [query, searchResults, view, visibleDrafts, visibleNeedsYou, visibleWaiting, visibleOther, other.threads.length])

  // Keep the cursor valid as the list changes: switching between inbox,
  // search, and drafts resets it; if the focused row vanished (archived,
  // trashed, or replaced by a live reload), re-anchor to the same position.
  useEffect(() => {
    if (listModeRef.current !== listMode) {
      const isFirstRun = listModeRef.current === null
      listModeRef.current = listMode
      if (!isFirstRun) {
        lastFocusedIndexRef.current = 0
        setFocusedThreadId(null)
        return
      }
    }
    if (!focusedThreadId || visibleList.length === 0) return
    const idx = visibleList.findIndex((t) => rowIdOf(t) === focusedThreadId)
    if (idx >= 0) {
      lastFocusedIndexRef.current = idx
      return
    }
    const fallback = visibleList[Math.min(lastFocusedIndexRef.current, visibleList.length - 1)]
    setFocusedThreadId(fallback ? rowIdOf(fallback) : null)
  }, [visibleList, focusedThreadId, listMode, rowIdOf])

  // ── Smooth list scrolling ──────────────────────────────────────────────────
  // Short ease-out scroll instead of native behavior:'smooth' — it finishes in
  // ~140ms and retargets cleanly under key-repeat, where the native animation
  // lags behind and rubber-bands.
  const scrollAnimRef = useRef<number | null>(null)
  const smoothScrollTo = useCallback((container: HTMLElement, top: number) => {
    if (scrollAnimRef.current !== null) window.cancelAnimationFrame(scrollAnimRef.current)
    const from = container.scrollTop
    const max = container.scrollHeight - container.clientHeight
    const target = Math.min(Math.max(top, 0), max)
    const delta = target - from
    if (delta === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.scrollTop = target
      return
    }
    const start = performance.now()
    const duration = 140
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      container.scrollTop = from + delta * eased
      scrollAnimRef.current = t < 1 ? window.requestAnimationFrame(step) : null
    }
    scrollAnimRef.current = window.requestAnimationFrame(step)
  }, [])

  useEffect(() => () => {
    if (scrollAnimRef.current !== null) window.cancelAnimationFrame(scrollAnimRef.current)
  }, [])

  const rowElementFor = useCallback((rowId: string) => {
    const el = rootRef.current?.querySelector(`[data-thread-id="${CSS.escape(rowId)}"]`)
    return el instanceof HTMLElement ? el : null
  }, [])

  // Keep the focused row on screen during keyboard navigation — "nearest"
  // semantics with the animated scroll, minding the sticky section header.
  useEffect(() => {
    if (!focusedThreadId) return
    const row = rowElementFor(focusedThreadId)
    const list = row ? listScrollerFor(row) : null
    if (!row || !list) return
    const listRect = list.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const topEdge = listRect.top + LIST_STICKY_HEADER_PX
    if (rowRect.top < topEdge) {
      smoothScrollTo(list, list.scrollTop + rowRect.top - topEdge)
    } else if (rowRect.bottom > listRect.bottom) {
      smoothScrollTo(list, list.scrollTop + rowRect.bottom - listRect.bottom)
    }
  }, [focusedThreadId, rowElementFor, smoothScrollTo])

  // Opening a thread glides its row to the top of the list so the expanded
  // conversation gets the full viewport. Runs after the focus effect above and
  // cancels its animation via the shared ref, so on open this scroll wins.
  useEffect(() => {
    if (!selectedThreadId) return
    const row = rowElementFor(selectedThreadId)
    const list = row ? listScrollerFor(row) : null
    if (!row || !list) return
    const rowTop = list.scrollTop + row.getBoundingClientRect().top - list.getBoundingClientRect().top
    smoothScrollTo(list, rowTop - LIST_STICKY_HEADER_PX)
  }, [selectedThreadId, rowElementFor, smoothScrollTo])

  // While the list is scrolling, flag the shell so CSS turns off row pointer
  // events (see .gmail-shell[data-scrolling]) — otherwise every row passing
  // under the cursor restyles for :hover and schedules a prefetch timer,
  // stealing frame time. The attribute is toggled straight on the DOM node so
  // scrolling itself never causes a React render.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let timer: number | null = null
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element) || !target.classList.contains('gmail-list')) return
      if (timer === null) root.setAttribute('data-scrolling', '')
      else window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        root.removeAttribute('data-scrolling')
      }, 150)
    }
    // Capture phase: scroll events don't bubble, so listen above the scroller.
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll, { capture: true })
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return
      // All list keys are unmodified. Shift is allowed through because "#" and
      // "?" need it; shifted letters produce uppercase e.key and match nothing.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const inEditable = isEditableTarget(e.target)

      if (e.key === 'Escape') {
        // The search input, recipient fields, and composers own their Escape;
        // this level only closes the open thread or clears the search.
        if (inEditable || anyModalOpen || activeThreadComposing) return
        if (selectedThreadId) {
          e.preventDefault()
          setSelectedThreadId(null)
          return
        }
        if (query.trim()) {
          e.preventDefault()
          setQuery('')
        }
        return
      }

      if (inEditable || anyModalOpen || activeThreadComposing) return

      // Two-key "go to" sequences: g then i (inbox) / g then d (drafts).
      if (gPendingRef.current && Date.now() - gPendingRef.current < 1000) {
        gPendingRef.current = 0
        if (e.key === 'i' || e.key === 'd') {
          e.preventDefault()
          setQuery('')
          setView(e.key === 'i' ? 'inbox' : 'drafts')
          return
        }
        // Any other key cancels the sequence and is handled normally below.
      }
      if (e.key === 'g') {
        gPendingRef.current = Date.now()
        return
      }

      const focusedIndex = focusedThreadId
        ? visibleList.findIndex((t) => rowIdOf(t) === focusedThreadId)
        : -1

      const moveFocus = (delta: number) => {
        if (visibleList.length === 0) return
        e.preventDefault() // stop arrow keys from also scrolling the list
        const next = visibleList[Math.min(Math.max(focusedIndex + delta, 0), visibleList.length - 1)]
        if (next) setFocusedThreadId(rowIdOf(next))
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          moveFocus(1)
          return
        case 'k':
        case 'ArrowUp':
          moveFocus(-1)
          return
        case 'Enter':
        case 'o': {
          const focused = focusedIndex >= 0 ? visibleList[focusedIndex] : undefined
          if (!focused) return
          e.preventDefault()
          if (listMode === 'drafts') setEditingDraft(focused)
          else toggleThread(focused)
          return
        }
        case 'c':
        case 'n':
          e.preventDefault()
          setComposeOpen(true)
          return
        case '/':
          e.preventDefault()
          searchInputRef.current?.focus()
          return
        case '?':
          e.preventDefault()
          setHelpOpen(true)
          return
        case 'e':
        case '#':
        case 'u':
        case 'i': {
          if (listMode === 'drafts') return // drafts have no archive/trash/read state
          // The open thread takes precedence over the cursor.
          const targetId = selectedThreadId ?? (focusedIndex >= 0 ? visibleList[focusedIndex]?.threadId : undefined)
          const target = targetId ? visibleList.find((t) => t.threadId === targetId) : undefined
          if (!target) return
          e.preventDefault()
          if (e.key === 'u') void markThreadReadAction(target.threadId, target.unread === true)
          else if (e.key === 'e') void archiveThreadAction(target.threadId)
          else if (e.key === 'i') {
            const isImportant = important.threads.some((t) => t.threadId === target.threadId)
            void setImportanceAction(target.threadId, isImportant ? 'other' : 'important')
          }
          else void trashThreadAction(target.threadId)
          return
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    visibleList, focusedThreadId, selectedThreadId, query, listMode, anyModalOpen,
    activeThreadComposing, rowIdOf, toggleThread, markThreadReadAction,
    archiveThreadAction, trashThreadAction, setImportanceAction, important.threads,
  ])

  const hasAny = important.threads.length > 0 || other.threads.length > 0
  const initialLoading = !hasAny && refreshing
  const needsEmailConnect = emailConnection?.connected === false
  const needsEmailReconnect = emailConnection?.connected === true && !emailConnection.hasRequiredScope

  const closeThread = useCallback(() => setSelectedThreadId(null), [])

  const renderRow = (
    thread: GmailThread,
    section: 'important' | 'other' | null = null,
    chip: string | null = null,
    chipWaiting: boolean = false,
  ) => {
    const isMounted = openedThreadIds.includes(thread.threadId)
    return (
      <ThreadRow
        key={thread.threadId}
        thread={thread}
        isSelected={thread.threadId === selectedThreadId}
        isFocused={thread.threadId === focusedThreadId}
        isMounted={isMounted}
        isLeaving={leavingThreadIds.has(thread.threadId)}
        keysDisabled={isMounted && anyModalOpen}
        section={section}
        chip={chip}
        chipWaiting={chipWaiting}
        onSetCategory={section ? setCategoryAction : undefined}
        labels={emailLabels}
        onToggle={toggleThread}
        onMarkRead={markThreadReadAction}
        onArchive={archiveThreadAction}
        onTrash={trashThreadAction}
        onSetImportance={setImportanceAction}
        onHoverIn={scheduleHoverPrefetch}
        onHoverOut={cancelHoverPrefetch}
        onCloseThread={closeThread}
        onComposingChange={setActiveThreadComposing}
      />
    )
  }

  const renderDraftRow = (thread: GmailThread) => {
    const stop = (e: React.MouseEvent | React.KeyboardEvent) => { e.stopPropagation() }
    const recipient = thread.to ? extractName(thread.to) : 'No recipient'
    const rowId = thread.draftId || thread.threadId
    const isFocused = rowId === focusedThreadId
    const isLeaving = leavingThreadIds.has(rowId)
    return (
      <div key={rowId} className={cn('gmail-row-group', 'gmail-row-group-cv', isLeaving && 'gmail-row-group-leaving')}>
        <div className="gmail-row-shell" data-thread-id={rowId}>
          <button
            type="button"
            className={cn('gmail-row', isFocused && 'gmail-row-focused')}
            onClick={() => setEditingDraft(thread)}
          >
            <span className="gmail-row-dot" aria-hidden />
            <span className="gmail-row-sender">To: {recipient}</span>
            <span className="gmail-row-content">
              <strong>{thread.subject || '(No subject)'}</strong>
              <span>{snippet(thread.gmail_draft || thread.latest_email)}</span>
            </span>
            <span className="gmail-row-date">{formatInboxTime(thread.date)}</span>
          </button>
          <div className="gmail-row-actions" onMouseDown={stop} onClick={stop}>
            <button
              type="button"
              className="gmail-row-action gmail-row-action-danger"
              title="Delete draft"
              aria-label="Delete draft"
              onClick={(e) => { stop(e); void deleteDraftAction(thread) }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="gmail-shell" ref={rootRef}>
      <div className="gmail-main">
        <div className="gmail-topbar">
          <div className="gmail-search">
            <Search size={18} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search all mail"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                if (query) setQuery('')
                else event.currentTarget.blur()
              }}
            />
            {query && (
              <button
                type="button"
                className="gmail-search-clear"
                onClick={() => setQuery('')}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="gmail-topbar-actions">
            <div className="flex items-center rounded-md border border-border p-0.5 text-xs font-medium">
              <button
                type="button"
                className={cn('rounded px-2.5 py-1 transition-colors', view === 'inbox' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => setView('inbox')}
              >Inbox</button>
              <button
                type="button"
                className={cn('rounded px-2.5 py-1 transition-colors', view === 'drafts' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => setView('drafts')}
              >Drafts{drafts.length > 0 ? ` (${drafts.length})` : ''}</button>
            </div>
            <button
              type="button"
              className="gmail-icon-button"
              onClick={() => setInstructionsOpen(true)}
              aria-label="Email agent instructions"
              title="Email agent instructions"
            >
              <SlidersHorizontal size={18} />
            </button>
            <button
              type="button"
              className="gmail-icon-button"
              onClick={() => { if (view === 'drafts') void loadDrafts(); else void refresh() }}
              aria-label="Refresh"
            >
              {(view === 'drafts' ? draftsLoading : refreshing) ? <LoaderIcon size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            </button>
            <button type="button" className="gmail-icon-button" onClick={() => setComposeOpen(true)} aria-label="Compose new email">
              <SquarePen size={18} />
            </button>
          </div>
        </div>

        {query.trim() ? (
          searchError && searchResults.length === 0 ? (
            <div className="gmail-empty-state">Could not search: {searchError}</div>
          ) : searchResults.length > 0 ? (
            <div className="gmail-list" aria-label="Search results">
              <section className="gmail-section">
                <div className="gmail-list-header">
                  <span>Search results</span>
                  <span>{searchResults.length} thread{searchResults.length === 1 ? '' : 's'}</span>
                </div>
                {searchResults.map((t) => renderRow(t))}
              </section>
            </div>
          ) : (
            <div className="gmail-empty-state">
              {searching ? 'Searching all mail…' : `No results for “${query.trim()}”.`}
            </div>
          )
        ) : view === 'drafts' ? (
          draftsError && drafts.length === 0 ? (
            <div className="gmail-empty-state">Could not load drafts: {draftsError}</div>
          ) : drafts.length > 0 ? (
            <div className="gmail-list" aria-label="Drafts">
              <section className="gmail-section">
                <div className="gmail-list-header">
                  <span>Drafts</span>
                  <span>{drafts.length} draft{drafts.length === 1 ? '' : 's'}</span>
                </div>
                {visibleDrafts.map(renderDraftRow)}
              </section>
            </div>
          ) : (
            <div className="gmail-empty-state">
              {draftsLoading ? 'Loading drafts…' : 'No drafts yet.'}
            </div>
          )
        ) : error && !hasAny ? (
          <div className="gmail-empty-state">Could not load mail: {error}</div>
        ) : hasAny ? (
          <div className="gmail-list" aria-label="Recent emails">
            {visibleNeedsYou.length > 0 ? (
              <section className="gmail-section">
                <div className="gmail-list-header">
                  <span>Needs you</span>
                  <span>
                    {visibleNeedsYou.length}{important.hasReachedEnd ? '' : '+'} thread{visibleNeedsYou.length === 1 ? '' : 's'}
                  </span>
                </div>
                {visibleNeedsYou.map((t) => renderRow(t, 'important', t.draft_response ? 'Reply ready' : null))}
              </section>
            ) : important.hasReachedEnd && !important.loadingPage ? (
              <div className="gmail-caughtup">You’re caught up — nothing needs a reply.</div>
            ) : null}
            {visibleWaiting.length > 0 && (
              <section className="gmail-section">
                <div className="gmail-list-header">
                  <span>Waiting on them</span>
                  <span>
                    {visibleWaiting.length}{important.hasReachedEnd ? '' : '+'} thread{visibleWaiting.length === 1 ? '' : 's'}
                  </span>
                </div>
                {visibleWaiting.map((t) => renderRow(t, 'important', waitingChip(t), true))}
              </section>
            )}
            {/* Pages of "Important" feed both sections above, so the sentinel
                lives after them rather than inside either one. */}
            {important.threads.length > 0 && !important.hasReachedEnd && (
              <SectionSentinel
                disabled={important.loadingPage || important.hasReachedEnd}
                onIntersect={() => loadNextPage('important')}
                loading={important.loadingPage}
              />
            )}
            {/* Loading stays lazy (chained on Important exhausting), but once
                loaded the section never unmounts: silent live reloads reset
                Important to page 1 (hasReachedEnd → false), and gating the
                render on it made this whole section vanish on every sync. */}
            {(other.threads.length > 0 || otherCategory !== null) && (
              <section className="gmail-section">
                <div className="gmail-list-header">
                  <span>Everything else</span>
                  <span>
                    {other.threads.length}{other.hasReachedEnd ? '' : '+'} thread{other.threads.length === 1 ? '' : 's'}
                  </span>
                </div>
                {Object.keys(categoryCounts).length > 0 && (
                  <div className="gmail-category-pills">
                    {[
                      ...BUILTIN_PILL_ORDER,
                      ...emailLabels.filter((l) => l.kind === 'custom').map((l) => l.id),
                      // Stale custom ids still present in counts render too.
                      ...Object.keys(categoryCounts).filter((c) => c !== 'unclassified' && !BUILTIN_PILL_ORDER.includes(c) && !emailLabels.some((l) => l.id === c)),
                      'unclassified',
                    ].filter((c) => (categoryCounts[c] ?? 0) > 0).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={cn('gmail-category-pill', otherCategory === cat && 'gmail-category-pill-active')}
                        onClick={() => setOtherCategory((prev) => (prev === cat ? null : cat))}
                      >
                        {labelNameFor(emailLabels, cat)} <span className="gmail-category-pill-count">{categoryCounts[cat]}</span>
                      </button>
                    ))}
                    {otherCategory && otherCategory !== 'unclassified' && (
                      <button
                        type="button"
                        className="gmail-category-pill gmail-category-pill-archive"
                        disabled={bulkArchiving}
                        onClick={() => void archiveCategoryAction(otherCategory)}
                      >
                        {bulkArchiving
                          ? 'Archiving…'
                          : `Archive all ${categoryCounts[otherCategory] ?? ''} ${labelNameFor(emailLabels, otherCategory).toLowerCase()}`}
                      </button>
                    )}
                  </div>
                )}
                {other.threads.length === 0 && otherCategory !== null && !other.loadingPage && (
                  <div className="gmail-caughtup">Nothing filed as {labelNameFor(emailLabels, otherCategory).toLowerCase()}.</div>
                )}
                {visibleOther.map((t) => renderRow(t, 'other'))}
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
        ) : needsEmailConnect || needsEmailReconnect ? (
          <div className="gmail-empty-state flex flex-col items-center gap-3 py-16 text-center">
            <Mail size={28} className="opacity-50" />
            <p>
              {needsEmailReconnect
                ? 'Reconnect your email to enable Gmail sync and actions.'
                : 'Connect your email to see your inbox here.'}
            </p>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Mail size={15} />
              {needsEmailReconnect ? 'Reconnect your email' : 'Connect your email'}
            </button>
          </div>
        ) : (
          <div className="gmail-empty-state">
            {initialLoading ? 'Loading Gmail threads…' : 'No Gmail threads in your inbox cache yet.'}
          </div>
        )}
      </div>
      {composeOpen && <ComposeBox mode="new" onClose={closeCompose} />}
      {editingDraft && (
        <ComposeBox
          mode="draft"
          thread={editingDraft}
          selfEmail={emailConnection?.email ?? ''}
          onClose={closeDraftEditor}
        />
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab="connections" />
      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <EmailInstructionsDialog open={instructionsOpen} onOpenChange={setInstructionsOpen} onSaved={() => void refreshLabels()} />
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
