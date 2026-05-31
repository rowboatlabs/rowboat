import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Bold, CheckCheck, Forward, Italic, Link as LinkIcon, List, ListOrdered, LoaderIcon, Mail, Paperclip, Quote, RefreshCw, Reply, ReplyAll, Search, Send, Sparkles, Strikethrough, Trash2 } from 'lucide-react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import type { blocks } from '@x/shared'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useTheme } from '@/contexts/theme-context'
import { SettingsDialog } from '@/components/settings-dialog'

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

function isReplyQuoteBoundary(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() || ''
  if (/^On\b.+\bwrote:\s*$/i.test(line)) return true
  if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(line)) return true
  if (/^From:\s+\S/i.test(line)) {
    const next = lines.slice(index + 1, index + 6).map((value) => value.trim())
    return next.some((value) => /^(Sent|Date):\s+\S/i.test(value))
      && next.some((value) => /^To:\s+\S/i.test(value))
      && next.some((value) => /^Subject:\s+\S/i.test(value))
  }
  return false
}

function stripQuotedReplyText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const boundary = lines.findIndex((line, index) => {
    if (isReplyQuoteBoundary(lines, index)) return true
    return index > 0
      && line.trim().startsWith('>')
      && (lines[index - 1]?.trim() === '' || lines[index - 1]?.trim().startsWith('>'))
  })
  const visible = boundary >= 0 ? lines.slice(0, boundary) : lines
  return visible.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
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

// Subject line for a reply ("Re: …") or forward ("Fwd: …"), avoiding double prefixes.
function composeSubject(mode: ComposeMode, rawSubject?: string): string {
  const raw = (rawSubject || '').trim()
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

// True if the HTML — after stripping quoted/hidden content — defines its
// own visual layout (real images, tables, explicit backgrounds). Unstyled
// HTML (Gmail replies, Outlook one-liners wrapped in MsoNormal boilerplate,
// outreach emails with only a tracking pixel, reply HTML whose only image
// lives inside the inline-quoted thread) gets an iframe that adapts to the
// app theme; styled HTML keeps the white "paper" look so newsletters /
// branded designs render as their senders intended.
function isStyledHtml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('.gmail_quote, .gmail_attr, blockquote[type="cite"]').forEach((n) => n.remove())
  if (doc.querySelector('table')) return true
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const w = parseInt(img.getAttribute('width') || '0', 10)
    const h = parseInt(img.getAttribute('height') || '0', 10)
    if (w === 1 && h === 1) continue
    const style = img.getAttribute('style') || ''
    if (/display\s*:\s*none/i.test(style)) continue
    if (/visibility\s*:\s*hidden/i.test(style)) continue
    return true
  }
  const visible = doc.body?.innerHTML || ''
  if (/bgcolor\s*=/i.test(visible)) return true
  if (/background-(color|image)\s*:/i.test(visible)) return true
  return false
}

