import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentClient, callStructured, restClient, startTestHarbor, freshStore } from './helpers.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import type { ReplicasApi } from '../src/replicas/api.js';
import { summarizeConversation } from '../src/replicas/api.js';
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
    expect(JSON.stringify(await harbor.store.getReplicasConnection(space))).not.toContain('test-secret');
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
