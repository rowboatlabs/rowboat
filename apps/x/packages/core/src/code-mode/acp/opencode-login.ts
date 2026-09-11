import * as pty from 'node-pty';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { ensureSpawnHelperExecutable } from '../../terminal/terminal.js';
import { killProcessTree } from '../../terminal/kill-tree.js';
import { buildOpenCodeEnvironment, OPENCODE_ROOT, prepareOpenCodeState } from './opencode-environment.js';
import { getProvisionedEnginePath } from './engine-provisioner.js';
import { openCodeSetup, SetupError } from './opencode-setup.js';

// Dedicated ephemeral PTY: no generic terminal broadcasts or persisted backlog.
let login: { id: string; process: pty.IPty; output: string; running: boolean; exitCode?: number; timer: ReturnType<typeof setTimeout> } | undefined;
export function startOpenCodeLogin(id: string): void {
    if (login) throw new SetupError('busy', 'A managed login is already open. Close it before starting another.');
    openCodeSetup.beginLogin(id);
    try {
        prepareOpenCodeState(); ensureSpawnHelperExecutable();
        const env = buildOpenCodeEnvironment();
        env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
        const proc = pty.spawn(getProvisionedEnginePath('opencode'), ['auth', 'login'], {
            cwd: OPENCODE_ROOT, env: Object.fromEntries(Object.entries(env).filter((item): item is [string, string] => item[1] !== undefined)),
            cols: 80, rows: 20, name: 'xterm-256color',
            // Avoid node-pty's legacy console-list helper racing tree termination.
            useConptyDll: process.platform === 'win32',
        });
        const timer = setTimeout(() => stopOpenCodeLogin(id), 10 * 60_000); timer.unref?.();
        const entry = { id, process: proc, output: '', running: true, exitCode: undefined as number | undefined, timer };
        login = entry;
        proc.onData(data => { entry.output = (entry.output + data).slice(-32768); });
        proc.onExit(({ exitCode }) => { entry.running = false; entry.exitCode = exitCode; clearTimeout(timer); if (login === entry) openCodeSetup.endLogin(id); });
    } catch { openCodeSetup.endLogin(id); throw new SetupError('failed', 'Could not open the managed login terminal. Re-check the engine and retry.'); }
}
export function readOpenCodeLogin(id: string) {
    if (login?.id !== id) throw new SetupError('cancelled', 'The managed login terminal has closed.');
    const output = login.output; login.output = '';
    return { output, running: login.running, exitCode: login.exitCode };
}
export function writeOpenCodeLogin(id: string, input: string): void {
    if (login?.id !== id || !login.running) throw new SetupError('cancelled', 'The managed login terminal has closed.');
    login.process.write(input);
}
export function stopOpenCodeLogin(id?: string): void {
    if (!login || (id && login.id !== id)) return;
    const entry = login; login = undefined;
    clearTimeout(entry.timer);
    if (entry.running) {
        if (process.platform === 'win32') {
            spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
                ['/pid', String(entry.process.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
        } else killProcessTree(entry.process.pid);
        try { entry.process.kill(); } catch { /* exited */ }
    }
    openCodeSetup.endLogin(entry.id);
}
