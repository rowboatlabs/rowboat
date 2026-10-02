import { Hono } from 'hono';

// GET /spaces/blob/{orgId}/{spaceId}/{hash} — the network twin of Electron's
// app://space-blob protocol (apps/main/src/main.ts). The org registry and its
// credentials live with core, so a client whose core is remote (a Baarali
// cloud instance, 2026-10-02) reads a space file's bytes here rather than
// from an org it cannot reach. Authenticated like every other route.

export interface SpaceBlob {
  bytes: Uint8Array;
  mime: string;
}

const HASH_RE = /^[0-9a-f]{64}$/;

export function createSpacesBlobRoutes(getSpaceBlob: (orgId: string, spaceId: string, hash: string) => Promise<SpaceBlob>): Hono {
  const app = new Hono();

  app.get('/spaces/blob/:orgId/:spaceId/:hash', async (c) => {
    const { orgId, spaceId, hash } = c.req.param();
    if (!HASH_RE.test(hash)) return c.text('Not Found', 404);
    try {
      const blob = await getSpaceBlob(orgId, spaceId, hash);
      return c.body(new Uint8Array(blob.bytes), 200, {
        'Content-Type': blob.mime,
        'Content-Length': String(blob.bytes.byteLength),
        // Content-addressed: the bytes under a hash never change.
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
    } catch {
      return c.text('Not Found', 404);
    }
  });

  return app;
}
