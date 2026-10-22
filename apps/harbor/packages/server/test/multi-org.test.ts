import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarborDeployment, type RunningDeployment } from '../src/deployment.js';
import { OrgDirectory } from '../src/directory.js';
import type { SqlDb } from '../src/sql.js';
import { startFakeAs, type FakeAs } from './helpers.js';
import { pgliteDb } from '../src/sql-pglite.js';

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
  async delete(path: string) {
    const res = await fetch(`${dep.url}${path}`, {
      method: 'DELETE',
      headers: { 'x-forwarded-host': host, ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
  it('open-space discovery, reads and joins stay org-scoped', async () => {
    const token = await as.mint({ sub: 'sub-ram' });
    const acme = http('acme.test', token);
    const beta = http('beta.test', token);
    const created = await acme.post('/v1/spaces', { name: 'Open isolation', visibility: 'open' });
    const id = created.body.space.id;
    expect((await acme.get('/v1/spaces/browse')).body.spaces.map((r: any) => r.space.id)).toContain(id);
    expect((await beta.get('/v1/spaces/browse')).body.spaces).toEqual([]);
    expect((await beta.get(`/v1/spaces/${id}/stream`)).status).toBe(404);
    expect((await beta.post(`/v1/spaces/${id}/join`)).status).toBe(404);
    const stranger = http('acme.test', await as.mint({ sub: 'unmapped-open-browser' }));
    for (const path of ['/v1/spaces/browse', `/v1/spaces/${id}/stream`]) {
      expect((await stranger.get(path)).body.code).toBe('not_a_member');
    }
    expect((await stranger.post(`/v1/spaces/${id}/join`)).body.code).toBe('not_a_member');
    // Leave the shared fixture's joined-space listing unchanged for its existing cases.
    await acme.post(`/v1/spaces/${id}/leave`);
  });

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

  it('deployment boot backfills asset_search — the path single-org init() covers, on the fleet', async () => {
    const ram = await as.mint({ sub: 'sub-ram' });
    const spaceId = (await http('acme.test', ram).get('/v1/spaces')).body.spaces[0].id;
    const made = await http('acme.test', ram).post(`/v1/spaces/${spaceId}/assets`, {
      path: 'notes/relics.md',
      newContent: 'the amphora survives the reboot',
      actingMode: 'direct',
    });
    expect(made.status).toBe(200);
    const relicsId: string = made.body.asset.id;

    // Simulate pre-012 data: the asset exists, its search row does not.
    await db.query('delete from asset_search', []);
    expect(
      (await http('acme.test', ram).get(`/v1/spaces/${spaceId}/search?q=amphora`)).body.assets,
    ).toEqual([]);

    // A fresh deployment over the same database — the fleet's restart.
    const dep2 = await startHarborDeployment({ db, apexDomain: 'spaces.test', issuer: as.issuer });
    try {
      const url = dep2.url;
      const res = await fetch(`${url}/v1/spaces/${spaceId}/search?q=amphora`, {
        headers: { 'x-forwarded-host': 'acme.test', authorization: `Bearer ${ram}` },
      });
      const body = (await res.json()) as { assets: Array<{ id: string; path: string; snippet?: string }> };
      expect(body.assets.map((a) => [a.id, a.path])).toEqual([[relicsId, 'notes/relics.md']]);
      expect(body.assets[0]!.snippet).toContain('amphora');
    } finally {
      await dep2.close();
    }
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

  it('a refused create leaves nothing behind — org, founder and identity roll back together', async () => {
    const tables = ['orgs', 'org_domains', 'members', 'member_identities'];
    const count = async (table: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]!.n;
    const before = await Promise.all(tables.map(count));
    // The collision is on the SECOND domain — after the org row and its founder were written in the same transaction.
    await expect(
      dep.createOrg({
        name: 'Half-made',
        domains: ['fresh.test', 'acme.test'],
        issuer: as.issuer,
        firstAdmin: { iss: as.issuer, sub: 'sub-half', displayName: 'Half' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringMatching(/already routes/) });
    expect(await Promise.all(tables.map(count))).toEqual(before);
    expect(await dep.directory.getByDomain('fresh.test')).toBeUndefined();
  });

  it("listing an identity's orgs is one statement, whatever the number of orgs", async () => {
    let statements = 0;
    const counting: SqlDb = {
      ...db,
      async query<R>(text: string, params?: unknown[]): Promise<R[]> {
        statements += 1;
        return db.query<R>(text, params);
      },
    };
    const rows = await new OrgDirectory(counting).listOrgsForIdentity(as.issuer, 'sub-ram');
    expect(statements).toBe(1);
    expect(rows.map((r) => [r.name, r.address, r.role]).sort()).toEqual([
      ['Acme', 'acme.test', 'admin'],
      ['Beta', 'beta.test', 'admin'],
    ]);
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

    // Landing area: a group chat — one space named after the org, no files
    // to read past (2026-10-07), attributed to the founder.
    const spaces = (await http('roadboard.spaces.test', token).get('/v1/spaces')).body.spaces;
    expect(spaces.map((s: any) => s.name)).toEqual(['Roadboard']);
    const entries = (await http('roadboard.spaces.test', token).get(`/v1/spaces/${spaces[0].id}/assets`)).body.entries;
    expect(entries).toEqual([]);
    const roster = (await http('roadboard.spaces.test', token).get(`/v1/spaces/${spaces[0].id}/members`)).body.members;
    expect(roster.map((m: any) => m.id)).toEqual([created.body.member.id]);

    // It is open and the org's first default (2026-10-19), so an invite to
    // the org that lists nothing binds a newcomer straight into it.
    expect(spaces[0]).toMatchObject({ visibility: 'open', isDefault: true });
    const invite = (await http('roadboard.spaces.test', token).post('/v1/invites', {})).body;
    const newcomer = await as.mint({ sub: 'sub-newcomer', email: 'new@rowboatlabs.com', name: 'Newcomer' });
    const bound = await http('roadboard.spaces.test', newcomer).post('/v1/invites/accept', { token: invite.token });
    expect(bound.status).toBe(200);
    expect(bound.body.space.id).toBe(spaces[0].id);
    expect(bound.body.spaces.map((s: any) => s.id)).toEqual([spaces[0].id]);

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

describe('org removal and reactivation (spec §4 Roles, 2026-10-19)', () => {
  it('a removed member is refused, an old link does not bring them back, a new invite reactivates the same row', async () => {
    const ram = await as.mint({ sub: 'sub-ram' });
    const temp = await as.mint({ sub: 'sub-temp', email: 'temp@acme.example', name: 'Temp' });
    const admin = http('acme.test', ram);
    const org = http('acme.test', temp);
    const spaceId = (await admin.post('/v1/spaces', { name: 'Contractors' })).body.space.id;
    const before = (await admin.post('/v1/invites', { spaceId })).body;
    const joined = await org.post('/v1/invites/accept', { token: before.token });
    expect(joined.status).toBe(200);
    const tempId = joined.body.membership.memberId;
    const posted = await org.post(`/v1/spaces/${spaceId}/messages`, { body: 'hello', actingMode: 'direct' });

    const removed = await admin.post(`/v1/members/${tempId}/remove`, { actingMode: 'direct' });
    expect(removed.status).toBe(200);
    expect((await org.get('/v1/spaces')).body.code).toBe('not_a_member');
    expect((await http('spaces.test', temp).get('/v1/orgs')).body.orgs.map((o: any) => o.name)).not.toContain('Acme');

    // The invite they joined with predates the removal: refused.
    const stale = await org.post('/v1/invites/accept', { token: before.token });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('not_a_member');

    const after = (await admin.post('/v1/invites', { spaceId })).body;
    const back = await org.post('/v1/invites/accept', { token: after.token });
    expect(back.status).toBe(200);
    expect(back.body.membership.memberId).toBe(tempId);
    const me = (await org.get('/v1/me')).body.member;
    expect(me.id).toBe(tempId);
    expect(me.removedAt).toBeUndefined();
    expect(posted.body.message.author.memberId).toBe(tempId);
  });
});

describe('apex face: account deletion (DELETE /v1/me, 2026-10-08)', () => {
  it('deactivates the caller in every org: out of shared spaces, name kept, refused at sign-in', async () => {
    const leaver = await as.mint({ sub: 'sub-leaver', email: 'leaver@rowboatlabs.com', name: 'Leaver' });
    const ram = await as.mint({ sub: 'sub-ram' });
    const created = await http('spaces.test', leaver).post('/v1/orgs', { name: 'Leavers', slug: 'leavers' });
    const leaverId = created.body.member.id;
    const org = http('leavers.spaces.test', leaver);
    const spaceId = (await org.get('/v1/spaces')).body.spaces[0].id;
    const posted = await org.post(`/v1/spaces/${spaceId}/messages`, { body: 'hello', actingMode: 'direct' });
    expect(posted.status).toBe(200);
    expect((await org.post('/v1/push/register', { token: 'ExponentPushToken[leaver]', level: 'all' })).status).toBe(200);
    const invite = (await org.post('/v1/invites', { spaceId })).body;
    const ramOrg = http('leavers.spaces.test', ram);
    expect((await ramOrg.post('/v1/invites/accept', { token: invite.token })).status).toBe(200);

    const gone = await http('spaces.test', leaver).delete('/v1/me');
    expect(gone.status).toBe(200);
    expect(gone.body.deactivated).toEqual([created.body.org.id]);

    // The same token no longer reaches the org, and the apex lists nothing.
    const after = await org.get('/v1/spaces');
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('not_a_member');
    expect((await http('spaces.test', leaver).get('/v1/orgs')).body.orgs).toEqual([]);

    // Out of the space; on the org roster with their name, marked deactivated, no photo.
    const spaceRoster = (await ramOrg.get(`/v1/spaces/${spaceId}/members`)).body.members;
    expect(spaceRoster.map((m: any) => m.id)).not.toContain(leaverId);
    const kept = (await ramOrg.get('/v1/members')).body.members.find((m: any) => m.id === leaverId);
    expect(kept.displayName).toBe('Leaver');
    expect(kept.deactivatedAt).toEqual(expect.any(String));
    expect(kept.avatarUrl).toBeUndefined();
    expect(posted.body.message.author.memberId).toBe(leaverId);

    const tokens = await db.query('select 1 from push_tokens where member_id = $1', [leaverId]);
    expect(tokens).toEqual([]);

    // Nobody adds them back or opens a DM with them.
    const add = await ramOrg.post(`/v1/spaces/${spaceId}/members`, { memberIds: [leaverId], actingMode: 'direct' });
    expect(add.status).toBe(400);
    expect(add.body.message).toContain('deleted their account');

    // An invite cannot rebind the same identity.
    const again = (await ramOrg.post('/v1/invites', { spaceId })).body;
    const rebind = await org.post('/v1/invites/accept', { token: again.token });
    expect(rebind.status).toBe(403);
    expect(rebind.body.code).toBe('not_a_member');

    // Idempotent: nothing left to deactivate.
    expect((await http('spaces.test', leaver).delete('/v1/me')).body.deactivated).toEqual([]);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await http('spaces.test').delete('/v1/me')).status).toBe(401);
  });
});