function buildEmailDocument(
  html: string,
  opts: { theme: 'light' | 'dark'; adaptToTheme: boolean },
): string {
  const useDark = opts.theme === 'dark' && opts.adaptToTheme
  const colorScheme = opts.theme === 'dark' ? 'light dark' : 'light'
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
  .gmail_quote,
  .gmail_attr,
  blockquote[type="cite"] { display: none; }
  [data-show-quotes="true"] .gmail_quote,
  [data-show-quotes="true"] .gmail_attr,
  [data-show-quotes="true"] blockquote[type="cite"] { display: block; }
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
  const [hasQuote, setHasQuote] = useState(false)
  const [showQuotes, setShowQuotes] = useState(false)

  const adaptToTheme = useMemo(() => !isStyledHtml(message.bodyHtml!), [message.bodyHtml])
  const srcDoc = useMemo(
    () => buildEmailDocument(message.bodyHtml!, { theme: resolvedTheme, adaptToTheme }),
    [message.bodyHtml, resolvedTheme, adaptToTheme],
  )

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc?.body) return
    setHasQuote(!!doc.querySelector('.gmail_quote, .gmail_attr, blockquote[type="cite"]'))
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
  const openAttachment = (path: string, filename: string) => {
    void window.ipc
      .invoke('shell:openPath', { path })
      .then((result) => {
        if (result?.error) toast(`Could not open ${filename}: ${result.error}`, 'error')
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        toast(`Could not open ${filename}: ${message}`, 'error')
      })
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
            onClick={() => openAttachment(att.savedPath, att.filename)}
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

type ComposeMode = 'reply' | 'replyAll' | 'forward'

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

function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
  trailing,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  autoFocus?: boolean
  trailing?: React.ReactNode
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const commit = (raw: string) => {
    const additions = splitAddresses(raw)
    if (additions.length === 0) return
    onChange(dedupeRecipients([...value, ...additions], new Set()))
    setDraft('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';' || (event.key === 'Tab' && draft.trim())) {
      if (draft.trim()) {
        event.preventDefault()
        commit(draft)
      }
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="gmail-recipient-row">
      <span className="gmail-recipient-label">{label}</span>
      <div className="gmail-recipient-field">
        {value.map((token, index) => (
          <span key={`${token}-${index}`} className="gmail-recipient-chip" title={extractAddress(token)}>
            <span className="gmail-recipient-chip-label">{recipientLabel(token)}</span>
            <button
              type="button"
              className="gmail-recipient-chip-remove"
              aria-label={`Remove ${extractAddress(token)}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(value.filter((_, idx) => idx !== index))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="gmail-recipient-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (draft.trim()) commit(draft) }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text')
            if (text && /[,;\n]/.test(text)) {
              event.preventDefault()
              commit(text)
            }
          }}
        />
      </div>
      {trailing && <div className="gmail-recipient-trailing">{trailing}</div>}
    </div>
  )
}

function ComposeBox({
  mode,
  thread,
  selfEmail,
  onClose,
}: {
  mode: ComposeMode
  thread: GmailThread
  selfEmail: string
  onClose: () => void
}) {
  const latest = latestMessage(thread)
  const initialRecipients = useMemo(
    () => buildRecipients(mode, thread, selfEmail),
    [mode, thread, selfEmail],
  )

  const [toList, setToList] = useState<string[]>(initialRecipients.to)
  const [ccList, setCcList] = useState<string[]>(initialRecipients.cc)
  const [bccList, setBccList] = useState<string[]>([])
  const [showCc, setShowCc] = useState<boolean>(initialRecipients.cc.length > 0)
  const [showBcc, setShowBcc] = useState<boolean>(false)
  const [subject, setSubject] = useState<string>(() => composeSubject(mode, thread.subject))
  const modeLabel = mode === 'forward' ? 'Forward' : mode === 'replyAll' ? 'Reply all' : 'Reply'

  const initialContent = useMemo(() => {
    if (mode === 'forward') return buildForwardedContent(thread)
    // Gmail-side draft (user's own work) wins over the AI-generated draft.
    const source = stripQuotedReplyText(thread.gmail_draft || thread.draft_response || '')
    if (!source) return ''
    return source
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
      .join('')
  }, [mode, thread])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({
        placeholder: mode === 'forward' ? 'Write a message…' : 'Write your reply…',
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

    if (toList.length === 0) {
      toast('Add at least one recipient.', 'error')
      return
    }

    // Build References chain from all known message ids (newest last).
    const messageIds = thread.messages
      .map((m) => m.messageIdHeader)
      .filter((v): v is string => Boolean(v))
    const references = messageIds.join(' ')
    const inReplyTo = latest?.messageIdHeader
    const isForward = mode === 'forward'

    setSending(true)
    try {
      const result = await window.ipc.invoke('gmail:sendReply', {
        threadId: isForward ? undefined : thread.threadId,
        to: toList.join(', '),
        cc: ccList.length ? ccList.join(', ') : undefined,
        bcc: bccList.length ? bccList.join(', ') : undefined,
        subject: subject.trim() || composeSubject(mode, thread.subject),
        bodyHtml: html,
        bodyText: text,
        inReplyTo: isForward ? undefined : inReplyTo,
        references: isForward ? undefined : references || undefined,
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

  return (
    <div className="gmail-compose-card">
      <div className="gmail-compose-header">
        <span>{modeLabel}</span>
        <button type="button" onClick={onClose} aria-label="Close compose">×</button>
      </div>
      <RecipientField
        label="To"
        value={toList}
        onChange={setToList}
        autoFocus={mode === 'forward'}
        trailing={
          <div className="gmail-recipient-toggles">
            {!showCc && <button type="button" onClick={() => setShowCc(true)}>Cc</button>}
            {!showBcc && <button type="button" onClick={() => setShowBcc(true)}>Bcc</button>}
          </div>
        }
      />
      {showCc && <RecipientField label="Cc" value={ccList} onChange={setCcList} />}
      {showBcc && <RecipientField label="Bcc" value={bccList} onChange={setBccList} />}
      {mode === 'forward' && (
        <div className="gmail-compose-line">
          <span className="gmail-compose-label">Subject</span>
          <input
            className="gmail-compose-subject-input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
          />
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

  const canReplyAll = useMemo(() => {
    const { to, cc } = buildRecipients('replyAll', thread, selfEmail)
    return cc.length > 0 || to.length > 1
  }, [thread, selfEmail])

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
          <button type="button" onClick={() => setComposeMode('reply')}>
            <Reply size={16} />
            Reply
          </button>
          {canReplyAll && (
            <button type="button" onClick={() => setComposeMode('replyAll')}>
              <ReplyAll size={16} />
              Reply all
            </button>
          )}
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

const MAX_KEPT_OPEN = 5
const PAGE_SIZE = 25
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

function clearLoadingFlag(state: SectionState | null): SectionState {
  if (!state) return initialSectionState
  return { ...state, loadingPage: false }
}

export type EmailViewProps = {
  /** If provided, the view opens with this thread already expanded. */
  initialThreadId?: string | null
  /** Bump to re-focus on the same threadId after navigating away inside the view. */
  threadIdVersion?: number
}

export function EmailView({ initialThreadId, threadIdVersion }: EmailViewProps = {}) {
  const [important, setImportant] = useState<SectionState>(() => clearLoadingFlag(persistedImportant))
  const [other, setOther] = useState<SectionState>(() => clearLoadingFlag(persistedOther))
  const hadPersistedDataOnMount = useRef(persistedImportant !== null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId ?? null)
  const [openedThreadIds, setOpenedThreadIds] = useState<string[]>(initialThreadId ? [initialThreadId] : [])
  useEffect(() => {
    setSelectedThreadId(initialThreadId ?? null)
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
  // Gmail sync uses the native Google OAuth connection.
  const [emailConnection, setEmailConnection] = useState<GmailConnectionStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  }, [])

  const removeThreadFromState = useCallback((threadId: string) => {
    const filterSection = (prev: SectionState): SectionState => ({
      ...prev,
      threads: prev.threads.filter((t) => t.threadId !== threadId),
    })
    setImportant(filterSection)
    setOther(filterSection)
    setSelectedThreadId((current) => (current === threadId ? null : current))
    setOpenedThreadIds((prev) => prev.filter((id) => id !== threadId))
  }, [])

  const markThreadReadAction = useCallback(async (threadId: string) => {
    updateThreadInState(threadId, (t) => ({
      ...t,
      unread: false,
      messages: t.messages.map((m) => ({ ...m, unread: false })),
    }))
    try {
      const result = await window.ipc.invoke('gmail:markThreadRead', { threadId })
      if (!result.ok && result.error) console.warn('[Gmail] mark-read failed:', result.error)
    } catch (err) {
      console.warn('[Gmail] mark-read failed:', err)
    }
  }, [updateThreadInState])

  const archiveThreadAction = useCallback(async (threadId: string) => {
    try {
      const result = await window.ipc.invoke('gmail:archiveThread', { threadId })
      if (result.ok) {
        removeThreadFromState(threadId)
      } else if (result.error) {
        toast(`Archive failed: ${result.error}`, 'error')
      }
    } catch (err) {
      toast(`Archive failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [removeThreadFromState])

  const trashThreadAction = useCallback(async (threadId: string) => {
    try {
      const result = await window.ipc.invoke('gmail:trashThread', { threadId })
      if (result.ok) {
        removeThreadFromState(threadId)
      } else if (result.error) {
        toast(`Delete failed: ${result.error}`, 'error')
      }
    } catch (err) {
      toast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [removeThreadFromState])

  const toggleThread = useCallback((thread: GmailThread) => {
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

  const sectionChannel = (section: InboxSection) =>
    section === 'important' ? 'gmail:getImportant' as const : 'gmail:getEverythingElse' as const

  const loadNextPage = useCallback(async (section: InboxSection) => {
    const current = section === 'important' ? important : other
    if (current.loadingPage || current.hasReachedEnd) return

    const epoch = epochsRef.current[section]
    setSection(section, (prev) => ({ ...prev, loadingPage: true }))
    try {
      const result = await window.ipc.invoke(sectionChannel(section), {
        cursor: current.nextCursor ?? undefined,
        limit: PAGE_SIZE,
      })
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
  }, [important, other, setSection])

  const reloadFirstPage = useCallback(async (section: InboxSection, options: { silent?: boolean } = {}) => {
    const epoch = ++epochsRef.current[section]
    if (options.silent) {
      setSection(section, (prev) => ({ ...prev, loadingPage: true }))
    } else {
      setSection(section, () => ({ ...initialSectionState, loadingPage: true }))
    }
    try {
      const result = await window.ipc.invoke(sectionChannel(section), {
        limit: PAGE_SIZE,
      })
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
  }, [setSection])

  // Initial load — fetch page 1 of Important. On first-ever mount we do a
  // non-silent load (shows loading state). On re-mount with persisted state we
  // do a silent reconcile against the cache — necessary because the watcher
  // subscription only runs while mounted, so any cache changes that happened
  // while the panel was unmounted would otherwise stay invisible.
  useEffect(() => {
    if (hadPersistedDataOnMount.current) {
      void reloadFirstPage('important', { silent: true })
      // Reconcile Other too if it had been loaded before the unmount.
      if (other.threads.length > 0) {
        void reloadFirstPage('other', { silent: true })
      }
    } else {
      void reloadFirstPage('important')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once Important is exhausted, kick off page 1 of Everything else.
  useEffect(() => {
    if (!important.hasReachedEnd) return
    if (other.threads.length > 0) return
    if (other.loadingPage) return
    void reloadFirstPage('other')
  }, [important.hasReachedEnd, other.threads.length, other.loadingPage, reloadFirstPage])

  // Live updates: watcher on inbox_lists/ → silently refresh visible sections
  // when files change. Throttled to at most one reload per ~3s so a burst of
  // backend writes (sync processing many threads sequentially) coalesces into
  // a small number of in-place updates rather than a flicker storm.
  // Suppressed while a thread is open (composing/reading); deferred until close.
  const pendingReloadRef = useRef(false)
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastReloadAtRef = useRef(0)
  const isSelectedRef = useRef<string | null>(null)
  isSelectedRef.current = selectedThreadId
  const isRefreshingRef = useRef(false)
  isRefreshingRef.current = refreshing
  const otherHasThreadsRef = useRef(false)
  otherHasThreadsRef.current = other.threads.length > 0

  const RELOAD_THROTTLE_MS = 3000

  const doReload = useCallback(() => {
    if (isRefreshingRef.current) return
    if (isSelectedRef.current !== null) {
      pendingReloadRef.current = true
      return
    }
    lastReloadAtRef.current = Date.now()
    void reloadFirstPage('important', { silent: true })
    // Only refresh Other if it had been loaded — otherwise the chained
    // effect handles it once Important hits hasReachedEnd.
    if (otherHasThreadsRef.current) {
      void reloadFirstPage('other', { silent: true })
    }
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

  // When user closes a thread, if updates arrived while they were reading, flush now.
  useEffect(() => {
    if (selectedThreadId !== null) return
    if (!pendingReloadRef.current) return
    pendingReloadRef.current = false
    lastReloadAtRef.current = Date.now()
    void reloadFirstPage('important', { silent: true })
    if (otherHasThreadsRef.current) {
      void reloadFirstPage('other', { silent: true })
    }
  }, [selectedThreadId, reloadFirstPage])

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

  const hasAny = important.threads.length > 0 || other.threads.length > 0
  const initialLoading = !hasAny && refreshing
  const needsEmailConnect = emailConnection?.connected === false
  const needsEmailReconnect = emailConnection?.connected === true && !emailConnection.hasRequiredScope

  const renderRow = (thread: GmailThread) => {
    const latest = latestMessage(thread)
    const isSelected = thread.threadId === selectedThreadId
    const isUnread = thread.unread === true
    const isMounted = openedThreadIds.includes(thread.threadId)
    const stop = (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation()
    }
    return (
      <div key={thread.threadId} className="gmail-row-group">
        <div
          className={cn('gmail-row-shell', isSelected && 'gmail-row-shell-selected')}
          onMouseEnter={() => scheduleHoverPrefetch(thread)}
          onMouseLeave={cancelHoverPrefetch}
        >
          <button
            type="button"
            className={cn('gmail-row', isSelected && 'gmail-row-selected', isUnread && 'gmail-row-unread')}
            onClick={() => toggleThread(thread)}
          >
            <span className="gmail-row-dot" aria-hidden />
            <span className="gmail-row-sender">{extractName(latest?.from || thread.from)}</span>
            <span className="gmail-row-content">
              <strong>{thread.summary || thread.subject || '(No subject)'}</strong>
              <span>{thread.summary ? thread.subject : snippet(latest?.body || thread.latest_email)}</span>
            </span>
            <span className="gmail-row-date">{formatInboxTime(latest?.date || thread.date)}</span>
          </button>
          <div className="gmail-row-actions" onMouseDown={stop} onClick={stop}>
            {isUnread && (
              <button
                type="button"
                className="gmail-row-action"
                title="Mark as read"
                aria-label="Mark as read"
                onClick={(e) => { stop(e); void markThreadReadAction(thread.threadId) }}
              >
                <CheckCheck size={15} />
              </button>
            )}
            <button
              type="button"
              className="gmail-row-action"
              title="Archive"
              aria-label="Archive"
              onClick={(e) => { stop(e); void archiveThreadAction(thread.threadId) }}
            >
              <Archive size={15} />
            </button>
            <button
              type="button"
              className="gmail-row-action gmail-row-action-danger"
              title="Delete"
              aria-label="Delete"
              onClick={(e) => { stop(e); void trashThreadAction(thread.threadId) }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
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
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab="connections" />
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
