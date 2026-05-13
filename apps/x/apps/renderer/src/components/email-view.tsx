import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Forward, LoaderIcon, RefreshCw, Reply, Search, Send } from 'lucide-react'
import type { blocks } from '@x/shared'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildEmailDocument(html: string): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.6 Arial, sans-serif;
    color: #202124;
    overflow-x: auto;
    overflow-y: hidden;
    word-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #1a73e8; }
  blockquote {
    margin: 0 0 0 6px;
    padding-left: 12px;
    border-left: 2px solid #dadce0;
    color: #5f6368;
  }
</style>
</head><body>${html}</body></html>`
}

function MessageBody({ message }: { message: GmailThreadMessage }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [height, setHeight] = useState(80)

  const srcDoc = useMemo(() => {
    if (message.bodyHtml && message.bodyHtml.trim()) {
      return buildEmailDocument(message.bodyHtml)
    }
    const text = (message.body || '(No message body)').trim()
    return buildEmailDocument(`<pre style="white-space: pre-wrap; font: inherit; margin: 0;">${escapeHtml(text)}</pre>`)
  }, [message.bodyHtml, message.body])

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc?.body) return
    const measure = () => {
      const next = Math.max(40, doc.documentElement.scrollHeight)
      setHeight((current) => (current === next ? current : next))
    }
    measure()
    observerRef.current?.disconnect()
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(measure)
      observerRef.current.observe(doc.body)
    }
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      title="Email content"
      className="gmail-message-iframe"
      style={{ height }}
      onLoad={handleLoad}
    />
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
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const to = mode === 'reply' ? extractAddress(latest?.from) : ''

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(120, el.scrollHeight)}px`
  }, [body])

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
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={mode === 'reply' ? 'Write your reply...' : 'Write a message...'}
      />
      <div className="gmail-compose-actions">
        <button
          type="button"
          className="gmail-send-button"
          onClick={() => {
            toast('Sending from this view needs Gmail send scope. Draft UI is ready.', 'info')
          }}
        >
          <Send size={15} />
          Send
        </button>
        <button type="button" className="gmail-compose-link" onClick={onClose}>Discard</button>
      </div>
    </div>
  )
}

function ThreadDetail({
  thread,
  onClose,
}: {
  thread: GmailThread
  onClose: () => void
}) {
  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null)

  return (
    <div className="gmail-detail gmail-detail-inline">
      <div className="gmail-detail-toolbar">
        <div className="gmail-thread-subject-inline">{thread.subject || '(No subject)'}</div>
        <button type="button" className="gmail-icon-button" onClick={onClose} aria-label="Close thread">
          <span>×</span>
        </button>
      </div>

      <div className="gmail-thread-body">
        <div className="gmail-message-stack">
          {thread.messages.map((message, index) => {
            const isLast = index === thread.messages.length - 1
            return (
              <div key={message.id || index} className={cn('gmail-message', isLast && 'gmail-message-open')}>
                <div className="gmail-message-avatar" style={{ backgroundColor: avatarColor(message.from) }}>
                  {getInitial(message.from)}
                </div>
                <div className="gmail-message-main">
                  <div className="gmail-message-meta">
                    <div className="gmail-message-from">
                      <strong>{extractName(message.from)}</strong>
                      <span>{extractAddress(message.from)}</span>
                    </div>
                    <div className="gmail-message-date">{formatFullDate(message.date)}</div>
                  </div>
                  <div className="gmail-message-to">to {message.to || 'me'}</div>
                  <MessageBody message={message} />
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

export function EmailView() {
  const [threads, setThreads] = useState<GmailThread[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const loadThreads = useCallback(async () => {
    setError(null)
    let hasCachedContent = false

    try {
      const cached = await window.ipc.invoke('gmail:listCachedThreads', { daysAgo: 2 })
      if (cached.threads.length > 0) {
        setThreads(cached.threads)
        hasCachedContent = true
      }
    } catch (err) {
      console.warn('[Gmail] cache read failed:', err)
    }

    setLoading(true)

    try {
      const list = await window.ipc.invoke('gmail:listRecentThreads', { daysAgo: 2 })
      if (list.error) throw new Error(list.error)

      const hydrated = await mapWithConcurrency(list.threads, 6, async (item) => {
        const result = await window.ipc.invoke('gmail:getThread', {
          threadId: item.threadId,
          expectedHistoryId: item.historyId,
        })
        if (result.thread) return result.thread
        console.warn('Failed to hydrate Gmail thread', item.threadId, result.error)
        return null
      })

      const nextThreads = hydrated
        .filter((thread): thread is GmailThread => Boolean(thread))
        .sort((a, b) => {
          const aDate = Date.parse(latestMessage(a)?.date || a.date || '')
          const bDate = Date.parse(latestMessage(b)?.date || b.date || '')
          return (Number.isNaN(bDate) ? 0 : bDate) - (Number.isNaN(aDate) ? 0 : aDate)
        })

      setThreads(nextThreads)
      setSelectedThreadId(current => current && nextThreads.some(thread => thread.threadId === current) ? current : null)
    } catch (err) {
      if (hasCachedContent) {
        console.warn('[Gmail] background refresh failed; keeping cached view:', err)
      } else {
        setError(err instanceof Error ? err.message : String(err))
        setThreads([])
        setSelectedThreadId(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const filteredThreads = useMemo(() => {
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
  }, [query, threads])

  const hasThreads = filteredThreads.length > 0

  return (
    <div className="gmail-shell">
      <div className="gmail-main">
        <div className="gmail-topbar">
          <div className="gmail-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search mail"
            />
          </div>
          <button type="button" className="gmail-icon-button" onClick={() => void loadThreads()} aria-label="Refresh">
            {loading ? <LoaderIcon size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          </button>
        </div>

        {error ? (
          <div className="gmail-empty-state">Could not load mail: {error}</div>
        ) : hasThreads ? (
          <div className="gmail-list" aria-label="Recent emails">
            <div className="gmail-list-header">
              <span>Last 2 days</span>
              <span>{filteredThreads.length} threads</span>
            </div>
            {filteredThreads.map((thread) => {
              const latest = latestMessage(thread)
              const isSelected = thread.threadId === selectedThreadId
              const isUnread = thread.unread === true
              return (
                <div key={thread.threadId} className="gmail-row-group">
                  <button
                    type="button"
                    className={cn('gmail-row', isSelected && 'gmail-row-selected', isUnread && 'gmail-row-unread')}
                    onClick={() => setSelectedThreadId(isSelected ? null : thread.threadId)}
                  >
                    <span className="gmail-row-dot" aria-hidden />
                    <span className="gmail-row-sender">{extractName(latest?.from || thread.from)}</span>
                    <span className="gmail-row-content">
                      <strong>{thread.subject || '(No subject)'}</strong>
                      <span>{snippet(latest?.body || thread.latest_email)}</span>
                    </span>
                    <span className="gmail-row-date">{formatInboxTime(latest?.date || thread.date)}</span>
                  </button>
                  {isSelected && (
                    <ThreadDetail
                      thread={thread}
                      onClose={() => setSelectedThreadId(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="gmail-empty-state">
            {loading ? 'Loading recent Gmail threads...' : 'No Gmail threads found from the last 2 days.'}
          </div>
        )}
      </div>
    </div>
  )
}
