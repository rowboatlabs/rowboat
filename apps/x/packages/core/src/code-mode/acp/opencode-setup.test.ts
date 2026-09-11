import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OpenCodeSetupService, safeSetupError, validateAuthorizationUrl } from './opencode-setup.js';
import type { OpenCodeProcess } from './opencode-process.js';

let root: string, service: OpenCodeSetupService, fetcher: ReturnType<typeof vi.fn>, launch: ReturnType<typeof vi.fn>;
let connected: boolean, modelError: unknown, wrongModel: boolean;
const calls: { route: string; method: string; body: any; server: string }[] = [];
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat provider test '));
    connected = false; modelError = undefined; wrongModel = false; calls.length = 0;
    let serial = 0;
    launch = vi.fn(async () => {
        let exit!: (value: { code: number; signal: null }) => void;
        const exited = new Promise<{ code: number; signal: null }>(resolve => { exit = resolve; });
        return { url: `http://127.0.0.1:${30000 + serial++}`, authorization: 'Basic private-backend', exited, stop: vi.fn(() => exit({ code: 0, signal: null })) } as unknown as OpenCodeProcess;
    });
    fetcher = vi.fn(async (url: string, options: RequestInit) => {
        const parsed = new URL(url), route = parsed.pathname, method = options.method ?? 'GET';
        const body = options.body ? JSON.parse(String(options.body)) : undefined;
        calls.push({ route, method, body, server: parsed.origin });
        let data: unknown = true;
        if (route === '/provider') data = { all: [{ id: 'openai', name: 'OpenAI', env: ['OPENAI_API_KEY'], models: { model: { id: 'model', name: 'Test model' } } }], connected: connected ? ['openai'] : [] };
        if (route === '/provider/auth') data = { openai: [{ type: 'oauth', label: 'ChatGPT Pro/Plus (browser)' }, { type: 'api', label: 'API key' }] };
        if (route === '/auth/openai') connected = method === 'PUT';
        if (route.endsWith('/oauth/authorize')) data = { url: 'https://auth.openai.com/oauth/authorize?state=test', method: 'auto', instructions: 'Complete sign in' };
        if (route.endsWith('/oauth/callback')) connected = true;
        if (route === '/session') data = { id: 'session-test' };
        if (route.endsWith('/message')) data = { info: { providerID: 'openai', modelID: wrongModel ? 'another-model' : 'model', finish: 'stop', ...(modelError ? { error: modelError } : {}) }, parts: [{ type: 'text', text: 'OK' }] };
        return new Response(JSON.stringify(data), { status: 200 });
    });
    service = new OpenCodeSetupService(launch as (signal: AbortSignal) => Promise<OpenCodeProcess>, fetcher as typeof fetch, path.join(root, 'selection.json'), async () => new Set(connected ? ['openai'] : []));
});
afterEach(() => { service.stop(); vi.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });
async function configured() {
    const state = await service.start('window');
    await service.saveKey(state.setupId, 'openai', 1, 'test-secret-not-a-real-key');
    await service.select(state.setupId, 'openai', 'openai/model');
    return state.setupId;
}

