import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, Table2 } from 'lucide-react'
import { blocks } from '@x/shared'

function TableBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const raw = node.attrs.data as string
  let config: blocks.TableBlock | null = null

  try {
    config = blocks.TableBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  if (!config) {
    return (
      <NodeViewWrapper className="table-block-wrapper" data-type="table-block">
        <div className="table-block-card table-block-error">
          <Table2 size={16} />
          <span>Invalid table block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="table-block-wrapper" data-type="table-block">
      <div className="table-block-card">
        <button
          className="table-block-delete"
          onClick={deleteNode}
          aria-label="Delete table block"
        >
          <X size={14} />
        </button>
        {config.title && <div className="table-block-title">{config.title}</div>}
        <div className="table-block-scroll">
          <table className="table-block-table">
            <thead>
              <tr>
                {config.columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.data.map((row, i) => (
                <tr key={i}>
                  {config!.columns.map((col) => (
                    <td key={col}>{String(row[col] ?? '')}</td>
                  ))}
                </tr>
              ))}
              {config.data.length === 0 && (
                <tr>
                  <td colSpan={config.columns.length} className="table-block-empty">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const TableBlockExtension = Node.create({
  name: 'tableBlock',
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
          if (cls.includes('language-table')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```table\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
