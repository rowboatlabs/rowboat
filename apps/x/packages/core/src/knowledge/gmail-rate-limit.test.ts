import { beforeEach, describe, expect, it } from 'vitest';
import type { Common } from 'googleapis';
import {
    IN_REQUEST_RETRY_FALLBACK_MS,
    gmailRateLimitCooldownMs,
    inRequestRetryWaitMs,
    isRateLimitError,
    noteGmailRateLimit,
    rateLimitDeadlineMs,
    resetGmailRateLimitForTests,
} from './gmail-rate-limit.js';

const NOW = Date.parse('2026-08-27T01:30:00.000Z');

function gaxiosError(opts: {
    status?: number;
    message?: string;
    headers?: Record<string, string> | Headers;
    reasons?: string[];
    dataMessage?: string;
} = {}): Common.GaxiosError {
    return {
        message: opts.message ?? 'Request failed',
        status: opts.status,
        config: {},
        response: {
            status: opts.status,
            headers: opts.headers ?? {},
            data: {
                error: {
                    message: opts.dataMessage,
                    errors: (opts.reasons ?? []).map((reason) => ({ reason })),
                },
            },
        },
    } as unknown as Common.GaxiosError;
}

beforeEach(() => {
    resetGmailRateLimitForTests();
});

describe('isRateLimitError', () => {
    it('matches 429 regardless of body', () => {
        expect(isRateLimitError(gaxiosError({ status: 429 }))).toBe(true);
    });

    it('matches 403 with a rate-limit reason', () => {
        expect(isRateLimitError(gaxiosError({ status: 403, reasons: ['userRateLimitExceeded'] }))).toBe(true);
        expect(isRateLimitError(gaxiosError({ status: 403, reasons: ['rateLimitExceeded'] }))).toBe(true);
    });

    it('rejects other 403s and non-throttle statuses', () => {
        expect(isRateLimitError(gaxiosError({ status: 403, reasons: ['insufficientPermissions'] }))).toBe(false);
        expect(isRateLimitError(gaxiosError({ status: 500 }))).toBe(false);
    });
});

describe('rateLimitDeadlineMs', () => {
    it('reads delta-seconds Retry-After from plain-object headers', () => {
        const err = gaxiosError({ status: 429, headers: { 'retry-after': '120' } });
        expect(rateLimitDeadlineMs(err, NOW)).toBe(NOW + 120_000);
    });

    it('reads Retry-After from fetch Headers (gaxios v7 shape)', () => {
        const err = gaxiosError({ status: 429, headers: new Headers({ 'Retry-After': '15' }) });
        expect(rateLimitDeadlineMs(err, NOW)).toBe(NOW + 15_000);
    });

    it('reads an HTTP-date Retry-After', () => {
        const err = gaxiosError({ status: 429, headers: { 'retry-after': 'Thu, 27 Aug 2026 01:35:00 GMT' } });
        expect(rateLimitDeadlineMs(err, NOW)).toBe(Date.parse('2026-08-27T01:35:00.000Z'));
    });

    it("reads Gmail's message-embedded deadline when no header exists", () => {
        const err = gaxiosError({
            status: 403,
            reasons: ['userRateLimitExceeded'],
            message: 'User-rate limit exceeded.  Retry after 2026-08-27T01:41:22.427Z',
        });
        expect(rateLimitDeadlineMs(err, NOW)).toBe(Date.parse('2026-08-27T01:41:22.427Z'));
    });

    it('reads the deadline from the response body message too', () => {
        const err = gaxiosError({
            status: 429,
            dataMessage: 'User-rate limit exceeded. Retry after 2026-08-27T01:45:00.000Z',
        });
        expect(rateLimitDeadlineMs(err, NOW)).toBe(Date.parse('2026-08-27T01:45:00.000Z'));
    });

    it('ignores deadlines in the past and returns null when none is named', () => {
        const stale = gaxiosError({ status: 429, message: 'Retry after 2026-08-27T01:00:00.000Z' });
        expect(rateLimitDeadlineMs(stale, NOW)).toBeNull();
        expect(rateLimitDeadlineMs(gaxiosError({ status: 429 }), NOW)).toBeNull();
    });
});

describe('inRequestRetryWaitMs', () => {
    it('waits out a deadline that fits under the cap', () => {
        const err = gaxiosError({ status: 429, headers: { 'retry-after': '10' } });
        expect(inRequestRetryWaitMs(err, NOW)).toBe(10_000);
    });

    it('returns null (fail fast) when the deadline outlasts the cap', () => {
        const err = gaxiosError({
            status: 429,
            message: 'User-rate limit exceeded. Retry after 2026-08-27T01:41:22.427Z',
        });
        expect(inRequestRetryWaitMs(err, NOW)).toBeNull();
    });

    it('falls back to the short default when no deadline is named', () => {
        expect(inRequestRetryWaitMs(gaxiosError({ status: 429 }), NOW)).toBe(IN_REQUEST_RETRY_FALLBACK_MS);
    });
});

describe('cross-cycle cooldown', () => {
    it("honors Gmail's own deadline", () => {
        const deadline = Date.parse('2026-08-27T01:41:22.427Z');
        const err = gaxiosError({ status: 429, message: `Rate limited. Retry after 2026-08-27T01:41:22.427Z` });
        expect(noteGmailRateLimit(err, NOW)).toBe(deadline);
        expect(gmailRateLimitCooldownMs(NOW)).toBe(deadline - NOW);
        expect(gmailRateLimitCooldownMs(deadline + 1)).toBe(0);
    });

    it('escalates the default cooldown per strike when no deadline is named', () => {
        const err = gaxiosError({ status: 429 });
        expect(noteGmailRateLimit(err, NOW)).toBe(NOW + 60_000);
        expect(noteGmailRateLimit(err, NOW + 61_000)).toBe(NOW + 61_000 + 120_000);
        expect(noteGmailRateLimit(err, NOW + 200_000)).toBe(NOW + 200_000 + 240_000);
    });

    it('caps the escalating default at 15 minutes', () => {
        const err = gaxiosError({ status: 429 });
        let t = NOW;
        for (let i = 0; i < 10; i++) {
            // Re-strike right after each cooldown ends so the episode persists.
            t = noteGmailRateLimit(err, t) + 1_000;
        }
        expect(noteGmailRateLimit(err, t) - t).toBe(15 * 60_000);
    });

    it('resets the strike ladder after a quiet spell', () => {
        const err = gaxiosError({ status: 429 });
        noteGmailRateLimit(err, NOW);
        noteGmailRateLimit(err, NOW + 61_000);
        // > EPISODE_RESET_MS after the last cooldown ended → fresh episode.
        const later = NOW + 61_000 + 120_000 + 11 * 60_000;
        expect(noteGmailRateLimit(err, later)).toBe(later + 60_000);
    });

    it('never shrinks an already-armed cooldown', () => {
        const far = gaxiosError({ status: 429, message: 'Retry after 2026-08-27T02:00:00.000Z' });
        const near = gaxiosError({ status: 429, headers: { 'retry-after': '5' } });
        noteGmailRateLimit(far, NOW);
        noteGmailRateLimit(near, NOW + 1_000);
        expect(gmailRateLimitCooldownMs(NOW + 2_000)).toBe(Date.parse('2026-08-27T02:00:00.000Z') - (NOW + 2_000));
    });
});
