import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ChevronDown, FileText } from 'lucide-react'
import { blocks } from '@x/shared'
import { useState, useMemo } from 'react'

interface TranscriptEntry {
  speaker: string
  text: string
}

function parseTranscript(raw: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const lines = raw.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Match **Speaker Name:** text or **You:** text
    const match = trimmed.match(/^\*\*(.+?):\*\*\s*(.*)$/)
    if (match) {
      entries.push({ speaker: match[1], text: match[2] })
    } else if (entries.length > 0) {
      // Continuation line — append to last entry
      entries[entries.length - 1].text += ' ' + trimmed
    }
  }
  return entries
}

function speakerColor(speaker: string): string {
  // Simple hash to pick a consistent color per speaker
  let hash = 0
  for (let i = 0; i < speaker.length; i++) {
    hash = speaker.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = [
    '#3b82f6',  // blue
    '#06b6d4',  // cyan
    '#6366f1',  // indigo
    '#8b5cf6',  // purple
    '#0ea5e9',  // sky
    '#2563eb',  // blue darker
    '#7c3aed',  // violet
  ]
  return colors[Math.abs(hash) % colors.length]
}

function TranscriptBlockView({ node, getPos, editor }: {
  node: { attrs: Record<string, unknown> }
  getPos: () => number | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any
}) {
  const raw = node.attrs.data as string
  let config: blocks.TranscriptBlock | null = null

  try {
    config = blocks.TranscriptBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  // Auto-detect: expand if this is the first real block (live recording),
  // collapse if there's other content above (notes have been generated)
  const isFirstBlock = useMemo(() => {
    try {
      const pos = getPos()
      if (pos === undefined) return false
      const firstChild = editor?.state?.doc?.firstChild
      if (!firstChild) return true
      // If the transcript block is right after the first node (heading), it's the main content
      return pos <= (firstChild.nodeSize ?? 0) + 1
    } catch {
      return false
    }
  }, [getPos, editor])

  const [expanded, setExpanded] = useState(isFirstBlock)

  const entries = useMemo(() => {
    if (!config) return []
    return parseTranscript(config.transcript)
  }, [config])

  if (!config) {
    return (
      <NodeViewWrapper className="transcript-block-wrapper" data-type="transcript-block">
        <div className="transcript-block-card transcript-block-error">
          <FileText size={16} />
          <span>Invalid transcript block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="transcript-block-wrapper" data-type="transcript-block">
      <div className="transcript-block-card" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="transcript-block-toggle"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ChevronDown size={14} className={`transcript-block-chevron ${expanded ? 'transcript-block-chevron-open' : ''}`} />
          <FileText size={14} />
          <span>Raw transcript</span>
        </button>
        {expanded && (
          <div className="transcript-block-content">
            {entries.length > 0 ? (
              entries.map((entry, i) => (
                <div key={i} className="transcript-entry">
                  <span className="transcript-speaker" style={{ color: speakerColor(entry.speaker) }}>
                    {entry.speaker}
                  </span>
                  <span className="transcript-text">{entry.text}</span>
                </div>
              ))
            ) : (
              <div className="transcript-raw">{config.transcript}</div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const TranscriptBlockExtension = Node.create({
  name: 'transcriptBlock',
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
        if (cls.includes('language-transcript')) {
          return { data: code.textContent || '{}' }
        }
        return false
      },
    }]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'transcript-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TranscriptBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```transcript\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
