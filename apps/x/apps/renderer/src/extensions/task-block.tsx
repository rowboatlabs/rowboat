import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { CalendarClock, X } from 'lucide-react'
import { inlineTask } from '@x/shared'

function TaskBlockView({ node, deleteNode }: { node: { attrs: { data: string } }; deleteNode: () => void }) {
  const raw = node.attrs.data
  let instruction = ''
  let scheduleLabel = ''

  try {
    const parsed = inlineTask.InlineTaskBlockSchema.parse(JSON.parse(raw))
    instruction = parsed.instruction
    scheduleLabel = parsed['schedule-label'] ?? ''
  } catch {
    // Fallback: show raw data
    instruction = raw
  }

  return (
    <NodeViewWrapper className="task-block-wrapper" data-type="task-block">
      <div className="task-block-card">
        <button
          className="task-block-delete"
          onClick={deleteNode}
          aria-label="Delete task block"
        >
          <X size={14} />
        </button>
        <div className="task-block-content">
          <span className="task-block-instruction"><span className="task-block-prefix">@rowboat</span> {instruction}</span>
          {scheduleLabel && (
            <span className="task-block-schedule">
              <CalendarClock size={12} />
              {scheduleLabel}
            </span>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const TaskBlockExtension = Node.create({
  name: 'taskBlock',
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
          if (cls.includes('language-task') || cls.includes('language-tell-rowboat')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'task-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```task\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
