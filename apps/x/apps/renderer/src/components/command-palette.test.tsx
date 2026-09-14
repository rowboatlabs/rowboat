import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './command-palette'

// jsdom lacks what Radix Dialog and cmdk poke at.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
;(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
Element.prototype.scrollIntoView = () => {}

const { org, topics, visits, invoke } = vi.hoisted(() => {
    const org = {
        id: 'org', name: 'Acme', memberId: 'me', address: 'acme', baseUrl: 'http://acme', authKind: 'dev',
        spaces: [{ id: 'design', name: 'design', kind: 'shared', createdAt: '2026-09-01T00:00:00Z' }, { id: 'main', name: 'Main', kind: 'shared', createdAt: '2026-09-01T00:00:00Z' }],
        directs: [{ id: 'dm1', name: 'dm', kind: 'direct', createdAt: '2026-09-02T00:00:00Z', participants: ['me', 'pat'] }],
        directLabels: { dm1: 'Pat Lee' },
    }
    const topics: Record<string, unknown[]> = {
        design: [{ id: 't1', rootMessageId: 'r1', title: 'Design review cadence', lastActivityAt: '2026-09-10T00:00:00Z', archived: false }],
        main: [{ id: 't2', rootMessageId: 'r2', title: 'Main street mural', lastActivityAt: '2026-09-09T00:00:00Z', archived: false }, { id: 't3', rootMessageId: 'r3', title: 'Archived thing', lastActivityAt: '2026-09-01T00:00:00Z', archived: true }],
        dm1: [],
    }
    // When this install last opened each space (the visit log): Main most
    // recently, then Pat's DM; design never.
    const visits: Record<string, number> = { main: Date.UTC(2026, 8, 11), dm1: Date.UTC(2026, 8, 10) }
    const invoke = vi.fn(async (channel: string, args: unknown) => {
        if (channel === 'codeMode:getConfig') return { enabled: true }
        if (channel === 'search:query') {
            const { types } = args as { types: string[] }
            return {
                results: [
                    ...(types.includes('knowledge') ? [{ type: 'knowledge', title: 'Roadmap sync notes', preview: 'Decisions from the sync', path: 'knowledge/meetings-2026.md' }] : []),
                    ...(types.includes('chat') ? [
                        { type: 'chat', title: 'Roadmap chat', preview: 'we said so', path: 'chat-1' },
                        { type: 'chat', title: 'Fix the login bug', preview: 'the roadmap for auth', path: 'code-1' },
                    ] : []),
                ],
            }
        }
        if (channel === 'spaces:search') {
            const { spaceId } = args as { spaceId: string }
            if (spaceId !== 'design') return { messages: [], topics: [], assets: [], truncated: { messages: false, topics: false, assets: false } }
            return {
                messages: [{ messageId: 'm1', threadRootId: 'r1', topicTitle: 'Design review cadence', author: { memberId: 'pat' }, snippet: 'the roadmap is ready', postedAt: '2026-09-10T10:00:00Z', offset: 3 }],
                topics: [],
                assets: [{ path: 'docs/roadmap.md', version: 1, updatedAt: '2026-09-09T00:00:00Z', snippet: 'roadmap draft' }],
                truncated: { messages: false, topics: false, assets: false },
            }
        }
        throw new Error(`unexpected ipc ${channel}`)
    })
    return { org, topics, visits, invoke }
})

vi.mock('@/hooks/use-spaces', () => ({
    useSpacesOrgs: () => ({ orgs: [org], loading: false, refresh: vi.fn() }),
    useSpaceFeeds: () => (_orgId: string, spaceId: string) => ({ topics: topics[spaceId] ?? [], changeSets: [], loaded: true }),
}))
// The org roster (the assistant's @ menu reads the same): Sam has no DM yet.
vi.mock('@/hooks/use-space-members', () => ({
    useOrgRosters: () => new Map([['org', [{ id: 'me', displayName: 'Me' }, { id: 'pat', displayName: 'Pat Lee' }, { id: 'sam', displayName: 'Sam Rivera' }]]]),
}))
vi.mock('@/lib/spaces-visits', () => ({
    spaceVisitedAt: (_orgId: string, spaceId: string) => visits[spaceId] ?? null,
    useSpaceVisitsVersion: () => 0,
}))
vi.mock('@/components/code/use-code-sessions', () => ({
    useCodeSessions: () => ({
        sessions: [{ id: 'code-1', projectId: 'p1', title: 'Fix the login bug', createdAt: '2026-09-08T00:00:00Z', lastActivityAt: '2026-09-11T00:00:00Z' }],
        projects: [{ project: { id: 'p1', name: 'rowboat' }, git: { root: null, subpath: null } }],
        statuses: {}, statusOf: () => 'idle', loaded: true, refresh: vi.fn(),
    }),
    projectLabel: (row: { project: { name: string } }) => row.project.name,
}))
vi.mock('@/lib/feature-flags', () => ({ SPACES_ENABLED: true }))
vi.mock('@/lib/analytics', () => ({ searchOpened: vi.fn(), searchExecuted: vi.fn(), searchResultSelected: vi.fn() }))
vi.mock('posthog-js', () => ({ default: { people: { set_once: vi.fn() } } }))

// A code-mode chat is a chat session too: it arrives in the chat list under
// the same id the code-session store knows it by.
const chats = [
    { id: 'chat-1', title: 'Roadmap chat', modifiedAt: '2026-09-11T00:00:00Z' },
    { id: 'code-1', title: 'Fix the login bug', modifiedAt: '2026-09-11T00:00:00Z' },
    { id: 'chat-2', title: 'Grocery list', modifiedAt: '2026-09-10T00:00:00Z' },
]
const notes = [
    { path: 'knowledge/roadmap.md', title: 'Roadmap 2026', modifiedAt: '2026-09-11T00:00:00Z' },
    { path: 'knowledge/ideas.md', title: 'Ideas', modifiedAt: '2026-09-08T00:00:00Z' },
]

beforeEach(() => {
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {}, send: () => undefined }
    invoke.mockClear()
})
afterEach(cleanup)

