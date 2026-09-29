import { afterEach, expect, it, vi } from 'vitest';
import { seal, unseal } from '../src/replicas/credentials.js';

afterEach(() => vi.unstubAllEnvs());

it('binds the ciphertext to the agent and org and rejects tampering', () => {
  vi.stubEnv('HARBOR_INTEGRATION_KEY', 'a'.repeat(64));
  const sealed = seal('org-api-key', 'org', 'agent');
  expect(sealed).toMatch(/^v1\.primary\./);
  expect(unseal(sealed, 'org', 'agent')).toBe('org-api-key');
  expect(() => unseal(sealed, 'org', 'different-agent')).toThrow();
  expect(() => unseal(sealed, 'different-org', 'agent')).toThrow();
  const parts = sealed.split('.');
  parts[4] = Buffer.from('tampered').toString('base64');
  expect(() => unseal(parts.join('.'), 'org', 'agent')).toThrow();
});

it('reads old credentials during wrapping-key rotation and seals new credentials with the new id', () => {
  vi.stubEnv('HARBOR_INTEGRATION_KEY', 'a'.repeat(64));
  const old = seal('org-api-key', 'org', 'agent');
  vi.stubEnv('HARBOR_INTEGRATION_KEY_ID', '2026-10');
  vi.stubEnv('HARBOR_INTEGRATION_KEY', 'b'.repeat(64));
  vi.stubEnv('HARBOR_INTEGRATION_PREVIOUS_KEYS', JSON.stringify({ primary: 'a'.repeat(64) }));
  expect(unseal(old, 'org', 'agent')).toBe('org-api-key');
  const fresh = seal(unseal(old, 'org', 'agent'), 'org', 'agent');
  expect(fresh).toMatch(/^v1\.2026-10\./);
  vi.stubEnv('HARBOR_INTEGRATION_PREVIOUS_KEYS', '{}');
  expect(unseal(fresh, 'org', 'agent')).toBe('org-api-key');
  expect(() => unseal(old, 'org', 'agent')).toThrow();
});
