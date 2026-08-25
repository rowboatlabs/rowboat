import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TokenCipher } from '@x/core/dist/auth/chatgpt-auth.js';

// Token-at-rest encryption for headless hosts (Phase 8b). The Electron app
// used safeStorage (OS keychain); a standalone server has no keychain, so the
// cipher key is a random 32-byte file next to the data it protects —
// `<workdir>/cipher-key`, mode 0600. This protects tokens from casual reads
// and backups that miss the key file; an attacker with full workdir access
// gets both, which matches the keychain-less posture of comparable
// server daemons. Ciphertext format: v1:<iv>:<tag>:<data>, all base64.

const KEY_BYTES = 32;
const IV_BYTES = 12;

export async function createFileCipher(workDir: string): Promise<TokenCipher> {
  const keyPath = path.join(workDir, 'cipher-key');
  let key: Buffer;
  try {
    key = Buffer.from((await fs.readFile(keyPath, 'utf8')).trim(), 'base64');
    if (key.length !== KEY_BYTES) throw new Error(`cipher-key is ${key.length} bytes, expected ${KEY_BYTES}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    key = crypto.randomBytes(KEY_BYTES);
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(keyPath, key.toString('base64') + '\n', { mode: 0o600 });
  }

  return {
    isAvailable: () => true,
    encrypt: (plain: string): string => {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
    },
    decrypt: (encrypted: string): string => {
      const [version, iv, tag, data] = encrypted.split(':');
      if (version !== 'v1' || !iv || !tag || !data) {
        throw new Error('Unrecognized ciphertext format');
      }
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
