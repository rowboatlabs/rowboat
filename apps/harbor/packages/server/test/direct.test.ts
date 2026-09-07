import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ServerFrame, Space } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { agentClient, callStructured, liveClient, restClient } from './helpers.js';
import { pgliteDb } from './pglite.js';

// Direct messages (2026-09-07): a DM is a `direct` space — same substrate,
// fixed membership, private forever. Runs on both stores: the direct-key
// uniqueness guard is a partial unique index on Postgres and a map in memory,
// and the service's race handling must hold on either.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let gagan: ReturnType<typeof restClient>;

async function startForStore(kind: 'memory' | 'postgres'): Promise<void> {
  const options: HarborOptions = {
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  };
  if (kind === 'postgres') {
    sqlDb = await pgliteDb();
    const store = new PgStore(sqlDb);
    await store.init();
    options.store = store;
  }
  harbor = await startHarbor(options);
  ramnique = restClient(harbor, 'dev-ramnique');
  harsh = restClient(harbor, 'dev-harsh');
  gagan = restClient(harbor, 'dev-gagan');
}

function spaceAdded(frames: ServerFrame[]) {
  return frames.filter((f): f is Extract<ServerFrame, { kind: 'space_added' }> => f.kind === 'space_added');
}

describe.each([['memory'], ['postgres']] as const)('direct messages (%s store)', (storeKind) => {
  let dm: Space;

  beforeAll(async () => {
    await startForStore(storeKind);
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('opens a DM: a direct space with the sorted pair as participants and a placeholder name', async () => {
    const r = await ramnique.post('/v1/direct', { memberId: 'harsh' });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    dm = r.body.space;
    expect(dm.kind).toBe('direct');
    expect(dm.participants).toEqual(['harsh', 'ramnique']);
    expect(dm.name).toBe('Direct message');
  });

  it('is get-or-create from either side: the same space comes back, never a second one', async () => {
    const again = await ramnique.post('/v1/direct', { memberId: 'harsh' });
    expect(again.body).toMatchObject({ created: false, space: { id: dm.id } });
    const fromHarsh = await harsh.post('/v1/direct', { memberId: 'ramnique' });
    expect(fromHarsh.body).toMatchObject({ created: false, space: { id: dm.id } });
  });

  it('both participants are ordinary members; their membership history is two joined events', async () => {
    const members = await ramnique.get(`/v1/spaces/${dm.id}/members`);
    expect(members.body.members.map((m: any) => m.id).sort()).toEqual(['harsh', 'ramnique']);
    const events = await harbor.service.eventsAfter(dm.id, 0);
    expect(events.map((e) => e.event.type)).toEqual(['membership', 'membership']);
    expect(events.map((e) => e.offset)).toEqual([1, 2]);
  });

  it('the listing hides DMs unless asked, and shows them only to participants', async () => {
    const plain = await ramnique.get('/v1/spaces');
    expect(plain.body.spaces.map((s: Space) => s.id)).not.toContain(dm.id);
    expect(plain.body.spaces.every((s: Space) => s.kind === 'shared')).toBe(true);

    const withDirect = await ramnique.get('/v1/spaces?includeDirect=1');
    const mine = withDirect.body.spaces.find((s: Space) => s.id === dm.id);
    expect(mine).toMatchObject({ kind: 'direct', participants: ['harsh', 'ramnique'] });
    expect((await harsh.get('/v1/spaces?includeDirect=1')).body.spaces.map((s: Space) => s.id)).toContain(dm.id);
    expect((await gagan.get('/v1/spaces?includeDirect=1')).body.spaces.map((s: Space) => s.id)).not.toContain(dm.id);
  });

  it('is private by construction: a third member is forbidden, participants talk as in any space', async () => {
    expect((await gagan.get(`/v1/spaces/${dm.id}/stream`)).status).toBe(403);
    const post = await harsh.post(`/v1/spaces/${dm.id}/messages`, { body: 'hey — got a minute?', actingMode: 'direct' });
    expect(post.status).toBe(200);
    const stream = await ramnique.get(`/v1/spaces/${dm.id}/stream`);
    expect(stream.body.messages.map((m: any) => m.body)).toEqual(['hey — got a minute?']);
  });

  it('has a fixed membership: no invites, no leaving', async () => {
    const invite = await ramnique.post('/v1/invites', { spaceId: dm.id });
    expect(invite.status).toBe(400);
    expect(invite.body.code).toBe('invalid_request');
    const leave = await harsh.post(`/v1/spaces/${dm.id}/leave`);
    expect(leave.status).toBe(400);
    expect(leave.body.code).toBe('invalid_request');
    expect((await ramnique.get(`/v1/spaces/${dm.id}/members`)).body.members).toHaveLength(2);
  });

  it('refuses a self-DM and an unknown member', async () => {
    const self = await ramnique.post('/v1/direct', { memberId: 'ramnique' });
    expect(self.status).toBe(400);
    const nobody = await ramnique.post('/v1/direct', { memberId: 'nobody' });
    expect(nobody.status).toBe(404);
  });

  it('two participants opening the same DM at once converge on one space', async () => {
    const [a, b] = await Promise.all([
      ramnique.post('/v1/direct', { memberId: 'gagan' }),
      gagan.post('/v1/direct', { memberId: 'ramnique' }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.space.id).toBe(b.body.space.id);
    expect([a.body.created, b.body.created].filter(Boolean)).toHaveLength(1);
    const listed = (await gagan.get('/v1/spaces?includeDirect=1')).body.spaces.filter((s: Space) => s.kind === 'direct');
    expect(listed).toHaveLength(1);
  });

  it('tells the other participant live (space_added), and a from-zero subscribe catches the first message', async () => {
    const gaganLive = await liveClient(harbor, 'dev-gagan');
    const opened = await harsh.post('/v1/direct', { memberId: 'gagan' });
    expect(opened.body.created).toBe(true);
    const id: string = opened.body.space.id;
    // The opener's first message may land before the other side has subscribed.
    await harsh.post(`/v1/spaces/${id}/messages`, { body: 'hi gagan', actingMode: 'direct' });

    await gaganLive.until((fs) => spaceAdded(fs).length > 0, 'space_added frame');
    expect(spaceAdded(gaganLive.frames)[0]).toMatchObject({ spaceId: id, spaceKind: 'direct', by: 'harsh' });

    gaganLive.send({ kind: 'subscribe', spaceId: id, afterOffset: 0 });
    await gaganLive.until((fs) => fs.filter((f) => f.kind === 'event').length >= 3, 'replay from zero');
    expect(gaganLive.events().map((e) => e.event.type)).toEqual(['membership', 'membership', 'message']);
    gaganLive.close();
  });

  it('never addresses the opener or bystanders with space_added', async () => {
    const ramLive = await liveClient(harbor, 'dev-ramnique');
    const harshLive = await liveClient(harbor, 'dev-harsh');
    // A brand-new pair so the open actually creates.
    await harbor.store.putMember({ id: 'prakhar', displayName: 'Prakhar', role: 'member' });
    const prakhar = restClient(harbor, 'dev-prakhar');
    const prakharLive = await liveClient(harbor, 'dev-prakhar');
    await ramnique.post('/v1/direct', { memberId: 'prakhar' });
    await prakharLive.until((fs) => spaceAdded(fs).length > 0, 'prakhar told');
    await new Promise((r) => setTimeout(r, 50));
    expect(spaceAdded(ramLive.frames)).toHaveLength(0);
    expect(spaceAdded(harshLive.frames)).toHaveLength(0);
    expect((await prakhar.get('/v1/spaces?includeDirect=1')).body.spaces.some((s: Space) => s.kind === 'direct')).toBe(true);
    ramLive.close();
    harshLive.close();
    prakharLive.close();
  });

  it('the agent face sees DMs only when asked, with kind and participants, and works on them like any space', async () => {
    const agent: Client = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
    const plain = await callStructured<{ spaces: Array<{ id: string; kind: string }> }>(agent, 'list_spaces', {});
    expect(plain.spaces.every((s) => s.kind === 'shared')).toBe(true);
    const all = await callStructured<{ spaces: Array<{ id: string; kind: string; participants?: string[] }> }>(
      agent,
      'list_spaces',
      { includeDirect: true },
    );
    const mine = all.spaces.find((s) => s.id === dm.id);
    expect(mine).toMatchObject({ kind: 'direct', participants: ['harsh', 'ramnique'] });
    try {
      const posted = await callStructured<{ messageId: string }>(agent, 'post_message', {
        spaceId: dm.id,
        body: 'Ramnique is in a meeting until 3 — will reply after.',
      });
      const stream = await harsh.get(`/v1/spaces/${dm.id}/stream`);
      const mine = stream.body.messages.find((m: any) => m.id === posted.messageId);
      expect(mine.author).toMatchObject({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });
    } finally {
      await agent.close();
    }
  });
});
