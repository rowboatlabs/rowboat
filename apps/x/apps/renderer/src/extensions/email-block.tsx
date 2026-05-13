import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, ExternalLink, Copy, Check, MessageSquare, ChevronDown } from 'lucide-react'
import { blocks } from '@x/shared'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/contexts/theme-context'

// --- Helpers ---

function formatEmailDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const now = new Date()
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    if (isToday) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatFullDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return dateStr
  }
}

function extractName(from: string): string {
  const match = from.match(/^([^<]+)</)
  if (match) return match[1].trim()
  const username = from.replace(/@.*/, '').replace(/[._+]/g, ' ').trim()
  return username.replace(/\b\w/g, c => c.toUpperCase())
}

function getInitial(from: string): string {
  const name = extractName(from)
  return (name[0] || '?').toUpperCase()
}

const GMAIL_AVATAR_COLORS = [
  '#1a73e8', '#e8453c', '#34a853', '#8430ce', '#f29900',
  '#00796b', '#c62828', '#1565c0', '#6a1b9a', '#2e7d32',
]

function avatarColor(from: string): string {
  let hash = 0
  for (let i = 0; i < from.length; i++) hash = (hash * 31 + from.charCodeAt(i)) >>> 0
  return GMAIL_AVATAR_COLORS[hash % GMAIL_AVATAR_COLORS.length]
}

