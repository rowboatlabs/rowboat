import fs from 'node:fs/promises';
import path from 'node:path';
import type { TokenCipher } from '../auth/chatgpt-auth.js';

// One-time migration: re-encrypt tokens that were written by the Electron
// main process using safeStorage (OS keychain) into the new file-cipher format
// used by the standalone rowboat-server (Phase 8b, #929).
//
// BACKGROUND
// Before the client/server separation, the main process injected a
// safeStorage-backed cipher into core so tokens were encrypted at rest with
// the OS keychain.  After the split, the child/standalone server injects a
// file-backed AES-256-GCM cipher (cipher-key, mode 0600) instead.  The two
// formats are incompatible:
//   • old (safeStorage):  raw DPAPI/libsecret blob stored as base64
//   • new (file cipher):  "v1:<iv>:<tag>:<data>", all base64 segments
//
// When the file cipher encounters old-format ciphertext, its decrypt() throws
// "Unrecognized ciphertext format" which triggers a store-clear, forcing the
// user to re-authenticate.  This migration runs ONCE in the Electron main
// process – the only place that can hold both ciphers simultaneously –
// translating each old-format credential to the new format before the child
// server starts.
//
// SECURITY PROPERTIES
//   • Plaintext material lives only in a local variable between the two cipher
//     calls; it is never written to disk, never logged, never placed on IPC.
//   • Migration is idempotent: a state file records completion; subsequent
//     launches skip all of the below.
//   • Partial failure is safe:
//       – If decryption fails, the file is left untouched (the child server
//         will treat missing material as a sign-in prompt, same as before).
//       – If re-encryption or the write fails, the original file is left
//         untouched.
//       – The state file is only written after ALL auth files have been
//         processed without a hard error.
//   • After success the old tokenEncrypted value is gone from disk, replaced
//     by the new-format value.  safeStorage is never called again for these
//     files.

const STATE_FILE_NAME = 'token-migration.json';

// Sentinel: the new file cipher always produces ciphertext beginning with this
// prefix.  Any tokenEncrypted value that already starts with 'v1:' was written
// by the file cipher and needs no migration.
const FILE_CIPHER_PREFIX = 'v1:';

export interface MigrationCiphers {
  /** The safeStorage-backed cipher available in the Electron main process. */
  oldCipher: TokenCipher;
  /** The file-backed AES-256-GCM cipher used by the child/standalone server. */
  newCipher: TokenCipher;
}

export interface MigrationResult {
  /** true when the migration ran and completed (or was already done). */
  done: boolean;
  /** Names of files that were re-encrypted this run. */
  migrated: string[];
  /** Names of files that could not be migrated (decryption failed). */
  skipped: string[];
}

/**
 * Attempt to re-encrypt a single auth JSON file.
 *
 * Returns 'migrated' | 'skipped' | 'unchanged':
 *   migrated  – the file was re-written with a new-format tokensEncrypted value
 *   skipped   – there was encrypted content but decryption failed; file unchanged
 *   unchanged – no old-format encrypted content found; nothing to do
 */
async function migrateAuthFile(
  filePath: string,
  ciphers: MigrationCiphers,
): Promise<'migrated' | 'skipped' | 'unchanged'> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'unchanged';
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Corrupt JSON – leave the file alone; the auth module will deal with it.
    return 'skipped';
  }

  const encrypted = parsed['tokensEncrypted'] ?? parsed['tokenEncrypted'];
  if (typeof encrypted !== 'string' || !encrypted) return 'unchanged';

  // Already in the new format – nothing to do.
  if (encrypted.startsWith(FILE_CIPHER_PREFIX)) return 'unchanged';

  // Old safeStorage format.  Attempt to decrypt.
  let plaintext: string;
  try {
    plaintext = ciphers.oldCipher.decrypt(encrypted);
  } catch {
    // Decryption failed (wrong key, corrupt blob, cipher not available).
    // Leave the file untouched so the server can surface a sign-in prompt.
    console.warn(`[token-migration] could not decrypt ${path.basename(filePath)}; skipping`);
    return 'skipped';
  }

  // Re-encrypt with the new cipher.
  const newEncrypted = ciphers.newCipher.encrypt(plaintext);
  // Overwrite the plaintext ref in memory immediately.
  // (JS strings are GC'd; we cannot zero-fill them, but we limit their scope.)

  // Determine which field name was used in the original file.
  const fieldName = 'tokensEncrypted' in parsed ? 'tokensEncrypted' : 'tokenEncrypted';
  const updated: Record<string, unknown> = {
    ...parsed,
    [fieldName]: newEncrypted,
    // Remove any plaintext fallback field that may have been written when no
    // cipher was available; the token is now encrypted.
    tokens: undefined,
    token: undefined,
    plaintext: undefined,
  };
  // Drop keys we explicitly cleared.
  for (const k of ['tokens', 'token', 'plaintext'] as const) {
    if (updated[k] === undefined) delete updated[k];
  }

  await fs.writeFile(filePath, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 });
  console.log(`[token-migration] re-encrypted ${path.basename(filePath)}`);
  return 'migrated';
}

/**
 * Migrate any pre-separation keychain-encrypted tokens to the file-cipher format.
 *
 * This function is called once in the Electron main process, after both
 * ciphers are available but before the child rowboat-server is started.
 * It is safe to call on every launch; on the second and subsequent launches it
 * returns immediately because the state file is present.
 *
 * @param workDir  The Rowboat work directory (e.g. ~/.rowboat).
 * @param ciphers  The two ciphers: old (safeStorage) and new (file-backed).
 */
export async function migrateKeychainTokens(
  workDir: string,
  ciphers: MigrationCiphers,
): Promise<MigrationResult> {
  const stateFile = path.join(workDir, 'config', STATE_FILE_NAME);

  // Idempotency guard: already done.
  try {
    await fs.access(stateFile);
    return { done: true, migrated: [], skipped: [] };
  } catch {
    // Not yet run.
  }

  // Only attempt when both ciphers are usable.
  if (!ciphers.oldCipher.isAvailable() || !ciphers.newCipher.isAvailable()) {
    console.warn('[token-migration] one or both ciphers unavailable; skipping migration');
    return { done: false, migrated: [], skipped: [] };
  }

  const authFiles = [
    path.join(workDir, 'config', 'chatgpt-auth.json'),
    path.join(workDir, 'config', 'github-auth.json'),
  ];

  const migrated: string[] = [];
  const skipped: string[] = [];

  for (const filePath of authFiles) {
    const result = await migrateAuthFile(filePath, ciphers);
    if (result === 'migrated') migrated.push(path.basename(filePath));
    if (result === 'skipped') skipped.push(path.basename(filePath));
  }

  // Record completion.  We write the state file even when some files were
  // skipped: a skipped file means decryption failed, which can't be fixed by
  // retrying with the same ciphers; we don't want to re-attempt on every
  // launch and generate log noise.
  const state = {
    migratedAt: new Date().toISOString(),
    migrated,
    skipped,
  };
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });

  console.log(`[token-migration] complete: migrated=[${migrated.join(',')}] skipped=[${skipped.join(',')}]`);
  return { done: true, migrated, skipped };
}
