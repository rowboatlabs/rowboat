import { describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { sessionCommand } from './session-command'

// /session (2026-11-05): New first and the default, then your open sessions,
// this space's first, filtered by the words typed after the command.

const listing = (id: string, spaceId: string, title: string, status: spaces.SessionStatus, unreadReplies = 0): spaces.SessionListing => ({
    spaceId,
    spaceName: spaceId === 'here' ? 'Main' : 'Design',
    spaceKind: 'space',
    root: {
        id, spaceId, author: { memberId: 'me', actingMode: 'direct' }, body: title, postedAt: '2026-11-05T10:00:00Z', offset: 1,
        replyCount: 0, replyAuthors: [], reactions: [], mentions: [], mentionsHere: false, mentionsRowboat: false, session: { title },
    } as spaces.Message,
    status,
    unreadReplies,
    unreadMentions: 0,
    lastActivityAt: '2026-11-05T10:00:00Z',
})

const sessions = [
    listing('a', 'there', 'fix thread nav', 'needs_you', 2),
    listing('b', 'here', 'flaky tests', 'working'),
    listing('c', 'here', 'thread perf', 'idle'),
]

function build(extra: Partial<Parameters<typeof sessionCommand>[0]> = {}) {
    const onNew = vi.fn()
    const onOpen = vi.fn()
    const command = sessionCommand({ spaceId: 'here', sessions, newLabel: (t) => `New session: ${t}`, onNew, onOpen, ...extra })
    return { command, onNew, onOpen }
}

describe('/session', () => {
    it('puts New first with the typed title, then your sessions, this space first', () => {
        const { command, onNew } = build()
        const choices = command.choices!('fix thread nav')
        expect(choices[0]).toMatchObject({ key: 'new', label: 'New session: fix thread nav', disabled: false })
        expect(choices.slice(1).map((c) => c.key)).toEqual(['a'])
        void choices[0]!.run()
        expect(onNew).toHaveBeenCalledWith('fix thread nav')
        expect(command.choices!('').slice(1).map((c) => c.key)).toEqual(['b', 'c', 'a'])
    })

    it('needs a title for New, and says so', () => {
        const { command } = build()
        expect(command.choices!('  ')[0]).toMatchObject({ label: 'New session — type a title', disabled: true })
    })

    it('filters by title and tells where each stands', () => {
        const { command, onOpen } = build()
        const choices = command.choices!('thread')
        expect(choices.slice(1).map((c) => [c.label, c.detail])).toEqual([
            ['thread perf', 'Idle'],
            ['fix thread nav', 'Design · Needs you · 2 new'],
        ])
        expect(choices[1]!.section).toBe('Your open sessions')
        void choices[2]!.run()
        expect(onOpen).toHaveBeenCalledWith(sessions[0])
    })

    it('in a thread, falls back to the thread\'s own label', () => {
        const { command, onNew } = build({ newLabel: (t) => `Make this thread a session: ${t}`, fallbackTitle: 'Look into it' })
        const first = command.choices!('')[0]!
        expect(first).toMatchObject({ label: 'Make this thread a session: Look into it', disabled: false })
        void command.run('')
        expect(onNew).toHaveBeenCalledWith('Look into it')
    })
})
