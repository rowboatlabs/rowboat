// The apps of a cloud account, opened on the computer (decided 03/10/2026).
//
// An app lives at its own origin, http://<folder>.apps.localhost:3210 (core
// apps/constants.ts appOrigin), served by the apps server of whichever
// machine runs core. In cloud mode that machine is the account's instance:
// the computer serves nothing there, and an opened app was a blank page.
// This relay listens on the computer at that same address and passes each
// request to the instance through the gateway (control gateway.ts), under
// `/_apps/<folder>/…`, with the device's key; the instance's gate (instance
// gate.ts) hands it to its apps server. The origin the app sees is the one
// it was built for, so its checks (§D17, same origin) hold unchanged.
//
// It may only import Node's builtins, for it compiles in main's project
// (scripts/brand.mjs copies it there).

import http from 'node:http';
import https from 'node:https';

export interface RelayTarget {
  /** The gateway, as the app's remote mode holds it: `${API_URL}/instance`. */
  url: string;
  /** The device's key. */
  key: string;
}

export interface AppsRelayOptions {
  /** Where to send, read on every request: null outside cloud mode. */
  target: () => RelayTarget | null;
  port?: number;
  hosts?: string[];
  log?: (message: string) => void;
}

/** `finance-tracker` from `finance-tracker.apps.localhost:3210`; null for any other host. */
export function folderOf(host: string | undefined): string | null {
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.apps\.localhost(?::\d+)?$/i.exec(host ?? '');
  return m ? m[1].toLowerCase() : null;
}

// Hop-by-hop headers (RFC 9110 §7.6.1) and what the gateway sets itself.
const DROPPED = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'host', 'authorization', 'proxy-authorization', 'proxy-connection']);

function answer(res: http.ServerResponse, status: number, code: string): void {
  if (res.headersSent) return void res.destroy();
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: { code } }));
}

export function createAppsRelay(options: AppsRelayOptions): http.Server {
  return http.createServer((req, res) => {
    const folder = folderOf(req.headers.host);
    if (!folder) return answer(res, 404, 'not_an_app');
    const target = options.target();
    if (!target) return answer(res, 503, 'not_in_cloud_mode');

    const base = new URL(target.url.replace(/\/+$/, '') + '/');
    const url = new URL(`_apps/${folder}${req.url ?? '/'}`, base);
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !DROPPED.has(name.toLowerCase())) headers[name] = value;
    }
    headers.authorization = `Bearer ${target.key}`;
    const send = url.protocol === 'https:' ? https.request : http.request;
    const upstream = send(url, { method: req.method, headers }, (up) => {
      const out: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(up.headers)) {
        if (value !== undefined && !DROPPED.has(name.toLowerCase())) out[name] = value;
      }
      res.writeHead(up.statusCode ?? 502, out);
      // A live stream (an app's /_rowboat/events) goes through as it comes.
      res.flushHeaders();
      up.on('error', () => res.destroy());
      up.pipe(res);
    });
    upstream.on('error', (err) => {
      options.log?.(`[apps-relay] ${folder}: ${err.message}`);
      answer(res, 502, 'instance_unavailable');
    });
    req.on('error', () => upstream.destroy());
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });
}

/**
 * Listens on loopback at the apps' port. A port already taken means a local
 * apps server runs (local mode): the relay then stays out of its way.
 */
export function startAppsRelay(options: AppsRelayOptions): { close: () => void } {
  const port = options.port ?? 3210;
  const servers: http.Server[] = [];
  for (const host of options.hosts ?? ['127.0.0.1', '::1']) {
    const server = createAppsRelay(options);
    server.on('error', (err: NodeJS.ErrnoException) => {
      options.log?.(`[apps-relay] not listening on ${host}:${port} (${err.code ?? err.message})`);
    });
    server.listen(port, host, () => options.log?.(`[apps-relay] on ${host}:${port}`));
    servers.push(server);
  }
  return { close: () => servers.forEach((s) => s.close()) };
}
