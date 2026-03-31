import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, Mail, ChevronDown, ExternalLink, Copy, Check, MessageSquare } from 'lucide-react'
import { blocks } from '@x/shared'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/contexts/theme-context'

// --- Helpers ---

function formatEmailDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return dateStr
  }
}

/** Extract just the name part from "Name <email>" format */
function senderFirstName(from: string): string {
  const name = from.replace(/<.*>/, '').trim()
  return name.split(/\s+/)[0] || name
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

  // Local draft state for editing
  const [draftBody, setDraftBody] = useState(config?.draft_response || '')
  const [emailExpanded, setEmailExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Sync draft from external changes
  useEffect(() => {
    try {
      const parsed = blocks.EmailBlockSchema.parse(JSON.parse(raw))
      setDraftBody(parsed.draft_response || '')
    } catch { /* ignore */ }
  }, [raw])

  // Auto-resize textarea
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
          <Mail size={16} />
          <span>Invalid email block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const gmailUrl = config.threadId
    ? `https://mail.google.com/mail/u/0/#all/${config.threadId}`
    : null

  // Build summary: use explicit summary, or auto-generate from sender + subject
  const summary = config.summary
    || (config.from && config.subject
      ? `${senderFirstName(config.from)} reached out about ${config.subject}`
      : config.subject || 'New email')

  return (
    <NodeViewWrapper className="email-block-wrapper" data-type="email-block">
      <div className="email-block-card email-block-card-gmail" onMouseDown={(e) => e.stopPropagation()}>
        <button className="email-block-delete" onClick={deleteNode} aria-label="Delete email block">
          <X size={14} />
        </button>

        {/* Header: Email badge */}
        <div className="email-block-badge">
          <Mail size={13} />
          Email
        </div>

        {/* Summary */}
        <div className="email-block-summary">{summary}</div>

        {/* Expandable email details */}
        <button
          className="email-block-expand-btn"
          onClick={(e) => { e.stopPropagation(); setEmailExpanded(!emailExpanded) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ChevronDown size={13} className={`email-block-toggle-chevron ${emailExpanded ? 'email-block-toggle-chevron-open' : ''}`} />
          {emailExpanded ? 'Hide email' : 'Show email'}
          {config.from && <span className="email-block-expand-meta">· From {senderFirstName(config.from)}</span>}
          {config.date && <span className="email-block-expand-meta">· {formatEmailDate(config.date)}</span>}
        </button>

        {emailExpanded && (
          <div className="email-block-email-details">
            <div className="email-block-message">
              <div className="email-block-message-header">
                <div className="email-block-sender-info">
                  <div className="email-block-sender-row">
                    <div className="email-block-sender-name">{config.from || 'Unknown'}</div>
                    {config.date && <div className="email-block-sender-date">{formatEmailDate(config.date)}</div>}
                  </div>
                  {config.subject && <div className="email-block-subject-line">Subject: {config.subject}</div>}
                </div>
              </div>
              <div className="email-block-message-body">{config.latest_email}</div>
            </div>
            {hasPastSummary && (
              <div className="email-block-context-section">
                <div className="email-block-context-label">Earlier conversation</div>
                <div className="email-block-context-summary">{config.past_summary}</div>
              </div>
            )}
          </div>
        )}

        {/* Draft section */}
        {hasDraft && (
          <div className="email-block-draft-section">
            <div className="email-block-draft-label">Draft reply</div>
            <textarea
              key={resolvedTheme}
              ref={bodyRef}
              className="email-draft-block-body-input"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              onBlur={() => commitDraft(draftBody)}
              placeholder="Write your reply..."
              rows={3}
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="email-block-actions">
          <button
            className="email-block-gmail-btn email-block-gmail-btn-primary"
            onClick={draftWithAssistant}
          >
            <MessageSquare size={13} />
            {hasDraft ? 'Refine with Rowboat' : 'Draft with Rowboat'}
          </button>
          {hasDraft && (
            <button
              className="email-block-gmail-btn email-block-gmail-btn-primary"
              onClick={() => {
                navigator.clipboard.writeText(draftBody).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }).catch(() => {
                  // Fallback for Electron contexts where clipboard API may fail
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
          {gmailUrl && (
            <button
              className="email-block-gmail-btn"
              onClick={() => window.open(gmailUrl, '_blank')}
            >
              <ExternalLink size={13} />
              Open in Gmail
            </button>
          )}
        </div>
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
