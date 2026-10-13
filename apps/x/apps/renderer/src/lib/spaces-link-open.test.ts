import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Where a spaces link opens (2026-10-13): the one resolution the desktop's
// deep links and the web app's /open share.

const org = { id: 'org-1', address: 'acme.spaces.test', baseUrl: 'https://acme.spaces.test', spaces: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }] }
vi.mock('@/hooks/use-spaces', () => ({
    getSpacesOrgs: () => [org],
    refreshSpacesOrgs: vi.fn(async () => {}),
    findSpace: (o: typeof org, spaceId: string) => o.spaces.find((s) => s.id === spaceId),
}))
vi.mock('@/hooks/use-space-directory', () => ({
    loadSpaceDirectory: vi.fn(async () => {}),
    getDirectorySpace: () => undefined,
}))

const { resolveSpacesLink } = await import('./spaces-link-open')
const SPACE = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const invoke = vi.fn()

describe('resolving a spaces link', () => {
    beforeEach(() => {
        window.ipc = { invoke, send: vi.fn(), on: vi.fn() } as unknown as typeof window.ipc
    })
    afterEach(() => invoke.mockReset())

    it('hands an invite to the join dialog as the https link', async () => {
        expect(await resolveSpacesLink({ orgAddress: 'acme.spaces.test', inviteToken: 'tok' }))
            .toEqual({ kind: 'invite', inviteUrl: 'https://acme.spaces.test/join/tok' })
        expect(await resolveSpacesLink({ orgAddress: 'other.example', inviteToken: 'tok' }))
            .toEqual({ kind: 'invite', inviteUrl: 'https://other.example/join/tok' })
    })

    it('names an org this person is not in', async () => {
        expect(await resolveSpacesLink({ orgAddress: 'other.example', spaceId: SPACE })).toEqual({ kind: 'unknown-org', orgAddress: 'other.example' })
    })

    it('lands a reply in its thread, at its offset', async () => {
        invoke.mockResolvedValueOnce({ message: { threadRoot: '01ARZ3NDEKTSV4RRFFQ69G5FAW', offset: 42 } })
        expect(await resolveSpacesLink({ orgAddress: 'acme.spaces.test', spaceId: SPACE, messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' })).toEqual({
            kind: 'place',
            place: { orgId: 'org-1', spaceId: SPACE, rail: { kind: 'thread', rootMessageId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' }, messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', messageOffset: 42 },
        })
    })

    it('opens a person as the DM with them', async () => {
        invoke.mockResolvedValueOnce({ space: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAY' } })
        expect(await resolveSpacesLink({ orgAddress: 'acme.spaces.test', memberId: 'm-1' }))
            .toEqual({ kind: 'place', place: { orgId: 'org-1', spaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAY', rail: { kind: 'general' } } })
        expect(invoke).toHaveBeenCalledWith('spaces:openDirect', { orgId: 'org-1', memberId: 'm-1' })
    })

    it('refuses a space it cannot see, landing on Activity instead', async () => {
        expect(await resolveSpacesLink({ orgAddress: 'acme.spaces.test', spaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ' })).toEqual({
            kind: 'refused',
            message: 'This space is unavailable or you do not have access',
            place: { orgId: 'org-1', view: 'activity' },
        })
    })

    it('says what failed when the org refuses, and lands nowhere', async () => {
        invoke.mockRejectedValueOnce(new Error('message not found'))
        expect(await resolveSpacesLink({ orgAddress: 'acme.spaces.test', spaceId: SPACE, messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' }))
            .toEqual({ kind: 'refused', message: 'message not found' })
    })
})
