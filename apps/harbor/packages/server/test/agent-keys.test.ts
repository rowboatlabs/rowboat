import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type AgentListing, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

// Agent keys (spec §4 Agent members, 2026-09-29): any person adds an agent
// and owns it; the owner alone creates its keys; the owner or an admin
// revokes them. A key is presented as the agent itself on every face — REST,
// live, MCP — and always acts direct, never "via".

let harbor: RunningHarbor;
let spaceId: string;
let agent: Member;
let firstKey: { id: string; secret: string };
const as = (token: string) => restClient(harbor, token);

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  const ram = (await harbor.store.getMember('ramnique'))!;
  await harbor.store.putMember({ ...ram, role: 'admin' });
  spaceId = (await as('dev-harsh').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  const created = await as('dev-harsh').post('/v1/agents', { displayName: '  Hermes ' });
  expect(created.status).toBe(200);
  ({ agent } = routes.createAgent.response.parse(created.body));
  firstKey = created.body.key;
  await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
});

describe('adding an agent', () => {
  it('makes the caller its owner and shows the first key once', () => {
    expect(agent).toMatchObject({ displayName: 'Hermes', kind: 'agent', role: 'member', ownerId: 'harsh' });
    expect(firstKey.secret).toMatch(/^rbk_[A-Za-z0-9_-]{43}$/);
  });

  it('lists agents with their keys, never a secret: yours, or every one for an admin', async () => {
    const mine = (await as('dev-harsh').get('/v1/agents')).body.agents as AgentListing[];
    expect(mine.map((a) => a.agent.id)).toEqual([agent.id]);
    expect(mine[0]!.keys.map((k) => k.id)).toEqual([firstKey.id]);
    expect(JSON.stringify(mine)).not.toContain(firstKey.secret);
    expect((await as('dev-gagan').get('/v1/agents')).body.agents).toEqual([]);
    const all = (await as('dev-ramnique').get('/v1/agents')).body.agents as AgentListing[];
    expect(all.map((a) => a.agent.id)).toContain(agent.id);
  });

  it('puts a new agent, in no space yet, on the org roster — so anyone can add it to a space', async () => {
    const fresh = (await as('dev-harsh').post('/v1/agents', { displayName: 'Fresh' })).body.agent as Member;
    const roster = (token: string) => as(token).get('/v1/members').then((r) => (r.body.members as Member[]).map((m) => m.id));
    expect(await roster('dev-harsh')).toContain(fresh.id);
    expect(await roster('dev-gagan')).toContain(fresh.id);
    expect((await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [fresh.id], actingMode: 'direct' })).status).toBe(200);
  });

  it('refuses an agent adding an agent', async () => {
    const r = await as(firstKey.secret).post('/v1/agents', { displayName: 'Spawn' });
    expect(r.status).toBe(403);
  });
});

describe('the key, on every face', () => {
  it('is the agent on REST, and posts as itself even when the body claims a "via"', async () => {
    const me = await as(firstKey.secret).get('/v1/me');
    expect(me.body.member).toMatchObject({ id: agent.id, kind: 'agent' });
    const posted = await as(firstKey.secret).post(`/v1/spaces/${spaceId}/messages`, { body: 'On it.', actingMode: 'agent', agentName: 'Claude' });
    expect(posted.status).toBe(200);
    expect(posted.body.message.author).toEqual({ memberId: agent.id, actingMode: 'direct' });
  });

  it('is the agent on MCP, acting direct', async () => {
    const mcp = await agentClient(harbor, firstKey.secret, { agentName: 'Ignored' });
    try {
      const who = await mcp.callTool({ name: 'whoami', arguments: {} });
      expect((who.structuredContent as { member: Member }).member.id).toBe(agent.id);
      const posted = await mcp.callTool({ name: 'post_message', arguments: { spaceId, body: 'Done.' } });
      const { messageId } = posted.structuredContent as { messageId: string };
      const read = await as('dev-harsh').get(`/v1/spaces/${spaceId}/messages/${messageId}`);
      expect(read.body.message.author).toEqual({ memberId: agent.id, actingMode: 'direct' });
    } finally {
      await mcp.close();
    }
  });

  it('is the agent on the live face', async () => {
    const live = await liveClient(harbor, firstKey.secret);
    try {
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'subscribed');
    } finally {
      live.close();
    }
  });

  it('records when it was last used', async () => {
    const listing = ((await as('dev-harsh').get('/v1/agents')).body.agents as AgentListing[]).find((a) => a.agent.id === agent.id);
    expect(listing!.keys[0]!.lastUsedAt).toEqual(expect.any(String));
  });

  it('is refused when unknown', async () => {
    expect((await as('rbk_not-a-real-key-at-all').get('/v1/me')).status).toBe(401);
  });
});

describe('who controls the keys', () => {
  it('lets only the owner create a key — not another member, not an admin', async () => {
    expect((await as('dev-gagan').post(`/v1/agents/${agent.id}/keys`)).status).toBe(403);
    expect((await as('dev-ramnique').post(`/v1/agents/${agent.id}/keys`)).status).toBe(403);
  });

  it('rotates: a second key works beside the first, and survives revoking the first', async () => {
    const second = (await as('dev-harsh').post(`/v1/agents/${agent.id}/keys`)).body.key;
    expect((await as(second.secret).get('/v1/me')).body.member.id).toBe(agent.id);
    const revoked = await as('dev-harsh').post(`/v1/agents/${agent.id}/keys/${firstKey.id}/revoke`);
    expect(revoked.body.key.revokedAt).toEqual(expect.any(String));
    expect((await as(firstKey.secret).get('/v1/me')).status).toBe(401);
    expect((await as(second.secret).get('/v1/me')).status).toBe(200);
    // Idempotent: the first revocation time stands.
    const again = await as('dev-harsh').post(`/v1/agents/${agent.id}/keys/${firstKey.id}/revoke`);
    expect(again.body.key.revokedAt).toBe(revoked.body.key.revokedAt);
  });

  it('lets an admin revoke — the off switch — but not another member', async () => {
    const third = (await as('dev-harsh').post(`/v1/agents/${agent.id}/keys`)).body.key;
    expect((await as('dev-gagan').post(`/v1/agents/${agent.id}/keys/${third.id}/revoke`)).status).toBe(403);
    expect((await as('dev-ramnique').post(`/v1/agents/${agent.id}/keys/${third.id}/revoke`)).status).toBe(200);
    expect((await as(third.secret).get('/v1/me')).status).toBe(401);
  });

  it('gives an org-owned agent no keys at all', async () => {
    const replicas = await harbor.service.createAgent({ displayName: 'Replicas' });
    expect((await as('dev-ramnique').post(`/v1/agents/${replicas.id}/keys`)).status).toBe(403);
  });

  it('answers not_found for a key that is not this agent’s', async () => {
    const other = (await as('dev-gagan').post('/v1/agents', { displayName: 'Other' })).body;
    const r = await as('dev-harsh').post(`/v1/agents/${agent.id}/keys/${other.key.id}/revoke`);
    expect(r.status).toBe(404);
  });
});
