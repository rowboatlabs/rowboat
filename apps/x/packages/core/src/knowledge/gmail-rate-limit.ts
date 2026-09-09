import type { Common } from 'googleapis';

/**
 * Gmail rate-limit detection and the cross-cycle cooldown (the follow-up
 * deferred by #869, hardened after the first field reports on v0.9.1).
 *
 * Three layers use this module:
 *   - GoogleClientFactory.gmailClient()'s retry hooks classify errors
 *     (isRateLimitError), size the single in-request retry
 *     (inRequestRetryWaitMs), and arm the cooldown (noteGmailRateLimit)
 *     whenever a throttled request is about to fail through to the caller.
 *   - The background loops (sync_gmail's 30s tick, gmail_sent_contacts'
 *     refresh, agent_notes' email backfill) consult gmailRateLimitCooldownMs()
 *     and stand down while it is positive; the heavy maintenance passes
 *     (inbox prune, classify sweep, timer backfill) also honor
 *     gmailQuotaTight(), which extends the pause through a short grace after
 *     the lockout ends so the first pass back is the lean core sync only.
 *   - getUserEmail (classify_thread.ts) doubles as a cheap recovery probe:
 *     its 1-quota-unit getProfile is allowed through during a lockout (at
 *     most once a minute) and calls noteGmailSuccess() on success, ending a
 *     stale cooldown the moment Gmail actually recovers.
 *
 * Cooldown policy, learned the hard way:
 *   - A deadline Gmail names (Retry-After header, or the "Retry after
 *     <timestamp>" embedded in the error message) is always honored, and may
 *     extend an active cooldown — it is Gmail's own word.
 *   - Our no-deadline fallback NEVER extends an active cooldown. v0.9.1 let
 *     it, and un-gated callers failing during a lockout kept sliding the
 *     promised resume time forward ("next attempt at 5:25" → 5:31 → …).
 *   - The fallback escalates per EPISODE (a new cooldown armed from an
 *     expired state), not per failing request — concurrent callers used to
 *     each count a strike and jump the ladder straight to its cap.
 *
 * The state is a process-wide in-memory singleton, deliberately not
 * persisted: lockouts are minutes long, restarts are rare mid-lockout, and a
 * stale on-disk deadline would silently pause sync after a crash.
 *
 * User-initiated actions (send, archive, mark read) do NOT consult the
 * cooldown — one interactive request can't sustain the limit, and an explicit
 * error beats a silent no-op.
 */

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/** Longest an in-request retry may wait; beyond this, fail fast and cool down. */
export const IN_REQUEST_RETRY_CAP_MS = 30_000;
/** In-request retry wait when Gmail names no deadline at all. */
export const IN_REQUEST_RETRY_FALLBACK_MS = 2_000;

// No-deadline cooldowns escalate per episode: 1m, 2m, 4m, ... capped at 15m.
// A quiet EPISODE_RESET_MS after a cooldown ends starts the ladder over.
const NO_DEADLINE_BASE_COOLDOWN_MS = 60_000;
const NO_DEADLINE_MAX_COOLDOWN_MS = 15 * 60_000;
const EPISODE_RESET_MS = 10 * 60_000;
// Sanity clamp on Gmail-supplied deadlines (clock skew, malformed dates).
const DEADLINE_CAP_MS = 6 * 60 * 60_000;
// After a cooldown expires, heavy maintenance passes stay paused this long so
// the first pass back doesn't re-trip the quota with a full burst.
const POST_COOLDOWN_GRACE_MS = 60_000;

export type GmailCooldownSource = 'gmail' | 'default';

let cooldownUntil = 0;
let cooldownSource: GmailCooldownSource = 'default';
let strikes = 0;

/** 429 anywhere, or Gmail's alternate 403-with-rate-limit-reason form. */
export function isRateLimitError(err: Common.GaxiosError): boolean {
    const status = err.response?.status ?? err.status;
    if (status === 429) return true;
    if (status !== 403) return false;
    const data = err.response?.data as { error?: { errors?: { reason?: string }[] } } | undefined;
    return (data?.error?.errors ?? []).some((e) => e.reason !== undefined && RATE_LIMIT_REASONS.has(e.reason));
}

/** Tolerates both fetch Headers (gaxios v7) and plain-object headers. */
function headerValue(err: Common.GaxiosError, name: string): string | null {
    const headers = err.response?.headers as unknown;
    if (!headers) return null;
    if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
    const record = headers as Record<string, string | string[] | undefined>;
    const raw = record[name] ?? record[name.toLowerCase()];
    return (Array.isArray(raw) ? raw[0] : raw) ?? null;
}

/**
 * "Retry after <timestamp>" parsed out of free text. Gmail's flood-control
 * message has been observed as ISO-with-T ("2026-08-31T17:26:00.123Z") but
 * this also accepts a space separator, a UTC/GMT/offset suffix, and no zone
 * at all (Gmail timestamps are UTC, so a missing zone normalizes to Z —
 * Date.parse would otherwise read a bare timestamp as LOCAL time).
 */
