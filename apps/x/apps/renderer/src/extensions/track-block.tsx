import { z } from 'zod'
import { useMemo } from 'react'
import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { Radio, Loader2 } from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import { TrackBlockSchema } from '@x/shared/dist/track-block.js'
import { useTrackStatus } from '@/hooks/use-track-status'

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen).trimEnd() + '…'
}

// Detail shape for the open-track-modal window event. Defined here so the
// consumer (TrackModal) can import it without a circular dependency.
export type OpenTrackModalDetail = {
  trackId: string
  /** Workspace-relative path, e.g. "knowledge/Notes/foo.md" */
  filePath: string
  /** Best-effort initial YAML from Tiptap's cached node attr (modal refetches fresh). */
  initialYaml: string
  /** Invoked after a successful IPC delete so the editor can remove the node. */
  onDeleted: () => void
}

// ---------------------------------------------------------------------------
// Chip (display-only)
// ---------------------------------------------------------------------------

function TrackBlockView({ node, deleteNode, extension }: {
  node: { attrs: Record<string, unknown> }
  deleteNode: () => void
  updateAttributes: (attrs: Record<string, unknown>) => void
  extension: { options: { notePath?: string } }
}) {
  const raw = node.attrs.data as string

  const track = useMemo<z.infer<typeof TrackBlockSchema> | null>(() => {
    try {
      return TrackBlockSchema.parse(parseYaml(raw))
    } catch { return null }
  }, [raw]) as z.infer<typeof TrackBlockSchema> | null;

  const trackId = track?.trackId ?? ''
  const instruction = track?.instruction ?? ''
  const active = track?.active ?? true
  const schedule = track?.schedule
  const eventMatchCriteria = track?.eventMatchCriteria ?? ''
  const notePath = extension.options.notePath
  const trackFilePath = notePath?.replace(/^knowledge\//, '') ?? ''

  const triggerType: 'scheduled' | 'event' | 'manual' =
    schedule ? 'scheduled' : eventMatchCriteria ? 'event' : 'manual'

  const allTrackStatus = useTrackStatus()
  const runState = allTrackStatus.get(`${track?.trackId}:${trackFilePath}`) ?? { status: 'idle' as const }
  const isRunning = runState.status === 'running'

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!trackId || !notePath) return
    const detail: OpenTrackModalDetail = {
      trackId,
      filePath: notePath,
      initialYaml: raw,
      onDeleted: () => deleteNode(),
    }
    window.dispatchEvent(new CustomEvent<OpenTrackModalDetail>(
      'rowboat:open-track-modal',
      { detail },
    ))
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleOpen(e as unknown as React.MouseEvent)
    }
  }

  return (
    <NodeViewWrapper
      className="track-block-chip-wrapper"
      data-type="track-block"
      data-trigger={triggerType}
      data-active={active ? 'true' : 'false'}
    >
      <button
        type="button"
        className={`track-block-chip ${!active ? 'track-block-chip-paused-state' : ''} ${isRunning ? 'track-block-chip-running' : ''}`}
        onClick={handleOpen}
        onKeyDown={handleKey}
        onMouseDown={(e) => e.stopPropagation()}
        title={instruction ? `${trackId}: ${instruction}` : trackId}
      >
        {isRunning
          ? <Loader2 size={13} className="animate-spin track-block-chip-icon" />
          : <Radio size={13} className="track-block-chip-icon" />}
        <span className="track-block-chip-id">{trackId || 'track'}</span>
        {instruction && (
          <span className="track-block-chip-sep">·</span>
        )}
        {instruction && (
          <span className="track-block-chip-instruction">{truncate(instruction, 80)}</span>
        )}
        {!active && <span className="track-block-chip-paused-label">paused</span>}
      </button>
    </NodeViewWrapper>
  )
}

// ---------------------------------------------------------------------------
// Tiptap extension — unchanged schema, parseHTML, serialize
// ---------------------------------------------------------------------------

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