function extractThreadId(config: Pick<blocks.EmailBlock, 'threadId' | 'threadUrl'>): string | null {
  if (config.threadId) return config.threadId
  if (!config.threadUrl) return null
  const url = config.threadUrl.trim()
  const hashId = url.match(/#(?:all|inbox|sent|important|starred|search\/[^/]+)\/([^/?#]+)/)
  if (hashId?.[1]) return decodeURIComponent(hashId[1])
  const queryId = url.match(/[?&](?:th|threadId)=([^&]+)/)
  if (queryId?.[1]) return decodeURIComponent(queryId[1])
  const tailId = url.match(/\/([a-f0-9]{12,})\/?$/i)
  return tailId?.[1] || null
}

function parseSyncedGmailThread(markdown: string, threadId: string): blocks.EmailBlock | null {
  const subject = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const chunks = markdown
    .split(/\n---\n/g)
    .map(chunk => chunk.trim())
    .filter(chunk => /^### From:/m.test(chunk))

  const messages = chunks.map((chunk) => {
    const from = chunk.match(/^### From:\s*(.+)$/m)?.[1]?.trim()
    const date = chunk.match(/^\*\*Date:\*\*\s*(.+)$/m)?.[1]?.trim()
    const body = chunk
      .replace(/^### From:\s*.+$/m, '')
      .replace(/^\*\*Date:\*\*\s*.+$/m, '')
      .replace(/\n\*\*Attachments:\*\*[\s\S]*$/m, '')
      .trim()
    return { from, date, body }
  }).filter(message => message.from || message.body)

  const latest = messages[messages.length - 1]
  if (!latest) return null

  const earlier = messages.slice(0, -1)
  const pastSummary = earlier
    .map((message) => {
      const date = message.date ? ` (${message.date})` : ''
      const body = message.body.replace(/\s+/g, ' ').slice(0, 500).trim()
      return `${message.from || 'Unknown'}${date}: ${body}`
    })
    .filter(Boolean)
    .join('\n\n')

  return {
    threadId,
    threadUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
    subject,
    from: latest.from,
    date: latest.date,
    latest_email: latest.body,
    past_summary: pastSummary || undefined,
  }
}

function mergeHydratedEmail(base: blocks.EmailBlock, hydrated: blocks.EmailBlock | null): blocks.EmailBlock {
  if (!hydrated) return base
  return {
    ...hydrated,
    ...base,
    threadId: base.threadId || hydrated.threadId,
    threadUrl: base.threadUrl || hydrated.threadUrl,
    subject: hydrated.subject || base.subject,
    from: hydrated.from || base.from,
    to: hydrated.to || base.to,
    date: hydrated.date || base.date,
    latest_email: hydrated.latest_email || base.latest_email,
    past_summary: hydrated.past_summary || base.past_summary,
    summary: base.summary || hydrated.summary,
  }
}

function useHydratedEmail(config: blocks.EmailBlock): { email: blocks.EmailBlock; loading: boolean; error: string | null } {
  const [email, setEmail] = useState(config)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadId = extractThreadId(config)
  const configKey = JSON.stringify(config)

  useEffect(() => {
    let cancelled = false
    const baseConfig = blocks.EmailBlockSchema.parse(JSON.parse(configKey))

    async function load() {
      setEmail(baseConfig)
      setError(null)
      if (!threadId) {
        setLoading(false)
        return
      }

      setLoading(true)
      let hydrated: blocks.EmailBlock | null = null
      let loadError: string | null = null

      try {
        const result = await window.ipc.invoke('gmail:getThread', { threadId })
        if (result.thread) {
          hydrated = result.thread
        } else if (result.error) {
          loadError = result.error
        }
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err)
      }

      if (!hydrated) {
        try {
          const result = await window.ipc.invoke('workspace:readFile', {
            path: `gmail_sync/${threadId}.md`,
            encoding: 'utf8',
          })
          hydrated = parseSyncedGmailThread(result.data, threadId)
        } catch (err) {
          loadError ||= err instanceof Error ? err.message : String(err)
        }
      }

      if (!cancelled) {
        setEmail(mergeHydratedEmail(baseConfig, hydrated))
        setError(hydrated ? null : loadError)
        setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [configKey, threadId])

  return { email, loading, error }
}

declare global {
  interface Window {
    __pendingEmailDraft?: { prompt: string }
  }
}

// --- Shared: expanded email body used by both block types ---

function EmailExpandedBody({
  config,
  resolvedTheme,
}: {
  config: blocks.EmailBlock
  resolvedTheme: string
}) {
  const [draftBody, setDraftBody] = useState(config.draft_response || '')
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraftBody(config.draft_response || '')
  }, [config.draft_response])

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = 'auto'
      bodyRef.current.style.height = bodyRef.current.scrollHeight + 'px'
    }
  }, [draftBody])

  const draftWithAssistant = useCallback(() => {
    let prompt = draftBody
      ? `Help me refine this draft response to an email`
      : `Help me draft a response to this email`
    const threadId = extractThreadId(config)
    if (threadId) {
      prompt += `. Read the full thread at gmail_sync/${threadId}.md for context`
    }
    prompt += `.\n\n**From:** ${config.from || 'Unknown'}\n**Subject:** ${config.subject || 'No subject'}\n`
    if (draftBody) prompt += `\n**Current draft:**\n${draftBody}\n`
    window.__pendingEmailDraft = { prompt }
    window.dispatchEvent(new Event('email-block:draft-with-assistant'))
  }, [config, draftBody])

  const copyDraft = useCallback(() => {
    navigator.clipboard.writeText(draftBody).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      const el = document.createElement('textarea')
      el.value = draftBody
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [draftBody])

  const threadId = extractThreadId(config)
  const gmailUrl = config.threadUrl || (threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null)

  const initial = config.from ? getInitial(config.from) : '?'
  const color = config.from ? avatarColor(config.from) : '#5f6368'
  const hasDraft = !!config.draft_response

  return (
    <div className="email-gmail-expanded">
      {config.subject && (
        <div className="email-gmail-exp-subject">{config.subject}</div>
      )}

      <div className="email-gmail-exp-meta">
        <div className="email-gmail-exp-avatar" style={{ backgroundColor: color }}>{initial}</div>
        <div className="email-gmail-exp-meta-right">
          <div className="email-gmail-exp-sender">{config.from || 'Unknown'}</div>
          <div className="email-gmail-exp-to-date">
            {config.to && <span>to {config.to}</span>}
            {config.date && <span className="email-gmail-exp-fulldate">{formatFullDate(config.date)}</span>}
          </div>
        </div>
      </div>

      <div className="email-gmail-exp-body">{config.latest_email || 'Loading latest message...'}</div>

      {config.past_summary && (
        <div className="email-gmail-exp-history">
          <div className="email-gmail-exp-history-label">Earlier conversation</div>
          <div className="email-gmail-exp-history-body">{config.past_summary}</div>
        </div>
      )}

      {!hasDraft && (
        <div className="email-gmail-reply-row">
          {gmailUrl && (
            <button
              className="email-gmail-btn"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); window.open(gmailUrl, '_blank') }}
            >
              <ExternalLink size={13} />
              Open in Gmail
            </button>
          )}
          <button
            className="email-gmail-btn email-gmail-btn-primary email-gmail-reply-row-end"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); draftWithAssistant() }}
          >
            <MessageSquare size={13} />
            Draft with Rowboat
          </button>
        </div>
      )}

      {hasDraft && (
        <div className="email-gmail-compose">
          <div className="email-gmail-compose-to">
            <span className="email-gmail-compose-to-label">Reply</span>
            {config.from && <span className="email-gmail-compose-to-addr">{config.from}</span>}
          </div>
          <textarea
            key={resolvedTheme}
            ref={bodyRef}
            className="email-gmail-compose-body"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="Write your reply..."
            rows={3}
          />
          <div className="email-gmail-compose-footer">
            <button
              className="email-gmail-btn email-gmail-btn-primary"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); draftWithAssistant() }}
            >
              <MessageSquare size={13} />
              {hasDraft ? 'Refine with Rowboat' : 'Draft with Rowboat'}
            </button>
            <button
              className="email-gmail-btn"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); copyDraft() }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy draft'}
            </button>
            {gmailUrl && (
              <button
                className="email-gmail-btn"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); window.open(gmailUrl, '_blank') }}
              >
                <ExternalLink size={13} />
                Open in Gmail
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

