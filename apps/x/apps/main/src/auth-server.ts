import { createServer, Server } from 'http';
import { URL } from 'url';

const OAUTH_CALLBACK_PATH = '/oauth/callback';
export const DEFAULT_PORT = 8080;
export const PORT_RANGE_SIZE = 10;

/** Escape HTML special characters to prevent XSS */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface AuthServerResult {
  server: Server;
  port: number;
}

function tryBindPort(
  port: number,
  onCallback: (callbackUrl: URL) => void | Promise<void>
): Promise<AuthServerResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname === OAUTH_CALLBACK_PATH) {
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>OAuth Error</title>
                <style>
                  body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                  .error { color: #d32f2f; }
                </style>
              </head>
              <body>
                <h1 class="error">Authorization Failed</h1>
                <p>Error: ${escapeHtml(error)}</p>
                <p>You can close this window.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);
          return;
        }

        // Handle callback - pass full URL so params like iss (OpenID Connect) are preserved for token exchange
        onCallback(url);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authorization Successful</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .success { color: #2e7d32; }
              </style>
            </head>
            <body>
              <h1 class="success">Authorization Successful</h1>
              <p>You can close this window.</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(port, 'localhost', () => {
      resolve({ server, port });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      server.close();
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        // Signal caller to try next port
        reject(Object.assign(new Error(err.code), { code: err.code }));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Create a local HTTP server to handle OAuth callback.
 *
 * When `fixedPort` is true, only the given port is tried — used for providers
 * with a pre-registered redirect URI (e.g. Google BYOK) where the port must
 * match exactly what the user registered at the OAuth provider console.
 *
 * When `fixedPort` is false (default), tries `port` through `port + PORT_RANGE_SIZE - 1`
 * and binds on the first available one, handling both EADDRINUSE and EACCES
 * (the latter is common on Windows when Hyper-V/WSL2 reserve the port).
 */
export async function createAuthServer(
  port: number = DEFAULT_PORT,
  onCallback: (callbackUrl: URL) => void | Promise<void>,
  fixedPort = false,
): Promise<AuthServerResult> {
  const limit = fixedPort ? port : port + PORT_RANGE_SIZE - 1;

  for (let p = port; p <= limit; p++) {
    try {
      return await tryBindPort(p, onCallback);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EADDRINUSE' || code === 'EACCES') && p < limit) {
        console.warn(`[OAuth] Port ${p} unavailable (${code}), trying ${p + 1}…`);
        continue;
      }
      if (fixedPort) {
        const reason = code === 'EACCES' || code === 'EADDRINUSE'
          ? `Port ${port} is unavailable (${code}). This port must be free for sign-in to work — close any app using it and try again.`
          : (err instanceof Error ? err.message : String(err));
        throw new Error(reason);
      }
      throw new Error(
        `No available port found in range ${port}–${limit}. Free a port in that range and try again.`
      );
    }
  }

  // Unreachable — loop always returns or throws — but satisfies TypeScript
  throw new Error(`No available port found in range ${port}–${limit}.`);
}

