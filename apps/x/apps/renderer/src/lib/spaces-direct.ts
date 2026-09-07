import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

// Direct messages are spaces of kind 'direct' (contract 2026-09-07): the same
// container with a fixed two-member roster and a placeholder name. Everything
// that NAMES a DM goes through here — the label is the other person's current
// display name, never anything stored.

/** The member on the other side of a DM; undefined on shared spaces. */
export function otherParticipant(space: spaces.Space, selfId: string): string | undefined {
    if (space.kind !== 'direct') return undefined
    return (space.participants ?? []).find((id) => id !== selfId)
}

/** A DM's label from a roster: the other person's display name, their id until the roster lands. */
export function directLabel(space: spaces.Space, members: readonly spaces.Member[], selfId: string): string {
    const other = otherParticipant(space, selfId)
    if (!other) return 'Direct message'
    return members.find((m) => m.id === other)?.displayName ?? other
}

/** What to call a space wherever it is named: its name, or for a DM the other person (from the orgs store). */
export function spaceDisplayName(org: Pick<OrgWithSpaces, 'directLabels'>, space: spaces.Space): string {
    return space.kind === 'direct' ? (org.directLabels[space.id] ?? 'Direct message') : space.name
}
