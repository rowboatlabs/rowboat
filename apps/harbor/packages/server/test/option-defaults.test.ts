import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// An agent's option defaults (spec §8 Invocation options, 2026-10-01): its
// owner sets a default for an option its connector declares, and Harbor
// fills it into every invocation whose invoker picked none.

let harbor: RunningHarbor;
let spaceId: string;
let agent: Member;
let agentKey: string;
const as = (token: string) => restClient(harbor, token);
const mention = () => `[@Coder](#member:${agent.id})`;

const declare = (options: unknown[]) => as(agentKey).post('/v1/agent/capabilities', { stop: false, options });
const ENVIRONMENT = { type: 'select', key: 'environment', label: 'Environment', choices: [{ id: 'env-web', label: 'web' }, { id: 'env-api', label: 'api' }] };
const PLAN = { type: 'toggle', key: 'plan_first', label: 'Plan first' };

async function invoke(token: string, body: string, extra: Record<string, unknown> = {}) {
  const r = await as(token).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
  return routes.postMessage.response.parse(r.body).invocations[0]!;
}

beforeAll(async () => {
  harbor = await startTestHarbor({ orgName: 'Rowboat Labs', seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }], seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }, { id: 'harsh', displayName: 'Harsh' }] });
  const created = await as('dev-ramnique').post('/v1/agents', { displayName: 'Coder' });
  agent = created.body.agent;
  agentKey = created.body.key.secret;
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh', agent.id], actingMode: 'direct' });
  await declare([ENVIRONMENT, PLAN]);
});

afterAll(async () => {
  await harbor.close();
});

describe('option defaults', () => {
  it('are the owner’s to set, for declared options and their choices only', async () => {
    expect((await as('dev-harsh').put(`/v1/agents/${agent.id}/option-defaults`, { defaults: { environment: 'env-api' } })).status).toBe(403);
    expect((await as('dev-ramnique').put(`/v1/agents/${agent.id}/option-defaults`, { defaults: { model: 'x' } })).status).toBe(400);
    expect((await as('dev-ramnique').put(`/v1/agents/${agent.id}/option-defaults`, { defaults: { environment: 'env-mobile' } })).status).toBe(400);
    expect((await as('dev-ramnique').put(`/v1/agents/${agent.id}/option-defaults`, { defaults: { plan_first: 'yes' } })).status).toBe(400);
    const set = await as('dev-ramnique').put(`/v1/agents/${agent.id}/option-defaults`, { defaults: { environment: 'env-api', plan_first: true } });
    expect(set.body.defaults).toEqual({ environment: 'env-api', plan_first: true });
  });

  it('show beside the capabilities, for the composer to preselect', async () => {
    const r = routes.getAgentCapabilities.response.parse((await as('dev-harsh').get(`/v1/agents/${agent.id}/capabilities`)).body);
    expect(r.defaults).toEqual({ environment: 'env-api', plan_first: true });
  });

  it('fill a mention whose invoker picked nothing, and give way to what they picked', async () => {
    expect((await invoke('dev-harsh', `${mention()} fix the build`)).options).toEqual({ environment: 'env-api', plan_first: true });
    const picked = await invoke('dev-harsh', `${mention()} bump deps`, { agentOptions: { [agent.id]: { environment: 'env-web', plan_first: false } } });
    expect(picked.options).toEqual({ environment: 'env-web', plan_first: false });
  });

  it('fill a DM and another agent’s hand-off too', async () => {
    const dm = (await as('dev-harsh').post('/v1/direct', { memberId: agent.id })).body.space.id;
    const inDm = routes.postMessage.response.parse((await as('dev-harsh').post(`/v1/spaces/${dm}/messages`, { body: 'hi', actingMode: 'direct' })).body).invocations[0]!;
    expect(inDm.options).toEqual({ environment: 'env-api', plan_first: true });

    const other = await as('dev-ramnique').post('/v1/agents', { displayName: 'Helper' });
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: [other.body.agent.id], actingMode: 'direct' });
    const handOff = await invoke(other.body.key.secret, `${mention()} take this one`);
    expect(handOff).toMatchObject({ depth: 1, options: { environment: 'env-api', plan_first: true } });
  });

  it('skip a default the connector no longer offers', async () => {
    await declare([{ ...ENVIRONMENT, choices: [{ id: 'env-web', label: 'web' }] }]);
    expect((await invoke('dev-harsh', `${mention()} again`)).options).toBeUndefined();
    await declare([ENVIRONMENT, PLAN]);
  });

  it('clear with an empty set', async () => {
    await as('dev-ramnique').put(`/v1/agents/${agent.id}/option-defaults`, { defaults: {} });
    expect((await invoke('dev-harsh', `${mention()} last one`)).options).toBeUndefined();
  });
});
