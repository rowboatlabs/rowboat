import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ChevronDown, FileText } from 'lucide-react'
import { blocks } from '@x/shared'
import { useState } from 'react'

function TranscriptBlockView({ node }: {
  node: { attrs: Record<string, unknown> }
}) {
  const raw = node.attrs.data as string
  let config: blocks.TranscriptBlock | null = null

  try {
    config = blocks.TranscriptBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  const [expanded, setExpanded] = useState(false)

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
            {config.transcript}
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
