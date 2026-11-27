import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../config/config.js', () => ({ WorkDir: os.tmpdir() }));
vi.mock('./indexer.js', () => ({ getApp: vi.fn() }));
vi.mock('./registry.js', () => ({ registryClient: {} }));
vi.mock('./agents.js', () => ({ syncAppAgents: vi.fn(), deleteAppAgents: vi.fn() }));

import { downloadBundle } from './installer.js';

let dir: string;
beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-download-'));
    vi.useFakeTimers();
    // Model the fetch signal's effect on the body with controllable time.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), ms);
        return ctrl.signal;
    });
});
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
});

function startDownload(withHeaders: boolean) {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let finish!: () => void;
    let requestSignal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url: string, { signal }: { signal: AbortSignal }) => {
        requestSignal = signal;
        if (!withHeaders) {
            started();
            return new Promise<Response>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        }
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                finish = () => {
                    controller.enqueue(new TextEncoder().encode('bundle bytes'));
                    controller.close();
                };
                signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
                started();
            },
        })));
    }));
    const result = downloadBundle('https://example.test/bundle.zip', dir);
    // The assertion runs after advancing time, so observe rejections immediately.
    void result.catch(() => {});
    return { result, ready, finish: () => finish(), signal: () => requestSignal };
}

it('keeps streaming after the header deadline', async () => {
    const transfer = startDownload(true);
    await transfer.ready;
    await vi.advanceTimersByTimeAsync(21_000);
    transfer.finish();
    const { zipPath } = await transfer.result;
    expect(await fs.readFile(zipPath, 'utf8')).toBe('bundle bytes');
});

it('times out when headers never arrive', async () => {
    const transfer = startDownload(false);
    await transfer.ready;
    const rejected = expect(transfer.result).rejects.toMatchObject({ code: 'download_failed' });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
});

it('times out a stalled body at the total deadline and removes partial output', async () => {
    const transfer = startDownload(true);
    await transfer.ready;
    const rejected = expect(transfer.result).rejects.toMatchObject({ code: 'download_failed' });
    await vi.advanceTimersByTimeAsync(179_999);
    expect(transfer.signal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(await fs.readdir(dir)).toEqual([]);
});
