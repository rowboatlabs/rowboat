import type { AutoRouteDecision, AutoRouteRequest, RouteCandidate, TagSuggestion } from '@x/shared/dist/auto-route.js';
import type { ChoiceQuestion, Json, NoulQuestion, SystemOneResponse } from './client.js';

// Where a stream draft belongs: the stream, or one of the space's open threads
// (the composer's Auto toggle, 2026-09-22). Built the System One way: code
// assembles the state and the candidate set, Jev answers narrow questions in
// one request, and code applies the thresholds. Jev never sees a thread id
// or a member id; the option keys map back to candidates and people here.
// Pure, so it is testable without the network; route_message.ts wires it to
// the client.
//
// Tag suggestions (2026-09-24) ride the same request: one Noul per person
// drawn from the same recent roots ("does the draft need their attention?"),
// plus one for @here. Speculative: code reads them only on a stream verdict,
// since a reply already reaches its thread.

/** The newest threads matter most, and a root's gist fits in a few hundred chars. */
export const MAX_CANDIDATES = 40;
export const MAX_ROOT_CHARS = 300;
export const MAX_DRAFT_CHARS = 4000;

// Starting points, not laws (the docs: thresholds scale with risk; validate on
// real traffic). A thread must beat the stream AND every other thread
// combined. That is probability rather than confidence, so the bar does not
// move with the number of open threads. The separate "continues a
// conversation" judgment must agree. A reply in the wrong thread is worse
// than a root in the stream, so every tie goes to the stream.
export const THREAD_MIN_PROBABILITY = 0.5;
export const CONTINUES_MIN = 0.5;

// A tag notifies someone, so the floor is high and the list short. Nothing
// is ever inserted on its own; these are offers.
export const MAX_PEOPLE = 15;
export const TAG_MIN_PROBABILITY = 0.7;
export const HERE_MIN_PROBABILITY = 0.8;
export const MAX_TAGS = 3;

export const NEW_MESSAGE_OPTION = 'new_message';
const optionKey = (index: number): string => `thread_${index + 1}`;
const OPTION_RE = /^thread_(\d+)$/;
const personKey = (index: number): `tag_person_${number}` => `tag_person_${index + 1}`;
export const HERE_QUESTION = 'tag_here';

function clip(text: string, max: number): string {
    const flat = text.trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Newest activity first, capped, roots clipped: the bounded set that goes to Jev. */
export function selectCandidates(candidates: readonly RouteCandidate[]): RouteCandidate[] {
    return [...candidates]
        .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0))
        .slice(0, MAX_CANDIDATES)
        .map((c) => ({ ...c, rootText: clip(c.rootText, MAX_ROOT_CHARS) }));
}

