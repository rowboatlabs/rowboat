import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// GET /v1/members: the org roster — every member of the org, sorted by
// display name (spec §5 answer 4; org-wide since 2026-09-29, bounded to
// shared spaces before). The same answer for everyone in the org.

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

  const everyone = ['arjun', 'gagan', 'harsh', 'loner', 'ramnique'];

  it('is every member of the org, sorted by display name case-insensitively', async () => {
    const r = await restClient(harbor, 'dev-ramnique').get('/v1/members');
    expect(r.status).toBe(200);
    expect(ids(r.body.members)).toEqual(everyone);
    expect(r.body.members.map((m: Member) => m.displayName)).toEqual(['Arjun', 'Gagan', 'harsh', 'Loner', 'Ramnique']);
    // Full Member objects, the same rows listMembers serves.
    expect(r.body.members.find((m: Member) => m.id === 'harsh')).toEqual({ id: 'harsh', displayName: 'harsh', role: 'member', kind: 'human' });
  });

  it('is the same for everyone, whatever spaces they share — a member of nothing included', async () => {
    for (const who of ['harsh', 'arjun', 'gagan', 'loner']) {
      expect(ids((await restClient(harbor, `dev-${who}`).get('/v1/members')).body.members)).toEqual(everyone);
    }
  });

  it('does not narrow when someone leaves a space', async () => {
    const arjun = restClient(harbor, 'dev-arjun');
    const launch = (await arjun.get('/v1/spaces')).body.spaces.find((s: { name: string }) => s.name === 'Launch');
    await arjun.post(`/v1/spaces/${launch.id}/leave`);
    expect(ids((await arjun.get('/v1/members')).body.members)).toEqual(everyone);
  });

  it('is authenticated like every /v1 route', async () => {
    const res = await fetch(`${harbor.url}/v1/members`);
    expect(res.status).toBe(401);
  });
});
