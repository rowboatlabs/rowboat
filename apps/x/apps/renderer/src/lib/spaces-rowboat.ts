import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { containsRowboatAddress } from '@/lib/spaces-mentions'
import { toast } from '@/lib/toast'

// ---------------------------------------------------------------------------
// @rowboat trigger (spec §8): a posted message that genuinely addresses
// @rowboat routes into the THREAD's session — the anchor is the posted
// message's thread root (the message itself when it went to the stream), so
// the agent's receipt lands as a reply right under the ask.
// ---------------------------------------------------------------------------

/** Per-turn agent options from the composer's agent strip. */
export interface RowboatTurnOptions {
    model?: { provider: string; model: string; effort?: 'low' | 'medium' | 'high' }
    permissionMode?: 'auto' | 'manual'
    searchEnabled?: boolean
    codeMode?: 'claude' | 'codex'
}

export function maybeInvokeRowboat(
    org: OrgWithSpaces,
    space: spaces.Space,
    thread: { rootMessageId: string; label: string },
    messageId: string,
    body: string,
    options?: RowboatTurnOptions,
): void {
    if (!containsRowboatAddress(body)) return
    void window.ipc
        .invoke('spaces:invokeRowboat', {
            orgId: org.id,
            spaceId: space.id,
            threadRootId: thread.rootMessageId,
            threadLabel: thread.label,
            spaceName: space.name,
            messageId,
            body,
            ...(options ? { options } : {}),
        })
        .catch((err) => {
            toast(err instanceof Error ? err.message : 'Rowboat could not be invoked', 'error')
        })
}