function open(props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
    const onNavigate = vi.fn()
    const onOpenChange = vi.fn()
    render(<CommandPalette open onOpenChange={onOpenChange} chats={chats} notes={notes} onNavigate={onNavigate} {...props} />)
    return { onNavigate, onOpenChange, input: screen.getByRole('combobox') as HTMLInputElement }
}

const optionTitles = () => screen.getAllByRole('option').map((o) => o.querySelector('span')?.textContent)
const groupTitles = (heading: string) =>
    within(screen.getByText(heading, { selector: '[cmdk-group-heading]' }).closest('[cmdk-group]') as HTMLElement)
        .getAllByRole('option').map((o) => o.querySelector('span')?.textContent)

describe('CommandPalette', () => {
    it('opens on the sections, the spaces you keep opening, and recent chats', async () => {
        open()
        const goTo = await screen.findByText('Go to')
        const group = goTo.closest('[cmdk-group]')!
        const labels = within(group as HTMLElement).getAllByRole('option').map((o) => o.textContent?.replace(/⌘\d|Ctrl\+\d/g, '').trim())
        expect(labels.slice(0, 6)).toEqual(['Todo', 'Spaces', 'Email', 'Code', 'Meetings', 'Brain'])
        expect(labels).toContain('Settings')
        // Visited spaces and DMs, most recent first; never-opened ones stay out.
        expect(groupTitles('Recent spaces')).toEqual(['Main', 'Pat Lee'])
        expect(groupTitles('Recent chats')).toEqual(['Roadmap chat', 'Grocery list'])
        expect(screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(['Spaces', 'Chats', 'Brain', 'Code'])
        // Nothing is searched until something is typed.
        expect(invoke).not.toHaveBeenCalledWith('search:query', expect.anything())
    })

    it('closes and goes to the section when a Go to row is clicked', () => {
        const { onNavigate, onOpenChange } = open()
        fireEvent.click(screen.getByText('Email'))
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(onNavigate).toHaveBeenCalledWith({ kind: 'section', section: 'email' })
    })

    it('keeps code-mode chats out of Chats and lists them under Code', async () => {
        const { input, onNavigate } = open()
        // Once code mode is known (the flag is read over IPC), the recent
        // list and the Chats scope skip the code-mode chat.
        await screen.findByRole('button', { name: 'Code' })
        expect(screen.queryByText('Fix the login bug')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Chats' }))
        expect(optionTitles()).toEqual(['Roadmap chat', 'Grocery list'])
        // The Code scope lists it with its project, and opens it in Code.
        fireEvent.click(screen.getByRole('button', { name: 'Code' }))
        expect(screen.getByText('Recent code chats')).toBeInTheDocument()
        expect(optionTitles()).toEqual(['Fix the login bug'])
        expect(screen.getByText('rowboat')).toBeInTheDocument()
        fireEvent.click(screen.getByText('Fix the login bug'))
        expect(onNavigate).toHaveBeenCalledWith({ kind: 'code-session', sessionId: 'code-1' })
        // Typed in All, it ranks as a code chat, not a chat.
        fireEvent.click(screen.getByRole('button', { name: 'All' }))
        fireEvent.change(input, { target: { value: 'login' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Fix the login bug']))
        expect(screen.queryByText('Chat')).toBeNull()
    })

    it('sends a code-mode transcript hit to Code and never to Chats', async () => {
        const { input } = open()
        fireEvent.click(screen.getByRole('button', { name: 'Chats' }))
        fireEvent.change(input, { target: { value: 'roadmap' } })
        expect(await screen.findByText('Roadmap chat')).toBeInTheDocument()
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('search:query', expect.objectContaining({ types: ['chat'] })))
        expect(screen.queryByText('In code chats')).toBeNull()
        expect(screen.queryByText('Fix the login bug')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Code' }))
        expect(await screen.findByText('In code chats')).toBeInTheDocument()
        expect(screen.getByText('Fix the login bug')).toBeInTheDocument()
        expect(screen.queryByText('In chats')).toBeNull()
    })

    it('ranks a space first for its name and Enter opens it', async () => {
        const { input, onNavigate, onOpenChange } = open()
        fireEvent.change(input, { target: { value: 'des' } })
        await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('design'))
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onNavigate).toHaveBeenCalledWith({ kind: 'space', orgId: 'org', spaceId: 'design' })
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('finds a space with or without a leading #, and a person with @', async () => {
        const { input, onNavigate } = open()
        fireEvent.change(input, { target: { value: 'Main' } })
        await waitFor(() => expect(optionTitles()[0]).toBe('Main'))
        expect(optionTitles()).toContain('Main street mural')
        // The # narrows to spaces alone, whatever the scope.
        fireEvent.click(screen.getByRole('button', { name: 'Chats' }))
        fireEvent.change(input, { target: { value: '#Main' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Main']))
        expect(screen.getByText('Spaces', { selector: '[cmdk-group-heading]' })).toBeInTheDocument()
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onNavigate).toHaveBeenCalledWith({ kind: 'space', orgId: 'org', spaceId: 'main' })
        // A bare # lists every space, the ones you keep opening first.
        fireEvent.change(input, { target: { value: '#' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Main', 'design']))
        fireEvent.change(input, { target: { value: '#zzz' } })
        expect(await screen.findByText('No space matches "zzz".')).toBeInTheDocument()
    })

    it('reaches anyone on the roster with @, starting the DM for those without one', async () => {
        const { input, onNavigate } = open()
        fireEvent.change(input, { target: { value: '@' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Pat Lee', 'Sam Rivera']))
        expect(screen.getByText('People')).toBeInTheDocument()
        expect(screen.getByText('Direct message')).toBeInTheDocument()
        expect(screen.getByText('Person')).toBeInTheDocument()
        fireEvent.change(input, { target: { value: '@sa' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Sam Rivera']))
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onNavigate).toHaveBeenCalledWith({ kind: 'person', orgId: 'org', memberId: 'sam' })
        // Someone with a DM already opens that DM; you are not listed.
        fireEvent.change(input, { target: { value: '@pat' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Pat Lee']))
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onNavigate).toHaveBeenLastCalledWith({ kind: 'space', orgId: 'org', spaceId: 'dm1' })
        fireEvent.change(input, { target: { value: '@me' } })
        expect(await screen.findByText('No person matches "me".')).toBeInTheDocument()
    })

    it('lists sections, people, discussions, and notes among the navigation rows', async () => {
        const { input } = open()
        fireEvent.change(input, { target: { value: 'pat' } })
        expect(await screen.findByText('Pat Lee')).toBeInTheDocument()
        fireEvent.change(input, { target: { value: 'cadence' } })
        expect(await screen.findByText('Design review cadence')).toBeInTheDocument()
        expect(screen.queryByText('Archived thing')).toBeNull()
        fireEvent.change(input, { target: { value: 'ideas' } })
        expect(await screen.findByText('Ideas')).toBeInTheDocument()
        expect(screen.getByText('Note')).toBeInTheDocument()
        fireEvent.change(input, { target: { value: 'settings' } })
        expect(await screen.findByText('Settings')).toBeInTheDocument()
    })

    it('searches spaces, Brain, and chats after the debounce and lands on a message', async () => {
        const { input, onNavigate } = open()
        fireEvent.change(input, { target: { value: 'roadmap' } })
        // The chat and the note named "Roadmap …" are navigation rows at
        // once; a transcript hit for the same chat is not listed twice.
        expect(await screen.findByText('Roadmap chat')).toBeInTheDocument()
        expect(screen.getByText('Roadmap 2026')).toBeInTheDocument()
        expect(await screen.findByText('Messages')).toBeInTheDocument()
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:search', expect.objectContaining({ spaceId: 'design', q: 'roadmap' })))
        expect(invoke).toHaveBeenCalledWith('spaces:search', expect.objectContaining({ spaceId: 'dm1' }))
        expect(invoke).toHaveBeenCalledWith('search:query', expect.objectContaining({ types: ['knowledge'] }))
        expect(invoke).toHaveBeenCalledWith('search:query', expect.objectContaining({ types: ['chat'] }))
        expect(await screen.findByText('Roadmap sync notes')).toBeInTheDocument()
        expect(screen.getByText('In notes')).toBeInTheDocument()
        expect(screen.queryByText('In chats')).toBeNull()
        expect(screen.getAllByText('Roadmap chat')).toHaveLength(1)
        // The code-mode chat's transcript hit shows as a code chat here.
        expect(screen.getByText('In code chats')).toBeInTheDocument()
        // The author resolves through the org roster, not as a raw id, and
        // no roster is fetched for it.
        const author = await screen.findByText('Pat Lee')
        expect(invoke).not.toHaveBeenCalledWith('spaces:listMembers', expect.anything())
        expect(screen.getByText('Files in spaces')).toBeInTheDocument()
        fireEvent.click(author)
        expect(onNavigate).toHaveBeenCalledWith({
            kind: 'space', orgId: 'org', spaceId: 'design',
            rail: { kind: 'thread', rootMessageId: 'r1' }, messageId: 'm1',
        })
    })

    it('cycles the scope with Tab and offers the way back out of an empty narrow search', async () => {
        const { input } = open()
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.keyDown(input, { key: 'Tab' })
        expect(screen.getByRole('button', { name: 'Spaces' })).toHaveAttribute('aria-pressed', 'true')
        // The browse lists put what you keep opening first.
        expect(groupTitles('Spaces')).toEqual(['Main', 'design', 'Activity'])
        expect(groupTitles('People')).toEqual(['Pat Lee', 'Sam Rivera'])
        fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Chats' }))
        fireEvent.change(screen.getByPlaceholderText('Search chats…'), { target: { value: 'zzz' } })
        expect(await screen.findByText('No matches in chats.')).toBeInTheDocument()
        fireEvent.click(screen.getByText('Search everything instead'))
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('opens the Brain scope on the recent notes, and says so when there are none', () => {
        const { onNavigate } = open({ defaultScope: 'brain' })
        expect(screen.getByRole('button', { name: 'Brain' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByText('Recent notes')).toBeInTheDocument()
        expect(optionTitles()).toEqual(['Roadmap 2026', 'Ideas'])
        fireEvent.click(screen.getByText('Ideas'))
        expect(onNavigate).toHaveBeenCalledWith({ kind: 'note', path: 'knowledge/ideas.md' })
        cleanup()
        open({ defaultScope: 'brain', notes: [] })
        expect(screen.getByText('No notes yet. Type to search your notes and files.')).toBeInTheDocument()
    })
})
