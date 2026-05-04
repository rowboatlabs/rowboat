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

/** Extract display name from "Name <email>" or plain email */
function extractName(from: string): string {
  const match = from.match(/^([^<]+)</)
  if (match) return match[1].trim()
  return from.replace(/@.*/, '').replace(/[._+]/g, ' ').trim()
}

/** Get first initial for avatar */
function getInitial(from: string): string {
  const name = extractName(from)
  return (name[0] || '?').toUpperCase()
}

// Gmail-style deterministic avatar colors based on sender
const GMAIL_AVATAR_COLORS = [
  '#1a73e8', // blue
  '#e8453c', // red
  '#34a853', // green
  '#8430ce', // purple
  '#f29900', // orange
  '#00796b', // teal
  '#c62828', // dark red
  '#1565c0', // dark blue
  '#6a1b9a', // deep purple
  '#2e7d32', // dark green
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

// --- Email Block ---

function EmailBlockView({ node, deleteNode, updateAttributes }: {
  node: { attrs: Record<string, unknown> }
  deleteNode: () => void
  updateAttributes: (attrs: Record<string, unknown>) => void
}) {
  const raw = node.attrs.data as string
  let config: blocks.EmailBlock | null = null

  try {
    config = blocks.EmailBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  const hasDraft = !!config?.draft_response
  const hasPastSummary = !!config?.past_summary

  const { resolvedTheme } = useTheme()

  const [draftBody, setDraftBody] = useState(config?.draft_response || '')
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      const parsed = blocks.EmailBlockSchema.parse(JSON.parse(raw))
      setDraftBody(parsed.draft_response || '')
    } catch { /* ignore */ }
  }, [raw])

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = 'auto'
      bodyRef.current.style.height = bodyRef.current.scrollHeight + 'px'
    }
  }, [draftBody])

  const commitDraft = useCallback((newBody: string) => {
    try {
      const current = JSON.parse(raw) as Record<string, unknown>
      updateAttributes({ data: JSON.stringify({ ...current, draft_response: newBody }) })
    } catch { /* ignore */ }
  }, [raw, updateAttributes])

  const draftWithAssistant = useCallback(() => {
    if (!config) return
    let prompt = draftBody
      ? `Help me refine this draft response to an email`
      : `Help me draft a response to this email`
    if (config.threadId) {
      prompt += `. Read the full thread at gmail_sync/${config.threadId}.md for context`
    }
    prompt += `.\n\n`
    prompt += `**From:** ${config.from || 'Unknown'}\n`
    prompt += `**Subject:** ${config.subject || 'No subject'}\n`
    if (draftBody) {
      prompt += `\n**Current draft:**\n${draftBody}\n`
    }
    window.__pendingEmailDraft = { prompt }
    window.dispatchEvent(new Event('email-block:draft-with-assistant'))
  }, [config, draftBody])

  if (!config) {
    return (
      <NodeViewWrapper className="email-block-wrapper" data-type="email-block">
        <div className="email-block-card email-block-error">
          <span>Invalid email block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const gmailUrl = config.threadId
    ? `https://mail.google.com/mail/u/0/#all/${config.threadId}`
    : null

  const senderName = config.from ? extractName(config.from) : 'Unknown'
  const initial = config.from ? getInitial(config.from) : '?'
  const color = config.from ? avatarColor(config.from) : '#5f6368'

  // Snippet: use summary if present, else truncate latest_email
  const snippet = config.summary
    || (config.latest_email ? config.latest_email.slice(0, 120).replace(/\s+/g, ' ').trim() : '')

  return (
    <NodeViewWrapper className="email-block-wrapper" data-type="email-block">
      <div className="email-block-card email-block-card-gmail" onMouseDown={(e) => e.stopPropagation()}>
        <button className="email-block-delete" onClick={deleteNode} aria-label="Delete email block">
          <X size={14} />
        </button>

        {/* Gmail-style two-column row */}
        <div
          className={`email-gmail-row${expanded ? ' email-gmail-row-expanded' : ''}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Avatar */}
          <div
            className="email-gmail-avatar"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          >
            {initial}
          </div>

          {/* Content */}
          <div className="email-gmail-content">
            <div className="email-gmail-top-row">
              <span className="email-gmail-sender">{senderName}</span>
              {config.date && (
                <span className="email-gmail-date">{formatEmailDate(config.date)}</span>
              )}
            </div>
            <div className="email-gmail-bottom-row">
              {config.subject && (
                <span className="email-gmail-subject">{config.subject}</span>
              )}
              {snippet && (
                <span className="email-gmail-snippet">
                  {config.subject ? ` — ${snippet}` : snippet}
                </span>
              )}
            </div>
          </div>

          {/* Chevron */}
          <ChevronDown
            size={15}
            className={`email-gmail-chevron${expanded ? ' email-gmail-chevron-open' : ''}`}
          />
        </div>

        {/* Expanded email detail */}
        {expanded && (
          <div className="email-gmail-expanded">
            {/* Subject heading */}
            {config.subject && (
              <div className="email-gmail-exp-subject">{config.subject}</div>
            )}

            {/* Metadata strip */}
            <div className="email-gmail-exp-meta">
              <div
                className="email-gmail-exp-avatar"
                style={{ backgroundColor: color }}
              >
                {initial}
              </div>
              <div className="email-gmail-exp-meta-right">
                <div className="email-gmail-exp-sender">{config.from || 'Unknown'}</div>
                <div className="email-gmail-exp-to-date">
                  {config.to && <span>to {config.to}</span>}
                  {config.date && <span className="email-gmail-exp-fulldate">{formatFullDate(config.date)}</span>}
                </div>
              </div>
              {gmailUrl && (
                <button
                  className="email-gmail-open-btn"
                  onClick={(e) => { e.stopPropagation(); window.open(gmailUrl, '_blank') }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Open in Gmail"
                >
                  <ExternalLink size={14} />
                </button>
              )}
            </div>

            {/* Email body */}
            <div className="email-gmail-exp-body">{config.latest_email}</div>

            {/* Earlier conversation */}
            {hasPastSummary && (
              <div className="email-gmail-exp-history">
                <div className="email-gmail-exp-history-label">Earlier conversation</div>
                <div className="email-gmail-exp-history-body">{config.past_summary}</div>
              </div>
            )}

            {/* Draft compose area */}
            {hasDraft && (
              <div className="email-gmail-compose">
                <div className="email-gmail-compose-to">
                  <span className="email-gmail-compose-to-label">Reply</span>
                  {config.from && (
                    <span className="email-gmail-compose-to-addr">{config.from}</span>
                  )}
                </div>
                <textarea
                  key={resolvedTheme}
                  ref={bodyRef}
                  className="email-gmail-compose-body"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  onBlur={() => commitDraft(draftBody)}
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
                  {hasDraft && (
                    <button
                      className="email-gmail-btn"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigator.clipboard.writeText(draftBody).then(() => {
                          setCopied(true)
                          setTimeout(() => setCopied(false), 2000)
                        }).catch(() => {
                          const textarea = document.createElement('textarea')
                          textarea.value = draftBody
                          document.body.appendChild(textarea)
                          textarea.select()
                          document.execCommand('copy')
                          document.body.removeChild(textarea)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 2000)
                        })
                      }}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? 'Copied!' : 'Copy draft'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Actions when no draft yet */}
            {!hasDraft && (
              <div className="email-gmail-actions">
                <button
                  className="email-gmail-btn email-gmail-btn-primary"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); draftWithAssistant() }}
                >
                  <MessageSquare size={13} />
                  Draft with Rowboat
                </button>
              </div>
            )}
          </div>
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
    return {
      data: { default: '{}' },
    }
  },

  parseHTML() {
    return [{
      tag: 'pre',
      priority: 60,
      getAttrs(element) {
        const code = element.querySelector('code')
        if (!code) return false
        const cls = code.className || ''
        if (cls.includes('language-email') && !cls.includes('language-emailDraft')) {
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
