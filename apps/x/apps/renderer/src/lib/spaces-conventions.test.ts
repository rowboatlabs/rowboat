import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import {
    applyReaction,
    artifactsForThread,
    buildThreadSeed,
    deriveTopicTitle,
    explicitTitle,
    findGeneralTopic,
    formatDayLabel,
    isContinuation,
    isGeneralSeedMessage,
    mergeMessages,
    parseThreadMarker,
    stripThreadMarker,
    stripThreadRef,
    threadRefOf,
    withThreadRef,
} from './spaces-conventions'

function topic(over: Partial<spaces.Topic> & { id: string }): spaces.Topic {
    return {
        spaceId: 's1',
        title: 'general',
        kind: 'discussion',
        createdBy: { memberId: 'arjun', actingMode: 'direct' },
        createdAt: '2026-08-19T09:00:00Z',
        archived: false,
        lastActivityAt: '2026-08-19T09:00:00Z',
        messageCount: 1,
        ...over,
    }
}

function msg(over: Partial<spaces.Message> & { id: string }): spaces.Message {
    return {
        topicId: 't-general',
        spaceId: 's1',
        author: { memberId: 'gagan', actingMode: 'direct' },
        body: 'hello',
        postedAt: '2026-08-19T10:20:00Z',
        offset: 1,
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

describe('general', () => {
    it('picks the oldest open stream topic ("messages", or the legacy "general"), ignoring archived ones and case', () => {
        const topics = [
            topic({ id: 'b', createdAt: '2026-08-19T09:01:00Z', title: 'messages' }),
            topic({ id: 'a', createdAt: '2026-08-19T09:00:00Z', title: 'General' }),
            topic({ id: 'old-archived', createdAt: '2026-08-18T09:00:00Z', archived: true }),
            topic({ id: 'other', title: 'roadmap' }),
        ]
        expect(findGeneralTopic(topics)?.id).toBe('a')
        expect(findGeneralTopic([topic({ id: 'x', title: 'not general' })])).toBeNull()
    })
    it('prefers the server-marked stream (kind general) over any legacy title match', () => {
        const topics = [
            topic({ id: 'legacy-titled', createdAt: '2026-08-19T09:00:00Z', title: 'messages' }),
            topic({ id: 'marked', createdAt: '2026-08-19T09:05:00Z', title: 'messages', kind: 'general' }),
        ]
        expect(findGeneralTopic(topics)?.id).toBe('marked')
    })
    it('recognises the seed message only as the first message of general', () => {
        const general = topic({ id: 't-general' })
        expect(isGeneralSeedMessage(general, msg({ id: 'm1', body: 'messages' }), 0)).toBe(true)
        expect(isGeneralSeedMessage(general, msg({ id: 'm1b', body: 'general' }), 0)).toBe(true)
        expect(isGeneralSeedMessage(general, msg({ id: 'm2', body: 'general' }), 3)).toBe(false)
        expect(isGeneralSeedMessage(general, msg({ id: 'm3', body: 'hi' }), 0)).toBe(false)
    })
})

describe('topic-from-message marker', () => {
    const parent = msg({ id: '01J9PARENT', body: 'Standup — Wed. Shipped the copy pass.\nBlocked on SSO.', postedAt: '2026-08-19T10:20:00Z' })
    it('puts the parent text first (so the title derives from it) and the marker after', () => {
        const seed = buildThreadSeed(parent)
        expect(seed.startsWith('Standup — Wed. Shipped the copy pass.')).toBe(true)
        expect(seed).toContain('<!-- rowboat:topic parent=msg:01J9PARENT by=gagan at=2026-08-19T10:20:00Z -->')
    })
    it('round-trips and strips cleanly', () => {
        const seed = buildThreadSeed(parent)
        expect(parseThreadMarker(seed)).toEqual({ parentMessageId: '01J9PARENT', parentAuthorId: 'gagan', parentPostedAt: '2026-08-19T10:20:00Z' })
        expect(stripThreadMarker(seed)).toBe('Standup — Wed. Shipped the copy pass.\nBlocked on SSO.')
        expect(parseThreadMarker('just a message')).toBeNull()
        expect(stripThreadMarker('just a message')).toBe('just a message')
    })
})

describe('topic titles — derived vs explicitly renamed', () => {
    it('deriveTopicTitle mirrors the server: first non-empty line, heading/bullet stripped, capped', () => {
        expect(deriveTopicTitle('# Ship it\ndetails')).toBe('Ship it')
        expect(deriveTopicTitle('\n\n- first bullet\nmore')).toBe('first bullet')
        expect(deriveTopicTitle('   ')).toBe('Untitled')
        const long = 'x'.repeat(300)
        expect(deriveTopicTitle(long)).toBe(`${'x'.repeat(255)}…`)
    })

    it('a topic still wearing its auto-derived title has no explicit name', () => {
        const seed = buildThreadSeed(msg({ id: '01J9PARENT', body: 'Standup — Wed. Shipped the copy pass.' }))
        const t = topic({ id: '01J9TOPIC', title: deriveTopicTitle(seed) })
        expect(explicitTitle(t, seed)).toBeNull()
        // No first message loaded yet → stay compact rather than guessing.
        expect(explicitTitle(t, null)).toBeNull()
    })

    it('a renamed topic surfaces its name — and renaming never touches the message body', () => {
        const seed = buildThreadSeed(msg({ id: '01J9PARENT', body: 'Standup — Wed. Shipped the copy pass.' }))
        const renamed = topic({ id: '01J9TOPIC', title: 'SSO rollout' })
        expect(explicitTitle(renamed, seed)).toBe('SSO rollout')
        // The seed (the first message) is an input, never an output: unchanged.
        expect(stripThreadMarker(seed)).toBe('Standup — Wed. Shipped the copy pass.')
    })
})

describe('artifact provenance', () => {
    it('appends, reads and strips the thread ref on reasons', () => {
        expect(withThreadRef('Folded SSO decision under P1', 'T1')).toBe('Folded SSO decision under P1 · topic:T1')
        expect(withThreadRef('', 'T1')).toBe('topic:T1')
        expect(withThreadRef('x · topic:OLD', 'T2')).toBe('x · topic:T2')
        expect(threadRefOf('Folded SSO decision under P1 · topic:T1')).toBe('T1')
        expect(threadRefOf('topic:T1')).toBe('T1')
        expect(threadRefOf('no ref here')).toBeNull()
        expect(threadRefOf(undefined)).toBeNull()
        expect(stripThreadRef('Folded · topic:T1')).toBe('Folded')
        expect(stripThreadRef('topic:T1')).toBe('')
    })
    it('groups a thread’s change-sets by file with the version span, newest group first', () => {
        const groups = artifactsForThread([
            cs({ id: 'c1', baseVersion: 31, resultVersion: 32, committedAt: '2026-08-19T11:44:00Z', reason: 'Folded SSO under P1 · topic:T1' }),
            cs({ id: 'c2', baseVersion: 32, resultVersion: 33, committedAt: '2026-08-19T11:46:00Z', reason: 'tidy · topic:T1' }),
            cs({ id: 'c3', assetPath: 'decisions/sso.md', baseVersion: 0, resultVersion: 1, committedAt: '2026-08-19T11:45:00Z', reason: 'SOW wording · topic:T1' }),
            cs({ id: 'other', committedAt: '2026-08-19T12:00:00Z', reason: 'unrelated · topic:T9' }),
            cs({ id: 'cold', committedAt: '2026-08-19T12:01:00Z', reason: 'edited in Files' }),
        ], 'T1')
        expect(groups.map((g) => g.assetPath)).toEqual(['roadmap.md', 'decisions/sso.md'])
        expect(groups[0]).toMatchObject({ fromVersion: 31, toVersion: 33 })
        expect(groups[0]!.changeSets.map((c) => c.id)).toEqual(['c2', 'c1'])
        expect(groups[1]).toMatchObject({ fromVersion: 0, toVersion: 1 })
        expect(artifactsForThread([], 'T1')).toEqual([])
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
