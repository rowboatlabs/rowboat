import type { FindCandidate, FindResult } from '@x/shared/dist/find.js';
import type { ChoiceQuestion, Json, NoulQuestion, SystemOneResponse } from './client.js';

// /find (2026-09-24): which of these messages is the person looking for? The
// reranking shape from the TypeSafe cookbooks: retrieval happened in the
// renderer (recent roots plus the org's word-search hits), Jev picks by
// meaning from that bounded list, and code reads the whole distribution so
// "not this, next" needs no second call. Pure; find_message.ts wires it to
// the client.

export const MAX_FIND_CANDIDATES = 50;
export const MAX_FIND_TEXT_CHARS = 240;
export const MAX_QUERY_CHARS = 500;
/** Below this on "is it here at all?", nothing is worth landing on. */
export const PRESENCE_MIN = 0.5;

export const NONE_OPTION = 'none_of_these';
const optionKey = (index: number): string => `message_${index + 1}`;
const OPTION_RE = /^message_(\d+)$/;

function clip(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One entry per message (first wins), newest first, capped, text clipped. */
export function selectFindCandidates(candidates: readonly FindCandidate[]): FindCandidate[] {
    const seen = new Set<string>();
    const out: FindCandidate[] = [];
    for (const c of candidates) {
        if (seen.has(c.messageId)) continue;
        seen.add(c.messageId);
        out.push({ ...c, text: clip(c.text, MAX_FIND_TEXT_CHARS) });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_FIND_CANDIDATES);
}

export type FindQuestions = {
    match: ChoiceQuestion;
    present: NoulQuestion;
};

/**
 * The request: the query and the messages as state; one Choice over "which
 * one" with a none option, and one Noul on whether it is here at all. The
 * criteria point back into the state by path (`messages[i]`).
 */
export function buildFindRequest(
    input: { spaceName: string; query: string },
    candidates: readonly FindCandidate[],
): { state: Json; questions: FindQuestions } {
    const messages = candidates.map((c, i) => {
        const entry: Record<string, Json> = { id: optionKey(i), text: c.text, at: c.at };
        if (c.title) entry.thread_title = c.title;
        if (c.author) entry.by = c.author;
        if (c.messageId !== c.threadRootId) entry.is_reply = true;
        else if (c.replyCount !== undefined) entry.replies = c.replyCount;
        return entry;
    });
    const state: Record<string, Json> = {
        space: input.spaceName,
        query: clip(input.query, MAX_QUERY_CHARS),
        messages,
    };

    const criteria: ChoiceQuestion['criteria'] = {};
    candidates.forEach((c, i) => {
        const option: Record<string, Json> = { what: `The entry \`messages[${i}]\`` };
        if (c.title) option.thread_title = c.title;
        if (c.text) option.text = clip(c.text, 100);
        criteria[optionKey(i)] = option;
    });
    criteria[NONE_OPTION] = 'Nothing in `messages` is what the person is looking for';

    return {
        state,
        questions: {
            match: {
                type: 'choice',
                instructions: {
                    question: 'Which entry in `messages` is the person looking for, going by `query`?',
                    context:
                        '`query` is how they remember it, in their own words; the entry they mean may say it differently. Prefer the entry that IS the thing (the message or the thread about it) over one that only mentions it in passing.',
                },
                criteria,
            },
            present: {
                type: 'noul',
                instructions: 'Is the message or thread described by `query` among `messages` at all?',
                criteria: {
                    true: 'One of the entries is what they are looking for',
                    false: 'None of the entries is it; they would need to search elsewhere',
                },
            },
        },
    };
}

/** Code's half: the whole distribution as a ranking, and whether the top of it is worth landing on. */
export function decideFind(answers: SystemOneResponse['answers'], candidates: readonly FindCandidate[]): FindResult {
    const match = answers.match;
    if (!match || match.type !== 'choice') throw new Error('TypeSafe returned no match choice');
    const ranked = candidates
        .map((c, i) => ({ messageId: c.messageId, probability: match.probabilities[optionKey(i)] ?? 0 }))
        .filter((r) => r.probability > 0)
        .sort((a, b) => b.probability - a.probability);
    const present = answers.present;
    const presence = present?.type === 'noul' ? present.noul : undefined;
    const pickedNone = match.choice === NONE_OPTION || !OPTION_RE.test(match.choice);
    const found = ranked.length > 0 && !pickedNone && (presence === undefined || presence >= PRESENCE_MIN);
    return {
        reason: 'ranked',
        ranked,
        ...(presence === undefined ? {} : { presence }),
        confidence: match.confidence,
        found,
    };
}
