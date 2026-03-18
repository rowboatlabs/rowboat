import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, ExternalLink } from 'lucide-react'
import { blocks } from '@x/shared'

function getEmbedUrl(provider: string, url: string): string | null {
  if (provider === 'youtube') {
    // Handle youtube.com/watch?v=X and youtu.be/X
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
    if (match) return `https://www.youtube.com/embed/${match[1]}`
  }
  if (provider === 'figma') {
    // Convert www.figma.com/design/:key/... → embed.figma.com/design/:key?embed-host=rowboat
    const figmaMatch = url.match(/figma\.com\/(design|board|proto)\/([\w-]+)/)
    if (figmaMatch) {
      return `https://embed.figma.com/${figmaMatch[1]}/${figmaMatch[2]}?embed-host=rowboat`
    }
    // Legacy /file/ URLs
    const legacyMatch = url.match(/figma\.com\/file\/([\w-]+)/)
    if (legacyMatch) {
      return `https://embed.figma.com/design/${legacyMatch[1]}?embed-host=rowboat`
    }
  }
  return null
}

function EmbedBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const raw = node.attrs.data as string
  let config: blocks.EmbedBlock | null = null

  try {
    config = blocks.EmbedBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  if (!config) {
    return (
      <NodeViewWrapper className="embed-block-wrapper" data-type="embed-block">
        <div className="embed-block-card embed-block-error">
          <ExternalLink size={16} />
          <span>Invalid embed block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const embedUrl = getEmbedUrl(config.provider, config.url)

  return (
    <NodeViewWrapper className="embed-block-wrapper" data-type="embed-block">
      <div className="embed-block-card">
        <button
          className="embed-block-delete"
          onClick={deleteNode}
          aria-label="Delete embed block"
        >
          <X size={14} />
        </button>
        {embedUrl ? (
          <div className="embed-block-iframe-container">
            <iframe
              src={embedUrl}
              className="embed-block-iframe"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </div>
        ) : (
          <a
            href={config.url}
            target="_blank"
            rel="noopener noreferrer"
            className="embed-block-link"
          >
            <ExternalLink size={14} />
            {config.url}
          </a>
        )}
        {config.caption && (
          <div className="embed-block-caption">{config.caption}</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const EmbedBlockExtension = Node.create({
  name: 'embedBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: '{}',
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
          if (cls.includes('language-embed')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```embed\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
