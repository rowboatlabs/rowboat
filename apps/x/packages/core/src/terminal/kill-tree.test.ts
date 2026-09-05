import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { killProcessTree } from './kill-tree.js';

// The whole point of killProcessTree is the escalation: processes that trap
// SIGHUP and SIGTERM (dev servers do, to survive terminal disconnects) must
// still die via the delayed SIGKILL sweep. These spawn real process trees —
// the parent here is NOT a session leader (it inherits vitest's process
// group), which also exercises the foreign-group path: the sweep must match
// per-pid instead of group-killing vitest's own group.

const isWindows = process.platform === 'win32';

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForDeath(pids: number[], timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (pids.every((pid) => !alive(pid))) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return pids.every((pid) => !alive(pid));
}

// Parent traps HUP+TERM and spawns a grandchild that traps them too; prints
// the grandchild pid so the test can watch both.
const STUBBORN_TREE = `
const { spawn } = require('node:child_process');
process.on('SIGHUP', () => {});
process.on('SIGTERM', () => {});
const c = spawn(process.execPath, ['-e', "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
console.log('GRANDCHILD=' + c.pid);
setInterval(() => {}, 1000);
`;

describe.skipIf(isWindows)('killProcessTree', () => {
    it('SIGKILLs a tree whose members trap SIGHUP and SIGTERM', async () => {
        const parent = spawn(process.execPath, ['-e', STUBBORN_TREE], { stdio: ['ignore', 'pipe', 'ignore'] });
        const grandchildPid = await new Promise<number>((resolve, reject) => {
            let buf = '';
            parent.stdout.on('data', (chunk: Buffer) => {
                buf += chunk.toString();
                const match = buf.match(/GRANDCHILD=(\d+)/);
                if (match) resolve(Number(match[1]));
            });
            parent.on('exit', () => reject(new Error('tree died before setup')));
            setTimeout(() => reject(new Error('grandchild never reported')), 10_000);
        });
        expect(alive(parent.pid as number)).toBe(true);
        expect(alive(grandchildPid)).toBe(true);

        killProcessTree(parent.pid as number, 300);

        expect(await waitForDeath([parent.pid as number, grandchildPid], 5000)).toBe(true);
    });

    it('a TERM-honoring tree dies in the graceful pass, before the SIGKILL grace elapses', async () => {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(alive(child.pid as number)).toBe(true);

        // Grace far longer than the wait: only SIGTERM can be the killer.
        killProcessTree(child.pid as number, 60_000);

        expect(await waitForDeath([child.pid as number], 2000)).toBe(true);
    });

    it('never signals the caller when the root shares its process group', async () => {
        // The spawned child inherits vitest's pgid — a group-based sweep
        // would hit this test process. Surviving the call IS the assertion,
        // but also verify the child itself died.
        const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' });
        await new Promise((resolve) => setTimeout(resolve, 200));
        killProcessTree(child.pid as number, 300);
        expect(await waitForDeath([child.pid as number], 5000)).toBe(true);
    });
});
