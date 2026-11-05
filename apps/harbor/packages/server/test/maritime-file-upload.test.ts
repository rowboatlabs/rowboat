import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { maritimeOps } from '../src/connectors/maritime/provisioning.js';
import type { MaritimeApi } from '../src/connectors/maritime/api.js';

// Run the actual publication command concurrently on a real filesystem (2026-11-05).
it('publishes uploads exclusively, preserves binary bytes and cleans temporary files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maritime-upload-'));
  const staging = join(root, 'staging');
  const destination = join(root, 'destination');
  mkdirSync(staging);
  mkdirSync(destination);
  let failUpload = false;
  let loseResult = false;
  const api = {
    uploadFile: async (_agent: string, directory: string, name: string, bytes: Uint8Array) => {
      expect(directory).toBe('/data');
      writeFileSync(join(staging, name), bytes);
      if (failUpload) throw new Error('Upload interrupted');
      return `/opt/data/${name}`;
    },
    deleteFile: async (_agent: string, path: string) => { rmSync(join(staging, basename(path)), { force: true }); },
    exec: async (_agent: string, command: string[]) => {
      expect(command[3]).toMatch(/^\/opt\/data\//);
      let exitCode = 0;
      try {
        await promisify(execFile)(command[0]!, [...command.slice(1, 3), join(staging, basename(command[3]!)), command[4]!]);
      } catch (error) { exitCode = Number((error as { code: number }).code); }
      return { executionId: 'upload', status: loseResult ? 'lost' : 'completed', exitCode };
    },
  } as unknown as MaritimeApi;
  const ops = maritimeOps(api, 'agent', 'user');
  const bytes = new Uint8Array([0, 255, 128, 65]);
  try {
    const name = "literal ' $(touch injected).bin";
    const results = await Promise.allSettled([
      ops.uploadFile(destination, name, bytes),
      ops.uploadFile(destination, name, new Uint8Array([42])),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { message: expect.stringContaining('already exists') } });
    const original = readFileSync(join(destination, name));
    expect([Buffer.from(bytes), Buffer.from([42])]).toContainEqual(original);
    symlinkSync(join(destination, name), join(destination, 'link'));
    symlinkSync(join(destination, 'missing'), join(destination, 'dangling'));
    mkdirSync(join(destination, 'folder'));
    for (const existing of [name, 'link', 'dangling', 'folder']) {
      await expect(ops.uploadFile(destination, existing, bytes)).rejects.toThrow('already exists');
    }
    expect(readFileSync(join(destination, name))).toEqual(original);
    await ops.uploadFile(destination, 'binary', bytes);
    expect(readFileSync(join(destination, 'binary'))).toEqual(Buffer.from(bytes));
    await ops.uploadFile(destination, 'empty', new Uint8Array());
    expect(readFileSync(join(destination, 'empty')).length).toBe(0);
    await expect(ops.uploadFile(join(destination, 'absent'), 'file', bytes)).rejects.toThrow('Refresh');
    failUpload = true;
    await expect(ops.uploadFile(destination, 'interrupted', bytes)).rejects.toThrow('Upload interrupted');
    failUpload = false;
    loseResult = true;
    await expect(ops.uploadFile(destination, 'uncertain', bytes)).rejects.toThrow('Refresh');
    expect(readFileSync(join(destination, 'uncertain'))).toEqual(Buffer.from(bytes));
    expect(readdirSync(staging)).toEqual([]);
    expect(readdirSync(destination).filter(name => name.startsWith('.rowboat-upload-'))).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
