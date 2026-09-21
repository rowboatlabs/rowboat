import type { IncomingMessage } from 'node:http';
import type { Context } from 'hono';

/**
 * The request's PUBLIC origin. TLS terminates at the platform edge and the
 * container sees plain http, so self-referential URLs (RFC 9728 resource
 * metadata, WWW-Authenticate pointers) must trust the proxy's
 * X-Forwarded-Proto/-Host — otherwise a deployed Harbor describes itself as
 * http:// and strict clients that compare resource identifiers exactly
 * mismatch. One rule, two entry points: a Hono context, or the raw node
 * request the MCP face holds.
 */
function compose(h: { forwardedProto: string | undefined; forwardedHost: string | undefined; protocol: string; host: string }): string {
  return `${h.forwardedProto ?? h.protocol}://${h.forwardedHost ?? h.host}`;
}

export function publicOrigin(c: Context): string {
  const url = new URL(c.req.url);
  return compose({
    forwardedProto: c.req.header('x-forwarded-proto'),
    forwardedHost: c.req.header('x-forwarded-host'),
    protocol: url.protocol.replace(/:$/, ''),
    host: url.host,
  });
}

export function publicOriginOf(req: IncomingMessage): string {
  const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  return compose({
    forwardedProto: first(req.headers['x-forwarded-proto']),
    forwardedHost: first(req.headers['x-forwarded-host']),
    protocol: 'http',
    host: req.headers.host ?? 'localhost',
  });
}
