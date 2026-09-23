import type { AutoRouteDecision, AutoRouteRequest, RouteCandidate } from '@x/shared/dist/auto-route.js';
import type { ChoiceQuestion, Json, NoulQuestion, SystemOneResponse } from './client.js';

// Where a stream draft belongs: the stream, or one of the space's open threads
// (the composer's Auto toggle, 2026-09-22). Built the System One way: code
// assembles the state and the candidate set, Jev answers two narrow questions
// in one request, and code applies the thresholds. Jev never sees a thread
// id; the option keys map back to candidates here. Pure, so it is testable
// without the network; route_message.ts wires it to the client.

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

export const NEW_MESSAGE_OPTION = 'new_message';
const optionKey = (index: number): string => `thread_${index + 1}`;
const OPTION_RE = /^thread_(\d+)$/;

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

export type RouteQuestions = {
    destination: ChoiceQuestion;
    continues_existing: NoulQuestion;
};

/**
 * The request: the draft and the threads as state, one Choice over
 * "new message or which thread", and one Noul on whether the draft continues
 * anything at all. Both see the same state; the criteria point back into it
 * by path (`threads[i]`), the documented way to reference nested state.
 */
export function buildRouteRequest(
    input: Pick<AutoRouteRequest, 'spaceName' | 'draft' | 'authorName'>,
    candidates: readonly RouteCandidate[],
): { state: Json; questions: RouteQuestions } {
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

    return {
        state,
        questions: {
            destination: {
                type: 'choice',
                instructions: {
                    question: 'Where does `draft` belong in this team chat space?',
                    context:
                        '`threads` lists the open threads in the space, newest activity first. A message belongs in a thread when it continues that specific conversation: it answers it, adds to it, or reacts to it. Otherwise it is a new message in the main stream.',
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
        },
    };
}

/** Code's half of the decision: the thresholds over Jev's probabilities. */
export function decideRoute(answers: SystemOneResponse['answers'], candidates: readonly RouteCandidate[]): AutoRouteDecision {
    const destination = answers.destination;
    if (!destination || destination.type !== 'choice') throw new Error('TypeSafe returned no destination choice');
    const probability = destination.probabilities[destination.choice] ?? 0;
    const scored = { probability, confidence: destination.confidence };
    if (destination.choice === NEW_MESSAGE_OPTION) return { destination: 'stream', reason: 'new-message', ...scored };

    const match = OPTION_RE.exec(destination.choice);
    const candidate = match ? candidates[Number(match[1]) - 1] : undefined;
    const continues = answers.continues_existing;
    const continuesProbability = continues?.type === 'noul' ? continues.noul : 1;
    if (!candidate || probability < THREAD_MIN_PROBABILITY || continuesProbability < CONTINUES_MIN) {
        return { destination: 'stream', reason: 'uncertain', ...scored };
    }
    return { destination: 'thread', threadRootId: candidate.rootMessageId, reason: 'thread', ...scored };
}
