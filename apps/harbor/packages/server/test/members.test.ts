import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Member } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { restClient } from './helpers.js';
import { pgliteDb } from './pglite.js';

// GET /v1/members (2026-09-09): the org roster as THIS member may see it — the
// union of every roster they belong to, DMs included, deduped, sorted by
// display name. Discovery is bounded by shared membership: no directory.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;

async function startForStore(kind: 'memory' | 'postgres'): Promise<void> {
  const options: HarborOptions = {
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'harsh' }, // lowercase: the sort is case-insensitive
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'arjun', displayName: 'Arjun' },
      { id: 'loner', displayName: 'Loner' }, // shares nothing with anyone
    ],
  };
  if (kind === 'postgres') {
    sqlDb = await pgliteDb();
    const store = new PgStore(sqlDb);
    await store.init();
    options.store = store;
  }
  harbor = await startHarbor(options);
}

describe.each([['memory'], ['postgres']] as const)('GET /v1/members (%s store)', (storeKind) => {
  const ids = (members: Member[]) => members.map((m) => m.id);

  beforeAll(async () => {
    await startForStore(storeKind);
    const ramnique = restClient(harbor, 'dev-ramnique');
    const harsh = restClient(harbor, 'dev-harsh');
    const arjun = restClient(harbor, 'dev-arjun');
    // Two shared spaces both holding ramnique + harsh (dedupe), arjun in one of
    // them, gagan reachable from ramnique only through a DM.
    for (const name of ['Main', 'Launch']) {
      const created = await ramnique.post('/v1/spaces', { name });
      const inv = await ramnique.post('/v1/invites', { spaceId: created.body.space.id });
      await harsh.post('/v1/invites/accept', { token: inv.body.token });
      if (name === 'Launch') {
        const inv2 = await ramnique.post('/v1/invites', { spaceId: created.body.space.id });
        await arjun.post('/v1/invites/accept', { token: inv2.body.token });
      }
    }
    await ramnique.post('/v1/direct', { memberId: 'gagan' });
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('is the deduped union of every roster the caller belongs to, DMs included, sorted by display name', async () => {
    const r = await restClient(harbor, 'dev-ramnique').get('/v1/members');
    expect(r.status).toBe(200);
    expect(ids(r.body.members)).toEqual(['arjun', 'gagan', 'harsh', 'ramnique']);
    expect(r.body.members.map((m: Member) => m.displayName)).toEqual(['Arjun', 'Gagan', 'harsh', 'Ramnique']);
    expect(ids(r.body.members)).not.toContain('loner');
    // Full Member objects, the same rows listMembers serves.
    expect(r.body.members.find((m: Member) => m.id === 'harsh')).toEqual({ id: 'harsh', displayName: 'harsh', role: 'member' });
  });

  it('is bounded by shared membership: each member sees a different roster, always including themself', async () => {
    expect(ids((await restClient(harbor, 'dev-harsh').get('/v1/members')).body.members)).toEqual(['arjun', 'harsh', 'ramnique']);
    expect(ids((await restClient(harbor, 'dev-arjun').get('/v1/members')).body.members)).toEqual(['arjun', 'harsh', 'ramnique']);
    // gagan only ever shared a DM with ramnique.
    expect(ids((await restClient(harbor, 'dev-gagan').get('/v1/members')).body.members)).toEqual(['gagan', 'ramnique']);
    // A member of nothing sees exactly themself.
    expect(ids((await restClient(harbor, 'dev-loner').get('/v1/members')).body.members)).toEqual(['loner']);
  });

  it('follows membership changes: leaving a space narrows the roster', async () => {
    const arjun = restClient(harbor, 'dev-arjun');
    const launch = (await arjun.get('/v1/spaces')).body.spaces.find((s: { name: string }) => s.name === 'Launch');
    await arjun.post(`/v1/spaces/${launch.id}/leave`);
    expect(ids((await arjun.get('/v1/members')).body.members)).toEqual(['arjun']);
    expect(ids((await restClient(harbor, 'dev-ramnique').get('/v1/members')).body.members)).toEqual(['gagan', 'harsh', 'ramnique']);
  });

  it('is authenticated like every /v1 route', async () => {
    const res = await fetch(`${harbor.url}/v1/members`);
    expect(res.status).toBe(401);
  });
});
