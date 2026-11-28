import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('child_process')>(),
    spawn,
}));
vi.mock('../../config/security.js', () => ({ getSecurityAllowList: () => [] }));
vi.mock('../../runtime/assembly/copilot/runtime-context.js', () => ({ getExecutionShell: () => '/bin/sh' }));

import { executeCommandAbortable } from './command-executor.js';

afterEach(() => {
    vi.useRealTimers();
    spawn.mockReset();
});

function childWithPipes() {
    const proc = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    spawn.mockReturnValue(proc);
    return proc;
}

it('includes final stdout and stderr written between exit and close', async () => {
    const proc = childWithPipes();
    const result = executeCommandAbortable('example').promise;
    proc.emit('exit', 0);
    proc.stdout.end('last stdout');
    proc.stderr.end('last stderr');
    proc.emit('close', 0);
    expect(await result).toEqual({
        stdout: 'last stdout', stderr: 'last stderr', exitCode: 0, wasAborted: false,
    });
});

it('returns the collected output if a descendant holds the pipes open after exit', async () => {
    vi.useFakeTimers();
    const proc = childWithPipes();
    const result = executeCommandAbortable('example').promise;
    proc.stdout.write('partial output');
    proc.emit('exit', 0);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ stdout: 'partial output', exitCode: 0, wasAborted: false });
    expect(proc.stdout.destroyed).toBe(true);
    expect(proc.stderr.destroyed).toBe(true);
});