/** A person Jev may be asked about: a member and what they wrote among the candidates. */
export interface RoutePerson {
    memberId: string;
    name: string;
    /** Indexes into the candidate list: the `threads[i]` this person wrote. */
    wrote: number[];
    lastActiveAt: string | null;
    namedInDraft: boolean;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (word: string): RegExp => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}(?=$|[^\\p{L}\\p{N}])`, 'iu');

/** The full display name as a whole word, or a first name of three letters or more. Jev judges the rest. */
export function nameAppears(draft: string, name: string): boolean {
    const full = name.trim();
    if (!full) return false;
    if (wordRe(full).test(draft)) return true;
    const first = full.split(/\s+/)[0] ?? '';
    return first.length >= 3 && wordRe(first).test(draft);
}

/**
 * The people worth asking about: authors of the candidate roots (direct
 * posts only, which is what carries an id) and members named in the draft,
 * named-first then newest activity, capped. The sender is never one, and
 * neither is anyone who has left, when the member list is known.
 */
export function selectPeople(
    input: Pick<AutoRouteRequest, 'draft' | 'members' | 'senderId'>,
    candidates: readonly RouteCandidate[],
): RoutePerson[] {
    const members = input.members ? new Map(input.members.map((m) => [m.id, m.name])) : null;
    const byId = new Map<string, RoutePerson>();
    const personFor = (id: string, name: string): RoutePerson => {
        const existing = byId.get(id);
        if (existing) return existing;
        const created: RoutePerson = { memberId: id, name, wrote: [], lastActiveAt: null, namedInDraft: false };
        byId.set(id, created);
        return created;
    };
    candidates.forEach((c, i) => {
        const id = c.rootAuthorId;
        if (!id || id === input.senderId) return;
        const name = members ? members.get(id) : c.rootAuthor;
        if (!name) return;
        const person = personFor(id, name);
        person.wrote.push(i);
        if (!person.lastActiveAt || c.lastActivityAt > person.lastActiveAt) person.lastActiveAt = c.lastActivityAt;
    });
    for (const [id, name] of members ?? []) {
        if (id === input.senderId || !nameAppears(input.draft, name)) continue;
        personFor(id, name).namedInDraft = true;
    }
    return [...byId.values()]
        .sort((a, b) => {
            if (a.namedInDraft !== b.namedInDraft) return a.namedInDraft ? -1 : 1;
            const x = a.lastActiveAt ?? '';
            const y = b.lastActiveAt ?? '';
            return x < y ? 1 : x > y ? -1 : 0;
        })
        .slice(0, MAX_PEOPLE);
}

export type RouteQuestions = {
    destination: ChoiceQuestion;
    continues_existing: NoulQuestion;
    [tag: `tag_${string}`]: NoulQuestion;
};

/**
 * The request: the draft, the threads and the people as state; one Choice
 * over "new message or which thread", one Noul on whether the draft continues
 * anything at all, one Noul per person, one for @here. All see the same
 * state; the criteria point back into it by path (`threads[i]`,
 * `people[i]`), the documented way to reference nested state.
 */
export function buildRouteRequest(
    input: Pick<AutoRouteRequest, 'spaceName' | 'draft' | 'authorName' | 'members' | 'senderId' | 'suggestTags'>,
    candidates: readonly RouteCandidate[],
): { state: Json; questions: RouteQuestions; people: RoutePerson[] } {
    const threads = candidates.map((c, i) => {
        const thread: Record<string, Json> = {
            id: optionKey(i),
            first_message: c.rootText,
            replies: c.replyCount,
            last_activity: c.lastActivityAt,
        };
        if (c.title) thread.title = c.title;
        if (c.rootAuthor) thread.started_by = c.rootAuthor;
        return thread;
    });
    const state: Record<string, Json> = {
        space: input.spaceName,
        draft: clip(input.draft, MAX_DRAFT_CHARS),
        threads,
    };
    if (input.authorName) state.author = input.authorName;

    const criteria: ChoiceQuestion['criteria'] = {
        [NEW_MESSAGE_OPTION]: {
            what: "A new root message in the space's main stream",
            when: 'The draft starts a new subject, is a general announcement or question, or does not continue any listed thread',
        },
    };
    candidates.forEach((c, i) => {
        const option: Record<string, Json> = { what: `A reply in the thread \`threads[${i}]\`` };
        if (c.title) option.title = c.title;
        else option.first_message = clip(c.rootText, 120);
        criteria[optionKey(i)] = option;
    });

    const questions: RouteQuestions = {
        destination: {
            type: 'choice',
            instructions: {
                question: 'Where does `draft` belong in this team chat space?',
                context:
                    '`threads` lists the recent messages and open threads in the space, newest activity first; replying to any of them continues its thread. A message belongs in a thread when it continues that specific conversation: it answers it, adds to it, or reacts to it. Otherwise it is a new message in the main stream.',
            },
            criteria,
        },
        continues_existing: {
            type: 'noul',
            instructions:
                'Does `draft` continue one of the conversations in `threads` (answering, adding to, or reacting to one) rather than start something new?',
            criteria: {
                true: 'The draft replies to something said in one of the listed threads',
                false: 'The draft stands on its own: a new subject, announcement, or question',
            },
        },
    };

    const askTags = input.suggestTags !== false;
    const people = askTags ? selectPeople(input, candidates) : [];
    if (people.length > 0) {
        state.people = people.map((p, i) => {
            const entry: Record<string, Json> = { id: personKey(i), name: p.name, wrote: p.wrote.map((w) => `threads[${w}]`) };
            if (p.lastActiveAt) entry.last_active = p.lastActiveAt;
            if (p.namedInDraft) entry.named_in_draft = true;
            return entry;
        });
        people.forEach((_, i) => {
            questions[personKey(i)] = {
                type: 'noul',
                instructions: {
                    question: `Does \`draft\` need the attention of \`people[${i}]\`?`,
                    yes_when: 'The draft is addressed to them, asks something of them, or continues something they wrote (their `wrote` entries in `threads`)',
                    not_when: 'Their name only comes up in passing, or they are merely active in the space',
                },
                criteria: { true: 'Tagging them would be expected', false: 'Tagging them would be noise' },
            };
        });
    }
    if (askTags && (input.members?.length ?? 0) > 1) {
        questions[HERE_QUESTION] = {
            type: 'noul',
            instructions:
                'Is `draft` an announcement or request that everyone in the space should see right away, rather than a message for a few people or a passing remark?',
            criteria: { true: 'Everyone should be notified (@here)', false: 'No need to notify everyone' },
        };
    }

    return { state, questions, people };
}

/** Code's half of the decision: the thresholds over Jev's probabilities. */
export function decideRoute(
    answers: SystemOneResponse['answers'],
    candidates: readonly RouteCandidate[],
    people: readonly RoutePerson[] = [],
): AutoRouteDecision {
    const destination = answers.destination;
    if (!destination || destination.type !== 'choice') throw new Error('TypeSafe returned no destination choice');
    const probability = destination.probabilities[destination.choice] ?? 0;
    const scored = { probability, confidence: destination.confidence };

    let decision: AutoRouteDecision;
    if (destination.choice === NEW_MESSAGE_OPTION) {
        decision = { destination: 'stream', reason: 'new-message', ...scored };
    } else {
        const match = OPTION_RE.exec(destination.choice);
        const candidate = match ? candidates[Number(match[1]) - 1] : undefined;
        const continues = answers.continues_existing;
        const continuesProbability = continues?.type === 'noul' ? continues.noul : 1;
        decision =
            !candidate || probability < THREAD_MIN_PROBABILITY || continuesProbability < CONTINUES_MIN
                ? { destination: 'stream', reason: 'uncertain', ...scored }
                : { destination: 'thread', threadRootId: candidate.rootMessageId, reason: 'thread', ...scored };
    }
    if (decision.destination !== 'stream') return decision;

    // Tags only on a stream verdict: a reply already reaches its thread.
    const tags: TagSuggestion[] = people
        .map((p, i) => ({ p, answer: answers[personKey(i)] }))
        .filter((x): x is { p: RoutePerson; answer: { type: 'noul'; noul: number } } => x.answer?.type === 'noul' && x.answer.noul >= TAG_MIN_PROBABILITY)
        .sort((a, b) => b.answer.noul - a.answer.noul)
        .slice(0, MAX_TAGS)
        .map(({ p, answer }) => ({ memberId: p.memberId, name: p.name, probability: answer.noul }));
    if (tags.length > 0) decision.tags = tags;
    const here = answers[HERE_QUESTION];
    if (here?.type === 'noul' && here.noul >= HERE_MIN_PROBABILITY) decision.here = here.noul;
    return decision;
}
