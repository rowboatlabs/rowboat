// Jump-to-message: search results, pinned/saved items, and the quick switcher
// all land on "open this topic, then scroll to this message". Navigation is
// the caller's job (rail selection); the scroll is this module's — a pending
// jump the destination pane consumes once it is visible and has the row.
// Module state, not just an event: the pane may mount (or become visible)
// AFTER the request fires.

export interface JumpTarget {
    /** The topic holding the message ('' targets the general stream). */
    topicId: string
    messageId: string
    /**
     * The row's offset in the space's log, when the producer already holds
     * the message: a pane whose window lacks the row loads around it without
     * a lookup. Absent = the pane asks the org once.
     */
    offset?: number
}

/** What the pane consumes: the row to land on, and where it sits if known. */
export type JumpAnchor = Pick<JumpTarget, 'messageId' | 'offset'>

let pending: JumpTarget | null = null
const listeners = new Set<() => void>()

export function requestJump(target: JumpTarget): void {
    pending = target
    for (const l of listeners) l()
}

/** The pane for `topicId` claims its jump (null = nothing pending for it). */
export function consumeJump(topicId: string): JumpAnchor | null {
    if (!pending || pending.topicId !== topicId) return null
    const { messageId, offset } = pending
    pending = null
    return offset === undefined ? { messageId } : { messageId, offset }
}

export function subscribeJump(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** Where the anchor's row sits: the offset the producer passed, else one lookup (throws when the message is gone). */
export async function resolveJumpOffset(orgId: string, spaceId: string, anchor: JumpAnchor): Promise<number> {
    if (anchor.offset !== undefined) return anchor.offset
    const { message } = await window.ipc.invoke('spaces:getMessage', { orgId, spaceId, messageId: anchor.messageId })
    return message.offset
}

/** The toast for a jump that could not reach its row. Errors cross IPC as bare messages, so "gone" is read off the text. */
export function jumpFailureMessage(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err ?? '')
    return /no such message|not found|\b404\b/i.test(msg) ? 'That message is no longer here' : 'Could not open the message'
}

/** Scroll a message row into view and flash it. The row carries data-mid. */
export function scrollToMessage(container: HTMLElement, messageId: string): boolean {
    const el = container.querySelector<HTMLElement>(`[data-mid="${CSS.escape(messageId)}"]`)
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.animate(
        [{ backgroundColor: 'rgba(250, 204, 21, 0.3)' }, { backgroundColor: 'transparent' }],
        { duration: 1800, easing: 'ease-out' },
    )
    return true
}
