import { afterAll, beforeAll, expect, it } from 'vitest';
import { routes, type Invocation, type Member, type Message, type ServerFrame } from '@rowboat/spaces-protocol';
import { greptilePlatform } from '../src/connectors/greptile/index.js';
import { PLATFORMS, type ConnectorEnv } from '../src/connectors/platforms.js';
import { restClient, startTestHarbor } from './helpers.js';
import { defaultGreptileReply, fakeGreptile, REPO } from './fake-greptile.js';

let fake: Awaited<ReturnType<typeof fakeGreptile>>;
let harbor: Awaited<ReturnType<typeof startTestHarbor>>;
let agent: Member, space: string;
const previous = PLATFORMS.greptile;
const listeners = new Map<string, (frame: ServerFrame) => void>();
const oldKey = process.env.HARBOR_INTEGRATION_KEY;
const as = (who = 'owner') => restClient(harbor, `dev-${who}`);
async function ask(command: string, who = 'peer') {
  const posted = await as(who).post(`/v1/spaces/${space}/messages`, { body: `[@${agent.displayName}](#member:${agent.id}) ${command}`, actingMode: 'direct' });
  expect(posted.status).toBe(200);
  const message = routes.postMessage.response.parse(posted.body);
  const id = message.invocations[0]!.id;
  let invocation: Invocation | undefined;
  await expect.poll(async () => {
    invocation = ((await as().get(`/v1/spaces/${space}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === id);
    return invocation?.state;
  }, { timeout: 8000 }).toMatch(/^(done|failed)$/);
  const thread = (await as().get(`/v1/spaces/${space}/threads/${message.message.id}`)).body.messages as Message[];
  return { invocation: invocation!, replies: thread.filter((m) => m.id !== message.message.id), posted: message };
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'b'.repeat(64);
  fake = await fakeGreptile();
  const platform = greptilePlatform({ endpoint: fake.endpoint });
  PLATFORMS.greptile = { ...platform, start(env) {
    return platform.start({ ...env, subscribe(fn) { listeners.set(env.agent.id, fn); return env.subscribe(fn); } });
  } };
  harbor = await startTestHarbor({ seedMembers: [{ id: 'owner', displayName: 'Owner' }, { id: 'peer', displayName: 'Peer' }, { id: 'admin', displayName: 'Admin' }] });
  await harbor.store.putMember({ id: 'admin', displayName: 'Admin', role: 'admin', kind: 'human' });
  space = (await as().post('/v1/spaces', { name: 'Code reviews' })).body.space.id;
  await as().post(`/v1/spaces/${space}/members`, { memberIds: ['peer', 'admin'], actingMode: 'direct' });
});
afterAll(async () => {
  await harbor?.close();
  await fake?.close();
  PLATFORMS.greptile = previous!;
  if (oldKey === undefined) delete process.env.HARBOR_INTEGRATION_KEY;
  else process.env.HARBOR_INTEGRATION_KEY = oldKey;
});

it('refuses unsupported pairs and invalid credentials without creating a bot', async () => {
  expect((await as().post('/v1/agents', { displayName: 'Wrong', kind: 'greptile', connection: 'cal', credential: 'bad' })).status).toBe(400);
  const refused = await as().post('/v1/agents', { displayName: 'Wrong', kind: 'greptile', connection: 'greptile', credential: 'bad' });
  expect(refused.status).toBe(400);
  expect(JSON.stringify(refused.body)).not.toContain('SECRET_SENTINEL');
  expect((await as().get('/v1/agents')).body.agents).toHaveLength(0);
});
it('verifies and seals the key and starts a command bot', async () => {
  const created = await as().post('/v1/agents', { displayName: 'Reviewer', kind: 'greptile', connection: 'greptile', credential: 'good' });
  expect(created.status).toBe(200);
  agent = created.body.agent;
  expect(agent).toMatchObject({ agentKind: 'greptile', agentConnection: 'greptile', ownerId: 'owner' });
  const stored = await harbor.store.getAgentCredential(agent.id);
  expect(stored?.sealed).not.toContain('good');
  await as().post(`/v1/spaces/${space}/members`, { memberIds: [agent.id], actingMode: 'direct' });
});
it('answers help and usage locally in the invoking thread with the current name', async () => {
  const start = fake.calls.length;
  const help = await ask('help');
  expect(help.invocation.state).toBe('done');
  expect(help.replies).toHaveLength(1);
  expect(help.replies[0]!.body).toContain('@Reviewer review');
  expect(help.replies[0]!.author.memberId).toBe(agent.id);
  const usage = await ask('review http://localhost/secret');
  expect(usage.replies[0]!.body).toContain('Usage:');
  expect(fake.calls.length).toBe(start);
});
it('lets another member request a review and then read its result without retriggering', async () => {
  const result = await ask('review https://github.com/owner/repo/pull/42');
  expect(result.invocation.state).toBe('done');
  expect(result.replies).toHaveLength(1);
  expect(result.replies[0]!.body).toContain('**Queued**');
  expect((await ask('status https://github.com/owner/repo/pull/42')).replies[0]!.body).toContain('Review summary');
  expect((await ask('comments https://github.com/owner/repo/pull/42')).replies[0]!.body).toContain('Check null input');
  expect(fake.calls.filter((c) => c.name === 'trigger_code_review')).toHaveLength(1);
});
it('preserves usable credentials on resource denial and flags authentication rejection', async () => {
  fake.setRoute(() => ({ status: 403, raw: 'SECRET_SENTINEL' }));
  expect((await ask('repos')).invocation.state).toBe('failed');
  expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeUndefined();
  fake.setRoute(() => ({ status: 401, raw: 'SECRET_SENTINEL' }));
  const failed = await ask('repos');
  expect(JSON.stringify(failed)).not.toContain('SECRET_SENTINEL');
  expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeDefined();
  fake.setRoute(defaultGreptileReply);
});
it('only lets the owner replace credentials, preserves old key on failure, and clears rejection', async () => {
  for (const who of ['peer', 'admin']) expect((await as(who).put(`/v1/agents/${agent.id}/credential`, { secret: 'other' })).status).toBe(403);
  const before = await harbor.store.getAgentCredential(agent.id);
  expect((await as().put(`/v1/agents/${agent.id}/credential`, { secret: 'bad' })).status).toBe(400);
  expect((await harbor.store.getAgentCredential(agent.id))?.sealed).toBe(before?.sealed);
  expect((await as().put(`/v1/agents/${agent.id}/credential`, { secret: 'other' })).status).toBe(200);
  expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeUndefined();
  await ask('repos');
  expect(fake.calls.at(-1)!.key).toBe('Bearer other');
});
it('does not reuse another bot’s credential or repository catalog', async () => {
  fake.setRoute((c) => c.name === 'list_repositories' ? { data: { repositories: [{ ...REPO, name: c.key === 'Bearer good' ? 'first/repo' : 'second/repo' }], total: 1 } } : defaultGreptileReply(c));
  const second = await as().post('/v1/agents', { displayName: 'Second', kind: 'greptile', connection: 'greptile', credential: 'good' });
  expect(second.status).toBe(200);
  await as().post(`/v1/spaces/${space}/members`, { memberIds: [second.body.agent.id], actingMode: 'direct' });
  const original = agent;
  expect((await ask('repos')).replies[0]!.body).toContain('second/repo');
  agent = second.body.agent;
  expect((await ask('repos')).replies[0]!.body).toContain('first/repo');
  agent = original;
  fake.setRoute(defaultGreptileReply);
});

it('ignores duplicate delivery of an invocation while a review request is running', async () => {
  fake.setRoute((c) => c.name === 'trigger_code_review' ? { delay: 100, data: { success: true } } : defaultGreptileReply(c));
  const before = fake.calls.filter((c) => c.name === 'trigger_code_review').length;
  const posted = await as('peer').post(`/v1/spaces/${space}/messages`, { body: `[@Reviewer](#member:${agent.id}) review https://github.com/owner/repo/pull/42`, actingMode: 'direct' });
  const invocation = routes.postMessage.response.parse(posted.body).invocations[0]!;
  listeners.get(agent.id)!({ kind: 'invocation', invocation });
  listeners.get(agent.id)!({ kind: 'invocation', invocation });
  await expect.poll(async () => ((await as().get(`/v1/spaces/${space}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === invocation.id)?.state).toBe('done');
  expect(fake.calls.filter((c) => c.name === 'trigger_code_review').length - before).toBe(1);
  fake.setRoute(defaultGreptileReply);
});
it('fails acknowledged work at connector startup without reissuing its review', async () => {
  const platform = PLATFORMS.greptile!;
  let paused: ConnectorEnv | undefined;
  PLATFORMS.greptile = { ...platform, start(env) { paused = env; return { async stop() {} }; } };
  try {
    const created = await as().post('/v1/agents', { displayName: 'Restarted', kind: 'greptile', connection: 'greptile', credential: 'good' });
    expect(created.status).toBe(200);
    const restarting = created.body.agent as Member;
    await as().post(`/v1/spaces/${space}/members`, { memberIds: [restarting.id], actingMode: 'direct' });
    const posted = await as().post(`/v1/spaces/${space}/messages`, { body: `[@Restarted](#member:${restarting.id}) review https://github.com/owner/repo/pull/42`, actingMode: 'direct' });
    const invocation = routes.postMessage.response.parse(posted.body).invocations[0]!;
    await harbor.service.acknowledgeInvocation(paused!.ctx, invocation.id);
    const before = fake.calls.length;
    const running = platform.start(paused!);
    try {
      await expect.poll(async () => ((await as().get(`/v1/spaces/${space}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === invocation.id)?.state).toBe('failed');
      expect(fake.calls.length).toBe(before);
    } finally { await running.stop(); }
  } finally { PLATFORMS.greptile = platform; }
});

it('accepts a review URL serialized as a composer autolink', async () => {
  const result = await ask('review <https://github.com/owner/repo/pull/42>');
  expect(result.invocation.state).toBe('done');
  expect(result.replies.some(message => message.body.includes('Review requested'))).toBe(true);
});

it('provides one copyable status command that works after mentioning the bot', async () => {
  const queued = await ask('review <https://github.com/owner/repo/pull/42>');
  const reply = queued.replies[0]!.body;
  expect(reply).toContain('[owner/repo #42](https://github.com/owner/repo/pull/42)');
  const copied = /```text\n([^`]+)\n```/.exec(reply)?.[1];
  expect(copied).toBe('status https://github.com/owner/repo/pull/42');
  const status = await ask(copied!);
  expect(status.invocation.state).toBe('done');
  expect(status.replies[0]!.body).toContain('Completed');
});
