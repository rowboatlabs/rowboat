import { createHash, randomBytes } from 'node:crypto';

// Agent key material (spec §4 Agent members, 2026-09-29). A key is `rbk_`
// plus 256 random bits: the prefix lets secret scanners and the auth path
// recognise it, and the entropy makes a fast hash safe to store (a slow KDF
// defends guessable passwords, not random tokens).

export const AGENT_KEY_PREFIX = 'rbk_';

export function mintAgentKeySecret(): string {
  return AGENT_KEY_PREFIX + randomBytes(32).toString('base64url');
}

export function hashAgentKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
