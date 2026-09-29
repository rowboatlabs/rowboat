import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// GET /v1/members: the org roster — every member of the org, sorted by display
// name, the same list for everyone (org-wide since 2026-09-29, spec §5 Open
// spaces; bounded to shared membership from 2026-09-09 until then).

let harbor: RunningHarbor;

async function start(): Promise<void> {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'harsh' }, // lowercase: the sort is case-insensitive
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'arjun', displayName: 'Arjun' },
      { id: 'loner', displayName: 'Loner' }, // shares nothing with anyone
    ],
  });
}

describe('GET /v1/members', () => {
  const ids = (members: Member[]) => members.map((m) => m.id);

  beforeAll(async () => {
    await start();
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
  });

  it('is every member of the org, sorted by display name', async () => {
    const r = await restClient(harbor, 'dev-ramnique').get('/v1/members');
    expect(r.status).toBe(200);
    expect(ids(r.body.members)).toEqual(['arjun', 'gagan', 'harsh', 'loner', 'ramnique']);
    expect(r.body.members.map((m: Member) => m.displayName)).toEqual(['Arjun', 'Gagan', 'harsh', 'Loner', 'Ramnique']);
    // Full Member objects, the same rows listMembers serves.
    expect(r.body.members.find((m: Member) => m.id === 'harsh')).toEqual({ id: 'harsh', displayName: 'harsh', role: 'member', kind: 'human' });
  });

  it('is the same list for everyone, whatever spaces they share — a member of nothing included', async () => {
    const all = (await restClient(harbor, 'dev-ramnique').get('/v1/members')).body.members;
    for (const token of ['dev-harsh', 'dev-arjun', 'dev-gagan', 'dev-loner']) {
      expect((await restClient(harbor, token).get('/v1/members')).body.members).toEqual(all);
    }
  });

  it('does not follow space membership: leaving every space leaves you on the roster', async () => {
    const arjun = restClient(harbor, 'dev-arjun');
    const launch = (await arjun.get('/v1/spaces')).body.spaces.find((s: { name: string }) => s.name === 'Launch');
    await arjun.post(`/v1/spaces/${launch.id}/leave`);
    expect(ids((await arjun.get('/v1/members')).body.members)).toEqual(['arjun', 'gagan', 'harsh', 'loner', 'ramnique']);
    expect(ids((await restClient(harbor, 'dev-ramnique').get('/v1/members')).body.members)).toContain('arjun');
  });

  it('lets anyone open a DM with anyone on it', async () => {
    const loner = restClient(harbor, 'dev-loner');
    const r = await loner.post('/v1/direct', { memberId: 'harsh' });
    expect(r.status).toBe(200);
    expect(r.body.space.participants).toEqual(['harsh', 'loner']);
  });

  it('is authenticated like every /v1 route', async () => {
    const res = await fetch(`${harbor.url}/v1/members`);
    expect(res.status).toBe(401);
  });
});
