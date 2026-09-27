// What's selected inside a space: the stream, a thread (by its root message —
// annotated or plain, the pane is the same), a file, or a whiteboard. Part of
// the app's navigation history, so the top ‹ › retrace it. Replying never
// creates anything, so there is no draft state: a thread with zero replies is
// just a thread.
//
// Files and boards are named by their ASSET ID (2026-09-14): the id is what
// every operation takes, the path is the record's display name and is looked
// up from the space's listing wherever it shows. A rename is a display
// change — the selection, the open column and any draft survive it.

export type RailSelection =
    | { kind: 'general' }
    | { kind: 'discussions' }
    | { kind: 'files' }
    | { kind: 'thread'; rootMessageId: string }
    /** `fromThreadRootId` = opened from a thread (an artifact link) — the file view shows a crumb back to it. */
    | { kind: 'file'; assetId: string; fromThreadRootId?: string }
    /** A message attachment previewed in the document column: the original blob URL (app://space-blob/…?name=…). */
    | { kind: 'attachment'; src: string; fromThreadRootId?: string }
    /** A shared board, full-bleed. `assetId` is the board's asset id (its path is whiteboards/<name>.excalidraw). */
    | { kind: 'whiteboard'; assetId: string }

/** Stable key for history comparisons. */
export function railKey(sel: RailSelection | undefined): string {
    if (!sel || sel.kind === 'general') return 'general'
    if (sel.kind === 'discussions' || sel.kind === 'files') return sel.kind
    if (sel.kind === 'thread') return `thread:${sel.rootMessageId}`
    if (sel.kind === 'attachment') return `attachment:${sel.src}`
    if (sel.kind === 'whiteboard') return `whiteboard:${sel.assetId}`
    return `file:${sel.assetId}`
}

/**
 * Shape-check a selection that arrived from outside the typed in-session
 * record (JSON from storage, an older history entry). Anything that is not a
 * selection this build understands — including the pre-2026-09-14 shape that
 * named files and boards by PATH — degrades to the stream: never a crash,
 * never a server call with a path where an id belongs.
 */
export function readRailSelection(raw: unknown): RailSelection {
    if (!raw || typeof raw !== 'object') return { kind: 'general' }
    const sel = raw as Record<string, unknown>
    const from = typeof sel.fromThreadRootId === 'string' ? { fromThreadRootId: sel.fromThreadRootId } : {}
    switch (sel.kind) {
        case 'discussions':
            return { kind: 'discussions' }
        case 'files':
            return { kind: 'files' }
        case 'general':
            return { kind: 'general' }
        case 'thread':
            return typeof sel.rootMessageId === 'string' && sel.rootMessageId ? { kind: 'thread', rootMessageId: sel.rootMessageId } : { kind: 'general' }
        case 'file':
            return typeof sel.assetId === 'string' && sel.assetId ? { kind: 'file', assetId: sel.assetId, ...from } : { kind: 'general' }
        case 'whiteboard':
            return typeof sel.assetId === 'string' && sel.assetId ? { kind: 'whiteboard', assetId: sel.assetId } : { kind: 'general' }
        case 'attachment':
            return typeof sel.src === 'string' && sel.src.startsWith('app://space-blob/') ? { kind: 'attachment', src: sel.src, ...from } : { kind: 'general' }
        default:
            return { kind: 'general' }
    }
}
