import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

// The search bar (2026-11-06, "search" in Main): filters go to the org as
// typed, a filter alone searches, and the bar teaches the grammar — the
// filters on focus, a filter's values while it is half-typed.

const roster: spaces.Member[] = [
    { id: 'me1', displayName: 'Ramnique Singh', kind: 'human' },
    { id: 'harsh', displayName: 'Harsh Verma', kind: 'human' },
    { id: 'arjun', displayName: 'Arjun Maheswaran', kind: 'human' },
] as spaces.Member[]

vi.mock('@/hooks/use-space-members', () => ({ useSpaceMembers: () => roster }))
vi.mock('@/hooks/use-spaces', () => ({ useSpaceNames: () => new Map() }))
vi.mock('@/hooks/use-space-chat', () => ({ STREAM_READ_KEY: 'stream' }))
vi.mock('@/lib/spaces-jump', () => ({ requestJump: vi.fn() }))
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: <T,>(v: T) => v }))

const EMPTY: spaces.SearchResults = { messages: [], topics: [], assets: [], truncated: { messages: false, topics: false, assets: false } }
const hit = (id: string, snippet: string): spaces.MessageSearchHit => ({
    messageId: id,
    threadRootId: id,
    author: { memberId: 'harsh', actingMode: 'direct' },
    snippet,
    postedAt: '2026-11-06T10:00:00.000Z',
    offset: 1,
}) as spaces.MessageSearchHit
const invoke = vi.fn(async (_channel: string, _args: Record<string, unknown>): Promise<spaces.SearchResults> => EMPTY)

import { SpaceSearch } from './space-search'

beforeEach(() => {
    invoke.mockClear()
    // jsdom has no layout: the selected row scrolls itself into view.
    Element.prototype.scrollIntoView = () => {}
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})
afterEach(cleanup)

const mount = () => {
    render(<SpaceSearch orgId="org-1" spaceId="S1" selfMemberId="me1" onNavigate={() => {}} />)
    const input = screen.getByPlaceholderText('Search messages, discussions, files')
    fireEvent.focus(input)
    return input
}

describe('SpaceSearch', () => {
    it('lists the filters on focus, and picking one types it', () => {
        const input = mount()
        expect(screen.getByText('Messages from a person')).toBeTruthy()
        fireEvent.click(screen.getByText('Messages with a link'))
        expect((input as HTMLInputElement).value).toBe('has:link ')
    })

    it("offers a half-typed from:'s people, and completes on Enter", () => {
        const input = mount()
        fireEvent.change(input, { target: { value: 'budget from:ar' } })
        expect(screen.getByText('Arjun Maheswaran')).toBeTruthy()
        expect(screen.queryByText('Harsh Verma')).toBeNull()
        fireEvent.keyDown(input, { key: 'Enter' })
        expect((input as HTMLInputElement).value).toBe('budget from:arjun ')
    })

    it('sends filters to the org as typed, and a filter alone is a search', async () => {
        invoke.mockResolvedValueOnce({ ...EMPTY, messages: [hit('m1', 'see https://example.com')] })
        const input = mount()
        fireEvent.change(input, { target: { value: 'from:me has:link ' } })
        await waitFor(() => expect(screen.getByText(/example\.com/)).toBeTruthy())
        expect(invoke).toHaveBeenCalledWith('spaces:search', { orgId: 'org-1', spaceId: 'S1', q: 'from:me has:link', limit: 20 })
    })

    it('leaves a half-typed filter out of the search', async () => {
        const input = mount()
        fireEvent.change(input, { target: { value: 'budget has:li' } })
        await waitFor(() => expect(invoke).toHaveBeenCalled())
        expect(invoke).toHaveBeenLastCalledWith('spaces:search', { orgId: 'org-1', spaceId: 'S1', q: 'budget', limit: 5 })
    })

    it('Show more widens one section to the org cap', async () => {
        invoke.mockResolvedValueOnce({ ...EMPTY, messages: [hit('m1', 'budget one')], truncated: { ...EMPTY.truncated, messages: true } })
        const input = mount()
        fireEvent.change(input, { target: { value: 'budget' } })
        fireEvent.click(await screen.findByText('Show more messages'))
        await waitFor(() =>
            expect(invoke).toHaveBeenLastCalledWith('spaces:search', { orgId: 'org-1', spaceId: 'S1', q: 'budget', kinds: ['messages'], limit: 50 }),
        )
    })
})
