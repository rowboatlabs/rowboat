import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import { composerExtensions } from './composer-editor'
import { useMentionAutocomplete } from './mention-autocomplete'
import { SpaceRefsProvider } from './space-markdown'

// Personal agents (Harbor spec §4 Agent members, 2026-10-26): only the owner
// can mention one, so the @ picker offers yours and leaves out everyone
// else's, whether it is in this space or not. Its own file: the roster stores
// are module-level, and the main picker test pins an exact roster.

const HERE = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const refs = { orgId: 'org', spaceId: HERE, orgAddress: 'spaces.example.com' }

const { listing } = vi.hoisted(() => ({
    listing: {
        id: 'org', name: 'Org', address: 'spaces.example.com', baseUrl: 'https://spaces.example.com', memberId: 'me', authKind: 'dev',
        spaces: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'General', createdAt: '', kind: 'shared' }],
        directs: [],
        directLabels: {},
    },
}))
vi.mock('@/hooks/use-spaces', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/hooks/use-spaces')>()),
    useSpacesOrgs: () => ({ orgs: [listing], loading: false, refresh: async () => {} }),
}))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))

const agent = (id: string, displayName: string, ownerId: string, personal?: boolean) =>
    ({ id, displayName, role: 'member', kind: 'agent', agentKind: 'claude-code', agentConnection: 'contract', ownerId, ...(personal ? { personal } : {}) })
const here = [
    { id: 'me', displayName: 'Gagan', role: 'member', kind: 'human' },
    { id: 'harsh', displayName: 'Harsh', role: 'member', kind: 'human' },
    agent('mine', "Gagan's Claude Code", 'me', true),
    agent('theirs', "Harsh's Claude Code", 'harsh', true),
    agent('shared', 'Claude Scout', 'harsh'),
]
const org = [...here, agent('elsewhere', "Ada's Claude Code", 'ada', true)]
const invoke = vi.fn(async (channel: string) => {
    if (channel === 'spaces:listMembers') return { members: here }
    if (channel === 'spaces:listOrgMembers') return { members: org }
    if (channel === 'spaces:listAssets') return { entries: [] }
    throw new Error(`unexpected ${channel}`)
})

let editor: Editor
beforeEach(() => {
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    editor = new Editor({ element: document.createElement('div'), extensions: composerExtensions(() => '') })
})
afterEach(() => editor.destroy())

const wrapper = ({ children }: { children: ReactNode }) => <SpaceRefsProvider refs={refs}>{children}</SpaceRefsProvider>

describe('personal agents in the @ picker', () => {
    it('offers your personal agent, marked, and leaves out everyone else’s', async () => {
        const { result } = renderHook(() => useMentionAutocomplete(editor), { wrapper })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:listOrgMembers', expect.anything()))
        act(() => {
            editor.chain().focus('end').insertContent('ask @claude').run()
        })
        await waitFor(() => expect(result.current.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(['mine', 'shared'])))
        const ids = result.current.candidates.map((c) => c.id)
        expect(ids).not.toContain('theirs')
        expect(ids).not.toContain('elsewhere')
        expect(result.current.candidates.find((c) => c.id === 'mine')?.hint).toBe('Claude Code · personal')
    })
})
