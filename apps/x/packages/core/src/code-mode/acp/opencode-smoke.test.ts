// Opt in with ROWBOAT_OPENCODE_SMOKE=1. Downloads the pinned native engine into
// a temporary home containing spaces; never reads/writes the real OpenCode state.
import { expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';

it.skipIf(process.env.ROWBOAT_OPENCODE_SMOKE !== '1')('downloads and launches the real managed engine with isolated authenticated serve and ACP', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat opencode smoke '));
    vi.doMock('os', () => ({ ...os, homedir: () => home }));
    vi.doMock('./shell-env.js', () => ({ loginShellPath: () => undefined }));
    const { ensureEngine, isEngineProvisioned, removeOpenCodeEngine } = await import('./engine-provisioner.js');
    const { openCodeProcesses } = await import('./opencode-process.js');
    let setup: import('./opencode-setup.js').OpenCodeSetupService | undefined;
    let providerServer: http.Server | undefined;
    let failure: unknown;
    let failed = false;
    let closeLogin: (() => void) | undefined;
    try {
        const engine = await ensureEngine('opencode');
        expect(engine.executablePath).toContain(home);
        expect(isEngineProvisioned('opencode')).toBe(true);
        for (const mode of ['serve', 'acp'] as const) {
            const handle = await openCodeProcesses.start(mode, { cwd: home, timeoutMs: 60_000 });
            expect((await fetch(`${handle.url}/global/health`)).status).toBe(401);
            expect((await fetch(`${handle.url}/global/health`, { headers: { Authorization: handle.authorization } })).status).toBe(200);
            handle.stop();
            await handle.exited;
            await expect(fetch(`${handle.url}/global/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
        }
        // Real OpenCode HTTP/setup/verification against a local fake inference
        // provider. No real provider credential or paid inference is used.
        const requests: string[] = [];
        let toolAction: { name: string; arguments: string } | undefined;
        providerServer = http.createServer(async (req, res) => {
            let body = ''; for await (const chunk of req) body += chunk;
            requests.push(body);
            if (!['Bearer opencode-key', 'Bearer public'].includes(req.headers.authorization ?? '')) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } })); return;
            }
            if (JSON.parse(body || '{}').stream) {
                if (toolAction && JSON.parse(body).tools?.some((t: { function?: { name: string } }) => t.function?.name === toolAction?.name)) {
                    const action = toolAction; toolAction = undefined;
                    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                    res.write(`data: ${JSON.stringify({ id: 'chatcmpl-tool', object: 'chat.completion.chunk', created: 1, model: 'smoke', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + Date.now(), type: 'function', function: action }] }, finish_reason: null }] })}\n\n`);
                    res.write(`data: ${JSON.stringify({ id: 'chatcmpl-tool', object: 'chat.completion.chunk', created: 1, model: 'smoke', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
                    res.end('data: [DONE]\n\n'); return;
                }
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                for (const item of [
                    { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'smoke', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
                    { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'smoke', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
                ]) res.write(`data: ${JSON.stringify(item)}\n\n`);
                res.end('data: [DONE]\n\n');
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'smoke', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
            }
        });
        await new Promise<void>(resolve => providerServer!.listen(0, '127.0.0.1', resolve));
        const port = (providerServer.address() as { port: number }).port;
        const configRoot = path.join(home, '.rowboat', 'opencode', 'config', 'opencode');
        fs.mkdirSync(configRoot, { recursive: true });
        fs.writeFileSync(path.join(configRoot, 'opencode.json'), JSON.stringify({ provider: {
            'opencode': { npm: '@ai-sdk/openai-compatible', name: 'Rowboat smoke provider', options: { baseURL: `http://127.0.0.1:${port}/v1` }, models: { smoke: { name: 'Smoke model', cost: { input: 0, output: 0 }, limit: { context: 4096, output: 64 } } } },
            'opencode-go': { npm: '@ai-sdk/openai-compatible', name: 'Go smoke provider', options: { baseURL: `http://127.0.0.1:${port}/v1` }, models: { smoke: { name: 'Go smoke model', cost: { input: 1, output: 1 }, limit: { context: 4096, output: 64 } } } },
        }}));
        const { OpenCodeSetupService } = await import('./opencode-setup.js');
        setup = new OpenCodeSetupService();
        let initial = await setup.start('smoke');
        expect(initial.providers.find(p => p.id === 'opencode')?.connected).toBe(false);
        expect(initial.providers.some(p => p.id === 'opencode')).toBe(true);
        const { CodeModeManager: PublicManager } = await import('./manager.js');
        const publicManager = new PublicManager();
        const publicOptions = await publicManager.listModelOptions('opencode', home, 'opencode/smoke');
        expect(publicOptions.currentModel).toBe('opencode/smoke');
        expect(publicOptions.openCodeProviders).toEqual(['free']);
        expect(publicOptions.models.every(m => m.value.startsWith('opencode/'))).toBe(true);
        await publicManager.runPrompt({ runId: 'public-smoke', agent: 'opencode', cwd: home, model: 'opencode/smoke',
            prompt: 'Say OK', policy: 'ask', ask: async () => 'reject', onEvent: () => {} });
        expect(requests.length).toBeGreaterThan(0);
        requests.length = 0;
        const saved = await setup.saveKey(initial.setupId, 'opencode', 0, 'opencode-key');
        expect(saved.verified).toBeUndefined();
        await setup.select(initial.setupId, 'opencode', 'opencode/smoke');
        const verified = await setup.verify(initial.setupId);
        expect(verified.verified?.modelId).toBe('opencode/smoke');
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.every(request => !request.includes('opencode-key'))).toBe(true);
        expect(requests.every(request => { const data = JSON.parse(request); return !data.tools || data.tools.length === 0; })).toBe(true);
        const zenOptions = await publicManager.listModelOptions('opencode', home, 'opencode/smoke');
        expect(zenOptions.openCodeProviders).toEqual(['zen']);
        expect(zenOptions.models.every(m => m.value.startsWith('opencode/'))).toBe(true);
        await setup.saveKey(initial.setupId, 'opencode-go', 0, 'opencode-key');
        const bothOptions = await publicManager.listModelOptions('opencode', home, 'opencode-go/smoke');
        expect(bothOptions.openCodeProviders).toEqual(['zen', 'go']);
        expect(bothOptions.models.some(m => m.value === 'opencode/smoke')).toBe(true);
        expect(bothOptions.models.some(m => m.value === 'opencode-go/smoke')).toBe(true);
        await setup.disconnect(initial.setupId, 'opencode');
        const goOptions = await publicManager.listModelOptions('opencode', home, 'opencode-go/smoke');
        expect(goOptions.openCodeProviders).toEqual(['go']);
        expect(goOptions.models.every(m => m.value.startsWith('opencode-go/'))).toBe(true);
        await expect(publicManager.runPrompt({ runId: 'blocked-service', agent: 'opencode', cwd: home, model: 'opencode/smoke',
            prompt: 'Must not reach inference', policy: 'ask', ask: async () => 'reject', onEvent: () => {} })).rejects.toThrow('unavailable through your current');
        await setup.saveKey(initial.setupId, 'opencode', 0, 'opencode-key');
        await setup.disconnect(initial.setupId, 'opencode-go');
        // Native ACP runtime: actual tools, approvals, cold-process resume and
        // model rejection, against the same isolated managed credentials.
        setup.stop();
        const { CodeModeManager } = await import('./manager.js');
        const manager = new CodeModeManager();
        const projectA = path.join(home, 'project A'), projectB = path.join(home, 'project B');
        fs.mkdirSync(projectA); fs.mkdirSync(projectB);
        fs.writeFileSync(path.join(projectA, 'opencode.json'), JSON.stringify({ agent: { reviewer: { mode: 'primary', description: 'Review without editing', permission: { edit: 'deny' } } } }));
        const projectOptionsA = await manager.listModelOptions('opencode', projectA, 'opencode/smoke');
        const projectOptionsB = await manager.listModelOptions('opencode', projectB, 'opencode/smoke');
        expect(projectOptionsA.modes?.some(m => m.value === 'reviewer')).toBe(true);
        expect(projectOptionsB.modes?.some(m => m.value === 'reviewer')).toBe(false);
        const options = await manager.listModelOptions('opencode', home, 'opencode/smoke');
        expect(options.currentModel).toBe('opencode/smoke');
        expect(options.modes?.some(m => m.value === 'build')).toBe(true);
        const events: import('./types.js').CodeRunEvent[] = [];
        const run = { runId: 'native-smoke', agent: 'opencode' as const, cwd: home, model: 'opencode/smoke', policy: 'ask' as const, prompt: 'Perform the requested smoke-test action.', ask: async () => 'allow_once' as const, onEvent: (event: import('./types.js').CodeRunEvent) => events.push(event) };
        try {
            const edited = path.join(home, 'approved.txt');
            toolAction = { name: 'write', arguments: JSON.stringify({ filePath: edited, content: 'approved' }) };
            const first = await manager.runPrompt(run);
            expect(fs.existsSync(edited), JSON.stringify({ events, tools: requests.map(r => JSON.parse(r).tools?.map((t: { function?: { name: string } }) => t.function?.name)) })).toBe(true);
            expect(fs.readFileSync(edited, 'utf8')).toBe('approved');
            expect(events.some(e => e.type === 'permission' && e.decision === 'allow_once')).toBe(true);
            const rejected = path.join(home, 'rejected.txt');
            toolAction = { name: 'write', arguments: JSON.stringify({ filePath: rejected, content: 'rejected' }) };
            const second = await manager.runPrompt({ ...run, ask: async () => 'reject' });
            expect(second.sessionId).toBe(first.sessionId);
            expect(fs.existsSync(rejected)).toBe(false);
            expect(events.some(e => e.type === 'permission' && e.decision === 'reject')).toBe(true);
            expect(events.some(e => e.type === 'message' && e.role === 'user')).toBe(false);
            await manager.runPrompt({ ...run, mode: 'plan' });
            toolAction = { name: 'write', arguments: JSON.stringify({ filePath: edited, content: 'after-plan' }) };
            await manager.runPrompt({ ...run, mode: 'build', policy: 'yolo' });
            expect(fs.readFileSync(edited, 'utf8')).toBe('after-plan');
            toolAction = { name: 'write', arguments: JSON.stringify({ filePath: edited, content: 'must-not-write' }) };
            await manager.runPrompt({ ...run, mode: 'build', ask: async () => 'reject' });
            expect(fs.readFileSync(edited, 'utf8')).toBe('after-plan');
            toolAction = { name: 'bash', arguments: JSON.stringify({ command: 'echo ROWBOAT_COMMAND_OUTPUT', description: 'Print smoke-test output' }) };
            await manager.runPrompt(run);
            expect(events.some(e => e.type === 'tool_call_update' && e.detail?.output?.includes('ROWBOAT_COMMAND_OUTPUT'))).toBe(true);
            toolAction = { name: 'bash', arguments: JSON.stringify({ command: 'echo denied > denied-command.txt', description: 'Command that must be rejected' }) };
            await manager.runPrompt({ ...run, ask: async () => 'reject' });
            expect(fs.existsSync(path.join(home, 'denied-command.txt'))).toBe(false);
            const abort = new AbortController();
            toolAction = { name: 'write', arguments: JSON.stringify({ filePath: rejected, content: 'cancelled' }) };
            const cancelled = await manager.runPrompt({ ...run, signal: abort.signal, ask: async () => { abort.abort(); return 'reject'; } });
            expect(cancelled.stopReason).toBe('cancelled');
            expect(fs.existsSync(rejected)).toBe(false);
            await expect(manager.runPrompt({ ...run, model: 'opencode/missing' })).rejects.toThrow('unavailable');
            const native = await openCodeProcesses.start('acp', { cwd: home });
            try {
                const url = new URL(`/session/${first.sessionId}`, native.url); url.searchParams.set('directory', home);
                expect((await fetch(url, { method: 'DELETE', headers: { Authorization: native.authorization } })).ok).toBe(true);
            } finally { native.stop(); await native.exited; }
            await expect(manager.runPrompt(run)).rejects.toThrow('could not be loaded');
        } finally { manager.disposeAll(); }
        initial = await setup.start('smoke');
        await setup.saveKey(initial.setupId, 'opencode', 0, 'invalid-key');
        await expect(setup.verify(initial.setupId)).rejects.toMatchObject({ code: 'invalid-credentials' });
        const disconnected = await setup.disconnect(initial.setupId, 'opencode');
        expect(disconnected.verified).toBeUndefined();
        expect(disconnected.providers.find(p => p.id === 'opencode')?.connected).toBe(false);
        setup.stop();
        const { openCodeSetup } = await import('./opencode-setup.js');
        setup = openCodeSetup;
        const loginState = await setup.start('native-login-smoke');
        const nativeLogin = await import('./opencode-login.js');
        closeLogin = () => nativeLogin.stopOpenCodeLogin(loginState.setupId);
        nativeLogin.startOpenCodeLogin(loginState.setupId);
        let loginOutput = '';
        const loginDeadline = Date.now() + 15_000;
        while (!loginOutput && Date.now() < loginDeadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
            loginOutput += nativeLogin.readOpenCodeLogin(loginState.setupId).output;
        }
        expect(loginOutput.length).toBeGreaterThan(0);
        closeLogin(); setup.stop();
        const logs = path.join(home, '.rowboat', 'opencode', 'data', 'opencode', 'log');
        for (const file of fs.readdirSync(logs)) {
            if (!file.endsWith('.log')) continue;
            expect(fs.readFileSync(path.join(logs, file), 'utf8').includes('opencode-key')).toBe(false);
        }
        const sentinel = path.join(home, '.rowboat', 'opencode', 'state', 'retention-test');
        fs.writeFileSync(sentinel, 'retained');
        await removeOpenCodeEngine();
        expect(isEngineProvisioned('opencode')).toBe(false);
        expect(fs.readFileSync(sentinel, 'utf8')).toBe('retained');
    } catch (error) { failure = error; failed = true; } finally {
        closeLogin?.();
        setup?.stop();
        providerServer?.closeAllConnections(); providerServer?.close();
        openCodeProcesses.stopAll();
        // Only remove this test's freshly allocated temporary home. Preserve
        // the original test failure if cleanup also fails.
        if (path.dirname(home) !== os.tmpdir() || !path.basename(home).startsWith('rowboat opencode smoke ')) {
            if (!failed) { failure = new Error('Unexpected smoke-test cleanup target'); failed = true; }
        } else {
            try { await fs.promises.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
            catch (error) { if (!failed) { failure = error; failed = true; } }
        }
    }
    if (failed) throw failure;
}, 600_000);
