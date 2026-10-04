import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../di/container.js', () => ({
    default: {
        resolve: vi.fn(),
    },
}));

import { OutlookClientFactory, GraphError } from './outlook-client-factory.js';
import {
    noteOutlookRateLimit,
    outlookCooldownInfo,
    outlookRateLimitCooldownMs,
    resetOutlookRateLimitForTests,
} from './outlook-rate-limit.js';

describe('OutlookClientFactory rate-limiting integration', () => {
    const realFetch = globalThis.fetch;
    const realTimeout = globalThis.setTimeout;

    beforeEach(() => {
        resetOutlookRateLimitForTests();
        // Mock getAccessToken so tests don't require an active OAuth repo
        vi.spyOn(OutlookClientFactory, 'getAccessToken').mockResolvedValue('test-token');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        globalThis.setTimeout = realTimeout;
        vi.restoreAllMocks();
    });

    it('retries in-request when Retry-After is under the 30s cap and succeeds', async () => {
        let attempts = 0;
        let sleptWaitMs = 0;

        // Mock setTimeout to verify wait time without actually waiting
        vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
            sleptWaitMs = ms ?? 0;
            fn();
            return 0 as unknown as NodeJS.Timeout;
        });

        globalThis.fetch = vi.fn(async () => {
            attempts++;
            if (attempts === 1) {
                return new Response(JSON.stringify({ error: { message: 'Too Many Requests' } }), {
                    status: 429,
                    headers: { 'Retry-After': '5', 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ value: 'success' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as typeof fetch;

        const result = await OutlookClientFactory.graphFetch<{ value: string }>('/me/messages');
        expect(attempts).toBe(2);
        expect(sleptWaitMs).toBe(5000);
        expect(result).toEqual({ value: 'success' });
        // Quota is healthy after success
        expect(outlookRateLimitCooldownMs()).toBe(0);
    });

    it('fails fast and arms cross-cycle cooldown when Retry-After exceeds 30s cap', async () => {
        let attempts = 0;
        let slept = false;

        vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void) => {
            slept = true;
            fn();
            return 0 as unknown as NodeJS.Timeout;
        });

        globalThis.fetch = vi.fn(async () => {
            attempts++;
            return new Response(JSON.stringify({ error: { message: 'Activity limit reached' } }), {
                status: 429,
                headers: { 'Retry-After': '120', 'Content-Type': 'application/json' },
            });
        }) as typeof fetch;

        const start = Date.now();
        await expect(OutlookClientFactory.graphFetch('/me/messages')).rejects.toThrow(GraphError);

        // Crucial invariant: does NOT retry in-request and does NOT sleep
        expect(attempts).toBe(1);
        expect(slept).toBe(false);

        // Arms cross-cycle cooldown from Graph's 120s header
        const cooldown = outlookCooldownInfo();
        expect(cooldown).not.toBeNull();
        expect(cooldown?.source).toBe('graph');
        expect(cooldown!.remainingMs).toBeGreaterThanOrEqual(119_000);
        expect(cooldown!.until).toBeGreaterThanOrEqual(start + 120_000);
    });

    it('arms default cooldown when no Retry-After header and in-request retry fails', async () => {
        let attempts = 0;
        let sleptWaitMs = 0;

        vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
            sleptWaitMs = ms ?? 0;
            fn();
            return 0 as unknown as NodeJS.Timeout;
        });

        globalThis.fetch = vi.fn(async () => {
            attempts++;
            return new Response(JSON.stringify({ error: { message: 'Throttled' } }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as typeof fetch;

        const start = Date.now();
        await expect(OutlookClientFactory.graphFetch('/me/messages')).rejects.toThrow(GraphError);

        // Retried once with 2000ms fallback
        expect(attempts).toBe(2);
        expect(sleptWaitMs).toBe(2000);

        // Unrecovered 429 arms default ladder (strike 1 = 60s)
        const cooldown = outlookCooldownInfo();
        expect(cooldown).not.toBeNull();
        expect(cooldown?.source).toBe('default');
        expect(cooldown!.remainingMs).toBeGreaterThanOrEqual(59_000);
        expect(cooldown!.until).toBeGreaterThanOrEqual(start + 60_000);
    });

    it('clears active cooldown on any successful 2xx response', async () => {
        // Arm an active cooldown
        noteOutlookRateLimit('60');
        expect(outlookRateLimitCooldownMs()).toBeGreaterThan(0);

        globalThis.fetch = vi.fn(async () => {
            return new Response(JSON.stringify({ value: 'ok' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as typeof fetch;

        const res = await OutlookClientFactory.graphFetch<{ value: string }>('/me');
        expect(res).toEqual({ value: 'ok' });
        // Successfully cleared
        expect(outlookRateLimitCooldownMs()).toBe(0);
        expect(outlookCooldownInfo()).toBeNull();
    });
});
