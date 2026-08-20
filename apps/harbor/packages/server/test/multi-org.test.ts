import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarborDeployment, type RunningDeployment } from '../src/deployment.js';
import type { SqlDb } from '../src/sql.js';
import { startFakeAs, type FakeAs } from './helpers.js';
import { pgliteDb } from './pglite.js';

// Spec §4 "Deployment and tenancy" as tests: one deployment, many orgs,
// resolved by host, with NOTHING crossing the org boundary — spaces, members,
// invites, identities, live streams. The same (iss, sub) is deliberately a
// different member in each org.

let db: SqlDb;
let as: FakeAs;
let dep: RunningDeployment;

const http = (host: string, token?: string) => ({
  async get(path: string) {
    const res = await fetch(`${dep.url}${path}`, {
      headers: { 'x-forwarded-host': host, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  },
  async post(path: string, body?: unknown) {
    const res = await fetch(`${dep.url}${path}`, {
      method: 'POST',
      headers: {
        'x-forwarded-host': host,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  },
});

beforeAll(async () => {
  db = await pgliteDb();
  as = await startFakeAs();
  dep = await startHarborDeployment({ db, apexDomain: 'spaces.test', issuer: as.issuer });
  await dep.createOrg({
    name: 'Acme',
    domains: ['acme.test'],
    issuer: as.issuer,
    firstAdmin: { iss: as.issuer, sub: 'sub-ram', displayName: 'Ramnique' },
  });
  await dep.createOrg({
    name: 'Beta',
    domains: ['beta.test'],
    issuer: as.issuer,
    allowedEmailDomains: ['beta.example'],
    firstAdmin: { iss: as.issuer, sub: 'sub-ram', displayName: 'Ram @ Beta' },
  });
});

afterAll(async () => {
  await dep.close();
  await new Promise<void>((resolve) => as.server.close(() => resolve()));
  await db.close();
});

describe('multi-org deployment', () => {
  it('routes by host: each domain is its own org; unknown domains are 404', async () => {
    expect((await http('acme.test').get('/v1/health')).body.org.name).toBe('Acme');
    expect((await http('beta.test').get('/v1/health')).body.org.name).toBe('Beta');
    expect((await http('nobody.test').get('/v1/health')).status).toBe(404);
    // Host header casing/ports normalize.
    expect((await http('ACME.test:443').get('/v1/health')).body.org.name).toBe('Acme');
  });

  it('the same (iss, sub) is a DIFFERENT member in each org — both provisioned admins', async () => {
    const token = await as.mint({ sub: 'sub-ram' });
    const acmeMe = (await http('acme.test', token).get('/v1/me')).body.member;
    const betaMe = (await http('beta.test', token).get('/v1/me')).body.member;
    expect(acmeMe.role).toBe('admin');
    expect(betaMe.role).toBe('admin');
    expect(acmeMe.id).not.toBe(betaMe.id);
    expect(acmeMe.displayName).toBe('Ramnique');
    expect(betaMe.displayName).toBe('Ram @ Beta');
  });

  it('spaces do not leak across orgs; a member of one org is not_a_member at another', async () => {
    const ram = await as.mint({ sub: 'sub-ram' });
    await http('acme.test', ram).post('/v1/spaces', { name: 'Acme Space' });
    expect((await http('acme.test', ram).get('/v1/spaces')).body.spaces.map((s: any) => s.name)).toEqual(['Acme Space']);
    expect((await http('beta.test', ram).get('/v1/spaces')).body.spaces).toEqual([]);

    // Bound in acme only → a stranger at beta.
    const invite = (
      await http('acme.test', ram).post('/v1/invites', {
        spaceId: (await http('acme.test', ram).get('/v1/spaces')).body.spaces[0].id,
      })
    ).body;
    const harsh = await as.mint({ sub: 'sub-harsh', email: 'harsh@rowboatlabs.com' });
    expect((await http('acme.test', harsh).post('/v1/invites/accept', { token: invite.token })).status).toBe(200);
    expect((await http('acme.test', harsh).get('/v1/spaces')).status).toBe(200);
    const atBeta = await http('beta.test', harsh).get('/v1/spaces');
    expect(atBeta.status).toBe(403);
    expect(atBeta.body.code).toBe('not_a_member');
  });

  it("an org's invite token is not_found at another org", async () => {
    const ram = await as.mint({ sub: 'sub-ram' });
    const spaceId = (await http('acme.test', ram).get('/v1/spaces')).body.spaces[0].id;
    const invite = (await http('acme.test', ram).post('/v1/invites', { spaceId })).body;
    const gagan = await as.mint({ sub: 'sub-gagan', email: 'gagan@beta.example' });
    const res = await http('beta.test', gagan).post('/v1/invites/accept', { token: invite.token });
    expect(res.status).toBe(404);
  });

  it('org policy is per-org: beta enforces its domain rule, acme does not', async () => {
    const ram = await as.mint({ sub: 'sub-ram' });
    await http('beta.test', ram).post('/v1/spaces', { name: 'Beta Space' });
    const spaceId = (await http('beta.test', ram).get('/v1/spaces')).body.spaces[0].id;
    const invite = (await http('beta.test', ram).post('/v1/invites', { spaceId })).body;
    const outsider = await as.mint({ sub: 'sub-x', email: 'x@gmail.com' });
    const refused = await http('beta.test', outsider).post('/v1/invites/accept', { token: invite.token });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('policy_refused');
  });

  it('live face routes by host and enforces the org boundary at upgrade', async () => {
    const harsh = await as.mint({ sub: 'sub-harsh' }); // member of acme only
    const connect = (host: string) =>
      new Promise<'open' | string>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${dep.port}/v1/live?token=${encodeURIComponent(harsh)}`, {
          headers: { 'x-forwarded-host': host },
        });
        ws.once('open', () => {
          ws.close();
          resolve('open');
        });
        ws.once('error', (err) => resolve(String(err)));
      });
    expect(await connect('acme.test')).toBe('open');
    expect(await connect('beta.test')).toContain('403');
    expect(await connect('nobody.test')).toContain('404');
  });

  it('agent face routes by host: same token, different org views', async () => {
    const ram = await as.mint({ sub: 'sub-ram' });
    const call = async (host: string) => {
      const res = await fetch(`${dep.url}/mcp`, {
        method: 'POST',
        headers: {
          'x-forwarded-host': host,
          authorization: `Bearer ${ram}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          id: 1,
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        }),
      });
      return res.status;
    };
    expect(await call('acme.test')).toBe(200);
    expect(await call('beta.test')).toBe(200);
    expect(await call('nobody.test')).toBe(404);
  });

  it('an issuer-less org is refused on a deployment that does not allow dev orgs', async () => {
    await dep.createOrg({ name: 'Dev Org', domains: ['dev.test'] });
    expect((await http('dev.test').get('/v1/health')).status).toBe(404);
  });

  it('domains are unique across the deployment', async () => {
    await expect(dep.createOrg({ name: 'Squatter', domains: ['acme.test'] })).rejects.toThrow(/already routes/);
  });
});

describe('apex face (self-serve org creation)', () => {
  it('serves discovery so the standard OAuth dance works against the apex', async () => {
    const res = await http('spaces.test').get('/.well-known/oauth-protected-resource');
    expect(res.body.authorization_servers).toEqual([as.issuer]);
  });

  it('creates an org: caller becomes first admin; the SAME token works on the new org immediately', async () => {
    const token = await as.mint({ sub: 'sub-founder', email: 'founder@rowboatlabs.com', name: 'The Founder' });
    const created = await http('spaces.test', token).post('/v1/orgs', { name: 'Roadboard', slug: 'roadboard' });
    expect(created.status).toBe(200);
    expect(created.body.org.address).toBe('roadboard.spaces.test');
    expect(created.body.member.displayName).toBe('The Founder');

    // Realm-generic tokens (spike finding): no second dance needed.
    const me = await http('roadboard.spaces.test', token).get('/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.member.role).toBe('admin');
    expect(me.body.member.id).toBe(created.body.member.id);

    // Landing area: a Main space with a welcome README, attributed to the founder.
    const spaces = (await http('roadboard.spaces.test', token).get('/v1/spaces')).body.spaces;
    expect(spaces.map((s: any) => s.name)).toEqual(['Main']);
    const readme = await http('roadboard.spaces.test', token).get(
      `/v1/spaces/${spaces[0].id}/asset?path=README.md`,
    );
    expect(readme.status).toBe(200);
    expect(readme.body.content).toContain('# Welcome to Roadboard');
    expect(readme.body.content).toContain('When to make more spaces');
    expect(readme.body.recentHistory[0].attribution.memberId).toBe(created.body.member.id);

    // Still fully functional beyond the seed: create another space.
    expect((await http('roadboard.spaces.test', token).post('/v1/spaces', { name: 'General' })).status).toBe(200);
  });

  it('lists MY orgs — memberships across the deployment, nobody else’s', async () => {
    const token = await as.mint({ sub: 'sub-founder' });
    const mine = (await http('spaces.test', token).get('/v1/orgs')).body.orgs;
    expect(mine.map((o: any) => o.name)).toEqual(['Roadboard']);
    const ram = await as.mint({ sub: 'sub-ram' });
    const rams = (await http('spaces.test', ram).get('/v1/orgs')).body.orgs;
    expect(rams.map((o: any) => o.name).sort()).toEqual(['Acme', 'Beta']);
  });

  it('rejects bad slugs, reserved slugs, taken slugs, and unauthenticated creation', async () => {
    const token = await as.mint({ sub: 'sub-founder' });
    const apex = http('spaces.test', token);
    expect((await apex.post('/v1/orgs', { name: 'X', slug: 'Bad_Slug!' })).status).toBe(400);
    expect((await apex.post('/v1/orgs', { name: 'X', slug: 'www' })).body.message).toContain('reserved');
    expect((await apex.post('/v1/orgs', { name: 'X', slug: 'roadboard' })).body.message).toContain('taken');
    const anon = await http('spaces.test').post('/v1/orgs', { name: 'X', slug: 'nope' });
    expect(anon.status).toBe(401);
    expect((await http('spaces.test').get('/v1/health')).body.apex).toBe('spaces.test');
  });
});
