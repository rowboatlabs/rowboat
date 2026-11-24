import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// Renaming an agent (spec §4 Agent members, amended 2026-10-21): PUT
// /v1/agents/:agentId/name, its owner only. Admins remove agents; they don't
// rename them, and an agent's own key can't rename it.

let harbor: RunningHarbor;
let agent: Member;
let secret: string;
const as = (token: string) => restClient(harbor, token);
const rename = (token: string, displayName: string) => as(token).put(`/v1/agents/${agent.id}/name`, { displayName });

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rename Test Org',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
  });
  const ram = (await harbor.store.getMember('ramnique'))!;
  await harbor.store.putMember({ ...ram, role: 'admin' });
  const created = await as('dev-harsh').post('/v1/agents', { displayName: 'Hermes' });
  ({ agent } = routes.createAgent.response.parse(created.body));
  secret = created.body.key.secret;
});

afterAll(async () => {
  await harbor.close();
});

describe('PUT /v1/agents/:agentId/name', () => {
  it('lets the owner rename it, folded to one line, and the roster shows the new name', async () => {
    const r = await rename('dev-harsh', '  Hermes \n Prime ');
    expect(r.status).toBe(200);
    expect(r.body.agent).toMatchObject({ id: agent.id, displayName: 'Hermes Prime', kind: 'agent', ownerId: 'harsh' });
    const roster = (await as('dev-ramnique').get('/v1/members')).body.members as Member[];
    expect(roster.find((m) => m.id === agent.id)?.displayName).toBe('Hermes Prime');
  });

  it('is a no-op when the name is unchanged', async () => {
    const r = await rename('dev-harsh', 'Hermes Prime');
    expect(r.status).toBe(200);
    expect(r.body.agent.displayName).toBe('Hermes Prime');
  });

  it('refuses an empty name and one past 128 characters', async () => {
    for (const name of ['', ' \n ', 'x'.repeat(129)]) {
      const r = await rename('dev-harsh', name);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('invalid_request');
    }
  });

  it('refuses an admin, another member, and the agent itself', async () => {
    for (const token of ['dev-ramnique', secret]) {
      const r = await rename(token, 'Hijacked');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('forbidden');
    }
    const outsider = await as('dev-gagan').put(`/v1/agents/${agent.id}/name`, { displayName: 'Hijacked' });
    expect(outsider.status).toBeGreaterThanOrEqual(400);
    expect((await harbor.store.getMember(agent.id))?.displayName).toBe('Hermes Prime');
  });

  it('answers not_found for a person or an unknown id', async () => {
    const r = await as('dev-harsh').put('/v1/agents/ramnique/name', { displayName: 'Bot' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('not_found');
  });
});
