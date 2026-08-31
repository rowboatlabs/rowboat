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
}

let pending: JumpTarget | null = null
const listeners = new Set<() => void>()

export function requestJump(target: JumpTarget): void {
    pending = target
    for (const l of listeners) l()
}

/** The pane for `topicId` claims its jump (null = nothing pending for it). */
export function consumeJump(topicId: string): string | null {
    if (!pending || pending.topicId !== topicId) return null
    const id = pending.messageId
    pending = null
    return id
}

export function subscribeJump(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
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
