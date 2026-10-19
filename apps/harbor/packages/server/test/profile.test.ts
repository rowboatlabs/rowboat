import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, restClient, startTestHarbor } from './helpers.js';

// Your own name and title (spec §4 Member profile; built 2026-10-19): PUT
// /v1/me on the render face and update_profile on the agent face. Only you
// edit your profile; an agent member's name is its owner's at creation.

let harbor: RunningHarbor;
let gaganAgent: Client;
const as = (token: string) => restClient(harbor, token);

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Profile Test Org',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
  });
  gaganAgent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await gaganAgent.close();
  await harbor.close();
});

describe('PUT /v1/me', () => {
  it('sets your name and title, trimmed to one line, and shows them on me and the roster', async () => {
    const r = await as('dev-gagan').put('/v1/me', { displayName: '  Gagan  P ', title: 'Founding\n engineer ' });
    expect(r.status).toBe(200);
    expect(r.body.member).toMatchObject({ id: 'gagan', displayName: 'Gagan P', title: 'Founding engineer', role: 'member' });

    expect((await as('dev-gagan').get('/v1/me')).body.member).toEqual(r.body.member);
    const roster = (await as('dev-ramnique').get('/v1/members')).body.members as Member[];
    expect(roster.find((m) => m.id === 'gagan')).toMatchObject({ displayName: 'Gagan P', title: 'Founding engineer' });
  });

  it('leaves a field you leave out alone, and an empty title removes it', async () => {
    const titled = await as('dev-gagan').put('/v1/me', { title: 'Design lead' });
    expect(titled.body.member).toMatchObject({ displayName: 'Gagan P', title: 'Design lead' });

    const cleared = await as('dev-gagan').put('/v1/me', { title: '   ' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.member.displayName).toBe('Gagan P');
    expect(cleared.body.member).not.toHaveProperty('title');
    expect((await as('dev-gagan').get('/v1/me')).body.member).not.toHaveProperty('title');
  });

  it('refuses a name with nothing in it, and fields past 128 characters', async () => {
    for (const input of [{ displayName: '' }, { displayName: ' \n ' }, { displayName: 'x'.repeat(129) }, { title: 'x'.repeat(129) }]) {
      const r = await as('dev-gagan').put('/v1/me', input);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('invalid_request');
    }
    expect((await as('dev-gagan').get('/v1/me')).body.member.displayName).toBe('Gagan P');
  });

  it('edits only the profile: a role or an id in the body is ignored', async () => {
    const r = await as('dev-gagan').put('/v1/me', { displayName: 'Gagan', role: 'admin', id: 'ramnique' });
    expect(r.status).toBe(200);
    expect(r.body.member).toMatchObject({ id: 'gagan', displayName: 'Gagan', role: 'member' });
    expect((await as('dev-ramnique').get('/v1/me')).body.member.displayName).toBe('Ramnique');
  });

  it('is a no-op when nothing changes: no write', async () => {
    await as('dev-gagan').put('/v1/me', { displayName: 'Gagan', title: 'Engineer' });
    const putMember = vi.spyOn(harbor.store, 'putMember');
    try {
      const same = await as('dev-gagan').put('/v1/me', { displayName: ' Gagan', title: 'Engineer ' });
      expect(same.status).toBe(200);
      expect(same.body.member).toMatchObject({ displayName: 'Gagan', title: 'Engineer' });
      expect((await as('dev-gagan').put('/v1/me', {})).status).toBe(200);
      expect(putMember).not.toHaveBeenCalled();
    } finally {
      putMember.mockRestore();
    }
  });

  it('refuses an agent member renaming itself with its own key', async () => {
    const created = await as('dev-gagan').post('/v1/agents', { displayName: 'Hermes' });
    const key = created.body.key.secret as string;
    const r = await as(key).put('/v1/me', { displayName: 'Ramnique' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('forbidden');
    expect((await as(key).get('/v1/me')).body.member.displayName).toBe('Hermes');
  });
});

describe('update_profile, the agent-face twin', () => {
  const call = async (args: Record<string, unknown>) => {
    const result = await gaganAgent.callTool({ name: 'update_profile', arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    const def = mcpTools.find((t) => t.name === 'update_profile')!;
    expect(def.output.safeParse(result.structuredContent).success).toBe(true);
    return (result.structuredContent as { member: Member }).member;
  };

  it("edits the person's own profile, the same row /v1/me serves", async () => {
    const member = await call({ title: 'Head of mobile' });
    expect(member).toMatchObject({ id: 'gagan', displayName: 'Gagan', title: 'Head of mobile' });
    expect((await as('dev-gagan').get('/v1/me')).body.member).toEqual(member);
  });

  it('refuses an empty name as the render face does', async () => {
    const result = await gaganAgent.callTool({ name: 'update_profile', arguments: { displayName: ' ' } });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).code).toBe('invalid_request');
  });
});
