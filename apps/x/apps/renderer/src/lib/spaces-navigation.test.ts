import { describe, expect, it } from 'vitest'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { parseSpacesLink, resolveSpacesLocation } from './spaces-navigation'

const orgs = [
    { id: 'first', spaces: [{ id: 'main' }], directs: [] },
    { id: 'second', spaces: [{ id: 'founders' }, { id: 'design' }], directs: [{ id: 'dm' }] },
    { id: 'empty', spaces: [], directs: [] },
] as unknown as OrgWithSpaces[]

describe('returning to Spaces', () => {
    it.each(['design', 'dm'])('restores the saved location %s instead of the first server', (spaceId) => {
        expect(resolveSpacesLocation(orgs, { orgId: 'second', spaceId })).toEqual({ orgId: 'second', spaceId })
    })
    it('keeps the previous server when its saved space was removed', () => {
        expect(resolveSpacesLocation(orgs, { orgId: 'second', spaceId: 'removed' })).toEqual({ orgId: 'second', spaceId: 'founders' })
    })
    it.each([
        { kind: 'thread', rootMessageId: 'msg1' },
        { kind: 'file', assetId: '01HXAMPLEASSET0000000000A1', fromThreadRootId: 'msg1' },
        { kind: 'whiteboard', assetId: '01HXAMPLEASSET0000000000B2' },
        { kind: 'attachment', src: 'app://space-blob/second/design/abc?name=x.pdf', fromThreadRootId: 'msg1' },
    ] as const)('reopens what was open inside the space (%j)', (rail) => {
        expect(resolveSpacesLocation(orgs, { orgId: 'second', spaceId: 'design', rail }))
            .toEqual({ orgId: 'second', spaceId: 'design', rail })
    })
    // Files and boards were named by PATH before 2026-09-14; a stored rail
    // from then must land on the stream, never reach the org as a path.
    it.each([
        { kind: 'file', path: 'notes/plan.md', fromThreadRootId: 'msg1' },
        { kind: 'whiteboard', path: 'whiteboards/sketch.excalidraw' },
        { kind: 'attachment', path: 'app://space-blob/second/design/abc' },
        { kind: 'file' },
        { kind: 'bogus', assetId: 'x' },
        'file:notes/plan.md',
    ])('degrades a legacy or malformed rail to the stream (%j)', (rail) => {
        expect(resolveSpacesLocation(orgs, { orgId: 'second', spaceId: 'design', rail }))
            .toEqual({ orgId: 'second', spaceId: 'design' })
    })
    it('leaves the rail behind when the saved space is gone', () => {
        expect(resolveSpacesLocation(orgs, { orgId: 'second', spaceId: 'removed', rail: { kind: 'thread', rootMessageId: 'msg1' } }))
            .toEqual({ orgId: 'second', spaceId: 'founders' })
    })
    it('returns to the Activity surface instead of a space', () => {
        expect(resolveSpacesLocation(orgs, { orgId: 'second', spaceId: '', view: 'activity' }))
            .toEqual({ orgId: 'second', spaceId: '', view: 'activity' })
    })
    it('falls back to a space when the Activity surface names a server that is gone', () => {
        expect(resolveSpacesLocation(orgs, { orgId: 'removed', spaceId: '', view: 'activity' }))
            .toEqual({ orgId: 'first', spaceId: 'main' })
    })
    it.each([null, {}, 'invalid', { orgId: 'removed', spaceId: 'gone' }])('chooses an available server for invalid saved state %j', (saved) => {
        expect(resolveSpacesLocation(orgs, saved)).toEqual({ orgId: 'first', spaceId: 'main' })
    })
    it('keeps an empty selected server available for creating a space', () => {
        expect(resolveSpacesLocation(orgs, { orgId: 'empty', spaceId: '' })).toEqual({ orgId: 'empty', spaceId: '' })
    })
    it('returns no location before joining the first server', () => {
        expect(resolveSpacesLocation([], null)).toBeNull()
    })
})

describe('org link landings → app deep links', () => {
    it('reads the org address and whichever target the landing named', () => {
        expect(parseSpacesLink('rowboat://open?type=spaces&org=acme.rowboat.space')).toEqual({ orgAddress: 'acme.rowboat.space' })
        expect(parseSpacesLink('rowboat://open?type=spaces&spaceId=S1&org=acme.rowboat.space')).toEqual({ orgAddress: 'acme.rowboat.space', spaceId: 'S1' })
        expect(parseSpacesLink('rowboat://open?type=spaces&spaceId=S1&messageId=M1&org=acme.rowboat.space')).toEqual({ orgAddress: 'acme.rowboat.space', spaceId: 'S1', messageId: 'M1' })
        // The /join landing: an invite to join, not a place to go.
        expect(parseSpacesLink('rowboat://open?type=spaces&org=acme.rowboat.space&invite=t0k3n')).toEqual({ orgAddress: 'acme.rowboat.space', inviteToken: 't0k3n' })
        expect(parseSpacesLink('rowboat://open?type=spaces&spaceId=S1&assetId=A%2Fx&org=acme.rowboat.space')).toEqual({ orgAddress: 'acme.rowboat.space', spaceId: 'S1', assetId: 'A/x' })
        expect(parseSpacesLink('rowboat://open?type=spaces&memberId=google%7C1&org=acme.rowboat.space')).toEqual({ orgAddress: 'acme.rowboat.space', memberId: 'google|1' })
        // The trailing-slash authority form some OS handlers hand over.
        expect(parseSpacesLink('rowboat://open/?type=spaces&spaceId=S1&org=acme.rowboat.space')).toEqual({ orgAddress: 'acme.rowboat.space', spaceId: 'S1' })
    })

    it('leaves orgId links (notifications) and every other deep link to the plain parser', () => {
        expect(parseSpacesLink('rowboat://open?type=spaces&orgId=org&spaceId=S1')).toBeNull()
        expect(parseSpacesLink('rowboat://open?type=file&path=knowledge/a.md')).toBeNull()
        expect(parseSpacesLink('https://acme.rowboat.space/s/S1')).toBeNull()
    })
})
