import { describe, expect, it } from 'vitest';
import type { RouteCandidate } from '@x/shared/dist/auto-route.js';
import type { SystemOneResponse } from './client.js';
import {
    HERE_QUESTION,
    MAX_CANDIDATES,
    MAX_PEOPLE,
    MAX_ROOT_CHARS,
    MAX_TAGS,
    NEW_MESSAGE_OPTION,
    buildRouteRequest,
    decideRoute,
    nameAppears,
    selectCandidates,
    selectPeople,
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
    extra: SystemOneResponse['answers'] = {},
): SystemOneResponse['answers'] => ({
    destination: { type: 'choice', choice, probabilities, confidence },
    ...(noul === undefined ? {} : { continues_existing: { type: 'noul', noul } }),
    ...extra,
});

const noul = (value: number): SystemOneResponse['answers'][string] => ({ type: 'noul', noul: value });

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

describe('nameAppears', () => {
    it('matches the full name or a first name of three letters as a whole word', () => {
        expect(nameAppears('ask Sam Rivera about it', 'Sam Rivera')).toBe(true);
        expect(nameAppears('ask sam about it', 'Sam Rivera')).toBe(true);
        expect(nameAppears('samples are ready', 'Sam Rivera')).toBe(false);
        expect(nameAppears('will do', 'Wi Lee')).toBe(false);
        expect(nameAppears('cc Al', 'Al Ng')).toBe(false);
    });
});

