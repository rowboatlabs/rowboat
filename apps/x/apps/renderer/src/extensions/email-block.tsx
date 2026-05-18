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
    if (config.threadId) {
      prompt += `. Read the full thread at gmail_sync/${config.threadId}.md for context`
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

  const gmailUrl = config.threadId
    ? `https://mail.google.com/mail/u/0/#all/${config.threadId}`
    : null

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

      <div className="email-gmail-exp-body">{config.latest_email}</div>

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
            const senderName = email.from ? extractName(email.from) : 'Unknown'
            const initial = email.from ? getInitial(email.from) : '?'
            const color = email.from ? avatarColor(email.from) : '#5f6368'
            const snippet = email.summary
              || (email.latest_email ? email.latest_email.slice(0, 100).replace(/\s+/g, ' ').trim() : '')

            return (
              <div key={i} className={`email-inbox-row${isExpanded ? ' email-inbox-row-expanded' : ''}`}>
                {/* Collapsed row */}
                <div
                  className="email-inbox-row-header"
                  onClick={(e) => { e.stopPropagation(); setExpandedIndex(isExpanded ? null : i) }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="email-inbox-avatar" style={{ backgroundColor: color }}>{initial}</div>

                  <div className="email-inbox-content">
                    <div className="email-inbox-top-row">
                      <span className="email-inbox-sender">{senderName}</span>
                      {email.date && <span className="email-inbox-date">{formatEmailDate(email.date)}</span>}
                    </div>
                    <div className="email-inbox-bottom-row">
                      {email.subject && <span className="email-inbox-subject">{email.subject}</span>}
                      {snippet && (
                        <span className="email-inbox-snippet">
                          {email.subject ? ` — ${snippet}` : snippet}
                        </span>
                      )}
                    </div>
                  </div>

                  <ChevronDown
                    size={14}
                    className={`email-inbox-chevron${isExpanded ? ' email-inbox-chevron-open' : ''}`}
                  />
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="email-inbox-expanded-wrap">
                    <EmailExpandedBody
                      config={email}
                      resolvedTheme={resolvedTheme}
                    />
                  </div>
                )}
              </div>
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

  const senderName = config.from ? extractName(config.from) : 'Unknown'
  const initial = config.from ? getInitial(config.from) : '?'
  const color = config.from ? avatarColor(config.from) : '#5f6368'
  const snippet = config.summary
    || (config.latest_email ? config.latest_email.slice(0, 120).replace(/\s+/g, ' ').trim() : '')

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
              {config.date && <span className="email-gmail-date">{formatEmailDate(config.date)}</span>}
            </div>
            <div className="email-gmail-bottom-row">
              {config.subject && <span className="email-gmail-subject">{config.subject}</span>}
              {snippet && <span className="email-gmail-snippet">{config.subject ? ` — ${snippet}` : snippet}</span>}
            </div>
          </div>
          <ChevronDown size={15} className={`email-gmail-chevron${expanded ? ' email-gmail-chevron-open' : ''}`} />
        </div>

        {expanded && (
          <EmailExpandedBody
            config={config}
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
