import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import {
    applyReaction,
    artifactsForThread,
    formatDayLabel,
    isContinuation,
    mergeMessages,
    stripThreadRef,
    threadLabelOf,
    threadRefOf,
    threadRootOf,
    withThreadRef,
} from './spaces-conventions'

function msg(over: Partial<spaces.Message> & { id: string }): spaces.Message {
    return {
        spaceId: 's1',
        author: { memberId: 'gagan', actingMode: 'direct' },
        body: 'hello',
        postedAt: '2026-08-19T10:20:00Z',
        offset: 1,
        replyCount: 0,
        reactions: [],
        ...over,
    }
}

function cs(over: Partial<spaces.ChangeSet> & { id: string }): spaces.ChangeSet {
    return {
        spaceId: 's1',
        assetPath: 'roadmap.md',
        baseVersion: 31,
        resultVersion: 32,
        attribution: { memberId: 'arjun', actingMode: 'agent', agentName: 'Rowboat' },
        committedAt: '2026-08-19T11:44:00Z',
        offset: 10,
        ...over,
    }
}

describe('thread identity', () => {
    it('a message lives in its root’s thread — its own when it IS a root', () => {
        expect(threadRootOf(msg({ id: 'root' }))).toBe('root')
        expect(threadRootOf(msg({ id: 'reply', threadRoot: 'root' }))).toBe('root')
    })
    it('labels a plain thread by its root’s first line, markdown scaffolding stripped', () => {
        expect(threadLabelOf('# Ship it\ndetails')).toBe('Ship it')
        expect(threadLabelOf('\n\n- first bullet\nmore')).toBe('first bullet')
        expect(threadLabelOf('![shot](https://x/b/abc)')).toBe('Thread')
        expect(threadLabelOf('   ')).toBe('Thread')
        expect(threadLabelOf('x'.repeat(100))).toBe(`${'x'.repeat(79)}…`)
    })
})

describe('artifact provenance', () => {
    it('appends, reads and strips the thread ref on reasons (legacy "topic:" still parses)', () => {
        expect(withThreadRef('Folded SSO decision under P1', 'M1')).toBe('Folded SSO decision under P1 · thread:M1')
        expect(withThreadRef('', 'M1')).toBe('thread:M1')
        expect(withThreadRef('x · thread:OLD', 'M2')).toBe('x · thread:M2')
        expect(withThreadRef('x · topic:OLD', 'M2')).toBe('x · thread:M2')
        expect(threadRefOf('Folded SSO decision under P1 · thread:M1')).toBe('M1')
        expect(threadRefOf('legacy · topic:T1')).toBe('T1')
        expect(threadRefOf('thread:M1')).toBe('M1')
        expect(threadRefOf('no ref here')).toBeNull()
        expect(threadRefOf(undefined)).toBeNull()
        expect(stripThreadRef('Folded · thread:M1')).toBe('Folded')
        expect(stripThreadRef('thread:M1')).toBe('')
    })
    it('groups a thread’s change-sets by file with the version span, newest group first — contract field first, suffix as fallback', () => {
        const groups = artifactsForThread([
            cs({ id: 'c1', baseVersion: 31, resultVersion: 32, committedAt: '2026-08-19T11:44:00Z', threadRootId: 'M1', reason: 'Folded SSO under P1' }),
            cs({ id: 'c2', baseVersion: 32, resultVersion: 33, committedAt: '2026-08-19T11:46:00Z', reason: 'tidy · thread:M1' }),
            cs({ id: 'c3', assetPath: 'decisions/sso.md', baseVersion: 0, resultVersion: 1, committedAt: '2026-08-19T11:45:00Z', reason: 'SOW wording · thread:M1' }),
            cs({ id: 'other', committedAt: '2026-08-19T12:00:00Z', reason: 'unrelated · thread:M9' }),
            cs({ id: 'cold', committedAt: '2026-08-19T12:01:00Z', reason: 'edited in Files' }),
        ], 'M1')
        expect(groups.map((g) => g.assetPath)).toEqual(['roadmap.md', 'decisions/sso.md'])
        expect(groups[0]).toMatchObject({ fromVersion: 31, toVersion: 33 })
        expect(groups[0]!.changeSets.map((c) => c.id)).toEqual(['c2', 'c1'])
        expect(groups[1]).toMatchObject({ fromVersion: 0, toVersion: 1 })
        expect(artifactsForThread([], 'M1')).toEqual([])
    })
})

