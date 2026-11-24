/**
 * The org's address is generated, never chosen (decision 2026-09-07: names
 * are display-only; the address is opaque). Always append a random suffix
 * so creation reveals nothing about taken names. Shared with the web host
 * (2026-10-27: its name-only request omitted Harbor's required slug).
 * Prefix 35 + '-' + 4 fits Harbor's 40-character cap.
 */
export function generatedOrgSlug(name: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const prefix =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 35).replace(/-+$/, '') || 'server';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${suffix}`;
}

/** First sign-in provisions the same solo org across devices (orgs return, 2026-11-24). */
export async function listAccountOrgs<T>(apex: string, init: RequestInit): Promise<T[]> {
  const list = async (ensure: boolean): Promise<T[]> => {
    const response = await fetch(apex + (ensure ? '/v1/orgs/ensure' : '/v1/orgs'), {
      ...init, method: ensure ? 'POST' : 'GET',
    });
    if (!response.ok) throw Object.assign(new Error(`Could not load your orgs (${response.status}).`), { status: response.status });
    const body = await response.json();
    if (!Array.isArray(body.orgs)) throw new Error('Invalid org listing.');
    return body.orgs as T[];
  };
  const orgs = await list(false);
  return orgs.length ? orgs : list(true);
}

/** Resolve an installed flat link before an app bypasses the browser redirect (2026-11-24). */
export async function orgForFlatLink(apex: string, kind: 's' | 'u' | 'join', id: string): Promise<string> {
  const res = await fetch(`${apex}/v1/links/${kind}/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('This Spaces link is unavailable.');
  const { address } = await res.json();
  if (typeof address !== 'string' || !address || new URL('https://' + address).host !== address) {
    throw new Error('Invalid Spaces address.');
  }
  return address;
}
