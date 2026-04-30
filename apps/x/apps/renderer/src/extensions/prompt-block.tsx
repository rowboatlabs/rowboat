import { z } from 'zod'
import { useMemo } from 'react'
import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { Sparkles } from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import { PromptBlockSchema } from '@x/shared/dist/prompt-block.js'
import { Button } from '@/components/ui/button'

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen).trimEnd() + '…'
}

function PromptBlockView({ node, extension }: {
  node: { attrs: Record<string, unknown> }
  extension: { options: { notePath?: string } }
}) {
  const raw = node.attrs.data as string

  const prompt = useMemo<z.infer<typeof PromptBlockSchema> | null>(() => {
    try {
      return PromptBlockSchema.parse(parseYaml(raw))
    } catch { return null }
  }, [raw])

  const notePath = extension.options.notePath

  const handleRun = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!prompt) return
    window.dispatchEvent(new CustomEvent('rowboat:open-copilot-prompt', {
      detail: {
        instruction: prompt.instruction,
        label: prompt.label,
        filePath: notePath,
      },
    }))
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleRun(e as unknown as React.MouseEvent)
    }
  }

  if (!prompt) {
    return (
      <NodeViewWrapper data-type="prompt-block">
        <div className="my-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Invalid prompt block — expected YAML with <code>label</code> and <code>instruction</code>.
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper data-type="prompt-block">
      <div
        role="button"
        tabIndex={0}
        onClick={handleRun}
        onKeyDown={handleKey}
        onMouseDown={(e) => e.stopPropagation()}
        title={prompt.instruction}
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 pr-4 text-left transition-colors hover:bg-accent/50 cursor-pointer w-full my-2"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium">{prompt.label}</div>
          <div className="truncate text-xs text-muted-foreground">{truncate(prompt.instruction, 80)}</div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 text-xs h-8 rounded-lg pointer-events-none">
          Run
        </Button>
      </div>
    </NodeViewWrapper>
  )
}

export const PromptBlockExtension = Node.create({
  name: 'promptBlock',
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
          if (cls.includes('language-prompt')) {
            return { data: code.textContent || '' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'prompt-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PromptBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```prompt\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
