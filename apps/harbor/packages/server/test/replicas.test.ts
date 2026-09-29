import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentClient, callStructured, restClient, startTestHarbor, freshStore } from './helpers.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import type { ReplicasApi } from '../src/replicas/api.js';
import { summarizeConversation } from '../src/replicas/api.js';
import { PgStore } from '../src/pg-store.js';
import { seal, unseal } from '../src/replicas/credentials.js';
import { blobHash } from '../src/blobs.js';

let harbor: RunningHarbor;
let space: string;
let bot: string;
let admin: ReturnType<typeof restClient>;
let ic: ReturnType<typeof restClient>;
let api: ReplicasApi;
let completed: boolean;
const seed = { seedMembers: [{ id: 'tl', displayName: 'Team Lead' }, { id: 'ic', displayName: 'Engineer' }], seedSpaces: [{ name: 'Engineering', creator: 'tl' }] };
const mention = () => `[@Replicas](#member:${bot})`;
async function post(client: ReturnType<typeof restClient>, body: string, threadRoot?: string) {
  const response = await client.post(`/v1/spaces/${space}/messages`, { body, ...(threadRoot ? { threadRoot } : {}), actingMode: 'direct' });
  expect(response.status).toBe(200);
  return response.body.message;
}
async function task(root: string) { return (await ic.get(`/v1/spaces/${space}/threads/${root}/replicas`)).body.task; }

beforeEach(async () => {
  vi.stubEnv('HARBOR_INTEGRATION_KEY', 'a'.repeat(64));
  completed = false;
  let sequence = 0;
  api = {
    environments: vi.fn(async () => [{ id: 'env', name: 'App' }]),
    create: vi.fn(async () => ({ id: `workspace-${++sequence}`, chatId: `chat-${sequence}`, url: `https://app.replicas.dev/test-${sequence}`, status: 'active' })),
    workspace: vi.fn(async id => ({ id, chatId: 'chat-1', url: 'https://app.replicas.dev/test-1', status: 'active' })),
    send: vi.fn(async () => {}),
    history: vi.fn(async () => ({ requestSeen: true, finished: completed, text: completed ? 'Implemented and tested. https://github.com/example/repo/pull/1' : null })),
  };
  harbor = await startTestHarbor({ ...seed, replicasApiFactory: () => api });
  admin = restClient(harbor, 'dev-tl'); ic = restClient(harbor, 'dev-ic');
  space = (await admin.get('/v1/spaces')).body.spaces[0].id;
  const config = await admin.post(`/v1/spaces/${space}/replicas`, { enabled: true, apiKey: 'test-secret', environmentId: 'env' });
  expect(config.status).toBe(200);
  bot = config.body.botMemberId;
});
afterEach(async () => { await harbor.close(); vi.unstubAllEnvs(); });

