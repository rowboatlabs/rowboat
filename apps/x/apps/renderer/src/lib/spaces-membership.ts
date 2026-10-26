import type { spaces } from '@x/shared'

// The words of a join or leave line in the stream (2026-09-29): who acted,
// and how, from the membership event alone.

function nameOf(id: string, names: ReadonlyMap<string, string>): string {
    // Someone who left may be off every roster this member can see.
    return names.get(id) ?? 'A former member'
}

/** "Ramnique added Replicas", "Harsh joined", "Harsh left". */
export function membershipLineText(event: spaces.MembershipEvent, names: ReadonlyMap<string, string>): string {
    const who = nameOf(event.membership.memberId, names)
    const by = event.by && event.by.memberId !== event.membership.memberId ? event.by : undefined
    const actor = by ? `${nameOf(by.memberId, names)}${by.actingMode !== 'direct' ? ` (via ${by.agentName ?? 'agent'})` : ''}` : undefined
    switch (event.action) {
        case 'joined':
            return actor ? `${actor} added ${who}` : `${who} joined`
        case 'left':
            return `${who} left`
        case 'removed':
            return actor ? `${actor} removed ${who}` : `${who} was removed`
    }
}
