import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Server key: a single random bearer token minted on first boot
// (~/.rowboat/server-key, mode 0600). Every client — the Electron forwarder,
// paired phones, third-party UIs — presents it. Rotation = delete the file
// and restart; that revokes every paired client at once.

export const SERVER_KEY_FILE = 'server-key';

export async function loadOrCreateServerKey(workDir: string): Promise<string> {
  const keyPath = path.join(workDir, SERVER_KEY_FILE);
  try {
    const key = (await fs.readFile(keyPath, 'utf8')).trim();
    if (key) return key;
  } catch {
    // fall through to mint
  }
  const key = crypto.randomBytes(32).toString('base64url');
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(keyPath, key + '\n', { mode: 0o600 });
  return key;
}

export async function rotateServerKey(workDir: string): Promise<string> {
  await fs.rm(path.join(workDir, SERVER_KEY_FILE), { force: true });
  return loadOrCreateServerKey(workDir);
}

// Hash both sides so timingSafeEqual gets equal-length buffers regardless of
// what the client sent.
export function tokenMatches(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Extracts the bearer token from an Authorization header value or a ?token=
// query fallback (browser WebSocket clients cannot set headers).
export function extractBearer(
  authorizationHeader: string | undefined,
  queryToken?: string | null,
): string | null {
  if (authorizationHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
    if (match) return match[1];
  }
  return queryToken || null;
}
