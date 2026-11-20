import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { SlackImportJob } from '@rowboat/spaces-protocol';
import { readFileSync } from 'node:fs';
import { startTestHarbor, agentClient } from './helpers.js';
import type { RunningHarbor } from '../src/server.js';
import { zip } from './slack-zip-fixture.js';
import { canManageSlackImport } from '../src/policy.js';

let harbor: RunningHarbor;
const files = JSON.parse(readFileSync(new URL('./fixtures/slack/public.json', import.meta.url), 'utf8'));
const bytes = zip(files).toString('base64');
const request = (path: string, method = 'GET', input?: unknown, token = 'dev-importer') => fetch(`${harbor.url}${path}`, {
  method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}),
});
const start = async (workspace: string, extra = {}) => {
  const response = await request('/v1/imports/slack/jobs', 'POST', { bytes, workspace, channelIds: ['C1'], ...extra });
  expect(response.status).toBe(200); return SlackImportJob.parse(await response.json());
};
const settled = async (id: string) => {
  let job!: SlackImportJob;
  await vi.waitFor(async () => {
    const response = await request(`/v1/imports/slack/jobs/${id}`); job = SlackImportJob.parse(await response.json());
    expect(['completed', 'failed']).toContain(job.status);
  }, { timeout: 15000, interval: 50 });
  return job;
};
beforeAll(async () => { harbor = await startTestHarbor({ seedMembers: [{ id: 'importer', displayName: 'Importer' }, { id: 'outsider', displayName: 'Outsider' }] }); });
afterAll(async () => { await harbor?.close(); });
it('imports private history and threads without memberships, mentions or invocations; HTTP/MCP parity', async () => {
  const job = await settled((await start('team.slack.com')).id);
  expect(job.status).toBe('completed');
  const spaceId = job.channels[0]!.spaceId;
  const members = await harbor.store.listMemberships(spaceId);
  expect(members.map(m => m.memberId)).toEqual(['importer']);
  const messages = await harbor.store.listMessagesBySpace(spaceId);
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({ author: { memberId: 'importer', slack: { userId: 'U1', name: 'Alex' } }, replyCount: 1, mentions: [], mentionsHere: false, mentionsRowboat: false });
  expect(messages[1]!.threadRoot).toBe(messages[0]!.id);
  expect(messages[0]!.postedAt).toBe('2026-01-01T00:00:00.000Z');
  expect(messages[0]!.author.slack?.reactions).toEqual([{ name: 'wave', count: 5, users: [{ id: 'U2', name: 'former' }] }]);
  expect((await harbor.store.getSlackJob(job.id))!.payload).toBeNull();
  expect((await request(`/v1/imports/slack/jobs/${job.id}`, 'GET', undefined, 'dev-outsider')).status).toBe(404);
  expect((await request(`/v1/imports/slack/jobs/${job.id}/retry`, 'POST', undefined, 'dev-outsider')).status).toBe(404);
  expect(canManageSlackImport('outsider', 'importer')?.code).toBe('not_found');
  expect(canManageSlackImport('importer', 'importer')).toBeNull();
  const client = await agentClient(harbor, 'dev-importer');
  try {
    expect((await client.callTool({ name: 'get_slack_import', arguments: { jobId: job.id } })).structuredContent).toEqual(job);
    const again = await client.callTool({ name: 'start_slack_import', arguments: { bytes, workspace: 'team.slack.com', channelIds: ['C1'] } });
    expect(again.isError).not.toBe(true); expect(again.structuredContent).toEqual(job);
    expect((await client.callTool({ name: 'list_slack_imports', arguments: {} })).structuredContent).toMatchObject({ jobs: [job] });
    expect((await client.callTool({ name: 'retry_slack_import', arguments: { jobId: job.id } })).structuredContent).toEqual(job);
  } finally { await client.close(); }
  const changed = await settled((await start('team.slack.com', { bytes: zip({ ...files, 'extra.json': [] }).toString('base64') })).id);
  expect(changed.channels[0]).toMatchObject({ status: 'skipped', spaceId });
  expect(await harbor.store.listMessagesBySpace(spaceId)).toHaveLength(2);
  const edited = await request(`/v1/spaces/${spaceId}/messages/${messages[0]!.id}/edit`, 'POST', { body: 'changed', actingMode: 'direct' });
  expect(edited.status).toBe(400);
});
it('rolls back a failed channel and resumes queued jobs after worker restart', async () => {
  await harbor.service.stopImports();
  const job = await start('recovery.slack.com');
  expect(job.status).toBe('queued');
  expect(await harbor.store.getSpace(job.channels[0]!.spaceId)).toBeUndefined();
  const original = harbor.store.appendMessage.bind(harbor.store);
  let count = 0;
  const fault = vi.spyOn(harbor.store, 'appendMessage').mockImplementation(async message => { if (++count === 2) throw new Error('Injected failure'); await original(message); });
  harbor.service.startImports();
  expect((await settled(job.id)).status).toBe('failed');
  expect(await harbor.store.getSpace(job.channels[0]!.spaceId)).toBeUndefined();
  fault.mockRestore();
  await harbor.service.stopImports();
  const retry = await request(`/v1/imports/slack/jobs/${job.id}/retry`, 'POST');
  expect(retry.status).toBe(200);
  harbor.service.startImports();
  const done = await settled(job.id);
  expect(done.status).toBe('completed');
  expect(await harbor.store.listMessagesBySpace(done.channels[0]!.spaceId)).toHaveLength(2);
});
it('rejects nonexistent channel selections without creating a job', async () => {
  expect((await request('/v1/imports/slack/jobs','POST',{bytes, workspace:'team.slack.com',channelIds:['missing']})).status).toBe(400);
});

