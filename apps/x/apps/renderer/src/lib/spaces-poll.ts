import type { spaces } from '@x/shared'

// Polls, the Discord model (CONTRACT.md "Polls are a field on a message"):
// a first-class `poll` on the message — question, 2–10 answers, expiry from
// a duration, optional multiselect — with votes folded per answer. This file
// is the renderer's poll math: the markdown fallback body poll-blind clients
// render, the client-side vote fold mirroring the org's, and the one-call
// post. The old convention (a "q | a | b" text command, numbered options,
// seeded reactions) is gone — existing messages of that shape stay ordinary
// messages and render as before.

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

export const POLL_MAX_ANSWERS = 10
export const POLL_QUESTION_MAX = 300
export const POLL_ANSWER_MAX = 55

/** Duration choices — Discord's set. */
export const POLL_DURATIONS: Array<{ hours: number; label: string }> = [
    { hours: 1, label: '1 hour' },
    { hours: 4, label: '4 hours' },
    { hours: 8, label: '8 hours' },
    { hours: 24, label: '24 hours' },
    { hours: 72, label: '3 days' },
    { hours: 168, label: '1 week' },
    { hours: 336, label: '2 weeks' },
]
export const POLL_DEFAULT_HOURS = 24

/** The markdown fallback body — what poll-blind clients, search, and notifications see. */
export function buildPollFallbackBody(input: spaces.SpacesNewPollInput): string {
    const lines = input.answers.map((a, i) => `${a.emoji ?? NUMBERS[i] ?? '•'} ${a.text}`)
    return `📊 **${input.question}**\n\n${lines.join('\n')}`
}

/** Closed = ended early or expired — the same lazy rule the org enforces. */
export function pollClosed(poll: spaces.Poll, now: Date = new Date()): boolean {
    return !!poll.endedAt || Date.parse(poll.expiresAt) <= now.getTime()
}

/** The viewer's current answers. */
export function myPollVotes(poll: spaces.Poll, memberId: string | undefined): number[] {
    if (!memberId) return []
    return poll.votes.filter((g) => g.memberIds.includes(memberId)).map((g) => g.answerId)
}

/** Distinct voters — the percentage denominator (multiselect vote totals sum past 100%). */
export function pollVoterCount(poll: spaces.Poll): number {
    return new Set(poll.votes.flatMap((g) => g.memberIds)).size
}

/**
 * Fold one vote toggle — the applyReaction of polls. On a single-select add
 * the member leaves every other group first (the org's move rule), so one
 * `added` fold matches the org's removed+added event pair.
 */
export function applyPollVote(
    poll: spaces.Poll,
    event: { answerId: number; memberId: string; action: 'added' | 'removed' },
): spaces.Poll {
    let votes = poll.votes
    if (event.action === 'added' && !poll.allowMultiselect) {
        votes = votes
            .map((g) => (g.answerId === event.answerId ? g : { ...g, memberIds: g.memberIds.filter((id) => id !== event.memberId) }))
            .filter((g) => g.memberIds.length > 0)
    }
    const existing = votes.find((g) => g.answerId === event.answerId)
    if (event.action === 'added') {
        if (existing?.memberIds.includes(event.memberId)) return { ...poll, votes }
        const next = existing
            ? votes.map((g) => (g.answerId === event.answerId ? { ...g, memberIds: [...g.memberIds, event.memberId] } : g))
            : [...votes, { answerId: event.answerId, memberIds: [event.memberId] }]
        // Groups stay in answer order, matching the org's fold.
        const order = new Map(poll.answers.map((a, i) => [a.id, i]))
        return { ...poll, votes: [...next].sort((a, b) => (order.get(a.answerId) ?? 0) - (order.get(b.answerId) ?? 0)) }
    }
    if (!existing?.memberIds.includes(event.memberId)) return { ...poll, votes }
    return {
        ...poll,
        votes: votes
            .map((g) => (g.answerId === event.answerId ? { ...g, memberIds: g.memberIds.filter((id) => id !== event.memberId) } : g))
            .filter((g) => g.memberIds.length > 0),
    }
}

/** "45m left" / "23h left" / "5d left" / "Final results" — Discord's footer wording. */
export function pollDeadlineLabel(poll: spaces.Poll, now: Date = new Date()): string {
    if (pollClosed(poll, now)) return 'Final results'
    const minutes = Math.max(1, Math.round((Date.parse(poll.expiresAt) - now.getTime()) / 60_000))
    if (minutes < 60) return `${minutes}m left`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours}h left`
    return `${Math.round(hours / 24)}d left`
}

/** Post the poll — one call; the poll rides postMessage (no seed reactions, no +1 artifact). */
export async function postPoll(opts: {
    orgId: string
    spaceId: string
    topicId: string
    input: spaces.SpacesNewPollInput
}): Promise<{ topic: spaces.Topic; message: spaces.Message }> {
    const { orgId, spaceId, topicId, input } = opts
    return window.ipc.invoke('spaces:postMessage', { orgId, spaceId, topicId, body: buildPollFallbackBody(input), poll: input })
}
