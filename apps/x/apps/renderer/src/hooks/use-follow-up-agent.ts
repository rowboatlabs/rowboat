import { useMemo } from 'react'
import type { spaces } from '@x/shared'
import { followUpAgentId } from '@x/shared/dist/spaces.js'
import { useSpaceInvocations } from '@/hooks/use-space-invocations'
import { useSpaceMembers } from '@/hooks/use-space-members'
import { isOthersPersonalAgent } from '@/lib/spaces-direct'

/**
 * The agent a reply that mentions nobody goes to (Harbor spec §8, 2026-10-27):
 * the one this person last invoked in the thread. Shared by the thread pane
 * and the inline view (2026-10-29, "inline thread ui" in Main) so both name
 * the same agent the org will. Undefined for someone else's personal agent,
 * which would refuse it anyway, and when there is no thread.
 */
export function useFollowUpAgent(orgId: string, spaceId: string, rootMessageId: string | undefined, selfMemberId: string): spaces.Member | undefined {
    const roster = useSpaceMembers(orgId, spaceId)
    const invocationsByMessage = useSpaceInvocations(orgId, spaceId)
    return useMemo(() => {
        if (rootMessageId === undefined) return undefined
        const members = new Map(roster.map((m) => [m.id, m]))
        const id = followUpAgentId([...invocationsByMessage.values()].flat(), rootMessageId, selfMemberId, members)
        const agent = id ? members.get(id) : undefined
        return agent && !isOthersPersonalAgent(agent, selfMemberId) ? agent : undefined
    }, [roster, invocationsByMessage, rootMessageId, selfMemberId])
}
