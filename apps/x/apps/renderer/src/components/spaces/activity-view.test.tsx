import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

// Activity is the org's query rendered, not a client fold: the view asks
// spaces:getActivity with the chosen tab's kinds, labels rows from the page's
// own names, and every row opens the message it is about.

vi.mock('@/components/spaces/atoms', () => ({
    MemberAvatar: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
    Segmented: ({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) => (
        <div>{options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>
    ),
}))
vi.mock('@/components/spaces/message-row', () => ({ DayDivider: ({ label }: { label: string }) => <div>{label}</div> }))

import { ActivityView, actorLabel, excerptOf, reasonLabel } from './activity-view'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

const org = { id: 'org-1', name: 'Rowboat Labs', memberId: 'ramnique', spaces: [], directs: [] } as unknown as OrgWithSpaces
const now = new Date().toISOString()
const msg = (id: string, body: string, author = 'harsh', threadRoot?: string): spaces.Message =>
    ({ id, spaceId: 'road', author: { memberId: author, actingMode: 'direct' }, body, postedAt: now, offset: 5, replyCount: 0, reactions: [], mentions: [], mentionsHere: false, mentionsRowboat: false, ...(threadRoot ? { threadRoot } : {}) }) as unknown as spaces.Message

const page: spaces.SpacesActivityPage = {
    items: [
        { id: 'm:1', kind: 'mention', spaceId: 'road', spaceKind: 'shared', spaceName: 'Roadboard', message: msg('1', 'hey [@Ramnique](#member:ramnique) look'), actors: [{ memberId: 'harsh', actingMode: 'direct' }], at: now, unread: true },
        { id: 'm:2', kind: 'reply', spaceId: 'road', spaceKind: 'shared', spaceName: 'Roadboard', threadRootId: 'root', message: msg('2', 'done', 'arjun', 'root'), actors: [{ memberId: 'arjun', actingMode: 'agent', agentName: 'Rowboat' }], at: now, unread: false },
        { id: 'r:3:👍', kind: 'reaction', spaceId: 'road', spaceKind: 'shared', spaceName: 'Roadboard', message: msg('3', 'my **plan**', 'ramnique'), actors: [{ memberId: 'harsh', actingMode: 'direct' }, { memberId: 'arjun', actingMode: 'direct' }], emoji: '👍', at: now, unread: true },
        { id: 'm:4', kind: 'dm', spaceId: 'dm-harsh', spaceKind: 'direct', spaceName: 'dm', message: msg('4', 'got a minute?'), actors: [{ memberId: 'harsh', actingMode: 'direct' }], at: now, unread: false },
    ],
    seenAt: null,
    names: { ramnique: 'Ramnique', harsh: 'Harsh', arjun: 'Arjun' },
}

const invoke = vi.fn()
beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation(async (channel: string) => {
        if (channel === 'spaces:getActivity') return page
        if (channel === 'spaces:markActivitySeen') return { seenAt: now }
        throw new Error(`unexpected ${channel}`)
    })
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})
afterEach(cleanup)

describe('labels', () => {
    const names = new Map([['harsh', 'Harsh'], ['arjun', 'Arjun']])
    it('name actors, agents as their person’s Rowboat, and fold crowds', () => {
        expect(actorLabel([{ memberId: 'harsh', actingMode: 'direct' }], names)).toBe('Harsh')
        expect(actorLabel([{ memberId: 'arjun', actingMode: 'agent' }], names)).toBe("Arjun's Rowboat")
        expect(actorLabel([{ memberId: 'harsh', actingMode: 'direct' }, { memberId: 'arjun', actingMode: 'direct' }], names)).toBe('Harsh and Arjun')
        expect(actorLabel([{ memberId: 'a', actingMode: 'direct' }, { memberId: 'b', actingMode: 'direct' }, { memberId: 'c', actingMode: 'direct' }, { memberId: 'd', actingMode: 'direct' }], names)).toBe('a, b and 2 others')
    })
    it('say what happened and where', () => {
        expect(reasonLabel(page.items[0]!)).toBe('mentioned you in #Roadboard')
        expect(reasonLabel(page.items[1]!)).toBe('replied in a thread in #Roadboard')
        expect(reasonLabel(page.items[2]!)).toBe('reacted 👍 to your message in #Roadboard')
        expect(reasonLabel(page.items[3]!)).toBe('messaged you')
    })
    it('excerpts flatten mentions and markdown', () => {
        expect(excerptOf('hey [@R](#member:ramnique) see [the doc](https://x) **now**', new Map([['ramnique', 'Ramnique']]))).toBe('hey @Ramnique see the doc now')
    })
})

describe('ActivityView', () => {
    it('renders the page’s rows and opens the message a row is about', async () => {
        const onOpenMessage = vi.fn()
        render(<ActivityView org={org} onOpenMessage={onOpenMessage} />)
        await screen.findByText('hey @Ramnique look')
        expect(invoke).toHaveBeenCalledWith('spaces:getActivity', { orgId: 'org-1', limit: 40 })
        expect(screen.getByText("Arjun's Rowboat")).toBeTruthy()
        expect(screen.getByText('Harsh and Arjun')).toBeTruthy()
        expect(screen.getByText('my plan')).toBeTruthy()
        fireEvent.click(screen.getByText('done'))
        expect(onOpenMessage).toHaveBeenCalledWith({ orgId: 'org-1', spaceId: 'road', rail: { kind: 'thread', rootMessageId: 'root' }, messageId: '2' })
        fireEvent.click(screen.getByText('got a minute?'))
        expect(onOpenMessage).toHaveBeenLastCalledWith({ orgId: 'org-1', spaceId: 'dm-harsh', rail: { kind: 'general' }, messageId: '4' })
        // Looking here reads the reactions: the seen mark moves to the newest unread one.
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:markActivitySeen', { orgId: 'org-1', at: now }))
    })

    it('tabs narrow the kinds; unread-only narrows further', async () => {
        render(<ActivityView org={org} onOpenMessage={vi.fn()} />)
        await screen.findByText('hey @Ramnique look')
        fireEvent.click(screen.getByText('Mentions'))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:getActivity', { orgId: 'org-1', kinds: ['mention', 'here'], limit: 40 }))
        fireEvent.click(screen.getByLabelText('Unread only'))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:getActivity', { orgId: 'org-1', kinds: ['mention', 'here'], unread: true, limit: 40 }))
    })

    it('a hidden view never marks seen', async () => {
        render(<ActivityView org={org} active={false} onOpenMessage={vi.fn()} />)
        await screen.findByText('hey @Ramnique look')
        expect(invoke).not.toHaveBeenCalledWith('spaces:markActivitySeen', expect.anything())
    })
})
