import { describe, expect, it } from 'vitest';
import { isRateLimitStatus, parseRetryAfter } from './retry-after.js';

const NOW = Date.parse('2026-08-27T01:30:00.000Z');

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