// --- Multi-email inbox block (language-emails) ---

function EmailInboxRow({
  email,
  expanded,
  onToggle,
  resolvedTheme,
}: {
  email: blocks.EmailBlock
  expanded: boolean
  onToggle: () => void
  resolvedTheme: string
}) {
  const { email: hydratedEmail, loading, error } = useHydratedEmail(email)
  const senderName = hydratedEmail.from ? extractName(hydratedEmail.from) : 'Unknown'
  const initial = hydratedEmail.from ? getInitial(hydratedEmail.from) : '?'
  const color = hydratedEmail.from ? avatarColor(hydratedEmail.from) : '#5f6368'
  const snippet = hydratedEmail.summary
    || (hydratedEmail.latest_email ? hydratedEmail.latest_email.slice(0, 100).replace(/\s+/g, ' ').trim() : '')
    || (loading ? 'Loading latest Gmail thread...' : error || '')

  return (
    <div className={`email-inbox-row${expanded ? ' email-inbox-row-expanded' : ''}`}>
      {/* Collapsed row */}
      <div
        className="email-inbox-row-header"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="email-inbox-avatar" style={{ backgroundColor: color }}>{initial}</div>

        <div className="email-inbox-content">
          <div className="email-inbox-top-row">
            <span className="email-inbox-sender">{senderName}</span>
            {hydratedEmail.date && <span className="email-inbox-date">{formatEmailDate(hydratedEmail.date)}</span>}
          </div>
          <div className="email-inbox-bottom-row">
            {hydratedEmail.subject && <span className="email-inbox-subject">{hydratedEmail.subject}</span>}
            {snippet && (
              <span className="email-inbox-snippet">
                {hydratedEmail.subject ? ` — ${snippet}` : snippet}
              </span>
            )}
          </div>
        </div>

        <ChevronDown
          size={14}
          className={`email-inbox-chevron${expanded ? ' email-inbox-chevron-open' : ''}`}
        />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="email-inbox-expanded-wrap">
          <EmailExpandedBody
            config={hydratedEmail}
            resolvedTheme={resolvedTheme}
          />
        </div>
      )}
    </div>
  )
}

