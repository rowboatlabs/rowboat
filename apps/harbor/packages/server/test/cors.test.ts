import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarborDeployment, type RunningDeployment } from '../src/deployment.js';
import type { RunningHarbor } from '../src/server.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';
import { startFakeAs, startTestHarbor, type FakeAs } from './helpers.js';

// Browser clients (CONTRACT.md, 2026-10-09): the listed origins get CORS on
// the render face and the apex — the preflight before auth, the headers kept
// on a 401 — and every other origin, and an unset list, gets none.

const WEB = 'https://web.test';

const preflight = (url: string, origin: string, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type', ...headers },
  });

describe('the render face', () => {
  let harbor: RunningHarbor;
  let closed: RunningHarbor;

  beforeAll(async () => {
    harbor = await startTestHarbor({ webOrigins: [WEB], seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }] });
    closed = await startTestHarbor({ seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }] });
  });

  afterAll(async () => {
    await harbor.close();
    await closed.close();
  });

  it('answers a listed origin’s preflight without a bearer', async () => {
    const res = await preflight(`${harbor.url}/v1/spaces`, WEB);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('marks a real response, and a 401, so the page can read them', async () => {
    const ok = await fetch(`${harbor.url}/v1/spaces`, { headers: { origin: WEB, authorization: 'Bearer dev-ramnique' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(WEB);

    const refused = await fetch(`${harbor.url}/v1/spaces`, { headers: { origin: WEB } });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(refused.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
  });

  it('gives an unlisted origin nothing', async () => {
    const res = await preflight(`${harbor.url}/v1/spaces`, 'https://elsewhere.test');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const read = await fetch(`${harbor.url}/v1/spaces`, { headers: { origin: 'https://elsewhere.test', authorization: 'Bearer dev-ramnique' } });
    expect(read.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('has no CORS at all when no origin is listed', async () => {
    const res = await preflight(`${closed.url}/v1/spaces`, WEB);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('the apex', () => {
  let db: SqlDb;
  let as: FakeAs;
  let dep: RunningDeployment;

  beforeAll(async () => {
    db = await pgliteDb();
    as = await startFakeAs();
    dep = await startHarborDeployment({ db, apexDomain: 'spaces.test', issuer: as.issuer, webOrigins: [WEB] });
    await dep.createOrg({
      name: 'Acme',
      domains: ['acme.test'],
      issuer: as.issuer,
      firstAdmin: { iss: as.issuer, sub: 'sub-ram', displayName: 'Ramnique' },
    });
  });

  afterAll(async () => {
    await dep.close();
    await new Promise<void>((resolve) => as.server.close(() => resolve()));
  });

  it('answers the preflight for my orgs, and marks the listing', async () => {
    const res = await preflight(`${dep.url}/v1/orgs`, WEB, { 'x-forwarded-host': 'spaces.test' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);

    const token = await as.mint({ sub: 'sub-ram' });
    const list = await fetch(`${dep.url}/v1/orgs`, {
      headers: { origin: WEB, authorization: `Bearer ${token}`, 'x-forwarded-host': 'spaces.test' },
    });
    expect(list.status).toBe(200);
    expect(list.headers.get('access-control-allow-origin')).toBe(WEB);
  });

  it('marks every org it serves', async () => {
    const res = await preflight(`${dep.url}/v1/spaces`, WEB, { 'x-forwarded-host': 'acme.test' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
  });
});
