import { beforeEach, describe, expect, it } from 'vitest';
import {
    IN_REQUEST_RETRY_FALLBACK_MS,
    isRateLimitStatus,
    noteOutlookRateLimit,
    noteOutlookSuccess,
    outlookCooldownInfo,
    outlookQuotaTight,
    outlookRateLimitCooldownMs,
    parseRetryAfter,
    inRequestRetryWaitMs,
    resetOutlookRateLimitForTests,
} from './outlook-rate-limit.js';

const NOW = Date.parse('2026-08-27T01:30:00.000Z');

beforeEach(() => {
    resetOutlookRateLimitForTests();
});

describe('isRateLimitStatus', () => {
    it('matches 429', () => {
        expect(isRateLimitStatus(429)).toBe(true);
    });

    it('rejects non-429 statuses', () => {
        expect(isRateLimitStatus(200)).toBe(false);
        expect(isRateLimitStatus(401)).toBe(false);
        expect(isRateLimitStatus(403)).toBe(false);
        expect(isRateLimitStatus(500)).toBe(false);
        expect(isRateLimitStatus(503)).toBe(false);
    });
});

describe('parseRetryAfter', () => {
    it('parses delta-seconds', () => {
        expect(parseRetryAfter('120', NOW)).toBe(NOW + 120_000);
        expect(parseRetryAfter('  45  ', NOW)).toBe(NOW + 45_000);
    });

    it('parses RFC 1123 HTTP-date', () => {
        const target = 'Thu, 27 Aug 2026 01:35:00 GMT';
        expect(parseRetryAfter(target, NOW)).toBe(Date.parse('2026-08-27T01:35:00.000Z'));
    });

    it('returns null for past timestamps or negative/zero seconds', () => {
        expect(parseRetryAfter('0', NOW)).toBeNull();
        expect(parseRetryAfter('-10', NOW)).toBeNull();
        const past = 'Thu, 27 Aug 2026 01:00:00 GMT';
        expect(parseRetryAfter(past, NOW)).toBeNull();
    });

    it('returns null for null, undefined, empty, or non-numeric/non-date strings', () => {
        expect(parseRetryAfter(null, NOW)).toBeNull();
        expect(parseRetryAfter(undefined, NOW)).toBeNull();
        expect(parseRetryAfter('', NOW)).toBeNull();
        expect(parseRetryAfter('   ', NOW)).toBeNull();
        expect(parseRetryAfter('invalid-format', NOW)).toBeNull();
    });
});

describe('inRequestRetryWaitMs', () => {
    it('returns fallback wait when no Retry-After header is provided', () => {
        expect(inRequestRetryWaitMs(null, NOW)).toBe(IN_REQUEST_RETRY_FALLBACK_MS);
        expect(inRequestRetryWaitMs(undefined, NOW)).toBe(IN_REQUEST_RETRY_FALLBACK_MS);
    });

    it('returns waitMs when deadline is within the in-request cap (30s)', () => {
        expect(inRequestRetryWaitMs('15', NOW)).toBe(15_000);
        expect(inRequestRetryWaitMs('30', NOW)).toBe(30_000);
    });

    it('clamps wait to minimum 1s if deadline is under 1s', () => {
        // HTTP-date has second precision; test when deadline is 500ms into the future
        const baseNow = Date.parse('2026-08-27T01:30:00.500Z');
        const nextSecond = 'Thu, 27 Aug 2026 01:30:01 GMT';
        expect(inRequestRetryWaitMs(nextSecond, baseNow)).toBe(1_000);
    });

    it('returns null when deadline exceeds in-request cap (>30s)', () => {
        expect(inRequestRetryWaitMs('31', NOW)).toBeNull();
        expect(inRequestRetryWaitMs('120', NOW)).toBeNull();
        const future = new Date(NOW + 60_000).toUTCString();
        expect(inRequestRetryWaitMs(future, NOW)).toBeNull();
    });
});

