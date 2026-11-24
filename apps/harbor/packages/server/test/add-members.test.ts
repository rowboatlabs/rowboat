import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { routes, type Member, type Membership } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// addMembers (spec §4 Roles, 2026-09-29): any member adds existing org
// members — people or agents — to a shared space they are in. Each add is the
// ordinary `joined` event with `by`, plus a `space_added` frame; anyone
// already in is a no-op; DMs refuse; no notification in v1.

let harbor: RunningHarbor;
let ramAgent: Client;
let spaceId: string;
let agent: Member;
const ramnique = () => restClient(harbor, 'dev-ramnique');
const base = () => `/v1/spaces/${spaceId}/members`;
const add = (memberIds: string[], token = 'dev-ramnique') =>
  restClient(harbor, token).post(base(), { memberIds, actingMode: 'direct' });

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    // A second space: a one-space org is a group chat, where DMs are off (2026-10-07).
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
      { id: 'outsider', displayName: 'Outsider' },
    ],
  });
  spaceId = (await ramnique().post('/v1/spaces', { name: 'Payments' })).body.space.id;
  agent = await harbor.service.createAgent({ displayName: 'Replicas' });
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await ramAgent.close();
  await harbor.close();
});

describe('POST /v1/spaces/:spaceId/members', () => {
  it('adds people and agents, each with a joined event that says who added them', async () => {
    const head = await harbor.store.head(spaceId);
    const r = await add(['harsh', agent.id]);
    expect(r.status).toBe(200);
    const { memberships } = routes.addMembers.response.parse(r.body);
    expect(memberships.map((m) => m.memberId)).toEqual(['harsh', agent.id]);
    const roster = (await ramnique().get(base())).body.members.map((m: Member) => m.id);
    expect(roster).toEqual(expect.arrayContaining(['ramnique', 'harsh', agent.id]));
    const events = (await harbor.store.listEventsAfter(spaceId, head)).map((e) => e.event);
    expect(events).toEqual([
      { type: 'membership', action: 'joined', membership: memberships[0], by: { memberId: 'ramnique', actingMode: 'direct' } },
      { type: 'membership', action: 'joined', membership: memberships[1], by: { memberId: 'ramnique', actingMode: 'direct' } },
    ]);
  });

  it('is a no-op for anyone already in: same memberships, no write, no event', async () => {
    const before = (await harbor.store.listSpaceMembers(spaceId)).length;
    const head = await harbor.store.head(spaceId);
    const again = await add(['harsh', 'harsh', agent.id]);
    expect(again.status).toBe(200);
    expect(again.body.memberships.map((m: Membership) => m.memberId)).toEqual(['harsh', agent.id]);
    expect(await harbor.store.head(spaceId)).toBe(head);
    expect(await harbor.store.listSpaceMembers(spaceId)).toHaveLength(before);
  });

  it('lets anyone in the space add, not only its creator', async () => {
    const r = await add(['gagan'], 'dev-harsh');
    expect(r.status).toBe(200);
    const last = (await harbor.store.listEventsAfter(spaceId, (await harbor.store.head(spaceId)) - 1))[0]!.event;
    expect(last).toMatchObject({ action: 'joined', membership: { memberId: 'gagan' }, by: { memberId: 'harsh' } });
  });

  it('tells the added member’s connections, once, so the space appears in their sidebar', async () => {
    const live = await liveClient(harbor, 'dev-prakhar');
    try {
      await add(['prakhar']);
      await live.until((fs) => fs.some((f) => f.kind === 'space_added'), 'space_added');
      await add(['prakhar']);
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'subscribed');
      expect(live.frames.filter((f) => f.kind === 'space_added')).toEqual([
        expect.objectContaining({ kind: 'space_added', spaceId, spaceKind: 'shared', by: 'ramnique' }),
      ]);
    } finally {
      live.close();
    }
  });

  it('refuses a caller who is not in the space', async () => {
    const r = await add(['outsider'], 'dev-outsider');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('forbidden');
  });

  it('refuses an id that is not an org member, and adds nobody from that request', async () => {
    const head = await harbor.store.head(spaceId);
    const r = await add(['outsider', 'nobody-here']);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('not_found');
    expect(await harbor.store.head(spaceId)).toBe(head);
    expect(await harbor.store.getMembership(spaceId, 'outsider')).toBeUndefined();
  });

  it('refuses a direct message — its membership is fixed', async () => {
    const dm = (await ramnique().post('/v1/direct', { memberId: 'harsh' })).body.space.id;
    const r = await restClient(harbor, 'dev-ramnique').post(`/v1/spaces/${dm}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/nobody can be added/);
  });

  it('refuses a new add in a read-only org, but not a no-op', async () => {
    harbor.service.readOnly = true;
    try {
      const grow = await add(['outsider']);
      expect(grow.status).toBe(403);
      expect(grow.body.code).toBe('read_only_limit');
      expect((await add(['harsh'])).status).toBe(200);
    } finally {
      harbor.service.readOnly = false;
    }
  });
});

describe('add_members (agent face)', () => {
  it('adds as the person, recording that their agent did it', async () => {
    const head = await harbor.store.head(spaceId);
    const result = await ramAgent.callTool({ name: 'add_members', arguments: { spaceId, memberIds: ['outsider'] } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { memberships: Membership[] }).memberships[0]?.memberId).toBe('outsider');
    const [event] = (await harbor.store.listEventsAfter(spaceId, head)).map((e) => e.event);
    expect(event).toMatchObject({ action: 'joined', by: { memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' } });
  });
});