describe('shared Replicas threads', () => {
  it('keeps IC → TL → IC on the same workspace AND chat, sends incremental named context, and publishes once', async () => {
    const root = await post(ic, `${mention()} Implement retries`);
    await harbor.service.replicas.tick();
    expect((await task(root.id)).status).toBe('running');
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.create).mock.calls[0]![0].message).toContain('Engineer: @Replicas Implement retries');
    completed = true;
    await harbor.service.replicas.tick();
    await harbor.service.replicas.tick();
    let thread = (await ic.get(`/v1/spaces/${space}/threads/${root.id}`)).body;
    expect(thread.messages.filter((m: {body:string}) => m.body.includes('Implemented and tested'))).toHaveLength(1);
    const question = await post(admin, `${mention()} Why this retry policy?`, root.id);
    await harbor.service.replicas.tick();
    expect(api.send).toHaveBeenLastCalledWith('workspace-1', 'chat-1', expect.stringContaining('Team Lead: @Replicas Why this retry policy?'), false, []);
    expect(vi.mocked(api.send).mock.calls[0]![2]).not.toContain('Engineer: @Replicas Implement retries');
    expect(vi.mocked(api.send).mock.calls[0]![2]).toContain(`[Spaces request ${question.id}]`);
    await harbor.service.replicas.tick();
    await post(ic, `${mention()} Apply the feedback`, root.id);
    await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenLastCalledWith('workspace-1', 'chat-1', expect.stringContaining('Engineer: @Replicas Apply the feedback'), false, []);
  });
  it('creates one agent per org across concurrent Space setup and keeps Space defaults separate', async () => {
    const others = await Promise.all(['Backend', 'Frontend'].map(name => admin.post('/v1/spaces', { name })));
    const configs = await Promise.all(others.map((r, i) => admin.post(`/v1/spaces/${r.body.space.id}/replicas`, { enabled: true, environmentId: i ? null : 'env', codingAgent: 'codex' })));
    expect(configs.map(c => c.status)).toEqual([200, 200]);
    expect(configs.map(c => c.body.botMemberId)).toEqual([bot, bot]);
    expect((await harbor.store.listAllMembers()).filter(m => m.kind === 'agent')).toEqual([
      { id: bot, displayName: 'Replicas', role: 'member', kind: 'agent' },
    ]);
    expect(await harbor.store.getMembership(others[0]!.body.space.id, bot)).toBeDefined();
    expect((await admin.get(`/v1/spaces/${space}/replicas`)).body.codingAgent).toBe('codex');
    expect((await admin.get(`/v1/spaces/${others[1]!.body.space.id}/replicas`)).body.environmentId).toBeNull();
    expect((await admin.get(`/v1/spaces/${space}/replicas`)).body.environmentId).toBe('env');
    const connection = (await harbor.store.getReplicasConnection())!;
    expect(unseal(connection.sealedKey, harbor.store.orgId, bot)).toBe('test-secret');
    expect(() => unseal(connection.sealedKey, harbor.store.orgId, space)).toThrow();
  });
  it('serializes first-time setup across Spaces without creating orphan agents', async () => {
    const other = await startTestHarbor({ ...seed, replicasApiFactory: () => api });
    try {
      const client = restClient(other, 'dev-tl');
      const first = (await client.get('/v1/spaces')).body.spaces[0].id;
      const second = (await client.post('/v1/spaces', { name: 'Another' })).body.space.id;
      const results = await Promise.all([first, second].map(id => client.post(`/v1/spaces/${id}/replicas`, { enabled: true, apiKey: 'org-key' })));
      expect(results.map(r => r.status)).toEqual([200, 200]);
      expect(results[0]!.body.botMemberId).toBe(results[1]!.body.botMemberId);
      expect((await other.store.listAllMembers()).filter(m => m.kind === 'agent')).toHaveLength(1);
    } finally { await other.close(); }
  });
  it('keeps Replicas credentials and defaults isolated across orgs', async () => {
    const { db, store } = await freshStore();
    try {
      const other = new PgStore(db, 'other-org');
      for (const org of [store, other]) await org.putMember({ id: 'same-agent-id', displayName: 'Replicas', kind: 'agent', role: 'member' });
      await store.putReplicasConnection({ botMemberId: 'same-agent-id', sealedKey: seal('secret', store.orgId, 'same-agent-id'), configuredBy: 'tl', codingAgent: 'claude' });
      expect(await other.getReplicasConnection()).toBeUndefined();
      const sealed = (await store.getReplicasConnection())!.sealedKey;
      expect(() => unseal(sealed, other.orgId, 'same-agent-id')).toThrow();
    } finally { await db.close(); }
  });
  it('includes requester attribution and the canonical thread link on each upstream request', async () => {
    const root = await post(ic, `${mention()} Implement`);
    await harbor.service.replicas.tick();
    const link = `https://${harbor.service.org.address}/s/${space}/m/${root.id}`;
    expect(vi.mocked(api.create).mock.calls[0]![0].message).toContain(`Requested by Engineer, ${link}`);
    completed = true;
    await harbor.service.replicas.tick();
    await post(admin, `${mention()} Update the PR`, root.id);
    await harbor.service.replicas.tick();
    expect(vi.mocked(api.send).mock.calls[0]![2]).toContain(`Requested by Team Lead, ${link}`);
  });
  it('allows DM invocation through any shared Space and uses no shared-Space environment default', async () => {
    const other = (await admin.post('/v1/spaces', { name: 'Other' })).body.space.id;
    await admin.post(`/v1/spaces/${other}/replicas`, { enabled: true });
    const invite = await admin.post('/v1/invites', { spaceId: other });
    await ic.post('/v1/invites/accept', { token: invite.body.token });
    await ic.post(`/v1/spaces/${space}/leave`);
    vi.mocked(api.environments).mockResolvedValue([{ id: 'env', name: 'App' }, { id: 'other', name: 'Other' }]);
    const sid = (await ic.post('/v1/direct', { memberId: bot })).body.space.id;
    const result = await ic.post(`/v1/spaces/${sid}/messages`, { body: 'Investigate', actingMode: 'direct' });
    expect(result.status).toBe(200);
    await harbor.service.replicas.tick();
    expect(api.create).not.toHaveBeenCalled();
    expect((await ic.get(`/v1/spaces/${sid}/threads/${result.body.message.id}/replicas`)).body.task.status).toBe('select_environment');
  });
  it('refuses a DM without a shared Space and rechecks queued DM spending rights after leaving', async () => {
    const outsider = restClient(harbor, 'dev-outsider');
    const sid = (await outsider.post('/v1/direct', { memberId: bot })).body.space.id;
    expect((await outsider.post(`/v1/spaces/${sid}/messages`, { body: 'Spend', actingMode: 'direct' })).status).toBe(403);
    const dm = (await ic.post('/v1/direct', { memberId: bot })).body.space.id;
    expect((await ic.post(`/v1/spaces/${dm}/messages`, { body: 'Implement', actingMode: 'direct' })).status).toBe(200);
    await ic.post(`/v1/spaces/${space}/leave`);
    await harbor.service.replicas.tick();
    expect(api.create).not.toHaveBeenCalled();
    expect((await ic.post(`/v1/spaces/${dm}/messages`, { body: 'Still spend', actingMode: 'direct' })).status).toBe(403);
  });
  it('cancels only the requester’s queued work and never cancels a running request', async () => {
    const root = await post(ic, `${mention()} Implement`);
    expect((await task(root.id)).cancellableMessageIds).toEqual([root.id]);
    const cancel = { action: 'cancel', messageId: root.id };
    expect((await admin.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, cancel)).status).toBe(403);
    expect((await ic.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, cancel)).status).toBe(200);
    expect((await task(root.id)).pending).toBe(0);
    await harbor.service.replicas.tick();
    expect(api.create).not.toHaveBeenCalled();
    const reply = await post(ic, `${mention()} Proceed`, root.id);
    await harbor.service.replicas.tick();
    expect((await ic.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'cancel', messageId: reply.id })).status).toBe(400);
    const queued = await post(ic, `${mention()} Extra`, root.id);
    expect((await ic.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'cancel', messageId: queued.id })).status).toBe(200);
    completed = true;
    await harbor.service.replicas.tick();
    await harbor.service.replicas.tick();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('allows queued work to be cancelled while the Space connection is disabled', async () => {
    const root = await post(ic, `${mention()} Implement`);
    await admin.post(`/v1/spaces/${space}/replicas`, { enabled: false });
    expect((await ic.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'cancel', messageId: root.id })).status).toBe(200);
    await admin.post(`/v1/spaces/${space}/replicas`, { enabled: true });
    await harbor.service.replicas.tick();
    expect(api.create).not.toHaveBeenCalled();
  });
  it.each([1, 2])('does not revive cancelled work when an in-flight lookup returns %i environments', async (count) => {
    await admin.post(`/v1/spaces/${space}/replicas`, { enabled: true, environmentId: null });
    const root = await post(ic, `${mention()} Implement`);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(api.environments).mockImplementationOnce(async () => {
      entered(); await new Promise<void>(resolve => { release = resolve; });
      return Array.from({ length: count }, (_, i) => ({ id: `env-${i}`, name: `App ${i}` }));
    });
    const tick = harbor.service.replicas.tick();
    await ready;
    try { expect((await ic.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'cancel', messageId: root.id })).status).toBe(200); }
    finally { release(); await tick; }
    expect(api.create).not.toHaveBeenCalled();
    expect((await task(root.id)).status).toBe('idle');
  });
  it('keeps credentials out of the agent tool schema and rejects key-bearing tool calls', async () => {
    const agent = await agentClient(harbor, 'dev-tl');
    try {
      const tool = (await agent.listTools()).tools.find(t => t.name === 'configure_replicas')!;
      expect(tool.inputSchema.properties).not.toHaveProperty('apiKey');
      const result = await agent.callTool({ name: 'configure_replicas', arguments: { spaceId: space, enabled: true, apiKey: 'must-not-be-saved' } });
      expect(result.isError).toBe(true);
      const connection = (await harbor.store.getReplicasConnection())!;
      expect(unseal(connection.sealedKey, harbor.store.orgId, bot)).toBe('test-secret');
      const config = await callStructured<{ enabled: boolean }>(agent, 'configure_replicas', { spaceId: space, enabled: false });
      expect(config.enabled).toBe(false);
    } finally { await agent.close(); }
  });
  it('serializes simultaneous follow-ups without duplicate workspaces', async () => {
    const root = await post(ic, `${mention()} Implement feature`);
    await Promise.all([post(ic, `${mention()} Also test it`, root.id), post(admin, `${mention()} Explain your approach`, root.id)]);
    await Promise.all([harbor.service.replicas.tick(), harbor.service.replicas.tick()]);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect((await task(root.id)).pending).toBe(3);
    completed = true;
    for (let i = 0; i < 5; i++) await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledTimes(2);
    expect((await task(root.id)).pending).toBe(0);
  });
  it('runs five independent feature threads concurrently', async () => {
    const roots = await Promise.all(Array.from({length: 5}, (_, i) => post(ic, `${mention()} Feature ${i}`)));
    await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledTimes(5);
    expect(new Set(await Promise.all(roots.map(async r => (await task(r.id)).workspaceId))).size).toBe(5);
  });
  it('forwards uploaded images only from this Space, without fetching external URLs', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const hash = blobHash(bytes);
    const uploaded = await fetch(`${harbor.url}/v1/spaces/${space}/blobs`, {
      method:'PUT', headers:{authorization:'Bearer dev-ic','x-blob-sha256':hash,'content-type':'image/png'}, body:bytes,
    });
    expect(uploaded.status).toBe(200);
    const origin = `https://${harbor.service.org.address}`;
    await post(ic, `${mention()} Reproduce this UI ![screen](${origin}/s/${space}/b/${hash}/screen.png) ![private](${origin}/s/other/b/${hash}/secret.png) ![external](https://external.example/screenshot.png)`);
    await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({images:[{type:'image',source:{type:'base64',media_type:'image/png',data:bytes.toString('base64')}}]}));
  });
  it('does not send normal team discussion to the coding agent', async () => {
    const root = await post(ic, 'Discuss the feature');
    await post(admin, 'I will review tomorrow', root.id);
    await harbor.service.replicas.tick();
    expect(await task(root.id)).toBeNull();
    expect(api.create).not.toHaveBeenCalled();
  });
  it('keeps credentials encrypted and denies configuration and task access to unauthorized members', async () => {
    expect((await ic.post(`/v1/spaces/${space}/replicas`, { enabled: false })).status).toBe(403);
    const config = await ic.get(`/v1/spaces/${space}/replicas`);
    expect(JSON.stringify(config.body)).not.toContain('test-secret');
    expect(JSON.stringify(await harbor.store.getReplicasConnection())).not.toContain('test-secret');
    const root = await post(ic, `${mention()} Implement`);
    const outsider = restClient(harbor, 'dev-outsider');
    expect((await outsider.get(`/v1/spaces/${space}/threads/${root.id}/replicas`)).status).toBe(403);
    expect((await outsider.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'select_environment', environmentId: 'env' })).status).toBe(403);
  });
  it('asks for an environment when ambiguous, then starts without re-posting the request', async () => {
    await admin.post(`/v1/spaces/${space}/replicas`, { enabled: true, environmentId: null });
    vi.mocked(api.environments).mockResolvedValue([{ id: 'env', name: 'App' }, { id: 'other', name: 'Backend' }]);
    const root = await post(ic, `${mention()} Implement`);
    await harbor.service.replicas.tick();
    expect((await task(root.id)).status).toBe('select_environment');
    expect(api.create).not.toHaveBeenCalled();
    expect((await ic.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'select_environment', environmentId: 'other' })).status).toBe(200);
    await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({environmentId: 'other'}));
  });
  it('forks a new root/workspace with source context without changing the original', async () => {
    const root = await post(ic, `${mention()} Implement`);
    await harbor.service.replicas.tick();
    const response = await admin.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'fork', messageId: root.id, body: 'Investigate a different implementation' });
    expect(response.status).toBe(200);
    expect(response.body.task.threadRootId).not.toBe(root.id);
    await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledTimes(2);
    expect((await task(root.id)).workspaceId).toBe('workspace-1');
    expect(vi.mocked(api.create).mock.calls[1]![0].message).toContain('Engineer: @Replicas Implement');
  });
  it('does not blindly repeat an uncertain create; a known workspace can resume tracking', async () => {
    vi.mocked(api.create).mockRejectedValueOnce(new Error('connection reset after upstream accepted POST'));
    const root = await post(ic, `${mention()} Implement`);
    await harbor.service.replicas.tick();
    await harbor.service.replicas.tick();
    expect((await task(root.id)).status).toBe('uncertain');
    expect(api.create).toHaveBeenCalledTimes(1);
    expect((await admin.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, { action: 'attach', workspaceId: 'existing', chatId: 'chat-1' })).status).toBe(200);
    completed = true;
    await harbor.service.replicas.tick();
    expect((await task(root.id)).status).toBe('idle');
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('refuses to attach an unrelated chat after an interrupted write', async () => {
    vi.mocked(api.create).mockRejectedValueOnce(new Error('connection reset'));
    const root = await post(ic, `${mention()} Implement`);
    await harbor.service.replicas.tick();
    vi.mocked(api.history).mockResolvedValue({requestSeen:false,finished:false,text:null});
    expect((await admin.post(`/v1/spaces/${space}/threads/${root.id}/replicas`, {action:'attach',workspaceId:'unrelated',chatId:'other'})).status).toBe(400);
    expect((await task(root.id)).status).toBe('uncertain');
    expect((await task(root.id)).workspaceId).toBeNull();
  });
  it('pauses on disconnect and delivers the existing result after reconnection', async () => {
    const root = await post(ic, `${mention()} Implement`);
    await harbor.service.replicas.tick();
    expect((await admin.post(`/v1/spaces/${space}/replicas`, {enabled:false})).status).toBe(200);
    completed = true;
    await harbor.service.replicas.tick();
    expect(api.history).not.toHaveBeenCalled();
    expect((await task(root.id)).status).toBe('running');
    expect((await admin.post(`/v1/spaces/${space}/replicas`, {enabled:true})).status).toBe(200);
    await harbor.service.replicas.tick();
    expect((await task(root.id)).status).toBe('idle');
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('checks membership again before sending queued work', async () => {
    await post(ic, `${mention()} Implement`);
    await ic.post(`/v1/spaces/${space}/leave`);
    await harbor.service.replicas.tick();
    expect(api.create).not.toHaveBeenCalled();
  });
  it('treats each bot DM root as a task and keeps DM replies on its workspace', async () => {
    const opened = await ic.post('/v1/direct', { memberId: bot });
    expect(opened.status).toBe(200);
    const sid = opened.body.space.id;
    const root = await ic.post(`/v1/spaces/${sid}/messages`, { body: 'Investigate retries', actingMode: 'direct' });
    await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledTimes(1);
    completed = true;
    await harbor.service.replicas.tick();
    await ic.post(`/v1/spaces/${sid}/messages`, { body: 'Explain the implementation', threadRoot: root.body.message.id, actingMode: 'direct' });
    await harbor.service.replicas.tick();
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('plan mode is separate from permission prompts and survives queueing', async () => {
    const response = await ic.post(`/v1/spaces/${space}/messages`, {body:`${mention()} /plan Implement retries`, replicas:{planMode:false}, actingMode:'direct'});
    expect(response.status).toBe(200);
    const root = response.body.message;
    await harbor.service.replicas.tick();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ planMode: true }));
    completed = true;
    await harbor.service.replicas.tick();
    await post(admin, `${mention()} Proceed with the plan`, root.id);
    await harbor.service.replicas.tick();
    expect(vi.mocked(api.send).mock.calls[0]![3]).toBe(false);
  });
  it('leaves ordinary posting intact when an explicitly requested connection is missing', async () => {
    await admin.post(`/v1/spaces/${space}/replicas`, {enabled:false});
    const response = await ic.post(`/v1/spaces/${space}/messages`, {body:'Do work', replicas:{}, actingMode:'direct'});
    expect(response.status).toBe(400);
    expect((await ic.get(`/v1/spaces/${space}/stream`)).body.messages).toHaveLength(0);
    await post(ic, 'Normal discussion still works');
  });
  it('exposes the same shared task on the MCP face', async () => {
    const root = await post(ic, `${mention()} Implement`);
    const agent = await agentClient(harbor, 'dev-tl');
    try {
      const result = await callStructured<{task: {threadRootId: string}}>(agent, 'get_replicas_task', {spaceId: space, rootMessageId: root.id});
      expect(result.task.threadRootId).toBe(root.id);
      const config = await callStructured<{configured: boolean}>(agent, 'get_replicas_config', {spaceId: space});
      expect(config.configured).toBe(true);
    } finally { await agent.close(); }
  });
  it('recovers a running task after a Harbor restart with no client connected', async () => {
    const {db, store} = await freshStore();
    let running = await startHarbor({ ...seed, store, replicasApiFactory: () => api });
    try {
      const client = restClient(running, 'dev-tl');
      const sid = (await client.get('/v1/spaces')).body.spaces[0].id;
      const conf = await client.post(`/v1/spaces/${sid}/replicas`, {enabled:true, apiKey:'key', environmentId:'env'});
      const posted = await client.post(`/v1/spaces/${sid}/messages`, {body:`[@Replicas](#member:${conf.body.botMemberId}) Implement`, actingMode:'direct'});
      await running.service.replicas.tick();
      await running.close();
      completed = true;
      running = await startHarbor({store, replicasApiFactory: () => api});
      await running.service.replicas.tick();
      const messages = await store.listThread(sid, posted.body.message.id);
      expect(messages.filter(m => m.body.includes('Implemented and tested'))).toHaveLength(1);
      expect(api.create).toHaveBeenCalledTimes(1);
    } finally { await running.close(); await db.close(); }
  });
});

it('requires the matching request before treating history as a completed answer', () => {
  const user = (text: string) => ({type:'claude-user', payload:{message:{content:[{type:'text',text}]}}});
  const result = {type:'claude-result',payload:{result:'Done'}};
  expect(summarizeConversation([user('[Spaces request old]'), result], 'new').finished).toBe(false);
  expect(summarizeConversation([user('[Spaces request new]'), result], 'new')).toEqual({requestSeen:true, finished:true, text:'Done'});
});
