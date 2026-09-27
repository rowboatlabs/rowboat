import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { buildPendingMessage, failPendingStreamMessage, ingestStreamMessage, resolvePendingStreamMessage } from '@/hooks/use-space-chat'
import { markStreamRead } from '@/lib/spaces-read-state'
import { maybeInvokeRowboat, type RowboatTurnOptions } from '@/lib/spaces-rowboat'
import { threadLabelOf } from '@/lib/spaces-conventions'
import { containsRowboatAddress } from '@/lib/spaces-mentions'
import * as analytics from '@/lib/analytics'

// Posting a ROOT to a space's stream, the optimistic way (standard team-chat
// pattern): the row renders the moment this is called, dimmed as pending; the
// org's write confirms, or fails into a retry/discard row, in the background.
// Lifted out of GeneralStream (2026-09-23) so the thread pane's "post to the
// stream instead" lands exactly what the stream composer would have. Callers
// on a detached window snap to the tail first (jumpToLatest), or the row has
// no tail to land on.
export function postStreamMessage(org: OrgWithSpaces, space: spaces.Space, body: string, agent?: RowboatTurnOptions): void {
    const pending = buildPendingMessage(space.id, org.memberId, body)
    ingestStreamMessage(org.id, space.id, pending)
    void window.ipc
        .invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, body })
        .then((result) => {
            resolvePendingStreamMessage(org.id, space.id, pending.id, result.message)
            // The org read the stream up to our own post; mirror it.
            markStreamRead(org.id, space.id, result.message.offset, { sync: false })
            analytics.spacesMessagePosted({ kind: 'general', mentionsRowboat: containsRowboatAddress(body) })
            // @rowboat on a fresh stream message: the agent works the thread
            // under it, its receipt lands as the first reply.
            maybeInvokeRowboat(org, space, { rootMessageId: result.message.id, label: threadLabelOf(body) }, result.message.id, body, agent)
        })
        .catch(() => {
            failPendingStreamMessage(org.id, space.id, pending.id, body)
        })
}
