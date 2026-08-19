import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// OAuth token lifecycle in the org registry (orgs.ts): refresh tokens ROTATE
// on every use, so the rules under test are (1) the new refresh token is
// persisted before the new access token is handed out, (2) refresh is
// single-flight per org, (3) a dead refresh marks the org needs-relogin.
// A fake AS (discovery + token endpoint) stands in for Supabase.

const workDir = mkdtempSync(path.join(tmpdir(), 'spaces-oauth-test-'));
process.env.ROWBOAT_WORKDIR = workDir;

type Orgs = typeof import('./orgs.js');
let orgs: Orgs;

let as: Server;
let issuer = '';
const tokenRequests: Array<{ refresh: string }> = [];
let nextGrant: { status: number; access: string; refresh: string; delayMs?: number };

const CONFIG = path.join(workDir, 'config', 'spaces_orgs.json');

function seedOrg(expiresAt: number, refresh = 'r1'): void {
  mkdirSync(path.dirname(CONFIG), { recursive: true });
  writeFileSync(
    CONFIG,
    JSON.stringify({
      version: 1,
      orgs: [
        {
          id: 'org-oauth-1',
          name: 'OAuth Org',
          address: 'oauth.test',
          baseUrl: 'http://localhost:9',
          auth: {
            kind: 'oauth',
            issuer,
            clientId: 'client-1',
            memberId: 'm-1',
            tokens: { access: 'a1', refresh, expiresAt },
          },
        },
      ],
    }),
  );
}

function storedAuth(): { tokens: { access: string; refresh: string }; error?: string } {
  return JSON.parse(readFileSync(CONFIG, 'utf-8')).orgs[0].auth;
}

beforeAll(async () => {
  as = createServer((req, res) => {
    if (req.url?.includes('.well-known')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer,
          token_endpoint: `${issuer}/token`,
          authorization_endpoint: `${issuer}/authorize`,
          response_types_supported: ['code'],
        }),
      );
      return;
    }
    if (req.url === '/token') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        tokenRequests.push({ refresh: params.get('refresh_token') ?? '' });
        const grant = nextGrant;
        setTimeout(() => {
          res.writeHead(grant.status, { 'content-type': 'application/json' });
          res.end(
            grant.status === 200
              ? JSON.stringify({ access_token: grant.access, refresh_token: grant.refresh, token_type: 'Bearer', expires_in: 3600 })
              : JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token revoked' }),
          );
        }, grant.delayMs ?? 0);
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => as.listen(0, resolve));
  issuer = `http://localhost:${(as.address() as AddressInfo).port}`;
  orgs = await import('./orgs.js');
});

afterAll(async () => {
  await new Promise<void>((resolve) => as.close(() => resolve()));
});

describe('freshTokenFor (oauth)', () => {
  it('returns the current access token untouched while it is still valid', async () => {
    seedOrg(Math.floor(Date.now() / 1000) + 3600);
    tokenRequests.length = 0;
    expect(await orgs.freshTokenFor('org-oauth-1')).toBe('a1');
    expect(tokenRequests).toHaveLength(0);
  });

  it('refreshes an expired token and persists the ROTATED refresh token', async () => {
    seedOrg(Math.floor(Date.now() / 1000) - 10);
    tokenRequests.length = 0;
    nextGrant = { status: 200, access: 'a2', refresh: 'r2' };
    expect(await orgs.freshTokenFor('org-oauth-1')).toBe('a2');
    expect(tokenRequests).toEqual([{ refresh: 'r1' }]);
    expect(storedAuth().tokens).toMatchObject({ access: 'a2', refresh: 'r2' });
  });

  it('is single-flight: concurrent callers share one refresh request', async () => {
    seedOrg(Math.floor(Date.now() / 1000) - 10);
    tokenRequests.length = 0;
    nextGrant = { status: 200, access: 'a3', refresh: 'r3', delayMs: 50 };
    const [x, y] = await Promise.all([orgs.freshTokenFor('org-oauth-1'), orgs.freshTokenFor('org-oauth-1')]);
    expect(x).toBe('a3');
    expect(y).toBe('a3');
    expect(tokenRequests).toHaveLength(1);
  });

  it('a dead refresh marks the org needs-relogin and throws', async () => {
    seedOrg(Math.floor(Date.now() / 1000) - 10, 'r-dead');
    tokenRequests.length = 0;
    nextGrant = { status: 400, access: '', refresh: '' };
    await expect(orgs.freshTokenFor('org-oauth-1')).rejects.toThrow(/re-login/);
    expect(storedAuth().error).toBeTruthy();
    // The dead refresh token is NOT overwritten — a later dance replaces auth wholesale.
    expect(storedAuth().tokens.refresh).toBe('r-dead');
  });
});
