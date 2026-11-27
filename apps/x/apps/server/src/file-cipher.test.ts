import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFileCipher } from './file-cipher.js';

describe('file cipher (token encryption at rest)', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-cipher-test-'));
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('round-trips and is always available', async () => {
    const cipher = await createFileCipher(workDir);
    expect(cipher.isAvailable()).toBe(true);
    const secret = 'refresh-token-🔑-with-unicode';
    const encrypted = cipher.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(cipher.decrypt(encrypted)).toBe(secret);
  });

  it('persists the key: a second instance decrypts the first one\'s ciphertext', async () => {
    const first = await createFileCipher(workDir);
    const encrypted = first.encrypt('survives-restart');
    const second = await createFileCipher(workDir);
    expect(second.decrypt(encrypted)).toBe('survives-restart');
  });

  it('creates the key file with owner-only permissions', async () => {
    await createFileCipher(workDir);
    const stat = await fs.stat(path.join(workDir, 'cipher-key'));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('shares one durable key across concurrent first-time initializers', async () => {
    const dir = path.join(workDir, 'concurrent');
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const read = vi.spyOn(fs, 'readFile')
      .mockRejectedValueOnce(missing).mockRejectedValueOnce(missing);
    try {
      const ciphers = await Promise.all([createFileCipher(dir), createFileCipher(dir)]);
      const restarted = await createFileCipher(dir);
      for (const cipher of ciphers) {
        const encrypted = cipher.encrypt('survives-concurrent-start');
        for (const reader of [...ciphers, restarted]) {
          expect(reader.decrypt(encrypted)).toBe('survives-concurrent-start');
        }
      }
      expect(await fs.readdir(dir)).toEqual(['cipher-key']);
      expect((await fs.stat(path.join(dir, 'cipher-key'))).mode & 0o777).toBe(0o600);
    } finally {
      read.mockRestore();
    }
  });

  it('refuses an invalid persisted key without replacing it', async () => {
    const dir = path.join(workDir, 'invalid');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'cipher-key'), 'invalid');
    await expect(createFileCipher(dir)).rejects.toThrow('expected 32');
    expect(await fs.readFile(path.join(dir, 'cipher-key'), 'utf8')).toBe('invalid');
  });

  it('rejects tampered ciphertext (GCM auth)', async () => {
    const cipher = await createFileCipher(workDir);
    const encrypted = cipher.encrypt('integrity');
    const parts = encrypted.split(':');
    const data = Buffer.from(parts[3]!, 'base64');
    data[0]! ^= 0xff;
    parts[3] = data.toString('base64');
    expect(() => cipher.decrypt(parts.join(':'))).toThrow();
    expect(() => cipher.decrypt('not-a-ciphertext')).toThrow();
  });
});
