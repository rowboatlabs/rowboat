import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LiveStats } from './stats.js';

// The operator face, as far as it exists (2026-09-22): GET /internal/stats,
// host-independent (the platform probes the service's own hostname, which
// routes to no org), behind one bearer the operator sets — HARBOR_INTERNAL_KEY.
// No key configured = the route does not exist. Spec §9 parks the rest of
// /internal (provisioning, limit knobs) until there is a control plane to call it.

export type InternalHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

/** Returns a handler that answers /internal/* and reports whether it did (false = not ours, route on). */
export function internalHandler(deps: { key: string | undefined; stats: LiveStats }): InternalHandler {
  return (req, res) => {
    if (!deps.key) return false;
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/internal/stats') return false;
    const json = (status: number, body: unknown): true => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    if (req.method !== 'GET') return json(405, { code: 'invalid_request', message: 'GET only' });
    const presented = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim() ?? '';
    const a = Buffer.from(presented);
    const b = Buffer.from(deps.key);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return json(401, { code: 'unauthorized', message: 'operator key required' });
    }
    return json(200, deps.stats.snapshot());
  };
}
