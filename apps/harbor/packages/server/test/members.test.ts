import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// GET /v1/contacts (spec §3, 2026-11-09; the org roster until then): the
// people you share a space with now — DMs and archived spaces included — and
// the agents you own, sorted by display name. Nothing lists everyone on the
// server: a member of nothing has no contacts.

let harbor: RunningHarbor;

async function start(): Promise<void> {
  harbor = await startTestHarbor({
    name: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'harsh' }, // lowercase: the sort is case-insensitive
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'arjun', displayName: 'Arjun' },
      { id: 'loner', displayName: 'Loner' }, // shares nothing with anyone
    ],
  });
}

describe('GET /v1/contacts', () => {
  const ids = (members: Member[]) => members.map((m) => m.id);
  const contacts = async (who: string) => ids((await restClient(harbor, `dev-${who}`).get('/v1/contacts')).body.members);
  let launchId: string;

  beforeAll(async () => {
    await start();
    const ramnique = restClient(harbor, 'dev-ramnique');
    const harsh = restClient(harbor, 'dev-harsh');
    const arjun = restClient(harbor, 'dev-arjun');
    // Two spaces both holding ramnique + harsh (dedupe), arjun in one of them;
    // gagan reachable from ramnique only through a DM — opened past the reach
    // rule by gagan's personal link, since they share no space yet.
    for (const name of ['Main', 'Launch']) {
      const created = await ramnique.post('/v1/spaces', { name });
      const inv = await ramnique.post('/v1/invites', { spaceId: created.body.space.id });
      await harsh.post('/v1/invites/accept', { token: inv.body.token });
      if (name === 'Launch') {
        launchId = created.body.space.id;
        const inv2 = await ramnique.post('/v1/invites', { spaceId: created.body.space.id });
        await arjun.post('/v1/invites/accept', { token: inv2.body.token });
      }
    }
    const link = (await restClient(harbor, 'dev-gagan').post('/v1/invites', { direct: true })).body;
    await ramnique.post('/v1/invites/accept', { token: link.token });
  });

  afterAll(async () => {
    await harbor.close();
  });

  it('is the people you share a space with, sorted by display name case-insensitively, DMs counting', async () => {
    const r = await restClient(harbor, 'dev-ramnique').get('/v1/contacts');
    expect(r.status).toBe(200);
    expect(ids(r.body.members)).toEqual(['arjun', 'gagan', 'harsh']);
    expect(r.body.members.map((m: Member) => m.displayName)).toEqual(['Arjun', 'Gagan', 'harsh']);
    // Full Member objects, the same rows listMembers serves.
    expect(r.body.members.find((m: Member) => m.id === 'harsh')).toEqual({ id: 'harsh', displayName: 'harsh', kind: 'human' });
  });

  it('differs per person: everyone sees only who they share with; a member of nothing sees nobody', async () => {
    expect(await contacts('harsh')).toEqual(['arjun', 'ramnique']);
    expect(await contacts('arjun')).toEqual(['harsh', 'ramnique']);
    expect(await contacts('gagan')).toEqual(['ramnique']);
    expect(await contacts('loner')).toEqual([]);
  });

  it('narrows when someone leaves a space, and your own agents are always in it', async () => {
    const arjun = restClient(harbor, 'dev-arjun');
    const bot = (await arjun.post('/v1/agents', { displayName: 'Arjun bot' })).body.agent as Member;
    expect(await contacts('arjun')).toEqual([bot.id, 'harsh', 'ramnique']);
    expect(await contacts('harsh')).toEqual(['arjun', 'ramnique']); // someone else's agent, in no shared space, is not a contact
    await arjun.post(`/v1/spaces/${launchId}/leave`);
    expect(await contacts('arjun')).toEqual([bot.id]);
    expect(await contacts('ramnique')).toEqual(['gagan', 'harsh']);
  });

  it('is authenticated like every /v1 route', async () => {
    const res = await fetch(`${harbor.url}/v1/contacts`);
    expect(res.status).toBe(401);
  });
});
