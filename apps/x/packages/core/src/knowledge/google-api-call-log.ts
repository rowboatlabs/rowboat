import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

const LOG_FILE = path.join(WorkDir, 'google_api_calls.jsonl');
const MAX_STRING_LENGTH = 160;
const SENSITIVE_KEYS = new Set([
    'access_token',
    'auth',
    'authorization',
    'contentBase64',
    'data',
    'id_token',
    'key',
    'raw',
    'refresh_token',
    'requestBody',
    'token',
]);

function sanitize(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        return value.length > MAX_STRING_LENGTH
            ? `${value.slice(0, MAX_STRING_LENGTH)}...`
            : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(sanitize);
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                out[key] = '[redacted]';
            } else {
                out[key] = sanitize(child);
            }
        }
        return out;
    }
    return String(value);
}

function getStatus(error: unknown): number | undefined {
    const status = (error as { response?: { status?: number }; status?: number; code?: number | string })?.response?.status
        ?? (error as { status?: number })?.status;
    if (status) return status;
    const code = Number((error as { code?: number | string })?.code);
    return Number.isFinite(code) ? code : undefined;
}

function appendRecord(record: Record<string, unknown>): void {
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        fs.appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`, 'utf-8');
    } catch {
        // Logging must never break sync or user actions.
    }
}

function logCall(
    service: string,
    method: string,
    args: unknown[],
    startedAt: number,
    ok: boolean,
    error?: unknown,
): void {
    appendRecord({
        ts: new Date().toISOString(),
        service,
        method,
        ok,
        durationMs: Date.now() - startedAt,
        status: error ? getStatus(error) : undefined,
        params: sanitize(args[0]),
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
    });
}

export function googleApiLogPath(): string {
    return LOG_FILE;
}

export function withGoogleApiLogging<T extends object>(client: T, service: string): T {
    const cache = new WeakMap<object, unknown>();

    const wrap = (target: unknown, methodPath: string[]): unknown => {
        if (!target || (typeof target !== 'object' && typeof target !== 'function')) return target;
        if (cache.has(target as object)) return cache.get(target as object);

        const proxy = new Proxy(target as object, {
            get(obj, prop, receiver) {
                const value = Reflect.get(obj, prop, receiver);
                if (typeof prop === 'symbol') return value;
                const nextPath = [...methodPath, String(prop)];
                if (typeof value === 'function') {
                    return (...args: unknown[]) => {
                        const startedAt = Date.now();
                        try {
                            const result = value.apply(obj, args);
                            if (result && typeof (result as Promise<unknown>).then === 'function') {
                                return (result as Promise<unknown>).then(
                                    (response) => {
                                        logCall(service, nextPath.join('.'), args, startedAt, true);
                                        return response;
                                    },
                                    (error) => {
                                        logCall(service, nextPath.join('.'), args, startedAt, false, error);
                                        throw error;
                                    },
                                );
                            }
                            logCall(service, nextPath.join('.'), args, startedAt, true);
                            return result;
                        } catch (error) {
                            logCall(service, nextPath.join('.'), args, startedAt, false, error);
                            throw error;
                        }
                    };
                }
                return wrap(value, nextPath);
            },
        });

        cache.set(target as object, proxy);
        return proxy;
    };

    return wrap(client, []) as T;
}