function EmailsBlockView({ node, deleteNode }: {
  node: { attrs: Record<string, unknown> }
  deleteNode: () => void
}) {
  const raw = node.attrs.data as string
  let config: blocks.EmailsBlock | null = null

  try {
    config = blocks.EmailsBlockSchema.parse(JSON.parse(raw))
  } catch { /* fallback below */ }

  const { resolvedTheme } = useTheme()
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  if (!config || config.emails.length === 0) {
    return (
      <NodeViewWrapper className="email-block-wrapper" data-type="emails-block">
        <div className="email-block-card email-block-error"><span>Invalid emails block</span></div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="email-block-wrapper" data-type="emails-block">
      <div className="email-block-card email-inbox-card" onMouseDown={(e) => e.stopPropagation()}>
        <button className="email-block-delete" onClick={deleteNode} aria-label="Remove block"><X size={14} /></button>

        {config.title && (
          <div className="email-inbox-title">{config.title}</div>
        )}

        <div className="email-inbox-list">
          {config.emails.map((email, i) => {
            const isExpanded = expandedIndex === i
            return (
              <EmailInboxRow
                key={email.threadId || email.threadUrl || i}
                email={email}
                expanded={isExpanded}
                onToggle={() => setExpandedIndex(isExpanded ? null : i)}
                resolvedTheme={resolvedTheme}
              />
            )
          })}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const EmailsBlockExtension = Node.create({
  name: 'emailsBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { data: { default: '{}' } }
  },

  parseHTML() {
    return [{
      tag: 'pre',
      priority: 61,
      getAttrs(element) {
        const code = element.querySelector('code')
        if (!code) return false
        if ((code.className || '').includes('language-emails')) {
          return { data: code.textContent || '{}' }
        }
        return false
      },
    }]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'emails-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmailsBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```emails\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

// --- Single email block (language-email, backward compat) ---

function EmailBlockView({ node, deleteNode, updateAttributes }: {
  node: { attrs: Record<string, unknown> }
  deleteNode: () => void
  updateAttributes: (attrs: Record<string, unknown>) => void
}) {
  const raw = node.attrs.data as string
  let config: blocks.EmailBlock | null = null

  try {
    config = blocks.EmailBlockSchema.parse(JSON.parse(raw))
  } catch { /* fallback below */ }

  const { resolvedTheme } = useTheme()
  const [expanded, setExpanded] = useState(false)

  void updateAttributes // available for future per-email draft persistence

  if (!config) {
    return (
      <NodeViewWrapper className="email-block-wrapper" data-type="email-block">
        <div className="email-block-card email-block-error"><span>Invalid email block</span></div>
      </NodeViewWrapper>
    )
  }

  const { email, loading, error } = useHydratedEmail(config)
  const senderName = email.from ? extractName(email.from) : 'Unknown'
  const initial = email.from ? getInitial(email.from) : '?'
  const color = email.from ? avatarColor(email.from) : '#5f6368'
  const snippet = email.summary
    || (email.latest_email ? email.latest_email.slice(0, 120).replace(/\s+/g, ' ').trim() : '')
    || (loading ? 'Loading latest Gmail thread...' : error || '')

  return (
    <NodeViewWrapper className="email-block-wrapper" data-type="email-block">
      <div className="email-block-card email-block-card-gmail" onMouseDown={(e) => e.stopPropagation()}>
        <button className="email-block-delete" onClick={deleteNode} aria-label="Delete email block"><X size={14} /></button>

        <div
          className={`email-gmail-row${expanded ? ' email-gmail-row-expanded' : ''}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="email-gmail-avatar" style={{ backgroundColor: color }} aria-hidden="true">{initial}</div>
          <div className="email-gmail-content">
            <div className="email-gmail-top-row">
              <span className="email-gmail-sender">{senderName}</span>
              {email.date && <span className="email-gmail-date">{formatEmailDate(email.date)}</span>}
            </div>
            <div className="email-gmail-bottom-row">
              {email.subject && <span className="email-gmail-subject">{email.subject}</span>}
              {snippet && <span className="email-gmail-snippet">{email.subject ? ` — ${snippet}` : snippet}</span>}
            </div>
          </div>
          <ChevronDown size={15} className={`email-gmail-chevron${expanded ? ' email-gmail-chevron-open' : ''}`} />
        </div>

        {expanded && (
          <EmailExpandedBody
            config={email}
            resolvedTheme={resolvedTheme}
          />
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const EmailBlockExtension = Node.create({
  name: 'emailBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { data: { default: '{}' } }
  },

  parseHTML() {
    return [{
      tag: 'pre',
      priority: 60,
      getAttrs(element) {
        const code = element.querySelector('code')
        if (!code) return false
        const cls = code.className || ''
        if (cls.includes('language-email') && !cls.includes('language-emailDraft') && !cls.includes('language-emails')) {
          return { data: code.textContent || '{}' }
        }
        return false
      },
    }]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'email-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmailBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```email\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
