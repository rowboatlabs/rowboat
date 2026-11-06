import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// A Grok Bot routine's webhook (spec §8 Grok Bot, 2026-11-05): its "POST to"
// address, then its key, as one credential separated by whitespace, because
// the Add screen takes one secret. A routine whose address carries its own
// token has no key. Harbor POSTs to an address its owner typed, so only a
// public https host is taken: no loopback, private or link-local address, no
// credentials in the URL.

export interface Webhook {
  url: string;
  key?: string;
}

export function parseWebhook(secret: string, options: { allowHttp?: boolean } = {}): Webhook | { error: string } {
  const parts = secret.trim().split(/\s+/).filter(Boolean);
  const urlAt = parts.findIndex((p) => /^https?:\/\//i.test(p));
  if (urlAt < 0) return { error: 'Paste the routine’s POST to address (https://…) and its key, separated by a space' };
  if (parts.length > 2) return { error: 'Paste only the routine’s POST to address and its key, separated by a space' };
  let url: URL;
  try {
    url = new URL(parts[urlAt]!);
  } catch {
    return { error: 'The routine’s POST to address is not a URL' };
  }
  if (url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:')) return { error: 'The routine’s POST to address must start with https://' };
  if (url.username || url.password) return { error: 'The routine’s POST to address must not carry a user name or password' };
  if (!options.allowHttp && !publicHost(url.hostname)) return { error: 'The routine’s POST to address must be a public host' };
  const key = parts.find((_, i) => i !== urlAt);
  return { url: url.href, ...(key ? { key } : {}) };
}

/** Every address the host resolves to is public: checked again before each delivery, as a name can move. */
export async function resolvesPublic(url: string): Promise<boolean> {
  const { hostname } = new URL(url);
  try {
    const addresses = await lookup(hostname.replace(/^\[|\]$/g, ''), { all: true });
    return addresses.length > 0 && addresses.every((a) => publicHost(a.address));
  } catch {
    return false;
  }
}

function publicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (isIP(host) === 6) return !(host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:'));
  return host.includes('.');
}
