import { mergeAttributes, Node } from '@tiptap/react'

/**
 * Track target markers — two Tiptap atom nodes that represent the open and
 * close HTML comment markers bracketing a track's output region on disk:
 *
 *   <!--track-target:ID-->   →  TrackTargetOpenExtension
 *   content in between       →  regular Tiptap nodes (paragraphs, lists,
 *                                custom blocks, whatever tiptap-markdown parses)
 *   <!--/track-target:ID-->  →  TrackTargetCloseExtension
 *
 * The markers are *semantic boundaries*, not a UI container. Content between
 * them is real, editable document content — fully rendered by the existing
 * extension set and freely editable by the user. The backend's updateContent()
 * in fileops.ts still locates the region on disk by these comment markers.
 *
 * Load path: `markdown-editor.tsx#preprocessTrackTargets` does a per-marker
 * regex replace, converting each comment into a placeholder div that these
 * extensions' parseHTML rules pick up. No content capture.
 *
 * Save path: both Tiptap's built-in markdown serializer
 * (`addStorage().markdown.serialize`) AND the app's custom serializer
 * (`blockToMarkdown` in markdown-editor.tsx) write the original comment form
 * back out — they must stay in sync.
 */

type MarkerVariant = 'open' | 'close'

function buildMarkerExtension(variant: MarkerVariant) {
    const name = variant === 'open' ? 'trackTargetOpen' : 'trackTargetClose'
    const htmlType = variant === 'open' ? 'track-target-open' : 'track-target-close'
    const commentFor = (id: string) =>
        variant === 'open' ? `<!--track-target:${id}-->` : `<!--/track-target:${id}-->`

    return Node.create({
        name,
        group: 'block',
        atom: true,
        selectable: true,
        draggable: false,

        addAttributes() {
            return {
                trackId: { default: '' },
            }
        },

        parseHTML() {
            return [
                {
                    tag: `div[data-type="${htmlType}"]`,
                    getAttrs(el) {
                        if (!(el instanceof HTMLElement)) return false
                        return { trackId: el.getAttribute('data-track-id') ?? '' }
                    },
                },
            ]
        },

        renderHTML({ HTMLAttributes, node }: { HTMLAttributes: Record<string, unknown>; node: { attrs: Record<string, unknown> } }) {
            return [
                'div',
                mergeAttributes(HTMLAttributes, {
                    'data-type': htmlType,
                    'data-track-id': (node.attrs.trackId as string) ?? '',
                }),
            ]
        },

        addStorage() {
            return {
                markdown: {
                    serialize(
                        state: { write: (text: string) => void; closeBlock: (node: unknown) => void },
                        node: { attrs: { trackId: string } },
                    ) {
                        state.write(commentFor(node.attrs.trackId ?? ''))
                        state.closeBlock(node)
                    },
                    parse: {
                        // handled via preprocessTrackTargets → parseHTML
                    },
                },
            }
        },
    })
}

export const TrackTargetOpenExtension = buildMarkerExtension('open')
export const TrackTargetCloseExtension = buildMarkerExtension('close')
