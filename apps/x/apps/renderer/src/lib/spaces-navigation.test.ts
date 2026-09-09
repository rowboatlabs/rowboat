import { describe, expect, it } from 'vitest'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { resolveSpacesLocation } from './spaces-navigation'

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
