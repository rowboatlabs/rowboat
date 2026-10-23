import { beforeEach, describe, expect, it, vi } from 'vitest'

// The badge arithmetic (2026-09-10): a space row collapsed carries its
// stream plus every followed discussion; expanded, the stream alone with each
// discussion carrying its own. "For you" is mentions, or everything in a DM.
// The org's snapshot reports mentions per space WITH the threads folded in;
// the store keeps the roots' share apart so the halves can be shown apart.

const feed = vi.hoisted(() => ({ listeners: [] as Array<(event: unknown) => void> }))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: (fn: (event: unknown) => void) => { feed.listeners.push(fn); return () => {} } }))

import { NO_BADGE, forgetOrg, loadUnread, markStreamRead, markThreadRead, spaceBadge, streamBadge, threadBadge } from '@/lib/spaces-read-state'

const snapshot = {
    spaces: [
        {
            spaceId: 'road', head: 30, readOffset: 10, unreadRoots: 6, unreadMentions: 2,
            threads: [
                { rootMessageId: 'pricing', readOffset: 12, lastReplyOffset: 29, unreadReplies: 9, unreadMentions: 1 },
                { rootMessageId: 'onboarding', readOffset: 20, lastReplyOffset: 28, unreadReplies: 8, unreadMentions: 0 },
            ],
        },
        { spaceId: 'dm-harsh', head: 12, readOffset: 0, unreadRoots: 12, unreadMentions: 0, threads: [] },
    ],
}

beforeEach(async () => {
    forgetOrg('org')
    vi.stubGlobal('ipc', { invoke: vi.fn().mockResolvedValue(snapshot) })
    await loadUnread('org', 'me')
})

describe('badges', () => {
    it('the stream, each followed discussion, and the collapsed sum', () => {
        expect(streamBadge('org', 'road', false)).toEqual({ unread: 6, forYou: 1 }) // 2 in the space, 1 of them in pricing
        expect(threadBadge('org', 'road', 'pricing', false)).toEqual({ unread: 9, forYou: 1 })
        expect(threadBadge('org', 'road', 'onboarding', false)).toEqual({ unread: 8, forYou: 0 })
        expect(threadBadge('org', 'road', 'launch-checklist', false)).toBe(NO_BADGE) // not followed: silent
        expect(spaceBadge('org', 'road', false)).toEqual({ unread: 23, forYou: 2 })
    })

    it('a DM is all for you', () => {
        expect(streamBadge('org', 'dm-harsh', true)).toEqual({ unread: 12, forYou: 12 })
        expect(spaceBadge('org', 'dm-harsh', true)).toEqual({ unread: 12, forYou: 12 })
    })

    it('reading a discussion takes its share out of the sum; reading the stream leaves the discussions', () => {
        markThreadRead('org', 'road', 'pricing', 29, { sync: false })
        expect(threadBadge('org', 'road', 'pricing', false)).toBe(NO_BADGE)
        expect(spaceBadge('org', 'road', false)).toEqual({ unread: 14, forYou: 1 })
        markStreamRead('org', 'road', 30, { sync: false })
        expect(streamBadge('org', 'road', false)).toBe(NO_BADGE)
        expect(spaceBadge('org', 'road', false)).toEqual({ unread: 8, forYou: 0 })
        markThreadRead('org', 'road', 'onboarding', 28, { sync: false })
        expect(spaceBadge('org', 'road', false)).toBe(NO_BADGE)
    })

    it('reading a discussion we do not follow sends the mark and badges nothing (2026-09-11)', async () => {
        vi.useFakeTimers()
        const invoke = vi.fn().mockResolvedValue({ readOffset: 27 })
        vi.stubGlobal('ipc', { invoke })
        markThreadRead('org', 'road', 'launch-checklist', 27)
        expect(threadBadge('org', 'road', 'launch-checklist', false)).toBe(NO_BADGE)
        expect(spaceBadge('org', 'road', false)).toEqual({ unread: 23, forYou: 2 })
        await vi.advanceTimersByTimeAsync(2_000)
        expect(invoke).toHaveBeenCalledWith('spaces:markRead', { orgId: 'org', spaceId: 'road', threadRootId: 'launch-checklist', offset: 27 })
        // A lower offset later is a no-op: nothing more goes to the org.
        markThreadRead('org', 'road', 'launch-checklist', 20)
        await vi.advanceTimersByTimeAsync(2_000)
        expect(invoke).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })

    it('a reply sent to the stream counts in the stream; a quiet one does not (2026-10-22)', () => {
        const reply = (offset: number, alsoInStream: boolean) => {
            for (const fn of feed.listeners) fn({ orgId: 'org', frame: { kind: 'event', spaceId: 'road', offset, at: '2026-10-22T10:00:00Z', event: { type: 'message', message: {
                id: `r${offset}`, spaceId: 'road', threadRoot: 'launch-checklist', author: { memberId: 'harsh', actingMode: 'agent' }, body: 'done',
                postedAt: '2026-10-22T10:00:00Z', offset, replyCount: 0, reactions: [], mentions: ['me'], mentionsHere: false, mentionsRowboat: false,
                ...(alsoInStream ? { alsoInStream: true } : {}),
            } } } })
        }
        reply(31, false)
        expect(streamBadge('org', 'road', false)).toEqual({ unread: 6, forYou: 1 })
        reply(32, true)
        // One more stream row; its mention belongs to its thread, as on the org.
        expect(streamBadge('org', 'road', false)).toEqual({ unread: 7, forYou: 1 })
    })

    it('an unknown space has no badge', () => {
        expect(spaceBadge('org', 'nowhere', false)).toBe(NO_BADGE)
        expect(streamBadge('other-org', 'road', false)).toBe(NO_BADGE)
    })
})
