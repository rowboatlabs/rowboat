import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';

// The instance's only door (roadmap phase 0, 30/09/2026). rowboat-server
// listens on loopback and rejects any Host that is not one of the machine's
// own names (its DNS-rebinding guard, apps/x/apps/server/src/server.ts). On
// Fly the Host is the app's domain, so the gate forwards to loopback with a
// loopback Host. The server's bearer key still guards every request: the
// gate adds reach, not trust. Control-plane auth lands here later
// (architecture §3.1).

export interface GateOptions {
  targetPort: number;
  targetHost?: string;
  /**
   * The apps of the account, opened on a computer (03/10/2026): `/_apps/<folder>/…`
   * goes to the apps server (core apps/constants.ts, port 3210) under the
   * app's own Host, once the bearer matches the server key. The apps server
   * checks no key of its own: the gate does it for it.
   */
  apps?: { port: number; serverKey: () => string | null };
}

/** `/_apps/finance-tracker/index.html?x=1` → the folder and the app's own path. */
export function appRoute(url: string | undefined): { folder: string; path: string } | null {
  const m = /^\/_apps\/([a-z0-9]+(?:-[a-z0-9]+)*)([/?][^]*)?$/.exec(url ?? '');
  if (!m) return null;
  const rest = m[2] ?? '/';
  return { folder: m[1], path: rest.startsWith('?') ? `/${rest}` : rest };
}

function sameKey(given: string | undefined, expected: string | null): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(given ?? '');
  if (!m || !expected) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createGate({ targetPort, targetHost = '127.0.0.1', apps }: GateOptions): http.Server {
  const loopbackHost = `${targetHost}:${targetPort}`;

  const server = http.createServer((req, res) => {
    let port = targetPort;
    let path = req.url;
    let headers: http.IncomingHttpHeaders = { ...req.headers, host: loopbackHost };
    const app = apps ? appRoute(req.url) : null;
    if (apps && app) {
      if (!sameKey(req.headers.authorization, apps.serverKey())) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'unauthorized' } }));
        return;
      }
      port = apps.port;
      path = app.path;
      headers = { ...req.headers, host: `${app.folder}.apps.localhost:${apps.port}` };
      delete headers.authorization;
    }
    const upstream = http.request(
      { host: targetHost, port, method: req.method, path, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        // The server gone mid-answer: so is the answer, rather than a caller
        // left waiting on it for ever.
        up.on('error', () => res.destroy());
        up.on('close', () => {
          if (!up.complete) res.destroy();
        });
        up.pipe(res);
      },
    );
    upstream.on('error', (err: NodeJS.ErrnoException) => {
      if (res.headersSent) return void res.destroy();
      // Refused: the server is still booting and never saw the request, so
      // the app may ask again (@x/client starting.ts). Anything else may
      // have reached it: an error the app shows.
      const starting = err.code === 'ECONNREFUSED';
      res.writeHead(starting ? 503 : 502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: starting ? 'instance_starting' : 'instance_unavailable' } }));
    });
    // The caller hung up (an app giving up while the machine wakes): stop
    // asking the server. Every stream's error is heard here — an unheard
    // one would end this process, and the machine with it.
    req.on('error', () => upstream.destroy());
    res.on('error', () => upstream.destroy());
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });

  // WebSocket: replay the handshake with the loopback Host, then splice the sockets.
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(targetPort, targetHost, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i].toLowerCase() === 'host') continue;
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: ${loopbackHost}`);
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return server;
}
