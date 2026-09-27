import { describe, expect, it } from 'vitest';
import type { FindCandidate } from '@x/shared/dist/find.js';
import type { SystemOneResponse } from './client.js';
import { MAX_FIND_CANDIDATES, MAX_FIND_TEXT_CHARS, NONE_OPTION, buildFindRequest, decideFind, selectFindCandidates } from './find_questions.js';

const candidate = (over: Partial<FindCandidate> & { messageId: string }): FindCandidate => ({
    threadRootId: over.messageId,
    title: null,
    text: 'text',
    at: '2026-09-22T10:00:00.000Z',
    source: 'recent',
    ...over,
});

const answers = (choice: string, probabilities: Record<string, number>, presence?: number, confidence = 0.9): SystemOneResponse['answers'] => ({
    match: { type: 'choice', choice, probabilities, confidence },
    ...(presence === undefined ? {} : { present: { type: 'noul', noul: presence } }),
});

describe('selectFindCandidates', () => {
    it('keeps one entry per message, newest first, capped, text clipped', () => {
        const many = Array.from({ length: MAX_FIND_CANDIDATES + 3 }, (_, i) =>
            candidate({ messageId: `m${i}`, at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00.000Z` }),
        );
        const picked = selectFindCandidates([
            candidate({ messageId: 'long', text: 'x'.repeat(999), at: '2026-12-01T00:00:00.000Z' }),
            ...many,
            // A later duplicate of the newest entry: the first copy wins.
            candidate({ messageId: 'long', text: 'dupe', at: '2026-12-02T00:00:00.000Z' }),
        ]);
        expect(picked).toHaveLength(MAX_FIND_CANDIDATES);
        expect(picked[0]!.messageId).toBe('long');
        expect(picked[0]!.text).toHaveLength(MAX_FIND_TEXT_CHARS);
        expect(new Set(picked.map((c) => c.messageId)).size).toBe(picked.length);
        for (let i = 1; i < picked.length; i++) expect(picked[i - 1]!.at >= picked[i]!.at).toBe(true);
    });
});

describe('buildFindRequest', () => {
    it('describes each message, marks replies, and offers none of these', () => {
        const { state, questions } = buildFindRequest({ spaceName: 'eng', query: 'the offsite thing' }, [
            candidate({ messageId: 'a', title: 'Offsite', text: 'Where in November?', author: 'Priya', replyCount: 5 }),
            candidate({ messageId: 'b', threadRootId: 'a', text: 'Lisbon gets my vote' }),
        ]);
        const s = state as { space: string; query: string; messages: Record<string, unknown>[] };
        expect(s.space).toBe('eng');
        expect(s.query).toBe('the offsite thing');
        expect(s.messages[0]).toMatchObject({ id: 'message_1', thread_title: 'Offsite', by: 'Priya', replies: 5 });
        expect(s.messages[1]).toMatchObject({ id: 'message_2', is_reply: true });
        expect(Object.keys(questions.match.criteria)).toEqual(['message_1', 'message_2', NONE_OPTION]);
        expect(questions.match.criteria.message_2).toMatchObject({ what: 'The entry `messages[1]`', text: 'Lisbon gets my vote' });
        expect(questions.present.type).toBe('noul');
    });
});

describe('decideFind', () => {
    const three = [candidate({ messageId: 'a' }), candidate({ messageId: 'b' }), candidate({ messageId: 'c' })];

    it('ranks every candidate that drew probability, strongest first', () => {
        const result = decideFind(answers('message_2', { message_1: 0.2, message_2: 0.7, message_3: 0, [NONE_OPTION]: 0.1 }, 0.9), three);
        expect(result).toMatchObject({ reason: 'ranked', found: true, presence: 0.9, confidence: 0.9 });
        expect(result.ranked).toEqual([{ messageId: 'b', probability: 0.7 }, { messageId: 'a', probability: 0.2 }]);
    });

    it('is not found when Jev picks none of these, even with a ranking to walk', () => {
        const result = decideFind(answers(NONE_OPTION, { message_1: 0.3, [NONE_OPTION]: 0.7 }, 0.2), three);
        expect(result.found).toBe(false);
        expect(result.ranked).toEqual([{ messageId: 'a', probability: 0.3 }]);
    });

    it('is not found when presence is low, whatever the pick', () => {
        expect(decideFind(answers('message_1', { message_1: 0.9 }, 0.3), three).found).toBe(false);
    });

    it('treats a missing presence answer as present', () => {
        expect(decideFind(answers('message_1', { message_1: 0.9 }), three).found).toBe(true);
    });

    it('throws without a match answer', () => {
        expect(() => decideFind({}, three)).toThrow(/no match/);
    });
});
