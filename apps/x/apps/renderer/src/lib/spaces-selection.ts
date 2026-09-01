// What's selected inside a space: the stream, a thread (by its root message —
// annotated or plain, the pane is the same), a file, or a whiteboard. Part of
// the app's navigation history, so the top ‹ › retrace it. Replying never
// creates anything, so there is no draft state: a thread with zero replies is
// just a thread.

export type RailSelection =
    | { kind: 'general' }
    | { kind: 'thread'; rootMessageId: string }
    /** `fromThreadRootId` = opened from a thread (an artifact link) — the file view shows a crumb back to it. */
    | { kind: 'file'; path: string; fromThreadRootId?: string }
    /** A shared board, full-bleed. `path` is its asset path (whiteboards/<name>.excalidraw). */
    | { kind: 'whiteboard'; path: string }

/** Stable key for history comparisons. */
export function railKey(sel: RailSelection | undefined): string {
    if (!sel || sel.kind === 'general') return 'general'
    if (sel.kind === 'thread') return `thread:${sel.rootMessageId}`
    if (sel.kind === 'whiteboard') return `whiteboard:${sel.path}`
    return `file:${sel.path}`
}
