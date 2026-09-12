import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateKeychainTokens, type MigrationCiphers } from './keychain-token-migration.js';

// Isolated workdir so tests never touch the real ~/.rowboat.
const tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-token-migration-test-'));

afterAll(() => {
  fs.rmSync(tmpWorkDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const configDir = path.join(tmpWorkDir, 'config');
const stateFile = path.join(configDir, 'token-migration.json');
const chatgptFile = path.join(configDir, 'chatgpt-auth.json');
const githubFile = path.join(configDir, 'github-auth.json');

function ensureConfigDir(): void {
  fs.mkdirSync(configDir, { recursive: true });
}

function writeFile(p: string, obj: unknown): void {
  ensureConfigDir();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
}

/** Old cipher simulates safeStorage: produces base64 without "v1:" prefix. */
function makeOldCipher(available = true) {
  return {
    isAvailable: () => available,
    // safeStorage output is an opaque base64 blob – no prefix.
    encrypt: (plain: string) => Buffer.from(`old:${plain}`).toString('base64'),
    decrypt: (ct: string) => {
      const raw = Buffer.from(ct, 'base64').toString('utf-8');
      if (!raw.startsWith('old:')) throw new Error('bad old ciphertext');
      return raw.slice(4);
    },
  };
}

/** New cipher produces ciphertext starting with "v1:" (matches production). */
function makeNewCipher(available = true) {
  return {
    isAvailable: () => available,
    encrypt: (plain: string) => `v1:${Buffer.from(plain).toString('base64')}:tag:data`,
    decrypt: (ct: string) => {
      const [version, b64] = ct.split(':');
      if (version !== 'v1' || !b64) throw new Error('unrecognized format');
      return Buffer.from(b64, 'base64').toString('utf-8');
    },
  };
}

function makeCiphers(
  oldAvailable = true,
  newAvailable = true,
): MigrationCiphers {
  return {
    oldCipher: makeOldCipher(oldAvailable),
    newCipher: makeNewCipher(newAvailable),
  };
}

beforeEach(() => {
  // Clean slate for each test.
  for (const f of [stateFile, chatgptFile, githubFile]) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('migrateKeychainTokens', () => {
  it('migrates old-format tokensEncrypted to v1 format', async () => {
    const oldCipher = makeOldCipher();
    const newCipher = makeNewCipher();
    const plainMaterial = JSON.stringify({ accessToken: 'at_abc', refreshToken: 'rt_xyz' });
    const oldEncrypted = oldCipher.encrypt(plainMaterial);

    writeFile(chatgptFile, {
      accountId: 'acct_1',
      email: 'user@example.com',
      expiresAt: 9999999999,
      createdAt: '2025-01-01T00:00:00.000Z',
      tokensEncrypted: oldEncrypted,
    });

    const result = await migrateKeychainTokens(tmpWorkDir, { oldCipher, newCipher });

    expect(result.done).toBe(true);
    expect(result.migrated).toContain('chatgpt-auth.json');
    expect(result.skipped).toHaveLength(0);

    const stored = readJson(chatgptFile);
    // Must use the new cipher format.
    expect(typeof stored.tokensEncrypted).toBe('string');
    expect((stored.tokensEncrypted as string).startsWith('v1:')).toBe(true);

    // The new cipher must decrypt back to the original plaintext.
    const decrypted = newCipher.decrypt(stored.tokensEncrypted as string);
    const material = JSON.parse(decrypted) as Record<string, string>;
    expect(material.accessToken).toBe('at_abc');
    expect(material.refreshToken).toBe('rt_xyz');

    // Non-secret metadata is preserved.
    expect(stored.accountId).toBe('acct_1');
    expect(stored.email).toBe('user@example.com');

    // State file written.
    expect(fs.existsSync(stateFile)).toBe(true);
  });

  it('migrates the tokenEncrypted field used by github-auth', async () => {
    const oldCipher = makeOldCipher();
    const newCipher = makeNewCipher();
    const oldToken = oldCipher.encrypt('ghp_secret_token_123');

    writeFile(githubFile, {
      login: 'dev-user',
      createdAt: '2025-06-01T00:00:00.000Z',
      tokenEncrypted: oldToken,
    });

    const result = await migrateKeychainTokens(tmpWorkDir, { oldCipher, newCipher });

    expect(result.done).toBe(true);
    expect(result.migrated).toContain('github-auth.json');

    const stored = readJson(githubFile);
    expect((stored.tokenEncrypted as string).startsWith('v1:')).toBe(true);
    expect(newCipher.decrypt(stored.tokenEncrypted as string)).toBe('ghp_secret_token_123');
    expect(stored.login).toBe('dev-user');
  });

  it('skips when no old credentials exist (fresh install)', async () => {
    const result = await migrateKeychainTokens(tmpWorkDir, makeCiphers());

    expect(result.done).toBe(true);
    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    // State file written so subsequent launches skip immediately.
    expect(fs.existsSync(stateFile)).toBe(true);
  });

  it('skips a file that already has a v1 ciphertext (already migrated)', async () => {
    const newCipher = makeNewCipher();
    const alreadyMigrated = newCipher.encrypt(JSON.stringify({ accessToken: 'at', refreshToken: 'rt' }));

    writeFile(chatgptFile, {
      accountId: 'acct_1',
      expiresAt: 9999999999,
      createdAt: '2025-01-01T00:00:00.000Z',
      tokensEncrypted: alreadyMigrated,
    });

    const result = await migrateKeychainTokens(tmpWorkDir, makeCiphers());

    expect(result.done).toBe(true);
    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);

    // File unchanged.
    const stored = readJson(chatgptFile);
    expect(stored.tokensEncrypted).toBe(alreadyMigrated);
  });

  it('is idempotent: running twice does not corrupt or duplicate state', async () => {
    const oldCipher = makeOldCipher();
    const newCipher = makeNewCipher();
    const oldEncrypted = oldCipher.encrypt(JSON.stringify({ accessToken: 'at', refreshToken: 'rt' }));
    writeFile(chatgptFile, {
      expiresAt: 9999999999,
      createdAt: '2025-01-01T00:00:00.000Z',
      tokensEncrypted: oldEncrypted,
    });

    const first = await migrateKeychainTokens(tmpWorkDir, { oldCipher, newCipher });
    const storedAfterFirst = readJson(chatgptFile).tokensEncrypted as string;

    const second = await migrateKeychainTokens(tmpWorkDir, { oldCipher, newCipher });

    // Second run is a no-op: returns done=true immediately.
    expect(second.done).toBe(true);
    expect(second.migrated).toHaveLength(0);

    // File not touched again.
    expect(readJson(chatgptFile).tokensEncrypted).toBe(storedAfterFirst);

    // State file still valid.
    const state = readJson(stateFile);
    expect(typeof state.migratedAt).toBe('string');

    void first; // used above
  });

  it('handles graceful failure: old credential cannot be decrypted → file unchanged', async () => {
    const badOld = {
      isAvailable: () => true,
      encrypt: (p: string) => p,
      decrypt: () => { throw new Error('keychain unavailable'); },
    };
    const oldEncrypted = Buffer.from('old:some_blob').toString('base64');

    writeFile(chatgptFile, {
      expiresAt: 9999999999,
      createdAt: '2025-01-01T00:00:00.000Z',
      tokensEncrypted: oldEncrypted,
    });

    const result = await migrateKeychainTokens(tmpWorkDir, { oldCipher: badOld, newCipher: makeNewCipher() });

    expect(result.done).toBe(true);
    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toContain('chatgpt-auth.json');

    // Original file untouched.
    expect(readJson(chatgptFile).tokensEncrypted).toBe(oldEncrypted);
  });

  it('old credential intact when server-side persistence fails after decryption', async () => {
    // Simulate a new cipher whose encrypt throws (e.g. cipher-key write failure).
    const oldCipher = makeOldCipher();
    const brokenNewCipher = {
      isAvailable: () => true,
      encrypt: (): string => { throw new Error('disk full'); },
      decrypt: (): string => { throw new Error('never called'); },
    };
    const oldEncrypted = oldCipher.encrypt('token_value');
    writeFile(chatgptFile, {
      expiresAt: 9999999999,
      createdAt: '2025-01-01T00:00:00.000Z',
      tokensEncrypted: oldEncrypted,
    });

    // Should not throw; the error should bubble as a rejection.
    await expect(
      migrateKeychainTokens(tmpWorkDir, { oldCipher, newCipher: brokenNewCipher }),
    ).rejects.toThrow('disk full');

    // The original file must still be there and unchanged.
    expect(readJson(chatgptFile).tokensEncrypted).toBe(oldEncrypted);
    // State file must NOT have been written.
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('skips all work when the old cipher is unavailable', async () => {
    const oldEncrypted = makeOldCipher().encrypt('secret');
    writeFile(chatgptFile, { expiresAt: 9999999999, createdAt: '2025-01-01T00:00:00.000Z', tokensEncrypted: oldEncrypted });

    const result = await migrateKeychainTokens(tmpWorkDir, makeCiphers(false, true));

    expect(result.done).toBe(false);
    expect(result.migrated).toHaveLength(0);
    // File unchanged.
    expect(readJson(chatgptFile).tokensEncrypted).toBe(oldEncrypted);
    // No state file — will retry next launch when the cipher becomes available.
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('skips all work when the new cipher is unavailable', async () => {
    const result = await migrateKeychainTokens(tmpWorkDir, makeCiphers(true, false));
    expect(result.done).toBe(false);
  });

  it('does not log or persist the plaintext token value', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const oldCipher = makeOldCipher();
    const newCipher = makeNewCipher();
    const secretToken = 'PLAINTEXT_SECRET_DO_NOT_LOG';
    writeFile(chatgptFile, {
      expiresAt: 9999999999,
      createdAt: '2025-01-01T00:00:00.000Z',
      tokensEncrypted: oldCipher.encrypt(secretToken),
    });

    await migrateKeychainTokens(tmpWorkDir, { oldCipher, newCipher });

    // No console.log call should contain the plaintext secret.
    for (const call of consoleSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(secretToken);
      }
    }

    // The written file should not contain the plaintext secret.
    const fileContents = fs.readFileSync(chatgptFile, 'utf-8');
    expect(fileContents).not.toContain(secretToken);

    consoleSpy.mockRestore();
  });

  it('migrates both files in one run', async () => {
    const oldCipher = makeOldCipher();
    const newCipher = makeNewCipher();

    writeFile(chatgptFile, {
      expiresAt: 9999999999,
      createdAt: '2025-01-01T00:00:00.000Z',
      tokensEncrypted: oldCipher.encrypt(JSON.stringify({ accessToken: 'at', refreshToken: 'rt' })),
    });
    writeFile(githubFile, {
      login: 'user',
      createdAt: '2025-01-01T00:00:00.000Z',
      tokenEncrypted: oldCipher.encrypt('ghp_abc'),
    });

    const result = await migrateKeychainTokens(tmpWorkDir, { oldCipher, newCipher });

    expect(result.migrated).toContain('chatgpt-auth.json');
    expect(result.migrated).toContain('github-auth.json');
    expect(result.migrated).toHaveLength(2);
  });
});
