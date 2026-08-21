import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';

// GET /workspace/{rel-path} — the network twin of the Electron app://workspace
// protocol (apps/main/src/main.ts): serves note attachments/media to paired
// clients. Same traversal guard, authenticated like every other route.

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

export function createWorkspaceRoutes(resolveWorkspacePath: (relPath: string) => string): Hono {
  const app = new Hono();

  app.get('/workspace/*', async (c) => {
    const relPath = decodeURIComponent(c.req.path.replace(/^\/workspace\/+/, ''));
    if (!relPath) return c.text('Not Found', 404);

    let absPath: string;
    try {
      absPath = resolveWorkspacePath(relPath);
    } catch {
      return c.text('Forbidden', 403);
    }

    try {
      const stats = await fs.stat(absPath);
      if (!stats.isFile()) return c.text('Not Found', 404);
      const data = await fs.readFile(absPath);
      const type = CONTENT_TYPES[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream';
      return c.body(new Uint8Array(data), 200, {
        'Content-Type': type,
        'Content-Length': String(stats.size),
      });
    } catch {
      return c.text('Not Found', 404);
    }
  });

  return app;
}
