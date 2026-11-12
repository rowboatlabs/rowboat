import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type AgentListing, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// Deleting an agent its owner made, whatever runs it (2026-11-13): before,
// only a managed (Maritime) agent could be deleted, so a local agent or a
// connected one stayed on its owner's list for good.

let harbor: RunningHarbor;
let spaceId: string;
let agent: Member;
let key: { id: string; secret: string };
const as = (token: string) => restClient(harbor, token);

beforeAll(async () => {
  harbor = await startTestHarbor({
    name: 'Rowboat Labs',
    seedMembers: [
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  spaceId = (await as('dev-harsh').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
  const created = await as('dev-harsh').post('/v1/agents', { displayName: 'Local Claude', kind: 'claude-code', connection: 'local' });
  expect(created.status).toBe(200);
  ({ agent, key } = created.body);
  await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
});

describe('deleting an agent', () => {
  it('is its owner’s alone', async () => {
    expect((await as('dev-gagan').delete(`/v1/agents/${agent.id}`)).status).toBe(403);
    expect((await as(key.secret).delete(`/v1/agents/${agent.id}`)).status).toBe(403);
  });

  it('retires it: deactivated, its key refused, out of the space, off contacts, a tombstone on its owner’s list', async () => {
    const res = await as('dev-harsh').delete(`/v1/agents/${agent.id}`);
    expect(res.status).toBe(200);
    const { agent: deleted, hosting } = routes.deleteAgent.response.parse(res.body);
    expect(deleted.id).toBe(agent.id);
    expect(deleted.deactivatedAt).toBeDefined();
    expect(hosting).toBeUndefined();

    expect((await as(key.secret).get('/v1/me')).status).toBe(401);
    expect((await harbor.store.listAgentKeys([agent.id])).every((k) => k.revokedAt)).toBe(true);
    const members = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/members`)).body.members as Array<{ member: Member } | Member>;
    expect(JSON.stringify(members)).not.toContain(agent.id);
    expect((await as('dev-harsh').get('/v1/contacts')).body.members.map((m: Member) => m.id)).not.toContain(agent.id);
    const listed = (await as('dev-harsh').get('/v1/agents')).body.agents as AgentListing[];
    expect(listed.find((a) => a.agent.id === agent.id)?.agent.deactivatedAt).toBeDefined();
  });

  it('says so again on a repeat, and refuses an unknown agent', async () => {
    expect((await as('dev-harsh').delete(`/v1/agents/${agent.id}`)).status).toBe(200);
    expect((await as('dev-harsh').delete('/v1/agents/01M00000000000000000000000')).status).toBe(404);
  });
});
