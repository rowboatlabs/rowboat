import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Member } from '@rowboat/spaces-protocol';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { freshStore, restClient } from './helpers.js';

// Ro retired (spec §8 Jev, 2026-10-30): an org that still has Ro, from before,
// finds it gone from every space and the org on its next boot, once.

describe('Ro, retired', () => {
  let harbor: RunningHarbor;
  let db: Awaited<ReturnType<typeof freshStore>>;
  let spaceId: string;
  const ro: Member = { id: '01JEVRO0000000000000000000', displayName: 'Ro', role: 'member', kind: 'agent', agentKind: 'jev', agentConnection: 'builtin' };
  const as = (t: string) => restClient(harbor, t);
  const start = () =>
    startHarbor({
      store: db.store,
      orgName: 'Rowboat Labs',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'harsh', displayName: 'Harsh' },
      ],
    });
  const roEvents = async () =>
    (await db.store.listEventsAfter(spaceId, -1)).filter((e) => e.event.type === 'membership' && e.event.membership.memberId === ro.id);

  beforeAll(async () => {
    db = await freshStore();
    harbor = await start();
    spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
    // Ro as the org had it before: the built-in member, added to a space.
    await db.store.putMember(ro);
    await db.store.putMembership({ spaceId, memberId: ro.id, joinedAt: new Date().toISOString() });
    await harbor.close();
    harbor = await start();
  });
  afterAll(async () => {
    await harbor.close();
    await db.db.close();
  });

  it('leaves every space it was in, as itself', async () => {
    const members = (await as('dev-ramnique').get(`/v1/spaces/${spaceId}/members`)).body.members as Member[];
    expect(members.some((m) => m.id === ro.id)).toBe(false);
    expect((await roEvents()).map((e) => e.event.type === 'membership' && e.event.action)).toEqual(['left']);
  });

  it('is removed from the org, so no agent list or picker shows it', async () => {
    const roster = (await as('dev-harsh').get('/v1/members')).body.members as Member[];
    expect(roster.find((m) => m.id === ro.id)?.removedAt).toBeDefined();
  });

  it('is never created again, and a restart writes nothing', async () => {
    await harbor.close();
    harbor = await start();
    expect(await roEvents()).toHaveLength(1);
    const roster = (await as('dev-harsh').get('/v1/members')).body.members as Member[];
    expect(roster.filter((m) => m.agentKind === 'jev').map((m) => m.id)).toEqual([ro.id]);
  });
});
