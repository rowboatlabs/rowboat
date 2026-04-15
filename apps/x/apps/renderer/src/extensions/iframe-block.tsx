import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ExternalLink, Globe, X } from 'lucide-react'
import { blocks } from '@x/shared'

const DEFAULT_IFRAME_HEIGHT = 560
const DEFAULT_IFRAME_ALLOW = [
  'accelerometer',
  'autoplay',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'microphone',
].join('; ')

function getIframeMeta(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.host,
      path: parsed.pathname === '/' ? '' : parsed.pathname,
    }
  } catch {
    return null
  }
}

function IframeBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const raw = node.attrs.data as string
  let config: blocks.IframeBlock | null = null

  try {
    config = blocks.IframeBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  if (!config) {
    return (
      <NodeViewWrapper className="iframe-block-wrapper" data-type="iframe-block">
        <div className="iframe-block-card iframe-block-error">
          <Globe size={16} />
          <span>Invalid iframe block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const meta = getIframeMeta(config.url)
  const title = config.title || meta?.host || 'Embedded page'
  const allow = config.allow || DEFAULT_IFRAME_ALLOW
  const height = config.height ?? DEFAULT_IFRAME_HEIGHT

  return (
    <NodeViewWrapper className="iframe-block-wrapper" data-type="iframe-block">
      <div className="iframe-block-card">
        <button
          className="iframe-block-delete"
          onClick={deleteNode}
          aria-label="Delete iframe block"
        >
          <X size={14} />
        </button>
        <div className="iframe-block-header">
          <div className="iframe-block-header-main">
            <div className="iframe-block-badge">
              <Globe size={13} />
              Iframe
            </div>
            <div className="iframe-block-title-row">
              <div className="iframe-block-title">{title}</div>
              {meta && (
                <div className="iframe-block-host">
                  {meta.host}
                  {meta.path}
                </div>
              )}
            </div>
          </div>
          <a
            href={config.url}
            target="_blank"
            rel="noopener noreferrer"
            className="iframe-block-open"
          >
            <ExternalLink size={13} />
            Open
          </a>
        </div>
        <div className="iframe-block-frame-shell" style={{ height }}>
          <iframe
            src={config.url}
            title={title}
            className="iframe-block-frame"
            loading="lazy"
            allow={allow}
            allowFullScreen
            sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
          />
        </div>
        {config.caption && (
          <div className="iframe-block-caption">{config.caption}</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const IframeBlockExtension = Node.create({
  name: 'iframeBlock',
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
          if (cls.includes('language-iframe')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'iframe-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(IframeBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```iframe\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
