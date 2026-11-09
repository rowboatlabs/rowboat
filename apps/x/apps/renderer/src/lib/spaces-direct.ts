import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

// Direct messages are spaces of kind 'direct' (contract 2026-09-07): the same
// container with a fixed two-member roster and a placeholder name. Everything
// that NAMES a DM goes through here — the label is the other person's current
// display name, never anything stored.

/** The sidebar's name for your notes-to-self DM. Elsewhere it is "<your name> (you)". */
export const SELF_DIRECT_LABEL = 'You'

// An org whose server predates self-DMs refuses your own id. Remember that
// per org (this session) so the "You" row says so instead of failing again.
const selfUnsupported = new Set<string>()
export function markSelfDirectUnsupported(orgId: string): void {
    selfUnsupported.add(orgId)
}
export function isSelfDirectUnsupported(orgId: string): boolean {
    return selfUnsupported.has(orgId)
}
/**
 * Did the org refuse a self-DM because its server predates them? Errors
 * cross IPC as a bare message (the wire code is lost), so this reads the
 * message an older Harbor sends ("…there is no self-DM") or a missing route.
 */
export function selfDirectRefused(err: unknown): boolean {
    const code = (err as { code?: string } | null)?.code
    if (code === 'invalid_request' || code === 'not_found') return true
    const msg = err instanceof Error ? err.message : String(err ?? '')
    return /self-DM|needs someone else|\b404\b|not found/i.test(msg)
}

/** The user-facing reason a self-DM could not be opened. */
export function selfDirectFailureMessage(err: unknown): string {
    if (selfDirectRefused(err)) return 'Notes to self need a newer server'
    return err instanceof Error ? err.message : 'Could not open your notes'
}

/** Your self-DM: a direct space whose only participant is you (2026-09-08). */
export function isSelfDirect(space: spaces.Space, selfId: string): boolean {
    return space.kind === 'direct' && (space.participants ?? []).length === 1 && space.participants![0] === selfId
}

/** The member on the other side of a DM; undefined on shared spaces AND on your self-DM. */
export function otherParticipant(space: spaces.Space, selfId: string): string | undefined {
    if (space.kind !== 'direct') return undefined
    return (space.participants ?? []).find((id) => id !== selfId)
}

/** The face a DM row wears: the other person, or you in your self-DM. */
export function directAvatarId(space: spaces.Space, selfId: string): string {
    return otherParticipant(space, selfId) ?? selfId
}

/** A DM's label from a roster: the other person's display name (their id until the roster lands), or "<you> (you)". */
export function directLabel(space: spaces.Space, members: readonly spaces.Member[], selfId: string): string {
    if (isSelfDirect(space, selfId)) {
        const me = members.find((m) => m.id === selfId)
        return me ? `${me.displayName} (you)` : SELF_DIRECT_LABEL
    }
    const other = otherParticipant(space, selfId)
    if (!other) return 'Direct message'
    return members.find((m) => m.id === other)?.displayName ?? other
}

/** What to call a space wherever it is named: its name, or for a DM the other person (from the orgs store). */
export function spaceDisplayName(org: Pick<OrgWithSpaces, 'directLabels'>, space: spaces.Space): string {
    return space.kind === 'direct' ? (org.directLabels[space.id] ?? 'Direct message') : space.name
}

/**
 * A member's name as the stream and sidebar show it: a deleted account keeps
 * its name, marked, so what it wrote still reads as theirs (2026-10-13,
 * Harbor's `Member.deactivatedAt`); so does someone an admin removed from the
 * org (2026-10-19, `Member.removedAt`).
 */
export function memberLabel(member: Pick<spaces.Member, 'displayName' | 'deactivatedAt' | 'removedAt'>): string {
    if (member.deactivatedAt) return `${member.displayName} (deactivated)`
    if (member.removedAt) return `${member.displayName} (removed)`
    return member.displayName
}

/** No longer on the server — a deleted account, or a row the one-server migration folded away (2026-11-09). Pickers leave them out. */
export function isDeparted(member: Pick<spaces.Member, 'deactivatedAt' | 'removedAt'>): boolean {
    return !!member.deactivatedAt || !!member.removedAt
}

/** An agent this person owns (Harbor spec §4 Agent members): the only agents they may DM or add to a space (2026-11-09). */
export function isOwnAgent(member: Pick<spaces.Member, 'kind' | 'ownerId'>, selfMemberId: string | undefined): boolean {
    return member.kind === 'agent' && member.ownerId !== undefined && member.ownerId === selfMemberId
}

/**
 * May this person open a DM with the member (Harbor spec §4, the reach rule,
 * 2026-11-09)? A person: yes, when they are a contact (the server checks the
 * shared space). An agent: its owner only. Pickers offer exactly these.
 */
export function canMessageDirect(member: Pick<spaces.Member, 'kind' | 'ownerId'>, selfMemberId: string | undefined): boolean {
    return member.kind !== 'agent' || isOwnAgent(member, selfMemberId)
}

/**
 * An agent whose seat in this space is its owner's alone (Harbor spec §4
 * Agent members, 2026-11-09: `Membership.invocableBy`), seen by someone else:
 * a mention of it is refused, so the composer's hints and the follow-up rule
 * say so. Everyone still sees it and its replies.
 */
export function answersOwnerOnly(member: Pick<spaces.Member, 'kind' | 'ownerId'> & { invocableBy?: 'owner' | 'members' }, selfMemberId: string | undefined): boolean {
    return member.kind === 'agent' && member.invocableBy === 'owner' && member.ownerId !== selfMemberId
}