describe('noteOutlookRateLimit & cooldown escalation', () => {
    it('arms cooldown from Graph deadline and records graph source', () => {
        const until = noteOutlookRateLimit('90', NOW);
        expect(until).toBe(NOW + 90_000);
        expect(outlookRateLimitCooldownMs(NOW)).toBe(90_000);
        expect(outlookCooldownInfo(NOW)).toEqual({
            remainingMs: 90_000,
            until: NOW + 90_000,
            source: 'graph',
        });
    });

    it('clamps excessive Graph deadline to 6 hours', () => {
        const tenHoursSecs = 10 * 60 * 60;
        const until = noteOutlookRateLimit(String(tenHoursSecs), NOW);
        expect(until).toBe(NOW + 6 * 60 * 60_000);
    });

    it('arms exponential ladder per episode when no deadline is provided', () => {
        // Strike 1: 1m (60s)
        const until1 = noteOutlookRateLimit(null, NOW);
        expect(until1).toBe(NOW + 60_000);
        expect(outlookCooldownInfo(NOW)?.source).toBe('default');

        // Subsequent failure during active cooldown does NOT slide cooldown
        const untilMid = noteOutlookRateLimit(null, NOW + 10_000);
        expect(untilMid).toBe(until1);

        // Strike 2 after cooldown expires: 2m (120s)
        const t2 = NOW + 61_000;
        const until2 = noteOutlookRateLimit(null, t2);
        expect(until2).toBe(t2 + 120_000);

        // Strike 3: 4m (240s)
        const t3 = until2 + 1_000;
        const until3 = noteOutlookRateLimit(null, t3);
        expect(until3).toBe(t3 + 240_000);

        // Strike 4: 8m (480s)
        const t4 = until3 + 1_000;
        const until4 = noteOutlookRateLimit(null, t4);
        expect(until4).toBe(t4 + 480_000);

        // Strike 5: 15m cap (900s)
        const t5 = until4 + 1_000;
        const until5 = noteOutlookRateLimit(null, t5);
        expect(until5).toBe(t5 + 900_000);

        // Strike 6+: stays capped at 15m
        const t6 = until5 + 1_000;
        const until6 = noteOutlookRateLimit(null, t6);
        expect(until6).toBe(t6 + 900_000);
    });

    it('allows an authoritative Graph deadline to extend an active cooldown', () => {
        noteOutlookRateLimit(null, NOW); // guessed 60s
        const longer = noteOutlookRateLimit('300', NOW + 5_000); // Graph says 300s
        expect(longer).toBe(NOW + 5_000 + 300_000);
        expect(outlookCooldownInfo(NOW + 5_000)?.source).toBe('graph');
    });

    it('resets strikes after 10 minutes quiet', () => {
        noteOutlookRateLimit(null, NOW); // strike 1 (1m)
        const t2 = NOW + 61_000;
        noteOutlookRateLimit(null, t2); // strike 2 (2m)

        // Quiet period > 10m after cooldown ends
        const t3 = t2 + 120_000 + 11 * 60_000;
        const untilReset = noteOutlookRateLimit(null, t3);
        // Should start over at strike 1 (60s)
        expect(untilReset).toBe(t3 + 60_000);
    });
});

describe('noteOutlookSuccess & outlookQuotaTight', () => {
    it('noteOutlookSuccess clears active cooldown and strikes', () => {
        noteOutlookRateLimit('60', NOW);
        expect(outlookRateLimitCooldownMs(NOW)).toBeGreaterThan(0);

        noteOutlookSuccess();
        expect(outlookRateLimitCooldownMs(NOW)).toBe(0);
        expect(outlookCooldownInfo(NOW)).toBeNull();

        // Next failure starts at strike 1
        const until = noteOutlookRateLimit(null, NOW);
        expect(until).toBe(NOW + 60_000);
    });

    it('outlookQuotaTight remains true during cooldown and for 60s post-cooldown grace', () => {
        noteOutlookRateLimit('60', NOW);
        const cooldownEnd = NOW + 60_000;

        // During cooldown
        expect(outlookQuotaTight(NOW + 10_000)).toBe(true);
        expect(outlookQuotaTight(cooldownEnd)).toBe(true);

        // In 60s grace period after cooldown expiry
        expect(outlookQuotaTight(cooldownEnd + 30_000)).toBe(true);
        expect(outlookQuotaTight(cooldownEnd + 59_999)).toBe(true);

        // After grace period
        expect(outlookQuotaTight(cooldownEnd + 60_001)).toBe(false);
    });

    it('noteOutlookSuccess immediately ends quota-tight grace', () => {
        noteOutlookRateLimit('60', NOW);
        const cooldownEnd = NOW + 60_000;
        expect(outlookQuotaTight(cooldownEnd + 10_000)).toBe(true);

        noteOutlookSuccess();
        expect(outlookQuotaTight(cooldownEnd + 10_000)).toBe(false);
    });
});
