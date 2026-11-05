import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maritimeOps } from '../src/connectors/maritime/provisioning.js';
import type { MaritimeApi } from '../src/connectors/maritime/api.js';

// Exercise the VM's actual exclusive-create command, not just the fake API (2026-11-04).
describe('exclusive VM file creation', () => {
  it('preserves files and symlinks, rejects directories and missing parents, and treats names literally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maritime-create-'));
    const api = { exec: async (_agent: string, command: string[]) => {
      let exitCode = 0;
      try { execFileSync(command[0]!, command.slice(1), { stdio: 'pipe' }); }
      catch (error) { exitCode = (error as { status: number }).status; }
      return { id: 'create', status: 'completed', exitCode };
    } } as unknown as MaritimeApi;
    const ops = maritimeOps(api, 'agent', 'user');
    try {
      const path = join(dir, "literal ' $(touch injected).txt");
      await ops.createFile(path);
      expect(readFileSync(path, 'utf8')).toBe('');
      writeFileSync(path, 'preserve me');
      await expect(ops.createFile(path)).rejects.toThrow('already exists');
      expect(readFileSync(path, 'utf8')).toBe('preserve me');
      symlinkSync(path, join(dir, 'link'));
      symlinkSync(join(dir, 'absent'), join(dir, 'dangling'));
      for (const existing of [dir, join(dir, 'link'), join(dir, 'dangling')]) {
        await expect(ops.createFile(existing)).rejects.toThrow('already exists');
      }
      await expect(ops.createFile(join(dir, 'missing', 'child'))).rejects.toThrow('Could not create');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