describe('OpenCode provider setup', () => {
    it('distinguishes saved credentials from verified provider/model and persists only selection', async () => {
        const id = await configured();
        const state = await service.refresh(id);
        expect(state.providers[0].connected).toBe(true);
        expect(state.verified).toBeUndefined();
        expect(JSON.stringify(state)).not.toContain('test-secret');
        expect(fs.readFileSync(path.join(root, 'selection.json'), 'utf8')).toBe('{"providerId":"openai","modelId":"openai/model"}');
        const verified = await service.verify(id);
        expect(verified.verified).toMatchObject({ providerId: 'openai', modelId: 'openai/model', generation: verified.generation });
        expect(calls.find(c => c.route === '/session')?.body.permission).toEqual([{ permission: '*', pattern: '*', action: 'deny' }]);
        expect(calls.find(c => c.route.endsWith('/message'))?.body.tools).toEqual({ '*': false });
        expect(JSON.stringify(calls.filter(c => c.route.startsWith('/session')))).not.toContain('test-secret');
        expect(calls.some(c => c.route === '/session/session-test' && c.method === 'DELETE')).toBe(true);
    });
    it('never marks rejected credentials ready, including errors inside HTTP 200', async () => {
        const id = await configured();
        modelError = { name: 'APIError', data: { statusCode: 401, message: 'upstream echoed test-secret' } };
        await expect(service.verify(id)).rejects.toMatchObject({ code: 'invalid-credentials' });
        expect((await service.refresh(id)).verified).toBeUndefined();
    });
    it('rejects silently substituted models and deletes the probe session', async () => {
        const id = await configured(); wrongModel = true;
        await expect(service.verify(id)).rejects.toThrow('selected model');
        expect(calls.some(c => c.method === 'DELETE' && c.route.includes('session'))).toBe(true);
    });
    it('rejects unavailable models without persisting the selection', async () => {
        const { setupId } = await service.start('window');
        await expect(service.select(setupId, 'openai', 'openai/missing')).rejects.toMatchObject({ code: 'unavailable-model' });
        expect(fs.existsSync(path.join(root, 'selection.json'))).toBe(false);
    });
    it('keeps one process alive across OAuth and restarts only after completion', async () => {
        const { setupId } = await service.start('window');
        const auth = await service.authorize(setupId, 'openai', 0, {});
        await expect(service.refresh(setupId)).rejects.toMatchObject({ code: 'busy' });
        const result = await service.complete(setupId, auth.attemptId);
        const oauth = calls.filter(c => c.route.includes('/oauth/'));
        expect(oauth[0].server).toBe(oauth[1].server);
        expect(launch).toHaveBeenCalledTimes(2);
        expect(result.providers[0].connected).toBe(true);
        expect(result.verified).toBeUndefined();
    });
    it('cancels attempts and permits a fresh retry', async () => {
        const { setupId } = await service.start('window');
        const auth = await service.authorize(setupId, 'openai', 0, {});
        service.cancel(setupId);
        await expect(service.complete(setupId, auth.attemptId)).rejects.toMatchObject({ code: 'cancelled' });
        const retry = await service.authorize(setupId, 'openai', 0, {});
        expect(retry.attemptId).not.toBe(auth.attemptId);
        await service.complete(setupId, retry.attemptId);
    });
    it('expires an idle authorization and kills its process', async () => {
        const { setupId } = await service.start('window');
        vi.useFakeTimers();
        const auth = await service.authorize(setupId, 'openai', 0, {});
        await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
        await expect(service.complete(setupId, auth.attemptId)).rejects.toMatchObject({ code: 'expired' });
    });
    it('accepts code submission when advertised by a supported method', async () => {
        const { setupId } = await service.start('window');
        fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://auth.openai.com/oauth/authorize', method: 'code', instructions: 'Paste code' })));
        const auth = await service.authorize(setupId, 'openai', 0, {});
        await expect(service.complete(setupId, auth.attemptId)).rejects.toMatchObject({ code: 'invalid-input' });
        await service.complete(setupId, auth.attemptId, 'one-time-code');
        expect(calls.find(c => c.route.endsWith('/callback'))?.body.code).toBe('one-time-code');
    });
    it('disconnects and invalidates verification while retaining selection', async () => {
        const id = await configured(); await service.verify(id);
        const result = await service.disconnect(id, 'openai');
        expect(result.providers[0].connected).toBe(false); expect(result.verified).toBeUndefined();
        expect(result.selection?.modelId).toBe('openai/model');
    });
    it('stops on window closure, prevents cross-window setup and rejects stale requests', async () => {
        const { setupId } = await service.start('one');
        await expect(service.start('two')).rejects.toMatchObject({ code: 'busy' });
        service.stopOwner('two'); await service.refresh(setupId);
        service.stopOwner('one'); await expect(service.refresh(setupId)).rejects.toMatchObject({ code: 'cancelled' });
        expect((await service.start('two')).setupId).not.toBe(setupId);
    });
    it.each([401, 429, 500])('returns safe errors for HTTP %s without upstream bodies', async status => {
        const { setupId } = await service.start('window');
        fetcher.mockResolvedValueOnce(new Response('test-secret-in-body', { status }));
        try { await service.saveKey(setupId, 'openai', 1, 'test-secret'); throw new Error('expected failure'); }
        catch (error) { expect(JSON.stringify(safeSetupError(error))).not.toContain('test-secret'); }
    });
    it('sanitizes transport and unexpected errors', () => {
        expect(safeSetupError(new Error('Authorization: secret')).message).not.toContain('secret');
    });
    it.each(['http://auth.openai.com/', 'https://evil.test/', 'file:///tmp/login', 'https://secret@auth.openai.com/'])('rejects unsafe authorization URL %s', url => {
        expect(() => validateAuthorizationUrl('openai', url)).toThrow();
    });
});
