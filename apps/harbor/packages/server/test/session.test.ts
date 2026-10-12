import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarborDeployment, type RunningDeployment } from '../src/deployment.js';
import type { RunningHarbor } from '../src/server.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';
import { startFakeAs, startTestHarbor, type FakeAs } from './helpers.js';

// The web app's session (CONTRACT.md, 2026-10-12): POST /v1/session turns a
// bearer into Harbor's cookie, and every face then takes the cookie from a
// listed origin. A blob read may come with no Origin (an <img>); nothing else may.

const WEB = 'https://web.test';
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;

describe('the session cookie on an org', () => {
  let harbor: RunningHarbor;
  let cookie: string;
  let spaceId: string;
  let hash: string;

  beforeAll(async () => {
    harbor = await startTestHarbor({ webOrigins: [WEB], seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }] });
    const start = await fetch(`${harbor.url}/v1/session`, { method: 'POST', headers: { origin: WEB, authorization: 'Bearer dev-ramnique' } });
    expect(start.status).toBe(200);
    cookie = cookieOf(start);
    const space = await fetch(`${harbor.url}/v1/spaces`, {
      method: 'POST',
      headers: { authorization: 'Bearer dev-ramnique', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cookies' }),
    });
    spaceId = ((await space.json()) as { space: { id: string } }).space.id;
    const bytes = new TextEncoder().encode('hello, cookie');
    hash = createHash('sha256').update(bytes).digest('hex');
    await fetch(`${harbor.url}/v1/spaces/${spaceId}/blobs`, {
      method: 'PUT',
      headers: { authorization: 'Bearer dev-ramnique', 'x-blob-sha256': hash, 'content-type': 'text/plain' },
      body: bytes,
    });
  });

  afterAll(async () => {
    await harbor.close();
  });

  it('is minted from a bearer: HttpOnly, Secure, SameSite=Lax, host-only on a single org', async () => {
    const res = await fetch(`${harbor.url}/v1/session`, { method: 'POST', headers: { authorization: 'Bearer dev-ramnique' } });
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/^harbor_session=dev-ramnique;/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('Domain=');
    expect((await fetch(`${harbor.url}/v1/session`, { method: 'POST' })).status).toBe(401);
  });

  it('authorizes reads and writes from a listed origin', async () => {
    const read = await fetch(`${harbor.url}/v1/spaces`, { headers: { cookie, origin: WEB } });
    expect(read.status).toBe(200);
    expect(read.headers.get('access-control-allow-credentials')).toBe('true');
    const write = await fetch(`${harbor.url}/v1/spaces/${spaceId}/messages`, {
      method: 'POST',
      headers: { cookie, origin: WEB, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'posted on the cookie', actingMode: 'direct' }),
    });
    expect(write.status).toBe(200);
    expect(((await write.json()) as { message: { author: { memberId: string } } }).message.author.memberId).toBe('ramnique');
  });

  it('counts for nothing from another origin, or with no origin outside the blob routes', async () => {
    const foreign = await fetch(`${harbor.url}/v1/spaces/${spaceId}/messages`, {
      method: 'POST',
      headers: { cookie, origin: 'https://evil.test', 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'forged', actingMode: 'direct' }),
    });
    expect(foreign.status).toBe(401);
    expect((await fetch(`${harbor.url}/v1/spaces`, { headers: { cookie } })).status).toBe(401);
  });

  it('serves a blob to a plain <img> load, with no origin, cacheable forever', async () => {
    const res = await fetch(`${harbor.url}/v1/spaces/${spaceId}/blobs/${hash}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello, cookie');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('serves download=1 as an attachment with its name', async () => {
    const res = await fetch(`${harbor.url}/v1/spaces/${spaceId}/blobs/${hash}?name=note.txt&download=1`, { headers: { cookie } });
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="note.txt"');
  });

  it('loses to a bearer: the header always wins', async () => {
    const res = await fetch(`${harbor.url}/v1/spaces`, { headers: { cookie: 'harbor_session=dev-nobody', origin: WEB, authorization: 'Bearer dev-ramnique' } });
    expect(res.status).toBe(200);
  });

  it('opens the live socket from a listed origin, and not from another', async () => {
    const wsUrl = `${harbor.url.replace('http', 'ws')}/v1/live`;
    const opened = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(wsUrl, { headers: { cookie, origin: WEB } });
      ws.on('open', () => { ws.close(); resolve(true); });
      ws.on('error', () => resolve(false));
    });
    expect(opened).toBe(true);
    const refused = await new Promise<number | undefined>((resolve) => {
      const ws = new WebSocket(wsUrl, { headers: { cookie, origin: 'https://evil.test' } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('open', () => { ws.close(); resolve(undefined); });
      ws.on('error', () => {});
    });
    expect(refused).toBe(401);
  });

  it('is cleared by DELETE, which needs no credential', async () => {
    const res = await fetch(`${harbor.url}/v1/session`, { method: 'DELETE', headers: { origin: WEB } });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^harbor_session=;.*Max-Age=0/);
  });
});

describe('the session cookie on a deployment', () => {
  let db: SqlDb;
  let as: FakeAs;
  let dep: RunningDeployment;

  beforeAll(async () => {
    db = await pgliteDb();
    as = await startFakeAs();
    dep = await startHarborDeployment({ db, apexDomain: 'spaces.test', issuer: as.issuer, webOrigins: [WEB] });
    await dep.createOrg({ name: 'Acme', domains: ['acme.spaces.test'], issuer: as.issuer, firstAdmin: { iss: as.issuer, sub: 'sub-ram', displayName: 'Ramnique' } });
  });

  afterAll(async () => {
    await dep.close();
    await new Promise<void>((resolve) => as.server.close(() => resolve()));
  });

  it('is scoped to the apex, expires with the token, and opens every org and "my orgs"', async () => {
    const token = await as.mint({ sub: 'sub-ram' });
    const start = await fetch(`${dep.url}/v1/session`, { method: 'POST', headers: { 'x-forwarded-host': 'spaces.test', origin: WEB, authorization: `Bearer ${token}` } });
    const header = start.headers.get('set-cookie') ?? '';
    expect(header).toContain('Domain=spaces.test');
    expect(header).toMatch(/Max-Age=\d+/);
    expect(((await start.json()) as { expiresAt?: string }).expiresAt).toBeDefined();
    const cookie = cookieOf(start);

    const mine = await fetch(`${dep.url}/v1/orgs`, { headers: { 'x-forwarded-host': 'spaces.test', origin: WEB, cookie } });
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { orgs: Array<{ name: string }> }).orgs.map((o) => o.name)).toEqual(['Acme']);

    const spaces = await fetch(`${dep.url}/v1/spaces`, { headers: { 'x-forwarded-host': 'acme.spaces.test', origin: WEB, cookie } });
    expect(spaces.status).toBe(200);
  });
});
