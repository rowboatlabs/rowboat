import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import { composerExtensions } from './composer-editor'
import { useMentionAutocomplete } from './mention-autocomplete'
import { SpaceRefsProvider } from './space-markdown'

// An agent's seat (Harbor spec §4 Agent members, 2026-11-09): the @ picker
// offers every agent in the space — the server refuses a mention the seat
// does not allow, and the hint says so — and, beyond it, your own agents
// only (your contacts hold no one else's). Its own file: the roster stores
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

const agent = (id: string, displayName: string, ownerId: string, invocableBy?: 'owner' | 'members') =>
    ({ id, displayName, kind: 'agent', agentKind: 'claude-code', agentConnection: 'contract', ownerId, ...(invocableBy ? { invocableBy } : {}) })
const here = [
    { id: 'me', displayName: 'Gagan', kind: 'human', role: 'member', joinedAt: '' },
    { id: 'harsh', displayName: 'Harsh', kind: 'human', role: 'member', joinedAt: '' },
    agent('mine', "Gagan's Claude Code", 'me', 'owner'),
    agent('theirs', "Harsh's Claude Code", 'harsh', 'owner'),
    agent('shared', 'Claude Scout', 'harsh', 'members'),
]
const contacts = [here[0], here[1], here[2], agent('elsewhere', "Gagan's Codex", 'me')]
const invoke = vi.fn(async (channel: string) => {
    if (channel === 'spaces:listMembers') return { members: here }
    if (channel === 'spaces:listContacts') return { members: contacts }
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

describe('agent seats in the @ picker', () => {
    it('offers every agent here, saying which answer only their owner, and your own agents from outside', async () => {
        const { result } = renderHook(() => useMentionAutocomplete(editor), { wrapper })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:listContacts', expect.anything()))
        act(() => {
            editor.chain().focus('end').insertContent('ask @').run()
        })
        await waitFor(() => expect(result.current.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(['mine', 'theirs', 'shared', 'elsewhere'])))
        const hint = (id: string) => result.current.candidates.find((c) => c.id === id)?.hint
        expect(hint('mine')).toBe('Claude Code')
        expect(hint('theirs')).toBe('Claude Code · answers only its owner here')
        expect(hint('shared')).toBe('Claude Code')
        expect(hint('elsewhere')).toBe('Claude Code · not in this space')
    })
})
