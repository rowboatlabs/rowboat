import http from 'node:http';
import net from 'node:net';

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
}

export function createGate({ targetPort, targetHost = '127.0.0.1' }: GateOptions): http.Server {
  const loopbackHost = `${targetHost}:${targetPort}`;

  const server = http.createServer((req, res) => {
    const upstream = http.request(
      { host: targetHost, port: targetPort, method: req.method, path: req.url, headers: { ...req.headers, host: loopbackHost } },
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
    upstream.on('error', () => {
      if (res.headersSent) return void res.destroy();
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'instance_unavailable' } }));
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
