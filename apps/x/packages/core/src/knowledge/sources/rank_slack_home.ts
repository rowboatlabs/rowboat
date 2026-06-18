export type SlackHomeRankCandidate = {
    id: string;
    workspaceName?: string;
    channelName?: string;
    author?: string;
    text: string;
    ts: string;
};

const EXPIRED_ROUTINE_AGE_MS = 2 * 60 * 60 * 1000;
const ROUTINE_EVENT_RE = /\b(stand[-\s]?up|daily\s+(sync|scrum|standup)|scrum|check[-\s]?in)\b/i;
const ROUTINE_LOGISTICS_RE = /\b(skip|skipping|miss|missing|can't|cannot|cant|won't|wont|join|attend|possible|move|reschedule|shift|late|running\s+late|stomach|sick|not\s+feeling|headache|doctor|appointment|today|todays|today's|tomorrow|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i;

// Durable signals always win: a message matching any of these is kept even if
// it would otherwise look like noise (a system message, a "done", etc.).
const DURABLE_SIGNAL_RE = /\b(blocker|blocked|decision|decided|owner|deadline|shipped|fixed|done|launched|deployed|merged|bug|issue|incident|outage|customer|contract|pricing|proposal|launch|release|handoff|review|approval|approved)\b/i;

// Slack system / automated messages render as plain narration like
// "<name> has joined the channel". They carry no human content, so drop them.
const SYSTEM_MESSAGE_RE = /\b(has joined the channel|has left the channel|was added to|has been added|set the channel (topic|purpose|description)|cleared the channel (topic|purpose)|renamed the channel|archived the channel|un-?archived the channel|pinned a message|joined the (call|huddle)|started a (call|huddle)|set up a call)\b/i;

// Greetings / acknowledgements with no informational content. Anchored to the
// whole (trimmed) message so "ok" drops but "ok, the deploy is blocked" stays.
const TRIVIAL_RE = /^(hi|hello+|hey+|yo|gm|gn|good\s*(morning|night|evening|afternoon)|morning|thanks?|thank\s*you|ty|thx|tysm|np|no\s*problem|ok(ay)?|k|got\s*it|gotcha|lgtm|\+1|nice|cool|great|awesome|perfect|done|yes+|yep|yup|no+|nope|sure|sounds?\s*good|sg|welcome|congrats?|congratulations)[\s.!?]*$/i;

const EMOJI_SHORTCODE_RE = /:[a-z0-9_+-]+:/gi;

function slackTsToMs(ts: string): number | null {
    const seconds = Number(ts.split('.')[0]);
    if (!Number.isFinite(seconds)) return null;
    return seconds * 1000;
}

// Newest-first recency ordering, capped at limit. The Home card shows "latest
// messages", so recency is the ordering once noise is filtered out.
function timeRank(candidates: SlackHomeRankCandidate[], limit: number): string[] {
    return [...candidates]
        .sort((a, b) => Number(b.ts) - Number(a.ts))
        .slice(0, limit)
        .map(candidate => candidate.id);
}

// What remains after removing :shortcodes:, unicode emoji/symbols, punctuation
// and whitespace. Empty ⇒ the message was emoji/reaction-only.
function strippedToCore(text: string): string {
    return text
        .replace(EMOJI_SHORTCODE_RE, '')
        .replace(/[\s\p{P}\p{S}]/gu, '')
        .trim();
}

function isExpiredRoutineLogistics(candidate: SlackHomeRankCandidate, nowMs: number): boolean {
    const sentAtMs = slackTsToMs(candidate.ts);
    if (sentAtMs === null) return false;
    if (nowMs - sentAtMs < EXPIRED_ROUTINE_AGE_MS) return false;

    const text = candidate.text.replace(/\s+/g, ' ').trim();
    if (!ROUTINE_EVENT_RE.test(text)) return false;
    if (DURABLE_SIGNAL_RE.test(text)) return false;

    return ROUTINE_LOGISTICS_RE.test(text);
}

// Low-value classes that never belong on Home: empty bodies, Slack system
// messages, emoji/reaction-only posts, and bare greetings/acks. A durable
// signal overrides all of these.
function isLowValueNoise(candidate: SlackHomeRankCandidate): boolean {
    const text = candidate.text.replace(/\s+/g, ' ').trim();
    if (!text) return true;
    if (DURABLE_SIGNAL_RE.test(text)) return false;
    if (SYSTEM_MESSAGE_RE.test(text)) return true;
    if (TRIVIAL_RE.test(text)) return true;
    return strippedToCore(text).length === 0;
}

export function filterSlackHomeCandidatesForRelevance(
    candidates: SlackHomeRankCandidate[],
    nowMs = Date.now(),
): SlackHomeRankCandidate[] {
    return candidates.filter(candidate =>
        !isExpiredRoutineLogistics(candidate, nowMs) && !isLowValueNoise(candidate));
}

// Deterministic Home feed: drop noise, then order by recency and cap. No LLM
// call — the filter does the de-noising and recency does the ordering.
// (kept async so the IPC caller's contract is unchanged.)
export async function rankSlackHomeMessages(
    candidates: SlackHomeRankCandidate[],
    limit: number,
): Promise<string[]> {
    return timeRank(filterSlackHomeCandidatesForRelevance(candidates), limit);
}
