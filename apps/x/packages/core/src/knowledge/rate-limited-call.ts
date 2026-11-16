/**
 * Retrying a sync API call under a provider's rate limit (2026-10-23, #555).
 *
 * Granola's sync used to detect a 429 by searching the error text and then
 * sleep on a fixed 60s doubling schedule, so a Retry-After the server sent was
 * dropped before the retry decision: retries fired inside the window the
 * server had asked us to wait out. Now the API error carries the status and
 * the header, and the wait honors the server's deadline when it names one,
 * falling back to the doubling only when it doesn't. Same policy shape as the
 * in-request retry in outlook-rate-limit.ts (#1156), minus the cross-cycle
 * cooldown: these loops already run every few minutes, so a skipped cycle is
 * the cooldown.
 *
 * Fireflies is not on this path: it reaches Fireflies through an MCP tool, so
 * no header survives to the error it sees.
 */
import { isRateLimitStatus, parseRetryAfter } from './retry-after.js';

/** A non-2xx response, keeping what a retry decision needs. */
export class HttpStatusError extends Error {
    readonly status: number;
    /** The raw Retry-After header, when the server sent one. */
    readonly retryAfter: string | null;

    constructor(status: number, statusText: string, retryAfter: string | null = null) {
        // Keeps the "<status>: <text>" shape the old text-matching detection
        // relied on, so logs and anything reading the message are unchanged.
        super(`${status}: ${statusText}`);
        this.name = 'HttpStatusError';
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

/** Builds the error for a failed fetch response. */
export function httpStatusErrorFrom(response: Pick<Response, 'status' | 'statusText' | 'headers'>): HttpStatusError {
    return new HttpStatusError(response.status, response.statusText, response.headers.get('retry-after'));
}

/**
 * Whether an error is a rate limit. A typed error answers by status; anything
 * else falls back to the text match the Granola loop always used, so an error
 * thrown by a layer that doesn't know HttpStatusError is still recognized.
 */
export function isRateLimitError(error: unknown): boolean {
    if (error instanceof HttpStatusError) return isRateLimitStatus(error.status);
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('429')
        || message.includes('Too Many Requests')
        || message.includes('too many requests')
        || message.includes('rate limit');
}

export interface RateLimitedCallOptions {
    /** Attempts before giving up on this cycle (default 3). */
    maxRetries?: number;
    /** First wait when the server names no deadline; doubles per retry (default 60s). */
    initialDelayMs?: number;
    /** Longest server-named wait honored in the loop; beyond it the cycle is skipped (default 15m). */
    maxHonoredWaitMs?: number;
    /** Floor on a server-named wait, so an almost-expired deadline doesn't hammer (default 1s). */
    minWaitMs?: number;
    /** Log prefix, e.g. "Granola". */
    label?: string;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 60_000;
const DEFAULT_MAX_HONORED_WAIT_MS = 15 * 60_000;
const DEFAULT_MIN_WAIT_MS = 1_000;

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs `operation`, retrying on rate limits. Resolves null when this cycle
 * should be skipped (retries exhausted, or the server asked for a wait longer
 * than maxHonoredWaitMs); the caller's next scheduled run is the retry. Any
 * other error is rethrown untouched.
 */
export async function callWithRateLimit<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: RateLimitedCallOptions = {},
): Promise<T | null> {
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const maxHonoredWaitMs = options.maxHonoredWaitMs ?? DEFAULT_MAX_HONORED_WAIT_MS;
    const minWaitMs = options.minWaitMs ?? DEFAULT_MIN_WAIT_MS;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? defaultSleep;
    const tag = options.label ? `[${options.label}]` : '[rate-limit]';

    let retries = 0;
    let fallbackDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

    while (retries < maxRetries) {
        try {
            return await operation();
        } catch (error) {
            if (!isRateLimitError(error)) {
                throw error;
            }
            retries++;
            if (retries >= maxRetries) {
                console.error(`${tag} Max retries reached for ${operationName}. Skipping.`);
                return null;
            }

            const at = now();
            const header = error instanceof HttpStatusError ? error.retryAfter : null;
            const deadline = parseRetryAfter(header, at);
            let waitMs: number;
            if (deadline !== null) {
                waitMs = deadline - at;
                if (waitMs > maxHonoredWaitMs) {
                    console.log(`${tag} ${operationName} rate limited; server asks for ${Math.round(waitMs / 1000)}s, beyond the ${maxHonoredWaitMs / 1000}s cap. Skipping this cycle.`);
                    return null;
                }
                waitMs = Math.max(waitMs, minWaitMs);
                console.log(`${tag} Rate limit hit for ${operationName}. Retry ${retries}/${maxRetries} in ${Math.round(waitMs / 1000)}s (Retry-After)...`);
            } else {
                waitMs = fallbackDelayMs;
                fallbackDelayMs *= 2;
                console.log(`${tag} Rate limit hit for ${operationName}. Retry ${retries}/${maxRetries} in ${waitMs / 1000}s...`);
            }
            await sleep(waitMs);
        }
    }

    return null;
}
