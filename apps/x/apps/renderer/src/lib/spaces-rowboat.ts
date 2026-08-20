import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { containsRowboatAddress } from '@/lib/spaces-mentions'
import { toast } from '@/lib/toast'

// ---------------------------------------------------------------------------
// @rowboat trigger (spec §8): a posted message that genuinely addresses
// @rowboat routes into the topic's session — from BOTH write paths, replying
// into a thread and starting a new topic with the mention as first message.
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
    topic: spaces.Topic,
    messageId: string,
    body: string,
    options?: RowboatTurnOptions,
): void {
    if (!containsRowboatAddress(body)) return
    void window.ipc
        .invoke('spaces:invokeRowboat', {
            orgId: org.id,
            spaceId: space.id,
            topicId: topic.id,
            topicTitle: topic.title,
            spaceName: space.name,
            messageId,
            body,
            ...(options ? { options } : {}),
        })
        .catch((err) => {
            toast(err instanceof Error ? err.message : 'Rowboat could not be invoked', 'error')
        })
}

