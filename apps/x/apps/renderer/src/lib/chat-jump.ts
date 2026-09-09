import { useSyncExternalStore } from 'react'

// Deep link into a chat: "open session S and land on message M". Navigation
// is the caller's job (openAssistantRun); the landing is this module's — a
// pending jump the session's pane consumes once it is mounted for that
// session, then hands to the scroll controller, which pins the row when the
// transcript renders it (lib/chat-scroll.ts requestJump). Module state, not
// just an event: the pane may mount AFTER the request fires — the same
// posture as lib/spaces-jump.ts for message rows in a space.

export interface ChatJumpTarget {
    sessionId: string
    /** A conversation item id — a user row is `${turnId}:user` or `${turnId}:user:${inputIndex}`. */
    messageId: string
}

/** The user-row item id for a turn's input (mirrors lib/session-chat/turn-view.ts). */
export function turnInputMessageId(turnId: string, inputIndex?: number): string {
    return typeof inputIndex === 'number' ? `${turnId}:user:${inputIndex}` : `${turnId}:user`
}

let pending: ChatJumpTarget | null = null
const listeners = new Set<() => void>()

export function requestChatJump(target: ChatJumpTarget): void {
    pending = target
    for (const l of listeners) l()
}

/** The pane for `sessionId` claims its jump (null = nothing pending for it). */
export function consumeChatJump(sessionId: string): string | null {
    if (!pending || pending.sessionId !== sessionId) return null
    const id = pending.messageId
    pending = null
    return id
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function snapshot(): ChatJumpTarget | null {
    return pending
}

/** The pending jump, when it targets `sessionId`; re-renders the caller when one arrives. */
export function usePendingChatJump(sessionId: string | null): ChatJumpTarget | null {
    const current = useSyncExternalStore(subscribe, snapshot, snapshot)
    return current && sessionId && current.sessionId === sessionId ? current : null
}

/** Test seam. */
export function resetChatJump(): void {
    pending = null
}
