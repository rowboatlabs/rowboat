import { createServer, Server } from 'http';
import { URL } from 'url';

const OAUTH_CALLBACK_PATH = '/oauth/callback';
const DEFAULT_PORT = 8080;

export interface AuthServerResult {
  server: Server;
  port: number;
}

/**
 * Create a local HTTP server to handle OAuth callback
 * Listens on http://localhost:8080/oauth/callback
 */
export function createAuthServer(
  port: number = DEFAULT_PORT,
  onCallback: (code: string, state: string) => void
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
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
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
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);
          return;
        }

        if (code && state) {
          onCallback(code, state);
          
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
          res.writeHead(400, { 'Content-Type': 'text/html' });
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
                <h1 class="error">Invalid Request</h1>
                <p>Missing code or state parameter.</p>
                <p>You can close this window.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(port, 'localhost', () => {
      resolve({ server, port });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
  });
}

