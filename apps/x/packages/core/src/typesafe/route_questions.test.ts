import { describe, expect, it } from 'vitest';
import type { RouteCandidate } from '@x/shared/dist/auto-route.js';
import type { SystemOneResponse } from './client.js';
import {
    MAX_CANDIDATES,
    MAX_ROOT_CHARS,
    NEW_MESSAGE_OPTION,
    buildRouteRequest,
    decideRoute,
    selectCandidates,
} from './route_questions.js';

const candidate = (over: Partial<RouteCandidate> & { rootMessageId: string }): RouteCandidate => ({
    title: null,
    rootText: 'root',
    replyCount: 1,
    lastActivityAt: '2026-09-22T10:00:00.000Z',
    ...over,
});

const answers = (
    choice: string,
    probabilities: Record<string, number>,
    noul?: number,
    confidence = 0.9,
): SystemOneResponse['answers'] => ({
    destination: { type: 'choice', choice, probabilities, confidence },
    ...(noul === undefined ? {} : { continues_existing: { type: 'noul', noul } }),
});

describe('selectCandidates', () => {
    it('orders newest activity first and caps the set', () => {
        const many = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) =>
            candidate({ rootMessageId: `m${i}`, lastActivityAt: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00.000Z` }),
        );
        const picked = selectCandidates(many);
        expect(picked).toHaveLength(MAX_CANDIDATES);
        for (let i = 1; i < picked.length; i++) {
            expect(picked[i - 1]!.lastActivityAt >= picked[i]!.lastActivityAt).toBe(true);
        }
    });

    it('clips long roots', () => {
        const [only] = selectCandidates([candidate({ rootMessageId: 'a', rootText: 'x'.repeat(MAX_ROOT_CHARS * 2) })]);
        expect(only!.rootText).toHaveLength(MAX_ROOT_CHARS);
        expect(only!.rootText.endsWith('…')).toBe(true);
    });
});

describe('buildRouteRequest', () => {
    it('names threads by index and points the options back at the state', () => {
        const { state, questions } = buildRouteRequest(
            { spaceName: 'eng', draft: 'yes, after lunch', authorName: 'Arjun' },
            [candidate({ rootMessageId: 'a', title: 'CI is red', rootAuthor: 'Sam' }), candidate({ rootMessageId: 'b', rootText: 'Offsite where?' })],
        );
        const s = state as { space: string; author: string; draft: string; threads: Record<string, unknown>[] };
        expect(s.space).toBe('eng');
        expect(s.author).toBe('Arjun');
        expect(s.draft).toBe('yes, after lunch');
        expect(s.threads.map((t) => t.id)).toEqual(['thread_1', 'thread_2']);
        expect(s.threads[0]).toMatchObject({ title: 'CI is red', started_by: 'Sam', replies: 1 });
        expect(s.threads[1]).not.toHaveProperty('title');

        expect(Object.keys(questions.destination.criteria)).toEqual([NEW_MESSAGE_OPTION, 'thread_1', 'thread_2']);
        expect(questions.destination.criteria.thread_1).toMatchObject({ what: 'A reply in the thread `threads[0]`', title: 'CI is red' });
        expect(questions.destination.criteria.thread_2).toMatchObject({ what: 'A reply in the thread `threads[1]`', first_message: 'Offsite where?' });
        expect(questions.continues_existing.type).toBe('noul');
    });

    it('leaves the author out when unknown', () => {
        const { state } = buildRouteRequest({ spaceName: 'eng', draft: 'hi' }, []);
        expect(state).not.toHaveProperty('author');
    });
});

describe('decideRoute', () => {
    const two = [candidate({ rootMessageId: 'a' }), candidate({ rootMessageId: 'b' })];

    it('posts to the stream when Jev picks a new message', () => {
        const decision = decideRoute(answers(NEW_MESSAGE_OPTION, { new_message: 0.8, thread_1: 0.1, thread_2: 0.1 }, 0.1), two);
        expect(decision).toMatchObject({ destination: 'stream', reason: 'new-message', probability: 0.8, confidence: 0.9 });
    });

    it('replies in the chosen thread above both thresholds', () => {
        const decision = decideRoute(answers('thread_2', { new_message: 0.05, thread_1: 0.05, thread_2: 0.9 }, 0.95), two);
        expect(decision).toMatchObject({ destination: 'thread', threadRootId: 'b', reason: 'thread', probability: 0.9 });
    });

    it('falls back to the stream when the thread holds no majority', () => {
        const decision = decideRoute(answers('thread_1', { new_message: 0.3, thread_1: 0.45, thread_2: 0.25 }, 0.9), two);
        expect(decision).toMatchObject({ destination: 'stream', reason: 'uncertain', probability: 0.45 });
    });

    it('falls back to the stream when the continuation judgment disagrees', () => {
        const decision = decideRoute(answers('thread_1', { new_message: 0.2, thread_1: 0.7, thread_2: 0.1 }, 0.3), two);
        expect(decision).toMatchObject({ destination: 'stream', reason: 'uncertain' });
    });

    it('falls back to the stream on an option it cannot map', () => {
        const decision = decideRoute(answers('thread_9', { thread_9: 1 }, 1), two);
        expect(decision).toMatchObject({ destination: 'stream', reason: 'uncertain' });
    });

    it('treats a missing continuation answer as agreement', () => {
        const decision = decideRoute(answers('thread_1', { new_message: 0.1, thread_1: 0.8, thread_2: 0.1 }), two);
        expect(decision).toMatchObject({ destination: 'thread', threadRootId: 'a' });
    });

    it('throws when the destination answer is missing', () => {
        expect(() => decideRoute({}, two)).toThrow(/no destination/);
    });
});
