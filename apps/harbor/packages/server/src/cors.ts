import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

// Browser clients (2026-10-09, the Spaces web-app plan): the web app is served
// from its own origin and calls every org's host and the apex cross-origin.
// Only the listed origins get CORS headers; the bearer rides the
// Authorization header, never a cookie, so credentials stay off. Mounted
// before auth, so a preflight — which carries no Authorization — is answered
// instead of refused, and a 401 still carries the headers that let the page
// read it and refresh its token.

export function webCors(origins: readonly string[]): MiddlewareHandler {
  const allowed = new Set(origins.map((origin) => origin.replace(/\/$/, '')));
  if (allowed.size === 0) return async (_c, next) => next();
  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['authorization', 'content-type', 'x-blob-sha256'],
    exposeHeaders: ['WWW-Authenticate'],
    maxAge: 600,
  });
}
