import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { HEALTH_BOOTSTRAP } from './health.js';

function boot(
    fetch: (
        input: string,
        init?: { body: string },
    ) => Promise<{ ok: boolean; status: number }> = vi.fn(async () => ({
        ok: true,
        status: 200,
    })),
) {
    const events: Record<string, (event?: unknown) => void> = {};
    const postMessage = vi.fn();
    const window = {
        parent: { postMessage },
        fetch,
        addEventListener: (event: string, fn: (event?: unknown) => void) => {
            events[event] = fn;
        },
    };
    runInNewContext(
        HEALTH_BOOTSTRAP.replace(/^<script>|<\/script>$/g, '').trim(),
        {
            window,
            URL,
            location: {
                origin: 'http://app.apps.localhost:3210',
                href: 'http://app.apps.localhost:3210/',
            },
        },
    );
    return { window, events, postMessage };
}

describe('app health reporting', () => {
    it('reports startup failure and does not overwrite it with the load event', () => {
        const { window, events, postMessage } = boot();
        events.error({
            target: window,
            message: 'SyntaxError: unexpected token',
        });
        events.load();
        expect(postMessage.mock.calls.map((c) => c[0].state)).toEqual([
            'loading',
            'error',
        ]);
    });
    it('reports failed account access without disclosing request payloads', async () => {
        const { window, postMessage } = boot(
            vi.fn(async () => ({ ok: false, status: 403 })),
        );
        const response = await window.fetch('/_rowboat/tools/execute', {
            body: 'private-data',
        });
        expect(response.status).toBe(403);
        expect(postMessage.mock.calls.at(-1)?.[0].message).toContain(
            'account connection',
        );
        expect(JSON.stringify(postMessage.mock.calls)).not.toContain(
            'private-data',
        );
    });
    it('clears a failed request after its retry succeeds', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 403 })
            .mockResolvedValueOnce({ ok: true, status: 200 });
        const { window, events, postMessage } = boot(fetch);
        events.load();
        await window.fetch('/_rowboat/tools/execute');
        expect(postMessage.mock.calls.at(-1)?.[0].state).toBe('error');
        await window.fetch('/_rowboat/tools/execute');
        expect(postMessage.mock.calls.at(-1)?.[0].state).toBe('loaded');
    });
    it('reports a healthy document separately from data readiness', () => {
        const { events, postMessage } = boot();
        events.load();
        expect(postMessage.mock.calls.map((c) => c[0].state)).toEqual([
            'loading',
            'loaded',
        ]);
    });
});
