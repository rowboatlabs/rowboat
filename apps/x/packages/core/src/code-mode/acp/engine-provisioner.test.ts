import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

const archive = Buffer.from('verified fixture archive');
const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
let home: string;
let provisioner: typeof import('./engine-provisioner.js');
let spawn: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    vi.resetModules();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat engine test '));
    vi.doMock('os', () => ({ ...os, homedir: () => home }));
    vi.doMock('./shell-env.js', () => ({ loginShellPath: () => undefined }));
    const platforms = Object.fromEntries(['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'linux-x64-musl', 'linux-arm64-musl'].map(key => [key, { pkg: 'fixture', pkgVersion: '1.18.30', tarball: 'https://example.test/engine.tgz', integrity }]));
    vi.doMock('./engine-manifest.js', () => ({ ENGINE_MANIFEST: { opencode: { version: '1.18.30', platforms } } }));
    spawn = vi.fn((_command: string, args: string[]) => {
        if (args[0] === '--version') return { status: 0, stdout: '1.18.30\n' };
        const root = args[args.indexOf('-C') + 1];
        fs.mkdirSync(path.join(root, 'bin'));
        fs.writeFileSync(path.join(root, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode'), 'native fixture');
        return { status: 0 };
    });
    vi.doMock('child_process', () => ({ spawnSync: spawn }));
    fetchMock = vi.fn(async () => new Response(archive));
    vi.stubGlobal('fetch', fetchMock);
    provisioner = await import('./engine-provisioner.js');
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(home, { recursive: true, force: true }); });

describe('managed OpenCode installation', () => {
    it.each([
        ['darwin', 'x64', { glibcVersionRuntime: '2.39' }, 'darwin-x64'],
        ['darwin', 'arm64', {}, 'darwin-arm64'],
        ['linux', 'x64', { glibcVersionRuntime: '2.39' }, 'linux-x64'],
        ['linux', 'arm64', { glibcVersionRuntime: '2.39' }, 'linux-arm64'],
        ['linux', 'x64', {}, 'linux-x64-musl'],
        ['linux', 'arm64', {}, 'linux-arm64-musl'],
        ['linux', 'x64', undefined, 'linux-x64'],
    ])('selects %s/%s correctly, including libc, and validates the Unix executable', async (platform, arch, header, expected) => {
        const previousPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        const previousArch = Object.getOwnPropertyDescriptor(process, 'arch')!;
        Object.defineProperty(process, 'platform', { value: platform });
        Object.defineProperty(process, 'arch', { value: arch });
        vi.spyOn(process.report, 'getReport').mockReturnValue((header ? { header } : undefined) as never);
        try {
            const result = await provisioner.ensureEngine('opencode');
            expect(path.basename(result.executablePath)).toBe('opencode');
            const metadata = JSON.parse(fs.readFileSync(path.join(provisioner.ENGINES_ROOT, 'opencode', '.meta', 'opencode-1.18.30.json'), 'utf8'));
            const expectedPlatform = !header && fs.existsSync('/lib/ld-musl-x86_64.so.1') ? 'linux-x64-musl' : expected;
            expect(metadata.platform).toBe(expectedPlatform);
            expect(metadata.validated).toBe(true);
            expect(spawn.mock.calls[0][0]).toBe('tar');
            expect(spawn.mock.calls[0][1]).toContain('--strip-components=1');
        } finally {
            Object.defineProperty(process, 'platform', previousPlatform);
            Object.defineProperty(process, 'arch', previousArch);
        }
    });
    it('deduplicates downloads, fans out progress, validates before activation and reuses installation', async () => {
        const first = vi.fn(), second = vi.fn();
        const [a, b] = await Promise.all([provisioner.ensureEngine('opencode', { onProgress: first }), provisioner.ensureEngine('opencode', { onProgress: second })]);
        expect(a).toEqual(b);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledWith({ phase: 'validate' });
        expect(second).toHaveBeenCalledWith({ phase: 'done' });
        expect(provisioner.isEngineProvisioned('opencode')).toBe(true);
        await provisioner.ensureEngine('opencode');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const probe = spawn.mock.calls.find(call => call[1][0] === '--version')!;
        expect(probe[0]).toContain(home);
        expect(probe[2]).toMatchObject({ timeout: 15000, windowsHide: true, env: { OPENCODE_DISABLE_AUTOUPDATE: 'true' } });
    });
    it('does not accept a global executable or a missing managed executable, and repairs', async () => {
        expect(() => provisioner.getProvisionedEnginePath('opencode')).toThrow('enabled');
        const installed = await provisioner.ensureEngine('opencode');
        fs.unlinkSync(installed.executablePath);
        expect(provisioner.isEngineProvisioned('opencode')).toBe(false);
        expect(() => provisioner.getProvisionedEnginePath('opencode')).toThrow();
        await provisioner.ensureEngine('opencode');
        expect(provisioner.isEngineProvisioned('opencode')).toBe(true);
    });
    it.each(['integrity', 'extraction', 'version', 'network'])('does not activate after %s failure and permits retry', async failure => {
        if (failure === 'integrity') fetchMock.mockResolvedValueOnce(new Response('corrupt'));
        if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
        if (failure === 'extraction') spawn.mockReturnValueOnce({ status: 1, stderr: 'bad tar' });
        if (failure === 'version') spawn.mockImplementationOnce((_cmd, args) => {
            const root = args[args.indexOf('-C') + 1];
            fs.mkdirSync(path.join(root, 'bin'));
            fs.writeFileSync(path.join(root, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode'), 'fixture');
            return { status: 0 };
        }).mockReturnValueOnce({ status: 1, stdout: 'wrong version' });
        await expect(provisioner.ensureEngine('opencode')).rejects.toThrow();
        expect(provisioner.isEngineProvisioned('opencode')).toBe(false);
        expect(fs.readdirSync(path.join(provisioner.ENGINES_ROOT, 'opencode')).filter(p => p.startsWith('.tmp-'))).toEqual([]);
        await provisioner.ensureEngine('opencode');
        expect(provisioner.isEngineProvisioned('opencode')).toBe(true);
    });
    it('detaches one cancelled caller without cancelling another', async () => {
        const controller = new AbortController();
        const a = provisioner.ensureEngine('opencode', { signal: controller.signal });
        const rejected = expect(a).rejects.toBeDefined();
        const b = provisioner.ensureEngine('opencode');
        controller.abort();
        await rejected;
        await b;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('aborts when the only caller cancels, leaving no installed state', async () => {
        const controller = new AbortController();
        const result = provisioner.ensureEngine('opencode', { signal: controller.signal });
        controller.abort();
        await expect(result).rejects.toBeDefined();
        await provisioner.removeOpenCodeEngine();
        expect(provisioner.isEngineProvisioned('opencode')).toBe(false);
    });
    it('preserves credentials and sessions on remove and reinstall', async () => {
        await provisioner.ensureEngine('opencode');
        const data = path.join(home, '.rowboat', 'opencode', 'data', 'auth.json');
        fs.writeFileSync(data, 'retained state');
        await provisioner.removeOpenCodeEngine();
        expect(provisioner.isEngineProvisioned('opencode')).toBe(false);
        expect(fs.readFileSync(data, 'utf8')).toBe('retained state');
        await provisioner.ensureEngine('opencode');
        expect(fs.readFileSync(data, 'utf8')).toBe('retained state');
    });
});
