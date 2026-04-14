import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { Streamdown } from 'streamdown'

/**
 * TrackTargetExtension — a Tiptap atom node that owns a
 *   <!--track-target:ID-->...<!--/track-target:ID-->
 * region. Content is display-only; the backend is the sole writer.
 *
 * Parse path: `markdown-editor.tsx#preprocessTrackTargets` converts each
 * comment-wrapped region into a placeholder
 *   <div data-type="track-target" data-track-id="..." data-content="<base64>"></div>
 * which the `parseHTML` rule below picks up.
 *
 * Serialize path: round-trips back to the exact comment-wrapped form via
 * `addStorage().markdown.serialize` AND via the custom
 * `blockToMarkdown` switch in `markdown-editor.tsx` (both save paths must
 * handle it identically).
 */

// Unicode-safe base64 helpers — content may contain any char, including
// emoji and CJK. btoa/atob alone only handle Latin-1.
function encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}

function decode(s: string): string {
  try {
    return decodeURIComponent(escape(atob(s)))
  } catch {
    return ''
  }
}

function TrackTargetView({ node }: {
  node: { attrs: Record<string, unknown> }
}) {
  const trackId = (node.attrs.trackId as string) ?? ''
  const content = (node.attrs.content as string) ?? ''

  return (
    <NodeViewWrapper
      className="track-target-wrapper"
      data-type="track-target"
      data-track-id={trackId}
    >
      <div className="track-target-box" onMouseDown={(e) => e.stopPropagation()}>
        {content.trim()
          ? <Streamdown className="track-target-markdown">{content}</Streamdown>
          : <span className="track-target-empty">No output yet — run the track to populate this area.</span>}
      </div>
    </NodeViewWrapper>
  )
}

export const TrackTargetExtension = Node.create({
  name: 'trackTarget',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      trackId: { default: '' },
      content: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="track-target"]',
        getAttrs(el) {
          if (!(el instanceof HTMLElement)) return false
          const trackId = el.getAttribute('data-track-id') ?? ''
          const b64 = el.getAttribute('data-content') ?? ''
          return { trackId, content: b64 ? decode(b64) : '' }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }: { HTMLAttributes: Record<string, unknown>; node: { attrs: Record<string, unknown> } }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'track-target',
        'data-track-id': (node.attrs.trackId as string) ?? '',
        'data-content': encode((node.attrs.content as string) ?? ''),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TrackTargetView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (text: string) => void; closeBlock: (node: unknown) => void },
          node: { attrs: { trackId: string; content: string } },
        ) {
          const id = node.attrs.trackId ?? ''
          const content = node.attrs.content ?? ''
          state.write(`<!--track-target:${id}-->\n${content}\n<!--/track-target:${id}-->`)
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML after preprocessTrackTargets runs
        },
      },
    }
  },
})