describe('stream helpers', () => {
    it('treats same-author messages within five minutes as continuations', () => {
        const a = msg({ id: 'a', postedAt: '2026-08-19T10:00:00Z' })
        const b = msg({ id: 'b', postedAt: '2026-08-19T10:04:00Z' })
        const c = msg({ id: 'c', postedAt: '2026-08-19T10:10:00Z' })
        const viaAgent = msg({ id: 'd', postedAt: '2026-08-19T10:04:30Z', author: { memberId: 'gagan', actingMode: 'agent', agentName: 'Rowboat' } })
        expect(isContinuation(undefined, a)).toBe(false)
        expect(isContinuation(a, b)).toBe(true)
        expect(isContinuation(b, c)).toBe(false)
        expect(isContinuation(a, viaAgent)).toBe(false)
    })
    it('labels days relative to now', () => {
        const now = new Date('2026-08-19T15:00:00')
        expect(formatDayLabel('2026-08-19T09:00:00', now)).toBe('Today')
        expect(formatDayLabel('2026-08-18T09:00:00', now)).toBe('Yesterday')
        expect(formatDayLabel('2026-08-12T09:00:00', now)).toMatch(/Aug/)
    })
})

describe('reactions', () => {
    it('adds into first-reacted order: new emoji appends a group, repeat member is a no-op', () => {
        const one = applyReaction([], { emoji: '👍', memberId: 'gagan', action: 'added' })
        expect(one).toEqual([{ emoji: '👍', memberIds: ['gagan'] }])
        const two = applyReaction(one, { emoji: '👍', memberId: 'arjun', action: 'added' })
        expect(two).toEqual([{ emoji: '👍', memberIds: ['gagan', 'arjun'] }])
        const three = applyReaction(two, { emoji: '🚀', memberId: 'gagan', action: 'added' })
        expect(three.map((g) => g.emoji)).toEqual(['👍', '🚀'])
        expect(applyReaction(three, { emoji: '👍', memberId: 'gagan', action: 'added' })).toEqual(three)
    })
    it('removes a member; the emptied group disappears; absent removals are no-ops', () => {
        const groups = [
            { emoji: '👍', memberIds: ['gagan', 'arjun'] },
            { emoji: '🚀', memberIds: ['gagan'] },
        ]
        const dropped = applyReaction(groups, { emoji: '🚀', memberId: 'gagan', action: 'removed' })
        expect(dropped).toEqual([{ emoji: '👍', memberIds: ['gagan', 'arjun'] }])
        expect(applyReaction(dropped, { emoji: '🚀', memberId: 'gagan', action: 'removed' })).toEqual(dropped)
        expect(applyReaction(undefined, { emoji: '👍', memberId: 'gagan', action: 'removed' })).toEqual([])
    })
})

describe('mergeMessages — windowed pages, echoes, and resyncs share one merge', () => {
    it('unions by id in offset order; the incoming copy wins (folded reactions)', () => {
        const older = [msg({ id: 'a', offset: 1 }), msg({ id: 'b', offset: 2 })]
        const fresh = [msg({ id: 'b', offset: 2, reactions: [{ emoji: '👍', memberIds: ['gagan'] }] }), msg({ id: 'c', offset: 3 })]
        const merged = mergeMessages(older, fresh)
        expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c'])
        expect(merged[1]!.reactions).toEqual([{ emoji: '👍', memberIds: ['gagan'] }])
    })
    it('prepends an older page below an existing window', () => {
        const window = [msg({ id: 'e', offset: 5 }), msg({ id: 'f', offset: 6 })]
        const olderPage = [msg({ id: 'c', offset: 3 }), msg({ id: 'd', offset: 4 })]
        expect(mergeMessages(window, olderPage).map((m) => m.id)).toEqual(['c', 'd', 'e', 'f'])
    })
    it('an echo already present is a no-op on content', () => {
        const win = [msg({ id: 'a', offset: 1 })]
        expect(mergeMessages(win, [msg({ id: 'a', offset: 1 })])).toEqual(win)
    })
})
