import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { loadSpaceConnections } from '@/hooks/use-space-connections'
import { AgentMark, MemberAvatar, MemberProfilePopover } from './atoms'
import { composerExtensions } from './composer-editor'
import { MemberDirectory } from './member-directory'
import { SpaceProfilesProvider } from './member-text'
import { useMentionAutocomplete } from './mention-autocomplete'
import { SpaceNavContext, SpaceRefsProvider } from './space-nav'
import { SpaceSettings } from './space-settings'

// A space connection's member (harbor spec §8 Space connections, 2026-11-28)
// is an agent on the wire and nothing like one to a person: it posts what its
// app sends and takes no requests. These pin where it is left out (anything
// that picks someone to ask, message or add) and how it shows where it stays
// (its posts, the member list): its app's logo and the word "Connection".
// Its own file: the roster stores are module-level, as the picker tests note.

const SPACE = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const refs = { orgId: 'org', spaceId: SPACE, orgAddress: 'spaces.example.com' }
const space = { id: SPACE, name: 'eng', createdAt: '', kind: 'shared', visibility: 'private', isDefault: false, archived: false } as spaces.Space

const { listing } = vi.hoisted(() => ({
    listing: {
        id: 'org', name: 'Org', address: 'spaces.example.com', baseUrl: 'https://spaces.example.com', memberId: 'me', authKind: 'dev',
        spaces: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'eng', createdAt: '', kind: 'shared' }],
        directs: [],
        directLabels: {},
    },
}))
vi.mock('@/hooks/use-spaces', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/hooks/use-spaces')>()),
    useSpacesOrgs: () => ({ orgs: [listing], loading: false, refresh: async () => {} }),
}))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const me = { id: 'me', displayName: 'Arjun', role: 'admin', kind: 'human' } as spaces.Member
const scout = { id: 'scout', displayName: 'Linear Scout', role: 'member', kind: 'agent', agentKind: 'claude-code', agentConnection: 'replicas', ownerId: 'me' } as spaces.Member
// Owned by whoever connected it, as Harbor makes it: ownership must not pull it into "your agents".
const linear = { id: 'conn-linear', displayName: 'Linear – Eng', role: 'member', kind: 'agent', agentKind: 'connection', agentConnection: 'composio', ownerId: 'me' } as spaces.Member
const members = [me, scout, linear]
const LINEAR_APP = { slug: 'linear', name: 'Linear', logo: 'https://logos.test/linear.svg' }
const connection = {
    id: 'C1', spaceId: SPACE, memberId: linear.id, app: LINEAR_APP, name: linear.displayName, status: 'active', triggers: [], filter: true, paused: false,
    createdBy: 'me', createdAt: '2026-11-28T00:00:00.000Z', posted: 0, skipped: 0,
} as spaces.SpaceConnection

const invoke = vi.fn(async (channel: string) => {
    switch (channel) {
        case 'spaces:listMembers': return { members }
        case 'spaces:listOrgMembers': return { members }
        case 'spaces:listAssets': return { entries: [] }
        case 'spaces:listSpaceConnections': return { connections: [connection], available: true, filterAvailable: true }
    }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})
afterEach(cleanup)

const inSpace = (children: ReactNode, orgId = refs.orgId) => render(
    <SpaceRefsProvider refs={{ ...refs, orgId }}>
        <SpaceNavContext.Provider value={{ onOpenFile: vi.fn(), onOpenDirect: vi.fn() }}>
            <SpaceProfilesProvider members={members} here={new Set([linear.id, scout.id])} selfId="me">{children}</SpaceProfilesProvider>
        </SpaceNavContext.Provider>
    </SpaceRefsProvider>,
)

