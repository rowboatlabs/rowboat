import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, Mail, ChevronDown, ExternalLink, Copy, Check, Sparkles, Loader2, MessageSquare } from 'lucide-react'
import { blocks } from '@x/shared'
import { useState, useEffect, useRef, useCallback } from 'react'

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
  const responseMode = config?.response_mode || 'both'

  // Local draft state for editing
  const [draftBody, setDraftBody] = useState(config?.draft_response || '')
  const [contextExpanded, setContextExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [responseSplitOpen, setResponseSplitOpen] = useState(false)
  const responseSplitRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Close split dropdown on outside click
  useEffect(() => {
    if (!responseSplitOpen) return
    const handler = (e: MouseEvent) => {
      if (responseSplitRef.current && !responseSplitRef.current.contains(e.target as globalThis.Node)) setResponseSplitOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [responseSplitOpen])

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

  const generateResponse = useCallback(async () => {
    if (!config || generating) return
    setGenerating(true)
    try {
      const ipc = (window as unknown as { ipc: { invoke: (channel: string, args: Record<string, unknown>) => Promise<{ response?: string }> } }).ipc
      // Build context for the agent
      let noteContent = `# Email: ${config.subject || 'No subject'}\n\n`
      noteContent += `**From:** ${config.from || 'Unknown'}\n`
      noteContent += `**Date:** ${config.date || 'Unknown'}\n\n`
      noteContent += `## Latest email\n\n${config.latest_email}\n\n`
      if (config.past_summary) {
        noteContent += `## Earlier conversation summary\n\n${config.past_summary}\n\n`
      }

      const result = await ipc.invoke('inline-task:process', {
        instruction: `Draft a concise, professional response to this email. Return only the email body text, no subject line or headers.`,
        noteContent,
        notePath: '',
      })

      if (result.response) {
        // Clean up the response — strip any markdown headers the agent may add
        const cleaned = result.response.replace(/^#+\s+.*\n*/gm, '').trim()
        setDraftBody(cleaned)
        // Update the block data to include the draft
        const current = JSON.parse(raw) as Record<string, unknown>
        updateAttributes({ data: JSON.stringify({ ...current, draft_response: cleaned }) })
      }
    } catch (err) {
      console.error('[email-block] Failed to generate response:', err)
    } finally {
      setGenerating(false)
    }
  }, [config, generating, raw, updateAttributes])

  const draftWithAssistant = useCallback(() => {
    if (!config) return
    let prompt = `Help me draft a response to this email`
    if (config.threadId) {
      prompt += `. Read the full thread at gmail_sync/${config.threadId}.md for context`
    }
    prompt += `.\n\n`
    prompt += `**From:** ${config.from || 'Unknown'}\n`
    prompt += `**Subject:** ${config.subject || 'No subject'}\n`
    window.__pendingEmailDraft = { prompt }
    window.dispatchEvent(new Event('email-block:draft-with-assistant'))
  }, [config])

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

  const senderName = config.from || 'Unknown'

  // --- Render: Draft mode (draft_response present) ---
  if (hasDraft) {
    return (
      <NodeViewWrapper className="email-block-wrapper" data-type="email-block">
        <div className="email-block-card email-block-card-gmail" onMouseDown={(e) => e.stopPropagation()}>
          <button className="email-block-delete" onClick={deleteNode} aria-label="Delete email block">
            <X size={14} />
          </button>
          {/* Draft header – Gmail compose style */}
          <div className="email-draft-block-header">
            {config.to && (
              <div className="email-draft-block-field">
                <span className="email-draft-block-label">To</span>
                <span className="email-draft-block-value">{config.to}</span>
              </div>
            )}
            {config.subject && (
              <div className="email-draft-block-field">
                <span className="email-draft-block-label">Subject</span>
                <span className="email-draft-block-value">{config.subject}</span>
              </div>
            )}
          </div>
          {/* Editable draft body */}
          <textarea
            ref={bodyRef}
            className="email-draft-block-body-input"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            onBlur={() => commitDraft(draftBody)}
            placeholder="Write your reply..."
            rows={3}
          />
          {/* Action buttons – Gmail style */}
          <div className="email-draft-block-actions">
            {(hasPastSummary || config.latest_email) && (
              <button
                className="email-block-gmail-btn"
                onClick={(e) => { e.stopPropagation(); setContextExpanded(!contextExpanded) }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ChevronDown size={13} className={`email-block-toggle-chevron ${contextExpanded ? 'email-block-toggle-chevron-open' : ''}`} />
                {contextExpanded ? 'Hide' : 'Show'} context
              </button>
            )}
            <button
              className="email-block-gmail-btn email-block-gmail-btn-primary"
              onClick={() => {
                void navigator.clipboard.writeText(draftBody)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy draft'}
            </button>
            {gmailUrl && (
              <button
                className="email-block-gmail-btn email-block-gmail-btn-primary"
                onClick={() => {
                  void navigator.clipboard.writeText(draftBody)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                  window.open(gmailUrl, '_blank')
                }}
              >
                <ExternalLink size={13} />
                Reply in Gmail
              </button>
            )}
          </div>
          {/* Context: latest email + past summary */}
          {contextExpanded && (
            <div className="email-block-context">
              <div className="email-block-context-section">
                <div className="email-block-message">
                  <div className="email-block-message-header">
                    <div className="email-block-sender-info">
                      <div className="email-block-sender-row">
                        {config.from && <div className="email-block-sender-name">{config.from}</div>}
                        {config.date && <div className="email-block-sender-date">{formatEmailDate(config.date)}</div>}
                      </div>
                      <div className="email-block-sender-to">to me</div>
                    </div>
                  </div>
                  <div className="email-block-message-body">{config.latest_email}</div>
                </div>
              </div>
              {hasPastSummary && (
                <div className="email-block-context-section">
                  <div className="email-block-context-label">Earlier conversation</div>
                  <div className="email-block-context-summary">{config.past_summary}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    )
  }

  // --- Render: Read mode (no draft_response) ---
  return (
    <NodeViewWrapper className="email-block-wrapper" data-type="email-block">
      <div className="email-block-card email-block-card-gmail" onMouseDown={(e) => e.stopPropagation()}>
        <button className="email-block-delete" onClick={deleteNode} aria-label="Delete email block">
          <X size={14} />
        </button>
        {config.subject && <div className="email-block-subject">{config.subject}</div>}
        {/* Latest email message */}
        <div className="email-block-message">
          <div className="email-block-message-header">
            <div className="email-block-sender-info">
              <div className="email-block-sender-row">
                <div className="email-block-sender-name">{senderName}</div>
                {config.date && <div className="email-block-sender-date">{formatEmailDate(config.date)}</div>}
              </div>
              <div className="email-block-sender-to">to me</div>
            </div>
          </div>
          <div className="email-block-message-body">{config.latest_email}</div>
        </div>
        {/* Action buttons – Gmail style */}
        <div className="email-draft-block-actions">
          {hasPastSummary && (
            <button
              className="email-block-gmail-btn"
              onClick={(e) => { e.stopPropagation(); setContextExpanded(!contextExpanded) }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ChevronDown size={13} className={`email-block-toggle-chevron ${contextExpanded ? 'email-block-toggle-chevron-open' : ''}`} />
              {contextExpanded ? 'Hide' : 'Show'} context
            </button>
          )}
          {responseMode === 'inline' && (
            <button
              className="email-block-gmail-btn email-block-gmail-btn-primary"
              onClick={generateResponse}
              disabled={generating}
            >
              {generating ? <Loader2 size={13} className="email-block-spinner" /> : <Sparkles size={13} />}
              {generating ? 'Generating...' : 'Generate response'}
            </button>
          )}
          {responseMode === 'assistant' && (
            <button
              className="email-block-gmail-btn email-block-gmail-btn-primary"
              onClick={draftWithAssistant}
            >
              <MessageSquare size={13} />
              Draft with assistant
            </button>
          )}
          {responseMode === 'both' && (
            <div className="email-block-response-split" ref={responseSplitRef}>
              <button
                className="email-block-split-main"
                onClick={generateResponse}
                disabled={generating}
              >
                {generating ? <Loader2 size={13} className="email-block-spinner" /> : <Sparkles size={13} />}
                {generating ? 'Generating...' : 'Generate response'}
              </button>
              <button
                className={`email-block-split-chevron ${responseSplitOpen ? 'email-block-split-chevron-open' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setResponseSplitOpen(!responseSplitOpen) }}
              >
                <ChevronDown size={12} />
              </button>
              {responseSplitOpen && (
                <div className="email-block-split-dropdown">
                  <button
                    className="email-block-split-option"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setResponseSplitOpen(false); draftWithAssistant() }}
                  >
                    <MessageSquare size={13} />
                    Draft with assistant
                  </button>
                </div>
              )}
            </div>
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
        {/* Past summary context */}
        {contextExpanded && hasPastSummary && (
          <div className="email-block-context">
            <div className="email-block-context-section">
              <div className="email-block-context-label">Earlier conversation</div>
              <div className="email-block-context-summary">{config.past_summary}</div>
            </div>
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
