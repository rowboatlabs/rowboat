import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as path from 'path';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn(), fetch: vi.fn() }));
vi.mock('child_process', () => ({ spawn: mocks.spawn, spawnSync: mocks.spawnSync }));
vi.mock('./engine-provisioner.js', () => ({ getProvisionedEnginePath: () => path.resolve('managed engine', 'opencode.exe') }));
vi.mock('./opencode-environment.js', () => ({ OPENCODE_ROOT: path.resolve('isolated state'), prepareOpenCodeState: vi.fn(), buildOpenCodeEnvironment: () => ({ PATH: 'project tools', OPENCODE_DISABLE_AUTOUPDATE: 'true' }) }));
vi.mock('net', () => ({ createServer: () => ({ once: vi.fn(), listen: (_port: number, _host: string, cb: () => void) => cb(), address: () => ({ port: 43210 }), close: (cb: () => void) => cb() }) }));
import { OpenCodeProcessService } from './opencode-process.js';

let child: EventEmitter & { pid: number; exitCode: number | null; stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: ReturnType<typeof vi.fn> };
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
    child = Object.assign(new EventEmitter(), { pid: 987654321, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => { child.exitCode = 1; child.emit('exit', 1, null); return true; }) });
    mocks.spawn.mockReturnValue(child);
    mocks.spawnSync.mockReturnValue({ status: 0 });
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ healthy: true }) });
    vi.stubGlobal('fetch', mocks.fetch);
});

describe('OpenCode process lifecycle', () => {
    it.each(['darwin', 'linux'])('creates and kills an owned process group on %s', async platform => {
        const previous = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { value: platform });
        const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
        const service = new OpenCodeProcessService();
        try {
            const handle = await service.start('acp', { cwd: path.resolve('project with spaces') });
            expect(mocks.spawn.mock.calls[0][2].detached).toBe(true);
            handle.stop();
            await handle.exited;
            expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
            expect(mocks.spawnSync).not.toHaveBeenCalled();
        } finally {
            service.stopAll();
            Object.defineProperty(process, 'platform', previous);
        }
    });
    it('uses native launch, private binding, ephemeral backend credentials and shared environment', async () => {
        const service = new OpenCodeProcessService();
        const handle = await service.start('acp', { cwd: path.resolve('project with spaces') });
        const [command, args, options] = mocks.spawn.mock.calls[0];
        expect(command).toContain('managed engine');
        expect(args).toEqual(['acp', '--hostname', '127.0.0.1', '--port', '43210', '--mdns=false']);
        expect(options).toMatchObject({ shell: false, windowsHide: true, cwd: path.resolve('project with spaces'), env: { OPENCODE_DISABLE_AUTOUPDATE: 'true' } });
        expect(options.env.OPENCODE_SERVER_PASSWORD).toHaveLength(64);
        expect(handle.authorization).toMatch(/^Basic /);
        expect(child.stdout.listenerCount('data')).toBe(0);
        service.stopAll();
        await handle.exited;
        expect(child.kill).toHaveBeenCalledOnce();
        handle.stop();
        expect(child.kill).toHaveBeenCalledOnce();
    });
    it('cleans up after startup timeout', async () => {
        mocks.fetch.mockRejectedValue(new Error('connection refused'));
        const service = new OpenCodeProcessService();
        await expect(service.start('serve', { timeoutMs: 1 })).rejects.toThrow('timed out');
        expect(child.kill).toHaveBeenCalledOnce();
    });
    it('cleans up on cancellation during startup', async () => {
        const controller = new AbortController();
        mocks.fetch.mockImplementation(async () => { controller.abort(); throw new Error('cancelled'); });
        await expect(new OpenCodeProcessService().start('serve', { signal: controller.signal })).rejects.toBeDefined();
        expect(child.kill).toHaveBeenCalledOnce();
    });
    it('handles spawn errors without leaving a live handle', async () => {
        mocks.spawn.mockImplementationOnce(() => { queueMicrotask(() => child.emit('error', new Error('ENOENT'))); return child; });
        await expect(new OpenCodeProcessService().start('serve')).rejects.toThrow('exited during startup');
        expect(child.kill).toHaveBeenCalledOnce();
    });
    it('requires a project directory for coding', async () => {
        await expect(new OpenCodeProcessService().start('acp')).rejects.toThrow('absolute project');
    });
});
