import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPrompt, routes, type Invocation, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { liveClient, restClient, startTestHarbor } from './helpers.js';

// Agent personalities (spec §4 Agent members, 2026-10-29): an agent's owner
// sets its description (the profile's title) and its instructions; every
// member reads both; the agent's connector receives the instructions with each
// invocation, and a space never does.

let harbor: RunningHarbor;
let agent: Member;
let agentKey: string;
let spaceId: string;
const as = (token: string) => restClient(harbor, token);
const INSTRUCTIONS = 'You are Scout, the team’s reviewer.\n- Be brief.\n- Run the tests before saying something is fixed.';

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
  });
  const added = await as('dev-gagan').post('/v1/agents', { displayName: 'Scout' });
  agent = added.body.agent;
  agentKey = added.body.key.secret;
  spaceId = (await as('dev-gagan').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-gagan').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh', agent.id], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
});

const setProfile = (token: string, profile: { title?: string; instructions?: string }) => as(token).put(`/v1/agents/${agent.id}/profile`, profile);

describe('setting it', () => {
  it('is the owner’s alone', async () => {
    const r = await setProfile('dev-harsh', { title: 'Mine now' });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/only the agent’s owner/);
  });

  it('sets both, keeps a one-line description and the instructions’ lines, and tells every member', async () => {
    const harsh = await liveClient(harbor, 'dev-harsh');
    const r = await setProfile('dev-gagan', { title: '  Reviews   pull requests\n', instructions: `  ${INSTRUCTIONS}  ` });
    expect(r.status).toBe(200);
    const saved = routes.setAgentProfile.response.parse(r.body).agent;
    expect(saved).toMatchObject({ title: 'Reviews pull requests', instructions: INSTRUCTIONS });
    await harsh.until((frames) => frames.some((f) => f.kind === 'profile_updated' && f.member.id === agent.id && f.member.instructions === INSTRUCTIONS), 'profile_updated');
    harsh.close();
    // Everyone reads them on the roster.
    const roster = routes.listOrgMembers.response.parse((await as('dev-harsh').get('/v1/members')).body);
    expect(roster.members.find((m) => m.id === agent.id)).toMatchObject({ title: 'Reviews pull requests', instructions: INSTRUCTIONS });
  });

  it('leaves out what isn’t sent, clears what is sent empty, and refuses too long', async () => {
    expect((await setProfile('dev-gagan', { title: 'Code reviewer' })).body.agent).toMatchObject({ title: 'Code reviewer', instructions: INSTRUCTIONS });
    const cleared = (await setProfile('dev-gagan', { title: '' })).body.agent;
    expect(cleared.title).toBeUndefined();
    expect(cleared.instructions).toBe(INSTRUCTIONS);
    expect((await setProfile('dev-gagan', { instructions: 'x'.repeat(4001) })).status).toBe(400);
  });

  it('is for agents only', async () => {
    expect((await as('dev-gagan').put('/v1/agents/harsh/profile', { title: 'Agent?' })).status).toBe(404);
  });
});

describe('the connector receives them', () => {
  it('on the live frame and the listing, as they are when delivered; a space never sees them', async () => {
    const app = await liveClient(harbor, agentKey);
    const { message } = routes.postMessage.response.parse(
      (await as('dev-gagan').post(`/v1/spaces/${spaceId}/messages`, { body: `[@Scout](#member:${agent.id}) look at checkout`, actingMode: 'direct' })).body,
    );
    await app.until((frames) => frames.some((f) => f.kind === 'invocation'), 'the invocation');
    const frame = app.frames.find((f): f is Extract<typeof f, { kind: 'invocation' }> => f.kind === 'invocation')!;
    expect(frame.invocation.instructions).toBe(INSTRUCTIONS);
    app.close();

    const listing = routes.listAgentInvocations.response.parse((await as(agentKey).get('/v1/agent/invocations')).body);
    expect(listing.invocations[0]!.instructions).toBe(INSTRUCTIONS);
    // An edit reaches the next delivery.
    await setProfile('dev-gagan', { instructions: 'Answer in one line.' });
    expect(routes.listAgentInvocations.response.parse((await as(agentKey).get('/v1/agent/invocations')).body).invocations[0]!.instructions).toBe('Answer in one line.');

    const spaceView = routes.listInvocations.response.parse((await as('dev-harsh').get(`/v1/spaces/${spaceId}/invocations?threadRootId=${message.id}`)).body);
    expect(spaceView.invocations[0]!.instructions).toBeUndefined();
  });
});

describe('the prompt a coding connector sends', () => {
  const invocation = (instructions?: string): Invocation => ({
    id: 'i1',
    agentId: 'a1',
    conversation: { spaceId: '01M00000000000000000000000', threadRootId: 'm1' },
    trigger: { messageId: 'm1', authorId: 'gagan', body: '/plan fix the retry' },
    where: { spaceKind: 'shared', spaceName: 'Payments' },
    depth: 0,
    ...(instructions ? { instructions } : {}),
    state: 'pending',
    createdAt: '2026-10-29T10:00:00.000Z',
    updatedAt: '2026-10-29T10:00:00.000Z',
  });
  const prompt = (inv: Invocation, inSystem = false) =>
    buildPrompt({ invocation: inv, agentId: 'a1', context: [], names: new Map([['gagan', 'Gagan']]), orgAddress: 'localhost', orgUrl: 'http://localhost', attachments: [], earlierAttachments: [], instructionsInSystemPrompt: inSystem });

  it('puts the instructions right after the request, which stays first for its commands', () => {
    const text = prompt(invocation('Be brief.'));
    expect(text.startsWith('/plan fix the retry')).toBe(true);
    expect(text).toContain('Your instructions from your owner. Follow them in everything you do here:\nBe brief.');
    expect(text.indexOf('Be brief.')).toBeLessThan(text.indexOf('You are '));
  });

  it('leaves them out when the agent got them as its system prompt, and when there are none', () => {
    expect(prompt(invocation('Be brief.'), true)).not.toContain('Be brief.');
    expect(prompt(invocation())).not.toContain('Your instructions from your owner');
  });
});
