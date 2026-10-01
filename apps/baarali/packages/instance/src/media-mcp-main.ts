import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createMcpHandler, createMediaTools, serveStdio } from './media-mcp.js';

// Entry point rowboat-server spawns for the `baarali-media` MCP server
// (seed.ts registers it). The token is read from the session the seed wrote
// in oauth.json, so mcp.json holds no secret. stdout is the protocol:
// anything else goes to stderr.

const workDir = process.env.ROWBOAT_WORKDIR ?? '/data';
const controlUrl = (process.env.API_URL ?? '').replace(/\/+$/, '');

async function instanceToken(): Promise<string> {
  const oauth = JSON.parse(await fs.readFile(path.join(workDir, 'config', 'oauth.json'), 'utf8')) as {
    providers?: { rowboat?: { tokens?: { access_token?: unknown } } };
  };
  const token = oauth.providers?.rowboat?.tokens?.access_token;
  if (typeof token !== 'string' || !token) throw new Error('No instance session in oauth.json');
  return token;
}

if (!controlUrl) {
  console.error('[baarali-media] API_URL is required');
  process.exit(1);
}
const tools = createMediaTools({
  controlUrl,
  token: await instanceToken(),
  workDir,
  fetch: globalThis.fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
});
serveStdio(createMcpHandler(tools));
