import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, GitBranch } from 'lucide-react'
import { MermaidRenderer } from '@/components/mermaid-renderer'

function MermaidBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const source = (node.attrs.data as string) || ''

  return (
    <NodeViewWrapper className="mermaid-block-wrapper" data-type="mermaid-block">
      <div className="mermaid-block-card">
        <button
          className="mermaid-block-delete"
          onClick={deleteNode}
          aria-label="Delete mermaid block"
        >
          <X size={14} />
        </button>
        {source ? (
          <MermaidRenderer source={source} />
        ) : (
          <div className="mermaid-block-empty">
            <GitBranch size={16} />
            <span>Empty mermaid block</span>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const MermaidBlockExtension = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

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
          if (cls.includes('language-mermaid')) {
            return { data: code.textContent || '' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```mermaid\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