describe('a connection member where someone is picked', () => {
    it('is never offered by the @ picker, though an agent of the same name is', async () => {
        const editor = new Editor({ element: document.createElement('div'), extensions: composerExtensions(() => '') })
        const { result } = renderHook(() => useMentionAutocomplete(editor), { wrapper: ({ children }) => <SpaceRefsProvider refs={refs}>{children}</SpaceRefsProvider> })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:listOrgMembers', expect.anything()))
        act(() => { editor.chain().focus('end').insertContent('see @linear').run() })
        await waitFor(() => expect(result.current.candidates.map((c) => c.id)).toContain('scout'))
        expect(result.current.candidates.map((c) => c.id)).not.toContain(linear.id)
        editor.destroy()
    })

    it('is not among the agents in Space settings, which lists it under Connections instead', async () => {
        render(<SpaceSettings org={listing as unknown as OrgWithSpaces} space={space} members={members} onBack={vi.fn()} onShowSidebar={vi.fn()} />)
        const tabs = within(screen.getByRole('navigation', { name: 'Space settings sections' }))
        // The connection's member is not counted among the agents.
        fireEvent.click(tabs.getByRole('button', { name: /^Agents\s*1$/ }))
        expect(screen.getByText('Linear Scout')).toBeInTheDocument()
        expect(screen.queryByText('Linear – Eng')).not.toBeInTheDocument()

        fireEvent.click(tabs.getByRole('button', { name: /^Connections/ }))
        const row = await screen.findByRole('listitem', { name: 'Linear – Eng' })
        expect(within(row).getByText('Linear · Connected by Arjun')).toBeInTheDocument()
        // Once read, the tab carries the count as People and Agents do.
        expect(tabs.getByRole('button', { name: /^Connections\s*1$/ })).toBeInTheDocument()
    })
})

describe('a connection member where it shows', () => {
    it('draws a plug until the space’s connections are read, then its app’s logo, and is labelled Connection', async () => {
        // An org whose connections this session has not read: the store is kept per org for the session.
        inSpace(<><MemberAvatar id={linear.id} name={linear.displayName} /><AgentMark id={linear.id} /><MemberAvatar id={scout.id} name={scout.displayName} /></>, 'org-unread')
        const face = screen.getByTitle('Linear – Eng')
        expect(face).not.toHaveClass('rounded-full')
        expect(face.querySelector('img')).toBeNull()
        expect(screen.getByText('Connection')).toBeInTheDocument()
        // An agent beside it keeps its round face.
        expect(screen.getByTitle('Linear Scout')).toHaveClass('rounded-full')

        await act(async () => { await loadSpaceConnections('org-unread', SPACE) })
        expect(screen.getByTitle('Linear – Eng').querySelector('img')).toHaveAttribute('src', LINEAR_APP.logo)
    })

    it('has a tab of its own in the member list, with no presence and not counted among the agents', () => {
        inSpace(<MemberDirectory members={members} here={new Set([linear.id])} selfId="me" />)
        expect(screen.getByRole('tab', { name: 'Agents 1' })).toBeInTheDocument()
        const tab = screen.getByRole('tab', { name: 'Connections 1' })
        fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
        const row = within(screen.getByRole('tabpanel')).getByRole('button')
        expect(row).toHaveTextContent('Linear – Eng')
        expect(row).toHaveTextContent('Connection')
        expect(row).not.toHaveTextContent('here')
        expect(within(row).queryByRole('img', { name: /Online|Away/ })).toBeNull()
    })

    it('has no Connections tab in a space with none', () => {
        inSpace(<MemberDirectory members={[me, scout]} here={new Set()} selfId="me" />)
        expect(screen.queryByRole('tab', { name: /Connections/ })).not.toBeInTheDocument()
    })

    it('its profile says what it is, with nothing to message or mention and no presence', () => {
        inSpace(<>
            <MemberProfilePopover id={linear.id}><button>Open connection</button></MemberProfilePopover>
            <MemberProfilePopover id={scout.id}><button>Open agent</button></MemberProfilePopover>
        </>)
        fireEvent.click(screen.getByRole('button', { name: 'Open connection' }))
        const profile = within(screen.getByRole('dialog'))
        expect(profile.getByText('Connection')).toBeInTheDocument()
        expect(profile.getByText(/^Posts updates from .*It takes no requests\.$/)).toBeInTheDocument()
        expect(profile.queryByRole('button', { name: /Message/ })).not.toBeInTheDocument()
        expect(profile.queryByRole('button', { name: /Mention/ })).not.toBeInTheDocument()
        expect(profile.queryByText(/Here now|Away|Online/)).not.toBeInTheDocument()
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

        // An agent's profile keeps both.
        fireEvent.click(screen.getByRole('button', { name: 'Open agent' }))
        const agent = within(screen.getByRole('dialog'))
        expect(agent.getByRole('button', { name: /Message/ })).toBeInTheDocument()
        expect(agent.getByRole('button', { name: /Mention/ })).toBeInTheDocument()
        expect(agent.getByText('Here now')).toBeInTheDocument()
    })
})
