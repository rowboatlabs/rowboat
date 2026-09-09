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
export function selfDirectFailureMessage(orgName: string, err: unknown): string {
    if (selfDirectRefused(err)) return `Notes to self need a newer server — ${orgName} hasn't been updated yet`
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
