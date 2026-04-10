import { z } from 'zod'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { Radio, ChevronRight, X, Clock, Code2, Check, Play, Loader2 } from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import { Streamdown } from 'streamdown'
import { TrackBlockSchema } from '@x/shared/dist/track-block.js'
import { useTrackStatus } from '@/hooks/use-track-status'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen).trimEnd() + '…'
}

type Tab = 'metadata' | 'instruction' | 'criteria'
function TrackBlockView({ node, deleteNode, updateAttributes, extension }: {
  node: { attrs: Record<string, unknown> }
  deleteNode: () => void
  updateAttributes: (attrs: Record<string, unknown>) => void
  extension: { options: { notePath?: string } }
}) {
  const raw = node.attrs.data as string
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('instruction')
  const [editingRaw, setEditingRaw] = useState(false)
  const [rawDraft, setRawDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const track = useMemo<z.infer<typeof TrackBlockSchema> | null>(() => {
    try {
      return TrackBlockSchema.parse(parseYaml(raw))
    } catch { return null }
  }, [raw]) as z.infer<typeof TrackBlockSchema> | null;

  const trackId = track?.trackId ?? ''
  const instruction = track?.instruction ?? ''
  const matchCriteria = track?.matchCriteria ?? ''
  const active = track?.active ?? true
  const lastRunAt = track?.lastRunAt ?? ''
  const lastRunId = track?.lastRunId ?? ''
  const lastRunSummary = track?.lastRunSummary ?? ''
  const notePath = extension.options.notePath
  const trackFilePath = notePath?.replace(/^knowledge\//, '') ?? ''

  // Track run status from the global hook
  const allTrackStatus = useTrackStatus()
  const runState = allTrackStatus.get(`${track.trackId}:${trackFilePath}`) ?? { status: 'idle' as const }
  const runStatus = runState.status
  const runSummary = runState.summary ?? runState.error ?? null

  useEffect(() => {
    if (editingRaw && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      )
    }
  }, [editingRaw])

  const handleStartEdit = () => {
    setRawDraft(raw)
    setEditingRaw(true)
  }

  const handleSaveRaw = () => {
    updateAttributes({ data: rawDraft })
    setEditingRaw(false)
  }

  const handleCancelEdit = () => {
    setEditingRaw(false)
  }

  const handleRun = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (runStatus === 'running' || !trackId || !trackFilePath) return
    try {
      await window.ipc.invoke('track:run', { trackId, filePath: trackFilePath })
    } catch (err) {
      console.error('[TrackBlock] Run failed:', err)
    }
  }, [runStatus, trackId, trackFilePath])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'instruction', label: 'Instruction' },
    { key: 'criteria', label: 'Match Criteria' },
    { key: 'metadata', label: 'Metadata' },
  ]

  const isRunning = runStatus === 'running'

  return (
    <NodeViewWrapper className="track-block-wrapper" data-type="track-block">
      <div
        className={`track-block-card ${!active ? 'track-block-paused' : ''} ${isRunning ? 'track-block-running' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="track-block-delete"
          onClick={deleteNode}
          aria-label="Delete track block"
        >
          <X size={14} />
        </button>

        {/* Collapsed view */}
        <div
          className="track-block-collapsed"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            size={14}
            className={`track-block-chevron ${expanded ? 'track-block-chevron-open' : ''}`}
          />
          <Radio size={14} className="track-block-icon" />
          <span className="track-block-label">Track</span>
          {!active && <span className="track-block-badge track-block-badge-paused">paused</span>}
          <span className="track-block-summary">{truncate(instruction, 60)}</span>
          {lastRunAt && !isRunning && (
            <span className="track-block-meta">
              <Clock size={11} />
              {formatDateTime(lastRunAt)}
            </span>
          )}
          {isRunning && (
            <span className="track-block-meta track-block-meta-running">
              <Loader2 size={11} className="animate-spin" />
              Running…
            </span>
          )}
          <button
            className="track-block-run-btn"
            onClick={handleRun}
            disabled={isRunning}
            aria-label="Run track"
            title="Run track"
          >
            {isRunning
              ? <Loader2 size={13} className="animate-spin" />
              : <Play size={13} />}
          </button>
        </div>

        {/* Status bar */}
        {runSummary && runStatus !== 'running' && (
          <div className={`track-block-status-bar ${runStatus === 'error' ? 'track-block-status-error' : 'track-block-status-done'}`}>
            {runSummary}
          </div>
        )}

        {/* Expanded view */}
        {expanded && (
          <div className="track-block-expanded">
            <div className="track-block-tabs">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  className={`track-block-tab ${activeTab === tab.key ? 'track-block-tab-active' : ''}`}
                  onClick={() => { setActiveTab(tab.key); setEditingRaw(false) }}
                >
                  {tab.label}
                </button>
              ))}
              <button
                className={`track-block-tab track-block-tab-raw ${editingRaw ? 'track-block-tab-active' : ''}`}
                onClick={handleStartEdit}
              >
                <Code2 size={12} />
                Edit Raw
              </button>
            </div>

            {editingRaw ? (
              <div className="track-block-raw-editor">
                <textarea
                  ref={textareaRef}
                  className="track-block-textarea"
                  value={rawDraft}
                  onChange={(e) => setRawDraft(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      handleCancelEdit()
                    }
                    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleSaveRaw()
                    }
                  }}
                />
                <div className="track-block-raw-actions">
                  <button className="track-block-btn track-block-btn-secondary" onClick={handleCancelEdit}>
                    Cancel
                  </button>
                  <button className="track-block-btn track-block-btn-primary" onClick={handleSaveRaw}>
                    <Check size={12} />
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="track-block-panel">
                {activeTab === 'instruction' && (
                  <div className="track-block-panel-text">
                    {instruction
                      ? <Streamdown className="track-block-markdown">{instruction}</Streamdown>
                      : <span className="track-block-empty">No instruction set</span>}
                  </div>
                )}
                {activeTab === 'criteria' && (
                  <div className="track-block-panel-text">
                    {matchCriteria
                      ? <Streamdown className="track-block-markdown">{matchCriteria}</Streamdown>
                      : <span className="track-block-empty">No match criteria set</span>}
                  </div>
                )}
                {activeTab === 'metadata' && (
                  <div className="track-block-metadata-grid">
                    <div className="track-block-metadata-row">
                      <span className="track-block-metadata-label">Track ID</span>
                      <span className="track-block-metadata-value"><code>{trackId}</code></span>
                    </div>
                    <div className="track-block-metadata-row">
                      <span className="track-block-metadata-label">Status</span>
                      <span className="track-block-metadata-value">
                        <span className={`track-block-badge ${active ? 'track-block-badge-active' : 'track-block-badge-paused'}`}>
                          {active ? 'active' : 'paused'}
                        </span>
                      </span>
                    </div>
                    {lastRunAt && (
                      <div className="track-block-metadata-row">
                        <span className="track-block-metadata-label">Last run</span>
                        <span className="track-block-metadata-value">{formatDateTime(lastRunAt)}</span>
                      </div>
                    )}
                    {lastRunId && (
                      <div className="track-block-metadata-row">
                        <span className="track-block-metadata-label">Run ID</span>
                        <span className="track-block-metadata-value"><code>{lastRunId}</code></span>
                      </div>
                    )}
                    {lastRunSummary && (
                      <div className="track-block-metadata-row">
                        <span className="track-block-metadata-label">Summary</span>
                        <span className="track-block-metadata-value">{lastRunSummary}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const TrackBlockExtension = Node.create({
  name: 'trackBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      notePath: undefined as string | undefined,
    }
  },

  addAttributes() {
    return {
      data: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        priority: 60,
        getAttrs(element) {
          const code = element.querySelector('code')
          if (!code) return false
          const cls = code.className || ''
          if (cls.includes('language-track')) {
            return { data: code.textContent || '' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'track-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TrackBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```track\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