describe('selectPeople', () => {
    const members = [
        { id: 'me', name: 'Arjun' },
        { id: 'sam', name: 'Sam Rivera' },
        { id: 'priya', name: 'Priya' },
        { id: 'quiet', name: 'Quiet Person' },
    ];
    const roots = [
        candidate({ rootMessageId: 'r1', rootAuthorId: 'sam', rootAuthor: 'Sam Rivera', lastActivityAt: '2026-09-22T10:00:00.000Z' }),
        candidate({ rootMessageId: 'r2', rootAuthorId: 'priya', rootAuthor: 'Priya', lastActivityAt: '2026-09-22T12:00:00.000Z' }),
        candidate({ rootMessageId: 'r3', rootAuthorId: 'sam', rootAuthor: 'Sam Rivera', lastActivityAt: '2026-09-22T11:00:00.000Z' }),
        candidate({ rootMessageId: 'r4', rootAuthorId: 'me', rootAuthor: 'Arjun' }),
        candidate({ rootMessageId: 'r5', rootAuthor: 'Arjun (rowboat)' }),
        candidate({ rootMessageId: 'r6', rootAuthorId: 'gone', rootAuthor: 'Left The Org' }),
    ];

    it('takes candidate authors, merges their roots, skips the sender, agents and ex-members', () => {
        const people = selectPeople({ draft: 'hello all', members, senderId: 'me' }, roots);
        expect(people.map((p) => p.memberId)).toEqual(['priya', 'sam']);
        expect(people[1]).toMatchObject({ name: 'Sam Rivera', wrote: [0, 2], lastActiveAt: '2026-09-22T11:00:00.000Z', namedInDraft: false });
    });

    it('puts a member named in the draft first, even with no recent roots', () => {
        const people = selectPeople({ draft: 'Quiet, can you take this?', members, senderId: 'me' }, roots);
        expect(people[0]).toMatchObject({ memberId: 'quiet', wrote: [], namedInDraft: true });
        expect(people.map((p) => p.memberId)).toEqual(['quiet', 'priya', 'sam']);
    });

    it('caps the list', () => {
        const many = Array.from({ length: MAX_PEOPLE + 4 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
        const manyRoots = many.map((m, i) => candidate({ rootMessageId: `r${i}`, rootAuthorId: m.id, lastActivityAt: `2026-09-${String(1 + i).padStart(2, '0')}T00:00:00.000Z` }));
        expect(selectPeople({ draft: 'x', members: many }, manyRoots)).toHaveLength(MAX_PEOPLE);
    });

    it('falls back to the candidate author name when no member list is given', () => {
        const people = selectPeople({ draft: 'x' }, roots);
        expect(people.map((p) => p.name)).toContain('Left The Org');
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

    it('adds people to the state with references into threads, and a question per person plus @here', () => {
        const members = [{ id: 'me', name: 'Arjun' }, { id: 'sam', name: 'Sam' }, { id: 'priya', name: 'Priya' }];
        const roots = [
            candidate({ rootMessageId: 'a', rootAuthorId: 'sam', rootAuthor: 'Sam' }),
            candidate({ rootMessageId: 'b', rootAuthorId: 'sam', rootAuthor: 'Sam', lastActivityAt: '2026-09-22T11:00:00.000Z' }),
        ];
        const { state, questions, people } = buildRouteRequest({ spaceName: 'eng', draft: 'Priya, can you look?', members, senderId: 'me' }, roots);
        expect(people.map((p) => p.memberId)).toEqual(['priya', 'sam']);
        const s = state as { people: Record<string, unknown>[] };
        expect(s.people[0]).toMatchObject({ id: 'tag_person_1', name: 'Priya', wrote: [], named_in_draft: true });
        expect(s.people[1]).toMatchObject({ id: 'tag_person_2', name: 'Sam', wrote: ['threads[0]', 'threads[1]'], last_active: '2026-09-22T11:00:00.000Z' });
        expect(questions.tag_person_1?.type).toBe('noul');
        expect(JSON.stringify(questions.tag_person_2?.instructions)).toContain('`people[1]`');
        expect(questions[HERE_QUESTION]?.type).toBe('noul');
    });

    it('asks no tag questions when switched off', () => {
        const members = [{ id: 'me', name: 'Arjun' }, { id: 'sam', name: 'Sam' }];
        const { state, questions, people } = buildRouteRequest(
            { spaceName: 'eng', draft: 'Sam?', members, senderId: 'me', suggestTags: false },
            [candidate({ rootMessageId: 'a', rootAuthorId: 'sam', rootAuthor: 'Sam' })],
        );
        expect(people).toEqual([]);
        expect(state).not.toHaveProperty('people');
        expect(Object.keys(questions)).toEqual(['destination', 'continues_existing']);
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

    describe('tags', () => {
        const people = Array.from({ length: MAX_TAGS + 2 }, (_, i) => ({ memberId: `m${i}`, name: `P${i}`, wrote: [], lastActiveAt: null, namedInDraft: false }));
        const tagAnswers = { tag_person_1: noul(0.95), tag_person_2: noul(0.2), tag_person_3: noul(0.75), tag_person_4: noul(0.9), tag_person_5: noul(0.71), tag_here: noul(0.85) };

        it('keeps the strongest few above the floor, on a stream verdict', () => {
            const decision = decideRoute(answers(NEW_MESSAGE_OPTION, { new_message: 1 }, 0, 1, tagAnswers), two, people);
            expect(decision.tags?.map((t) => t.memberId)).toEqual(['m0', 'm3', 'm2']);
            expect(decision.tags?.[0]).toMatchObject({ name: 'P0', probability: 0.95 });
            expect(decision.here).toBe(0.85);
        });

        it('offers nothing on a thread verdict, or below the floors', () => {
            const thread = decideRoute(answers('thread_1', { new_message: 0.1, thread_1: 0.8, thread_2: 0.1 }, 0.9, 0.9, tagAnswers), two, people);
            expect(thread.tags).toBeUndefined();
            expect(thread.here).toBeUndefined();
            const weak = decideRoute(answers(NEW_MESSAGE_OPTION, { new_message: 1 }, 0, 1, { tag_person_1: noul(0.5), tag_here: noul(0.6) }), two, people);
            expect(weak.tags).toBeUndefined();
            expect(weak.here).toBeUndefined();
        });
    });
});
