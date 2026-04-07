import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, ImageIcon } from 'lucide-react'
import { blocks } from '@x/shared'

function ImageBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const raw = node.attrs.data as string
  let config: blocks.ImageBlock | null = null

  try {
    config = blocks.ImageBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  if (!config) {
    return (
      <NodeViewWrapper className="image-block-wrapper" data-type="image-block">
        <div className="image-block-card image-block-error">
          <ImageIcon size={16} />
          <span>Invalid image block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="image-block-wrapper" data-type="image-block">
      <div className="image-block-card">
        <button
          className="image-block-delete"
          onClick={deleteNode}
          aria-label="Delete image block"
        >
          <X size={14} />
        </button>
        <img
          src={config.src}
          alt={config.alt || ''}
          className="image-block-img"
        />
        {config.caption && (
          <div className="image-block-caption">{config.caption}</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const ImageBlockExtension = Node.create({
  name: 'imageBlock',
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
          if (cls.includes('language-image')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```image\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
