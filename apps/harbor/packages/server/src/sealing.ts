import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HarborError } from './errors.js';

// Sealing a platform credential Harbor must present (spec §8 Connectors,
// 2026-09-30). Unlike an agent key, which is only ever checked and so is
// stored as a hash, a platform's key has to be recoverable. AES-256-GCM under
// a deployment key from the environment, with a key id so the key can rotate
// (old ids stay readable through HARBOR_INTEGRATION_PREVIOUS_KEYS), and each
// value bound to its org and agent so a sealed value copied elsewhere does not
// open. Carried over from PR #1130's credentials.ts, which its review shaped.
// A cloud KMS replaces the environment key when Harbor's other secrets move to
// a secrets manager; the version prefix lets a `v2` sit beside `v1`.

function activeKeyId(): string {
  const id = process.env.HARBOR_INTEGRATION_KEY_ID ?? 'primary';
  if (!/^[a-z0-9_-]{1,64}$/i.test(id)) {
    throw new HarborError('invalid_request', 'HARBOR_INTEGRATION_KEY_ID must contain only letters, digits, underscores or hyphens.');
  }
  return id;
}

function key(id: string): Buffer {
  let value: unknown;
  if (id === activeKeyId()) value = process.env.HARBOR_INTEGRATION_KEY;
  else {
    const previous: unknown = JSON.parse(process.env.HARBOR_INTEGRATION_PREVIOUS_KEYS ?? '{}');
    if (previous && typeof previous === 'object' && Object.hasOwn(previous, id)) value = (previous as Record<string, unknown>)[id];
  }
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new HarborError('invalid_request', 'This Harbor cannot hold platform keys: its operator must set HARBOR_INTEGRATION_KEY (64 hex characters).');
  }
  return Buffer.from(value, 'hex');
}

const aad = (version: string, id: string, orgId: string, agentId: string) => Buffer.from(JSON.stringify([version, id, orgId, agentId]));

export function seal(secret: string, orgId: string, agentId: string): string {
  const id = activeKeyId();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(id), iv);
  cipher.setAAD(aad('v1', id, orgId, agentId));
  const bytes = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', id, ...[iv, cipher.getAuthTag(), bytes].map((b) => b.toString('base64'))].join('.');
}

export function unseal(sealed: string, orgId: string, agentId: string): string {
  const parts = sealed.split('.');
  const [version, id, ivText, tagText, bytesText] = parts;
  if (parts.length !== 5 || version !== 'v1' || !id || !ivText || !tagText || !bytesText) throw new Error('Invalid sealed credential');
  const iv = Buffer.from(ivText, 'base64');
  const tag = Buffer.from(tagText, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid sealed credential');
  const decipher = createDecipheriv('aes-256-gcm', key(id), iv);
  decipher.setAAD(aad(version, id, orgId, agentId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(bytesText, 'base64')), decipher.final()]).toString('utf8');
}

/** Throws unless this deployment can seal, so nothing is created that cannot hold its credential. */
export function assertSealingConfigured(): void {
  key(activeKeyId());
}

/** The last four characters, which is all anyone sees again. */
export function credentialHint(secret: string): string {
  return `…${secret.slice(-4)}`;
}
