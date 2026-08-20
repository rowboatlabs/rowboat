import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import {
    buildFileTree,
    decorateMentions,
    encodeMentions,
    formatFeedTime,
    initials,
    isUnreadChange,
    orgMonogram,
    resolveMentions,
} from './spaces-presentation'

function cs(over: Partial<spaces.ChangeSet> & { id: string; committedAt: string }): spaces.ChangeSet {
    return {
        spaceId: 's1',
        assetPath: 'roadmap.md',
        baseVersion: 1,
        resultVersion: 2,
        attribution: { memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' },
        offset: 1,
        ...over,
    }
}

describe('initials / monograms', () => {
    it('derives two-letter initials', () => {
        expect(initials('Ramnique Sharma')).toBe('RS')
        expect(initials('arjun')).toBe('AR')
        expect(initials('')).toBe('?')
    })
    it('derives an org monogram from the address, falling back to the name', () => {
        expect(orgMonogram({ name: 'Rowboat Labs', address: 'rowboat.team' })).toBe('RT')
        expect(orgMonogram({ name: 'Rowboat Labs (dev)', address: 'localhost:4272' })).toBe('RL')
    })
})

describe('formatFeedTime', () => {
    const now = new Date('2026-08-19T15:00:00')
    it('shows clock time today, Yesterday for yesterday, a date otherwise', () => {
        expect(formatFeedTime('2026-08-19T09:04:00', now)).toBe('09:04')
        expect(formatFeedTime('2026-08-18T17:20:00', now)).toBe('Yesterday 17:20')
        expect(formatFeedTime('2026-08-12T10:00:00', now)).toMatch(/Aug/)
    })
})

describe('buildFileTree', () => {
    it('nests folders, README first, files before folders', () => {
        const tree = buildFileTree([
            { path: 'decisions/sso.md', version: 1, updatedAt: '' },
            { path: 'roadmap.md', version: 1, updatedAt: '' },
            { path: 'README.md', version: 1, updatedAt: '' },
            { path: 'decisions/migration.md', version: 1, updatedAt: '' },
            { path: 'briefs/onboarding.md', version: 1, updatedAt: '' },
        ])
        expect(tree.map((n) => n.name)).toEqual(['README.md', 'roadmap.md', 'briefs', 'decisions'])
        expect(tree[3]!.children.map((n) => n.name)).toEqual(['migration.md', 'sso.md'])
        expect(tree[3]!.children[0]!.path).toBe('decisions/migration.md')
    })
})

describe('mentions — compose names, wire ids', () => {
    const members = [
        { id: '01HXAMPLEULIDRAMNIQUE0000', displayName: 'Ramnique Singh' },
        { id: '01HXAMPLEULIDRAM00000000', displayName: 'Ramnique' },
        { id: '01HXAMPLEULIDHARSH000000', displayName: 'Harsh' },
    ]

    it('encodes display names to member-id addresses, longest name first', () => {
        expect(encodeMentions('@Ramnique Singh can you look?', members))
            .toBe('@01HXAMPLEULIDRAMNIQUE0000 can you look?')
        expect(encodeMentions('ping @Ramnique too', members))
            .toBe('ping @01HXAMPLEULIDRAM00000000 too')
    })

    it('matches case-insensitively, at boundaries, with trailing punctuation', () => {
        expect(encodeMentions('(@harsh)?', members)).toBe('(@01HXAMPLEULIDHARSH000000)?')
        expect(encodeMentions('email@Harsh.dev stays', members)).toBe('email@Harsh.dev stays')
    })

    it('leaves code regions, @rowboat, and unknown names alone', () => {
        expect(encodeMentions('`@Harsh` in code, @Harsh outside', members))
            .toBe('`@Harsh` in code, @01HXAMPLEULIDHARSH000000 outside')
        expect(encodeMentions('@rowboat summarise; @Nobody there', members))
            .toBe('@rowboat summarise; @Nobody there')
    })

    it('never lets a member named rowboat capture the agent address', () => {
        expect(encodeMentions('@rowboat go', [{ id: '01HIMPOSTOR', displayName: 'rowboat' }])).toBe('@rowboat go')
    })

    it('round-trips: encoded wire body decorates back to the name', () => {
        const names = new Map(members.map((m) => [m.id, m.displayName]))
        expect(decorateMentions(encodeMentions('hey @Ramnique Singh', members), names))
            .toBe('hey **@Ramnique Singh**')
    })

    it('resolveMentions renders names without markup — for titles, crumbs, reasons', () => {
        const names = new Map(members.map((m) => [m.id, m.displayName]))
        expect(resolveMentions('ask @01HXAMPLEULIDHARSH000000 about it', names))
            .toBe('ask @Harsh about it')
        expect(resolveMentions('`@01HXAMPLEULIDHARSH000000` in code, @unknown alone', names))
            .toBe('`@01HXAMPLEULIDHARSH000000` in code, @unknown alone')
        expect(resolveMentions('@rowboat plan this', names)).toBe('@rowboat plan this')
    })
})

describe('unread changes', () => {
    it('marks a change unread when it landed after the mark and was not my own direct edit', () => {
        const theirs = cs({ id: 'c2', committedAt: '2026-08-19T18:04:00Z' })
        const mine = cs({ id: 'self', committedAt: '2026-08-19T17:00:00Z', attribution: { memberId: 'me', actingMode: 'direct' } })
        const myAgent = cs({ id: 'agent', committedAt: '2026-08-19T17:30:00Z', attribution: { memberId: 'me', actingMode: 'agent', agentName: 'Rowboat' } })
        expect(isUnreadChange(theirs, '2026-08-18T17:20:00Z', 'me')).toBe(true)
        expect(isUnreadChange(theirs, '2026-08-19T18:04:00Z', 'me')).toBe(false)
        expect(isUnreadChange(mine, null, 'me')).toBe(false)
        expect(isUnreadChange(myAgent, null, 'me')).toBe(true)
    })
})
