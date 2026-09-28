import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HarborError } from '../errors.js';

// The org host, not a desktop or the coding VM, holds the credential (2026-09-28).
function key(): Buffer {
  const value = process.env.HARBOR_INTEGRATION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new HarborError('invalid_request', 'The Harbor administrator must set HARBOR_INTEGRATION_KEY to a 32-byte hex key before connecting Replicas.');
  return Buffer.from(value, 'hex');
}
export function seal(secret: string, spaceId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(spaceId));
  const bytes = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(b => b.toString('base64')).join('.');
}
export function unseal(secret: string, spaceId: string): string {
  const [iv, tag, bytes] = secret.split('.').map(s => Buffer.from(s, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv!);
  cipher.setAAD(Buffer.from(spaceId));
  cipher.setAuthTag(tag!);
  return Buffer.concat([cipher.update(bytes!), cipher.final()]).toString('utf8');
}
