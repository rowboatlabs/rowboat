import type { Common } from 'googleapis';

/**
 * Gmail rate-limit detection and the cross-cycle cooldown (the follow-up
 * deferred by #869).
 *
 * Two layers use this module:
 *   - GoogleClientFactory.gmailClient()'s retry hooks classify errors
 *     (isRateLimitError), size the single in-request retry
 *     (inRequestRetryWaitMs), and arm the cooldown (noteGmailRateLimit)
 *     whenever a throttled request is about to fail through to the caller.
 *   - The background loops (sync_gmail's 30s tick, gmail_sent_contacts'
 *     refresh) consult gmailRateLimitCooldownMs() and stand down while it is
 *     positive, instead of re-tripping the quota every tick.
 *
 * Gmail's flood-control errors ("User-rate limit exceeded. Retry after
 * 2026-08-27T20:08:37.427Z") put the deadline in the error MESSAGE, not a
 * Retry-After header, and it is routinely minutes away — far beyond what an
 * in-request retry may wait. Honoring it requires state that outlives the
 * request, hence this process-wide singleton. Deliberately not persisted to
 * disk: lockouts are minutes long, restarts are rare mid-lockout, and a stale
 * on-disk deadline would silently pause sync after a crash.
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

// No-deadline cooldowns escalate per strike: 1m, 2m, 4m, ... capped at 15m.
// A quiet EPISODE_RESET_MS after a cooldown ends starts the ladder over.
const NO_DEADLINE_BASE_COOLDOWN_MS = 60_000;
const NO_DEADLINE_MAX_COOLDOWN_MS = 15 * 60_000;
const EPISODE_RESET_MS = 10 * 60_000;
// Sanity clamp on Gmail-supplied deadlines (clock skew, malformed dates).
const DEADLINE_CAP_MS = 6 * 60 * 60_000;

let cooldownUntil = 0;
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
 * Epoch-ms deadline after which Gmail says a throttled request may be retried,
 * or null when the error names none. Checks the Retry-After header (delta
 * seconds or HTTP-date) first, then the "Retry after <ISO timestamp>" Gmail
 * embeds in the error message.
 */
export function rateLimitDeadlineMs(err: Common.GaxiosError, now: number = Date.now()): number | null {
    const header = headerValue(err, 'retry-after');
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
        const asDate = Date.parse(header);
        if (Number.isFinite(asDate) && asDate > now) return asDate;
    }

    const data = err.response?.data as { error?: { message?: string } } | undefined;
    const message = `${err.message ?? ''} ${data?.error?.message ?? ''}`;
    const match = /retry after\s+(\d{4}-\d{2}-\d{2}T[0-9:.]+Z?)/i.exec(message);
    if (match) {
        const asDate = Date.parse(match[1]);
        if (Number.isFinite(asDate) && asDate > now) return asDate;
    }
    return null;
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
 * failing through to its caller. Uses Gmail's own deadline when it names one;
 * otherwise escalates a default per strike. Returns the cooldown end (epoch ms).
 */
export function noteGmailRateLimit(err: Common.GaxiosError, now: number = Date.now()): number {
    if (now - cooldownUntil > EPISODE_RESET_MS) strikes = 0;
    strikes += 1;
    const deadline = rateLimitDeadlineMs(err, now);
    const until = deadline !== null
        ? Math.min(deadline, now + DEADLINE_CAP_MS)
        : now + Math.min(NO_DEADLINE_BASE_COOLDOWN_MS * 2 ** (strikes - 1), NO_DEADLINE_MAX_COOLDOWN_MS);
    cooldownUntil = Math.max(cooldownUntil, until);
    return cooldownUntil;
}

/** Milliseconds until Gmail may be called again; 0 when no cooldown is active. */
export function gmailRateLimitCooldownMs(now: number = Date.now()): number {
    return Math.max(0, cooldownUntil - now);
}

export function resetGmailRateLimitForTests(): void {
    cooldownUntil = 0;
    strikes = 0;
}