function parseRetryAfterTimestamp(text: string, now: number): number | null {
    const match = /retry\s*after\s+['"]?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?/i.exec(text);
    if (!match) return null;
    const base = match[1].replace(' ', 'T');
    const zoneRaw = match[2]?.toUpperCase();
    let zone: string;
    if (!zoneRaw || zoneRaw === 'Z' || zoneRaw === 'UTC' || zoneRaw === 'GMT') {
        zone = 'Z';
    } else {
        zone = zoneRaw.includes(':') ? zoneRaw : `${zoneRaw.slice(0, 3)}:${zoneRaw.slice(3)}`;
    }
    const asDate = Date.parse(base + zone);
    return Number.isFinite(asDate) && asDate > now ? asDate : null;
}

/**
 * Epoch-ms deadline after which Gmail says a throttled request may be retried,
 * or null when the error names none. Checks the Retry-After header (delta
 * seconds or HTTP-date) first, then the "Retry after <timestamp>" Gmail
 * embeds in the error message and/or response body.
 */
export function rateLimitDeadlineMs(err: Common.GaxiosError, now: number = Date.now()): number | null {
    const header = headerValue(err, 'retry-after');
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
        const asDate = Date.parse(header);
        if (Number.isFinite(asDate) && asDate > now) return asDate;
    }

    const data = err.response?.data as unknown;
    const dataMessage = typeof data === 'string'
        ? data
        : (data as { error?: { message?: string } } | undefined)?.error?.message ?? '';
    return parseRetryAfterTimestamp(`${err.message ?? ''}\n${dataMessage}`, now);
}

/**
 * How long the single in-request retry should wait, or null when the deadline
 * outlasts IN_REQUEST_RETRY_CAP_MS — then retrying in-request is pointless
 * (and burns another quota-counted call): fail fast and cool down instead.
 */
export function inRequestRetryWaitMs(err: Common.GaxiosError, now: number = Date.now()): number | null {
    const deadline = rateLimitDeadlineMs(err, now);
    if (deadline === null) return IN_REQUEST_RETRY_FALLBACK_MS;
    const wait = deadline - now;
    return wait <= IN_REQUEST_RETRY_CAP_MS ? Math.max(wait, 1_000) : null;
}

/**
 * Arm (or extend) the cross-cycle cooldown for a rate-limit error that is
 * failing through to its caller. A Gmail-named deadline is always honored
 * (never shortened, clamped for sanity); without one, a fresh cooldown is
 * armed from the per-episode ladder — but an active cooldown is never
 * extended by our own guesses. Returns the cooldown end (epoch ms).
 */
export function noteGmailRateLimit(err: Common.GaxiosError, now: number = Date.now()): number {
    const deadline = rateLimitDeadlineMs(err, now);
    if (deadline !== null) {
        const until = Math.min(deadline, now + DEADLINE_CAP_MS);
        if (until > cooldownUntil) {
            cooldownUntil = until;
            cooldownSource = 'gmail';
        }
        return cooldownUntil;
    }

    if (cooldownUntil > now) return cooldownUntil;

    if (now - cooldownUntil > EPISODE_RESET_MS) strikes = 0;
    strikes += 1;
    cooldownUntil = now + Math.min(NO_DEADLINE_BASE_COOLDOWN_MS * 2 ** (strikes - 1), NO_DEADLINE_MAX_COOLDOWN_MS);
    cooldownSource = 'default';
    return cooldownUntil;
}

/**
 * A Gmail request went through: quota is provably healthy. Ends any cooldown
 * (a stale default one, or Gmail relenting early) and resets the ladder.
 */
export function noteGmailSuccess(): void {
    cooldownUntil = 0;
    strikes = 0;
}

/** Milliseconds until Gmail may be called again; 0 when no cooldown is active. */
export function gmailRateLimitCooldownMs(now: number = Date.now()): number {
    return Math.max(0, cooldownUntil - now);
}

/** Active-cooldown details for logging/notices, or null when none is active. */
export function gmailCooldownInfo(now: number = Date.now()): { remainingMs: number; until: number; source: GmailCooldownSource } | null {
    if (cooldownUntil <= now) return null;
    return { remainingMs: cooldownUntil - now, until: cooldownUntil, source: cooldownSource };
}

/**
 * Whether heavy, deferrable Gmail work (inbox prune, classify sweep, timer
 * backfill) should stand down: an active cooldown, or the short grace right
 * after one — so the first pass back is the lean core sync, not a burst that
 * immediately re-trips the quota. noteGmailSuccess() ends the grace early.
 */
export function gmailQuotaTight(now: number = Date.now()): boolean {
    if (cooldownUntil > now) return true;
    return cooldownUntil > 0 && now - cooldownUntil < POST_COOLDOWN_GRACE_MS;
}

export function resetGmailRateLimitForTests(): void {
    cooldownUntil = 0;
    cooldownSource = 'default';
    strikes = 0;
}
