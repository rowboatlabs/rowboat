import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getAllowedRoots, isWithinAllowedRoots, shellTools } from './shell.js';

vi.mock('../../../application/lib/command-executor.js', () => ({
    executeCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'mock output',
        stderr: '',
    }),
    executeCommandAbortable: vi.fn(),
}));

describe('shellTools - working-directory boundary (#1144)', () => {
    const originalEnv = process.env.ROWBOAT_SHELL_ALLOWED_ROOTS;
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-test-'));
        delete process.env.ROWBOAT_SHELL_ALLOWED_ROOTS;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.ROWBOAT_SHELL_ALLOWED_ROOTS = originalEnv;
        } else {
            delete process.env.ROWBOAT_SHELL_ALLOWED_ROOTS;
        }
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Best effort cleanup
        }
        vi.clearAllMocks();
    });

    it('returns null when no allowed roots configured (unrestricted desktop mode)', () => {
        expect(getAllowedRoots(tempDir)).toBeNull();
    });

    it('resolves allowed roots from ROWBOAT_SHELL_ALLOWED_ROOTS env var', () => {
        const rootA = path.join(tempDir, 'workspace');
        const rootB = path.join(tempDir, 'shared');
        process.env.ROWBOAT_SHELL_ALLOWED_ROOTS = `${rootA}, ${rootB}`;

        const roots = getAllowedRoots(tempDir);
        expect(roots).toEqual([path.resolve(rootA), path.resolve(rootB)]);
    });

    it('resolves allowed roots from config/server.json', () => {
        const configDir = path.join(tempDir, 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            path.join(configDir, 'server.json'),
            JSON.stringify({
                shell: {
                    allowedRoots: ['projects/app1', '/var/data'],
                },
            }),
        );

        const roots = getAllowedRoots(tempDir);
        expect(roots).toEqual([
            path.resolve(tempDir, 'projects/app1'),
            path.resolve(tempDir, '/var/data'),
        ]);
    });

    it('correctly tests isWithinAllowedRoots', () => {
        const baseRoot = path.resolve(tempDir, 'allowed');
        const allowed = [baseRoot];

        // Exact match
        expect(isWithinAllowedRoots(baseRoot, allowed)).toBe(true);

        // Subdirectory
        const subDir = path.join(baseRoot, 'sub', 'folder');
        expect(isWithinAllowedRoots(subDir, allowed)).toBe(true);

        // Sibling / parent directory outside
        const outsideDir = path.resolve(tempDir, 'forbidden');
        expect(isWithinAllowedRoots(outsideDir, allowed)).toBe(false);

        const parentDir = path.resolve(baseRoot, '..');
        expect(isWithinAllowedRoots(parentDir, allowed)).toBe(false);
    });

    it('executeCommand allows command when unrestricted (env unset)', async () => {
        const result = (await shellTools.executeCommand.execute({
            command: 'echo hello',
            cwd: tempDir,
        })) as { success: boolean };

        expect(result.success).toBe(true);
    });

    it('executeCommand rejects command when cwd is outside allowed roots', async () => {
        const allowedDir = path.join(tempDir, 'safe-zone');
        fs.mkdirSync(allowedDir, { recursive: true });
        process.env.ROWBOAT_SHELL_ALLOWED_ROOTS = allowedDir;

        const outsideDir = path.join(tempDir, 'unsafe-zone');
        fs.mkdirSync(outsideDir, { recursive: true });

        const result = (await shellTools.executeCommand.execute({
            command: 'echo danger',
            cwd: outsideDir,
        })) as { success: boolean; message?: string };

        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid cwd: must be within allowed roots.');
    });

    it('executeCommand permits command when cwd is within allowed roots', async () => {
        const allowedDir = path.join(tempDir, 'safe-zone');
        const subDir = path.join(allowedDir, 'inner');
        fs.mkdirSync(subDir, { recursive: true });
        process.env.ROWBOAT_SHELL_ALLOWED_ROOTS = allowedDir;

        const result = (await shellTools.executeCommand.execute({
            command: 'echo safe',
            cwd: subDir,
        })) as { success: boolean };

        expect(result.success).toBe(true);
    });

    it('fails closed when server.json is malformed (has syntax error)', () => {
        const configDir = path.join(tempDir, 'config');
        fs.mkdirSync(configDir, { recursive: true });
        // Write malformed JSON
        fs.writeFileSync(path.join(configDir, 'server.json'), '{"shell": { allowedRoots: [');

        const roots = getAllowedRoots(tempDir);
        // Fails closed by returning empty array rather than null
        expect(roots).toEqual([]);
        expect(isWithinAllowedRoots(tempDir, roots!)).toBe(false);
    });

    it('returns null (unrestricted) when server.json exists without shell.allowedRoots', () => {
        const configDir = path.join(tempDir, 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'server.json'), JSON.stringify({ lanEnabled: false, port: 3220 }));

        const roots = getAllowedRoots(tempDir);
        expect(roots).toBeNull();
    });
});

