/**
 * Retry-After parsing shared by the sync clients (2026-10-23, #555).
 *
 * Lifted verbatim from outlook-rate-limit.ts (#1156) so Granola — and any
 * client of a server that names its own deadline — honors the same two forms:
 * delta-seconds ("120") and RFC 1123 HTTP-date. Gmail keeps its own parser in
 * gmail-rate-limit.ts because its deadline can also arrive inside the error
 * message, not only in the header.
 */

/** Checks if an HTTP response status represents rate limiting (429). */
export function isRateLimitStatus(status: number): boolean {
    return status === 429;
}

/**
 * Parses a Retry-After header into an epoch-ms deadline.
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