it('preserves missing-parent threads and archived private-channel metadata', async () => {
  const archive = zip(JSON.parse(readFileSync(new URL('./fixtures/slack/enterprise.json', import.meta.url), 'utf8'))).toString('base64');
  const job = await settled((await start('enterprise.slack.com', { bytes: archive, channelIds: ['G1'] })).id);
  expect(job.status).toBe('completed');
  expect(job.channels[0]!.source).toMatchObject({private:true, archived:true, memberIds:['U1']});
  const space = await harbor.store.getSpace(job.channels[0]!.spaceId);
  expect(space?.archived).toBe(true);
  const messages = await harbor.store.listMessagesBySpace(space!.id);
  expect(messages).toHaveLength(3);
  const parent = messages.find(m => m.body.includes('Earlier Slack message'))!;
  expect(parent.replyCount).toBe(1);
  expect(messages.find(m => m.body === 'Missing parent')?.threadRoot).toBe(parent.id);
});
it('keeps edited/deleted source records and redacts imported history on deletion', async () => {
  const archive = zip({ 'users.json': [{ id:'U1',name:'Alex'}], 'channels.json':[{id:'C1',name:'general'}], 'general/2026-01-01.json':[
    {type:'message', user:'U1', ts:'1767225600.000001', text:'Edited text', edited:{ts:'1767225601.000001'}},
    {type:'message', subtype:'message_deleted', deleted_ts:'1767225602.000001', ts:'1767225603.000001'},
  ] }).toString('base64');
  const job = await settled((await start('tombstones.slack.com',{bytes:archive})).id);
  expect(job.status).toBe('completed');
  const spaceId=job.channels[0]!.spaceId;
  const messages=await harbor.store.listMessagesBySpace(spaceId);
  expect(messages).toHaveLength(2);
  expect(messages[0]!.editedAt).toBe('2026-01-01T00:00:01.000Z');
  expect(messages[1]!.deletedAt).toBeTruthy(); expect(messages[1]!.body).toBe('');
  expect((await request(`/v1/spaces/${spaceId}/messages/${messages[0]!.id}/delete`,'POST',{actingMode:'direct'})).status).toBe(200);
  expect((await harbor.store.listMessagesBySpace(spaceId))[0]!.body).toBe('');
  expect((await harbor.store.getSlackJob(job.id))!.payload).toBeNull();
});

