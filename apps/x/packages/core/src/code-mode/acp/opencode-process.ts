import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as net from 'net';
import { getProvisionedEnginePath } from './engine-provisioner.js';
import { buildOpenCodeEnvironment, prepareOpenCodeState, OPENCODE_ROOT } from './opencode-environment.js';

export interface OpenCodeProcess {
    child: ChildProcessWithoutNullStreams;
    /** Backend-only connection details. Never serialize into IPC or logs. */
    url: string;
    authorization: string;
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    stop(): void;
}

async function availablePort(): Promise<number> {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

export function terminateOpenCodeTree(child: ChildProcessWithoutNullStreams): void {
    if (!child.pid) return;
    if (process.platform === 'win32') {
        spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000, stdio: 'ignore' });
    } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    if (child.exitCode === null) child.kill('SIGKILL');
}

export class OpenCodeProcessService {
    private readonly owned = new Set<OpenCodeProcess>();
    private generation = 0;

    /** Both serve and ACP bind an authenticated private HTTP listener. ACP stdout
     * remains untouched for the later coding protocol client. */
    async start(mode: 'serve' | 'acp', options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<OpenCodeProcess> {
        if (mode === 'acp' && (!options.cwd || !path.isAbsolute(options.cwd))) throw new Error('OpenCode ACP requires an absolute project working directory.');
        const generation = this.generation;
        options.signal?.throwIfAborted();
        const executable = getProvisionedEnginePath('opencode');
        prepareOpenCodeState();
        const port = await availablePort();
        options.signal?.throwIfAborted();
        if (generation !== this.generation) throw new Error('OpenCode startup cancelled.');
        const password = randomBytes(32).toString('hex');
        const env = buildOpenCodeEnvironment();
        env.OPENCODE_SERVER_USERNAME = 'rowboat';
        env.OPENCODE_SERVER_PASSWORD = password;
        if (mode === 'serve') env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
        const child = spawn(executable, [mode, '--hostname', '127.0.0.1', '--port', String(port), '--mdns=false'], {
            cwd: mode === 'serve' ? OPENCODE_ROOT : options.cwd,
            env, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: 'pipe',
        });
        let failed = false;
        // Consume diagnostics without logging potential provider secrets. Keep only
        // a bounded byte count; exit code and startup phase are safe diagnostics.
        let diagnosticBytes = 0;
        child.stderr.on('data', (data: Buffer) => { diagnosticBytes = Math.min(8192, diagnosticBytes + data.length); });
        if (mode === 'serve') child.stdout.resume();
        const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
            child.once('error', () => { failed = true; resolve({ code: null, signal: null }); });
            child.once('exit', (code, signal) => { failed = true; resolve({ code, signal }); });
        });
        const handle: OpenCodeProcess = {
            child, url: `http://127.0.0.1:${port}`, authorization: `Basic ${Buffer.from(`rowboat:${password}`).toString('base64')}`, exited,
            stop: () => {
                if (!this.owned.delete(handle)) return;
                options.signal?.removeEventListener('abort', handle.stop);
                terminateOpenCodeTree(child);
            },
        };
        this.owned.add(handle);
        options.signal?.addEventListener('abort', handle.stop, { once: true });
        void exited.then(() => handle.stop());
        const deadline = Date.now() + (options.timeoutMs ?? 30_000);
        try {
            while (Date.now() < deadline) {
                options.signal?.throwIfAborted();
                if (failed || !this.owned.has(handle)) throw new Error(`OpenCode ${mode} exited during startup (code ${child.exitCode ?? 'unavailable'}, diagnostic bytes ${diagnosticBytes}).`);
                try {
                    const response = await fetch(`${handle.url}/global/health`, {
                        headers: { Authorization: handle.authorization }, signal: AbortSignal.timeout(500), redirect: 'error',
                    });
                    const health = response.ok ? await response.json() as { healthy?: boolean } : null;
                    if (health?.healthy && this.owned.has(handle) && !failed && !options.signal?.aborted) return handle;
                } catch { /* socket not listening yet */ }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            throw new Error(`OpenCode ${mode} startup timed out.`);
        } catch (error) {
            handle.stop();
            throw error;
        }
    }

    stopAll(): void {
        this.generation++;
        for (const handle of [...this.owned]) handle.stop();
    }
}

export const openCodeProcesses = new OpenCodeProcessService();
