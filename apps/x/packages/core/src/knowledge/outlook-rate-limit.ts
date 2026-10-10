/**
 * Microsoft Graph rate-limit detection and cross-cycle cooldown for Outlook.
 *
 * Parity with Gmail's rate-limiting architecture (gmail-rate-limit.ts),
 * adapted to Microsoft Graph's HTTP 429 semantics and RFC 7231 Retry-After
 * headers.
 *
 * Three layers use this module:
 *   - OutlookClientFactory.graphFetch() classifies 429 responses, evaluates
 *     in-request retries (inRequestRetryWaitMs), and arms the cooldown
 *     (noteOutlookRateLimit) whenever a throttled request fails through to callers.
 *     It also calls noteOutlookSuccess() on successful 2xx responses.
 *   - The background loops (sync_outlook's 30s tick, sync_outlook_calendar's 60s
 *     tick, and outlook_sent_contacts' 30m refresh) consult
 *     outlookRateLimitCooldownMs() and stand down while it is positive. Heavy
 *     maintenance passes (inbox prune, sweepUnclassifiedSnapshots) also honor
 *     outlookQuotaTight(), extending the pause through a short grace period so
 *     the first pass back is the lean core sync only.
 *   - User-initiated actions (send reply, save draft, trash, archive) do NOT
 *     consult the cooldown — interactive requests must fail fast with explicit
 *     errors rather than silent no-ops.
 *
 * Cooldown policy:
 *   - A deadline Graph names (Retry-After header, either delta-seconds or HTTP-date)
 *     is always honored and may extend an active cooldown.
 *   - Our no-deadline fallback NEVER extends an active cooldown (prevents sliding
 *     deadlines forward).
 *   - The fallback escalates per EPISODE (a new cooldown armed from an expired state):
 *     1m, 2m, 4m, 8m, capped at 15m.
 *   - State is an in-memory singleton (not persisted across restarts).
 */

export type OutlookCooldownSource = 'graph' | 'default';

export interface OutlookCooldownInfo {
    remainingMs: number;
    until: number;
    source: OutlookCooldownSource;
}

let cooldownUntil = 0;
let cooldownSource: OutlookCooldownSource = 'default';
let strikes = 0;

/** Longest an in-request retry may wait; beyond this, fail fast and cool down. */
export const IN_REQUEST_RETRY_CAP_MS = 30_000;
/** In-request retry wait when Graph names no deadline at all. */
export const IN_REQUEST_RETRY_FALLBACK_MS = 2_000;

// No-deadline cooldowns escalate per episode: 1m, 2m, 4m, ... capped at 15m.
// A quiet EPISODE_RESET_MS after a cooldown ends starts the ladder over.
const NO_DEADLINE_BASE_COOLDOWN_MS = 60_000;
const NO_DEADLINE_MAX_COOLDOWN_MS = 15 * 60_000;
const EPISODE_RESET_MS = 10 * 60_000;
// Sanity clamp on Graph-supplied deadlines (clock skew, malformed dates).
const DEADLINE_CAP_MS = 6 * 60 * 60_000;
// After a cooldown expires, heavy maintenance passes stay paused this long so
// the first pass back doesn't re-trip the quota with a full burst.
const POST_COOLDOWN_GRACE_MS = 60_000;

/** Checks if an HTTP response status represents rate limiting (429). */
export function isRateLimitStatus(status: number): boolean {
    return status === 429;
}

/**
 * Parses the Retry-After header from Microsoft Graph into an epoch-ms deadline.
 * Supports delta-seconds (e.g. "120") and RFC 1123 HTTP-date (e.g. "Wed, 21 Oct 2026 07:28:00 GMT").
 * Returns null if the header is absent, invalid, or represents a time in the past.
 */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | null {
    if (!header) return null;
    const trimmed = header.trim();
    if (!trimmed) return null;

    // 1. Try delta-seconds
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds > 0) {
        return now + seconds * 1000;
    }

    // 2. Try HTTP-date
    const asDate = Date.parse(trimmed);
    if (Number.isFinite(asDate) && asDate > now) {
        return asDate;
    }

    return null;
}

/**
 * How long the single in-request retry should wait, or null when the deadline
 * outlasts IN_REQUEST_RETRY_CAP_MS — then retrying in-request is pointless:
 * fail fast and cool down instead.
 */
export function inRequestRetryWaitMs(retryAfterHeader: string | null | undefined, now: number = Date.now()): number | null {
    const deadline = parseRetryAfter(retryAfterHeader, now);
    if (deadline === null) return IN_REQUEST_RETRY_FALLBACK_MS;
    const wait = deadline - now;
    return wait <= IN_REQUEST_RETRY_CAP_MS ? Math.max(wait, 1_000) : null;
}

/**
 * Arm (or extend) the cross-cycle cooldown for a rate-limit error that is
 * failing through to its caller. A Graph-named deadline is always honored
 * (never shortened, clamped for sanity); without one, a fresh cooldown is
 * armed from the per-episode ladder — but an active cooldown is never
 * extended by our own guesses. Returns the cooldown end (epoch ms).
 */
export function noteOutlookRateLimit(retryAfterHeader?: string | null, now: number = Date.now()): number {
    const deadline = parseRetryAfter(retryAfterHeader, now);
    if (deadline !== null) {
        const until = Math.min(deadline, now + DEADLINE_CAP_MS);
        if (until > cooldownUntil) {
            cooldownUntil = until;
            cooldownSource = 'graph';
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
 * An Outlook Graph request went through: quota is provably healthy. Ends any cooldown
 * (a stale default one, or Graph relenting early) and resets the ladder.
 */
export function noteOutlookSuccess(): void {
    cooldownUntil = 0;
    strikes = 0;
}

/** Milliseconds until Outlook may be called again; 0 when no cooldown is active. */
export function outlookRateLimitCooldownMs(now: number = Date.now()): number {
    return Math.max(0, cooldownUntil - now);
}

/** Active-cooldown details for logging/notices, or null when none is active. */
export function outlookCooldownInfo(now: number = Date.now()): OutlookCooldownInfo | null {
    if (cooldownUntil <= now) return null;
    return { remainingMs: cooldownUntil - now, until: cooldownUntil, source: cooldownSource };
}

/**
 * Whether heavy, deferrable Outlook work (inbox prune, sweepUnclassifiedSnapshots)
 * should stand down: an active cooldown, or the short grace right after one —
 * so the first pass back is the lean core sync, not a burst that immediately
 * re-trips the quota. noteOutlookSuccess() ends the grace early.
 */
export function outlookQuotaTight(now: number = Date.now()): boolean {
    if (cooldownUntil > now) return true;
    return cooldownUntil > 0 && now - cooldownUntil < POST_COOLDOWN_GRACE_MS;
}

export function resetOutlookRateLimitForTests(): void {
    cooldownUntil = 0;
    cooldownSource = 'default';
    strikes = 0;
}
