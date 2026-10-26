import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import { membershipLineText } from './spaces-membership'

const names = new Map([['ram', 'Ramnique'], ['harsh', 'Harsh'], ['repl', 'Replicas']])
const event = (action: spaces.MembershipEvent['action'], memberId: string, by?: spaces.MembershipEvent['by']): spaces.MembershipEvent => ({
    type: 'membership',
    action,
    membership: { spaceId: 'S', memberId, joinedAt: '2026-09-29T00:00:00Z' },
    ...(by ? { by } : {}),
})

// Join and leave lines (2026-09-29): who acted, and how, from the event alone.
describe('membershipLineText', () => {
    it('says who added whom, and that an agent did it', () => {
        expect(membershipLineText(event('joined', 'repl', { memberId: 'ram', actingMode: 'direct' }), names)).toBe('Ramnique added Replicas')
        expect(membershipLineText(event('joined', 'harsh', { memberId: 'ram', actingMode: 'agent', agentName: 'Rowboat' }), names)).toBe('Ramnique (via Rowboat) added Harsh')
    })

    it('says a member joined or left on their own', () => {
        expect(membershipLineText(event('joined', 'harsh'), names)).toBe('Harsh joined')
        expect(membershipLineText(event('left', 'harsh'), names)).toBe('Harsh left')
    })

    it('names a removal by its remover, and someone off every roster honestly', () => {
        expect(membershipLineText(event('removed', 'harsh', { memberId: 'ram', actingMode: 'direct' }), names)).toBe('Ramnique removed Harsh')
        expect(membershipLineText(event('left', 'gone'), names)).toBe('A former member left')
    })
})
