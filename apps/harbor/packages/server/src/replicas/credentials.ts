import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HarborError } from '../errors.js';

// 2026-09-29, PR #1130 review: identify the wrapping key and bind ciphertext
// to the org's agent identity, so rotation never changes authorship.
function activeKeyId(): string {
  const id = process.env.HARBOR_INTEGRATION_KEY_ID ?? 'primary';
  if (!/^[a-z0-9_-]{1,64}$/i.test(id)) throw new HarborError('invalid_request', 'HARBOR_INTEGRATION_KEY_ID must contain only letters, digits, underscores or hyphens.');
  return id;
}
function key(id: string): Buffer {
  let value: unknown;
  if (id === activeKeyId()) value = process.env.HARBOR_INTEGRATION_KEY;
  else {
    const previous: unknown = JSON.parse(process.env.HARBOR_INTEGRATION_PREVIOUS_KEYS ?? '{}');
    if (previous && typeof previous === 'object' && Object.hasOwn(previous, id)) value = (previous as Record<string, unknown>)[id];
  }
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new HarborError('invalid_request', 'The Harbor administrator must configure the integration wrapping key for this key id.');
  return Buffer.from(value, 'hex');
}
export function seal(secret: string, orgId: string, memberId: string): string {
  const id = activeKeyId();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(id), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(['v1', id, orgId, memberId])));
  const bytes = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', id, ...[iv, cipher.getAuthTag(), bytes].map(b => b.toString('base64'))].join('.');
}
export function unseal(secret: string, orgId: string, memberId: string): string {
  const parts = secret.split('.');
  const [version, id, ivText, tagText, bytesText] = parts;
  if (parts.length !== 5 || version !== 'v1' || !id || !ivText || !tagText || !bytesText) throw new Error('Invalid sealed credential');
  const iv = Buffer.from(ivText, 'base64');
  const tag = Buffer.from(tagText, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid sealed credential');
  const cipher = createDecipheriv('aes-256-gcm', key(id), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([version, id, orgId, memberId])));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.from(bytesText, 'base64')), cipher.final()]).toString('utf8');
}
