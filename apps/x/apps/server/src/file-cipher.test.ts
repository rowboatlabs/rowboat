import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
