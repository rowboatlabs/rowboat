import { describe, expect, it, vi } from 'vitest';
import {
    HttpStatusError,
    callWithRateLimit,
    httpStatusErrorFrom,
    isRateLimitError,
} from './rate-limited-call.js';

const NOW = Date.parse('2026-10-23T10:00:00.000Z');

function harness(extra: Record<string, unknown> = {}) {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const options = { now: () => NOW, sleep, label: 'Test', ...extra };
    return { sleep, options };
}

/** An operation that throws each listed error in turn, then resolves. */
function failingThen<T>(errors: unknown[], value: T) {
    let i = 0;
    return vi.fn(async () => {
        if (i < errors.length) throw errors[i++];
        return value;
    });
}

const limited = (retryAfter: string | null = null) =>
    new HttpStatusError(429, 'Too Many Requests', retryAfter);

describe('httpStatusErrorFrom', () => {
    it('keeps the status, the Retry-After header, and the old message shape', () => {
        const err = httpStatusErrorFrom({
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'Retry-After': '120' }),
        });
        expect(err).toBeInstanceOf(HttpStatusError);
        expect(err.status).toBe(429);
        expect(err.retryAfter).toBe('120');
        expect(err.message).toBe('429: Too Many Requests');
    });

    it('records a missing header as null', () => {
        const err = httpStatusErrorFrom({ status: 500, statusText: 'Server Error', headers: new Headers() });
        expect(err.status).toBe(500);
        expect(err.retryAfter).toBeNull();
    });
});

describe('isRateLimitError', () => {
    it('answers by status for typed errors', () => {
        expect(isRateLimitError(limited())).toBe(true);
        expect(isRateLimitError(new HttpStatusError(503, 'rate limit'))).toBe(false);
    });

    it('falls back to the message text for untyped errors', () => {
        expect(isRateLimitError(new Error('429: Too Many Requests'))).toBe(true);
        expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
        expect(isRateLimitError('too many requests')).toBe(true);
        expect(isRateLimitError(new Error('ECONNRESET'))).toBe(false);
    });
});

describe('callWithRateLimit', () => {
    it('returns the result when the operation succeeds', async () => {
        const { sleep, options } = harness();
        await expect(callWithRateLimit(async () => 'ok', 'op', options)).resolves.toBe('ok');
        expect(sleep).not.toHaveBeenCalled();
    });

    it('honors a delta-seconds Retry-After as the wait', async () => {
        const { sleep, options } = harness();
        const op = failingThen([limited('120')], 'ok');
        await expect(callWithRateLimit(op, 'op', options)).resolves.toBe('ok');
        expect(op).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(120_000);
    });

    it('honors an HTTP-date Retry-After', async () => {
        const { sleep, options } = harness();
        const op = failingThen([limited('Fri, 23 Oct 2026 10:05:00 GMT')], 'ok');
        await expect(callWithRateLimit(op, 'op', options)).resolves.toBe('ok');
        expect(sleep).toHaveBeenCalledWith(300_000);
    });

    it('floors an almost-expired deadline to the minimum wait', async () => {
        const { sleep, options } = harness({ minWaitMs: 5_000 });
        const op = failingThen([limited('2')], 'ok');
        await expect(callWithRateLimit(op, 'op', options)).resolves.toBe('ok');
        expect(sleep).toHaveBeenCalledWith(5_000);
    });

    it('falls back to the doubling schedule when no header is sent', async () => {
        const { sleep, options } = harness();
        const op = failingThen([limited(), limited()], 'ok');
        await expect(callWithRateLimit(op, 'op', { ...options, maxRetries: 4 })).resolves.toBe('ok');
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([60_000, 120_000]);
    });

    it('skips the cycle without sleeping when the deadline is beyond the cap', async () => {
        const { sleep, options } = harness();
        const op = failingThen([limited('3600')], 'ok');
        await expect(callWithRateLimit(op, 'op', options)).resolves.toBeNull();
        expect(op).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('rethrows errors that are not rate limits without sleeping', async () => {
        const { sleep, options } = harness();
        const op = failingThen([new HttpStatusError(401, 'Unauthorized')], 'ok');
        await expect(callWithRateLimit(op, 'op', options)).rejects.toThrow('401: Unauthorized');
        expect(sleep).not.toHaveBeenCalled();
    });

    it('gives up with null after maxRetries attempts', async () => {
        const { sleep, options } = harness();
        const op = failingThen([limited('5'), limited('5'), limited('5')], 'ok');
        await expect(callWithRateLimit(op, 'op', { ...options, maxRetries: 3 })).resolves.toBeNull();
        expect(op).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('still recognizes a bare "429" message from an untyped error', async () => {
        const { sleep, options } = harness();
        const op = failingThen([new Error('429: Too Many Requests')], 'ok');
        await expect(callWithRateLimit(op, 'op', options)).resolves.toBe('ok');
        expect(sleep).toHaveBeenCalledWith(60_000);
    });
});
