import type { Context } from 'hono';

/**
 * The request's PUBLIC origin. TLS terminates at the platform edge and the
 * container sees plain http, so self-referential URLs (RFC 9728 resource
 * metadata, WWW-Authenticate pointers) must trust the proxy's
 * X-Forwarded-Proto/-Host — otherwise a deployed Harbor describes itself as
 * http:// and strict clients that compare resource identifiers exactly
 * mismatch.
 */
export function publicOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(/:$/, '');
  const host = c.req.header('x-forwarded-host') ?? url.host;
  return `${proto}://${host}`;
}