it('retains completed channels across failure and retries only unfinished history', async () => {
  await harbor.service.stopImports();
  const archive = zip({ ...files, 'channels.json': [...files['channels.json'], {id:'C2',name:'other'}], 'other/2026-01-01.json': [{type:'message',user:'U1',ts:'1767225600.000004',text:'Other channel'}] }).toString('base64');
  const job = await start('partial.slack.com', { bytes:archive, channelIds:['C1','C2'] });
  const original = harbor.store.appendMessage.bind(harbor.store);
  const fault=vi.spyOn(harbor.store,'appendMessage').mockImplementation(async message=>{ if(message.body==='Other channel') throw new Error('Injected'); await original(message); });
  harbor.service.startImports();
  const failed=await settled(job.id);
  expect(failed.status).toBe('failed');
  expect(failed.channels.map(c=>c.status)).toEqual(['imported','pending']);
  expect((await harbor.store.getSlackJob(job.id))!.payload!.channels.map(c=>c.id)).toEqual(['C2']);
  fault.mockRestore();
  expect((await request(`/v1/imports/slack/jobs/${job.id}/retry`,'POST')).status).toBe(200);
  const done=await settled(job.id);
  expect(done.channels.map(c=>c.status)).toEqual(['imported','imported']);
  expect(await harbor.store.listMessagesBySpace(done.channels[0]!.spaceId)).toHaveLength(2);
  expect(await harbor.store.listMessagesBySpace(done.channels[1]!.spaceId)).toHaveLength(1);
});
it('links legacy profiles per space with admin gates, audit, idempotence and MCP parity', async () => {
  const job = await settled((await start('profiles.slack.com')).id);
  const spaceId = job.channels[0]!.spaceId;
  const messages = await harbor.store.listMessagesBySpace(spaceId);
  const message = messages[0]!;
  const path = `/v1/spaces/${spaceId}/messages/${message.id}/slack-profile`;
  expect(await (await request(path)).json()).toMatchObject({ userId: 'U1', name: 'Alex', memberId: null });
  expect((await request(path, 'PUT', { memberId: 'outsider' })).status).toBe(400);
  expect((await request(path, 'GET', undefined, 'dev-outsider')).status).toBe(403);
  await harbor.store.putMembership({ spaceId, memberId: 'outsider', role: 'member', joinedAt: new Date().toISOString() });
  expect((await request(path, 'PUT', { memberId: 'outsider' }, 'dev-outsider')).status).toBe(403);
  const linked = await request(path, 'PUT', { memberId: 'outsider' });
  expect(linked.status).toBe(200);
  expect(await linked.json()).toMatchObject({ memberId: 'outsider' });
  expect((await harbor.store.getMessage(spaceId, message.id))!.author).toEqual(message.author);
  expect(await harbor.store.listMemberships(spaceId)).toHaveLength(2);
  const client = await agentClient(harbor, 'dev-importer');
  try {
    const read = await client.callTool({ name: 'get_slack_profile', arguments: { spaceId, messageId: message.id } });
    expect(read.structuredContent).toMatchObject({ memberId: 'outsider' });
    const same = await client.callTool({ name: 'link_slack_profile', arguments: { spaceId, messageId: message.id, memberId: 'outsider' } });
    expect(same.isError).not.toBe(true);
    const unlink = await client.callTool({ name: 'link_slack_profile', arguments: { spaceId, messageId: message.id, memberId: null } });
    expect(unlink.structuredContent).toMatchObject({ memberId: null });
  } finally { await client.close(); }
  expect(await harbor.store.getSlackProfileLink(spaceId, 'profiles.slack.com', 'U1')).toBeUndefined();
  const events = (await harbor.store.listEventsAfter(spaceId, 0)).filter(e => e.event.type === 'slack_profile_linked');
  expect(events).toHaveLength(2);
  expect(events[0]!.event).toMatchObject({ memberId: 'outsider', by: { memberId: 'importer' } });
  const other = await settled((await start('profiles-other.slack.com')).id);
  expect(await harbor.store.getSlackProfileLink(other.channels[0]!.spaceId, 'profiles.slack.com', 'U1')).toBeUndefined();
});
it('appends unseen timestamps to existing channels without changing history or access', async () => {
  const first = await settled((await start('incremental.slack.com')).id);
  const spaceId = first.channels[0]!.spaceId;
  const before = await harbor.store.listMessagesBySpace(spaceId);
  const extra = structuredClone(files);
  extra['general/2026-01-01.json'].push({ type: 'message', user: 'U1', ts: '1767225601.000001', thread_ts: '1767225600.000001', text: 'New reply' });
  const input = { bytes: zip(extra).toString('base64'), existingChannels: 'append' };
  const job = await settled((await start('incremental.slack.com', input)).id);
  expect(job.status).toBe('completed');
  expect(job.channels[0]!.spaceId).toBe(spaceId);
  const after = await harbor.store.listMessagesBySpace(spaceId);
  expect(after).toHaveLength(3);
  expect(after[0]!.id).toBe(before[0]!.id);
  expect(after[0]!.replyCount).toBe(2);
  expect(after[2]!.threadRoot).toBe(before[0]!.id);
  expect(await harbor.store.listMemberships(spaceId)).toHaveLength(1);
  const again = await settled((await start('incremental.slack.com', { ...input, bytes: zip({ ...extra, 'unused.json': [] }).toString('base64') })).id);
  expect(again.status).toBe('completed');
  expect(await harbor.store.listMessagesBySpace(spaceId)).toHaveLength(3);
  expect((await request(`/v1/spaces/${spaceId}/messages/${before[0]!.id}/delete`, 'POST', { actingMode: 'direct' })).status).toBe(200);
  const deleted = await settled((await start('incremental.slack.com', { ...input, bytes: zip({ ...extra, 'after-delete.json': [] }).toString('base64') })).id);
  expect(deleted.status).toBe('completed');
  expect(await harbor.store.getMessage(spaceId, before[0]!.id)).toMatchObject({ body: '', deletedAt: expect.any(String) });
  await harbor.store.putMembership({ spaceId, memberId: 'outsider', role: 'admin', joinedAt: new Date().toISOString() });
  expect(await harbor.store.setMembershipRole(spaceId, 'importer', 'member')).toBe('ok');
  expect((await request('/v1/imports/slack/jobs', 'POST', { ...input, bytes: zip({ ...extra, 'another.json': [] }).toString('base64'), workspace: 'incremental.slack.com', channelIds: ['C1'] })).status).toBe(403);
});
it('does not recreate a destination deleted after an append job was queued', async () => {
  const first = await settled((await start('deleted-destination.slack.com')).id);
  const spaceId = first.channels[0]!.spaceId;
  await harbor.service.stopImports();
  const next = await start('deleted-destination.slack.com', { existingChannels: 'append' });
  await harbor.store.deleteSpace(spaceId);
  harbor.service.startImports();
  expect((await settled(next.id)).status).toBe('failed');
  expect(await harbor.store.getSpace(spaceId)).toBeUndefined();
});
