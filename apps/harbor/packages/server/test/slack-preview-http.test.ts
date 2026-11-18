import { beforeAll, afterAll, expect, it } from 'vitest';
import { MAX_SLACK_ZIP_BYTES, SlackImportPreview } from '@rowboat/spaces-protocol';
import { readFileSync } from 'node:fs';
import { startTestHarbor, restClient, agentClient } from './helpers.js';
import type { RunningHarbor } from '../src/server.js';
import { zip } from './slack-zip-fixture.js';

let harbor: RunningHarbor;
const archive = zip(JSON.parse(readFileSync(new URL('./fixtures/slack/public.json', import.meta.url), 'utf8')));
beforeAll(async () => { harbor = await startTestHarbor({ seedMembers: [{ id: 'previewer', displayName: 'Previewer' }] }); });
afterAll(async () => { await harbor?.close(); });
const upload = (bytes: Uint8Array, token = 'dev-previewer') => fetch(`${harbor.url}/v1/imports/slack/preview`, {
  method: 'PUT', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/zip' }, body: bytes as unknown as BodyInit,
});
it('requires authentication before previewing bytes', async () => {
  expect((await upload(archive, '')).status).toBe(401);
});
it('returns summaries only and creates no spaces; MCP has the same result', async () => {
  const before = await restClient(harbor, 'dev-previewer').get('/v1/spaces');
  const response = await upload(archive);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const result = SlackImportPreview.parse(await response.json());
  expect(result.channels[0]).toMatchObject({ name: 'general', messages: 2, replies: 1 });
  expect(result.channels[0]).not.toHaveProperty('memberIds');
  expect(result).not.toHaveProperty('identities');
  const client = await agentClient(harbor, 'dev-previewer');
  try {
    const tool = await client.callTool({ name: 'preview_slack_import', arguments: { bytes: archive.toString('base64') } });
    expect(tool.isError).not.toBe(true);
    expect(tool.structuredContent).toEqual(result);
  } finally { await client.close(); }
  expect(await restClient(harbor, 'dev-previewer').get('/v1/spaces')).toEqual(before);
});
it('returns actionable errors for corrupt and unsupported exports', async () => {
  expect((await upload(Buffer.from('not a zip'))).status).toBe(400);
  const response = await upload(zip({ 'unrelated.json': [] }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'invalid_request' });
});
it('bounds a streamed upload without a content-length header', async () => {
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent > MAX_SLACK_ZIP_BYTES) { controller.close(); return; }
      const size = Math.min(1024 * 1024, MAX_SLACK_ZIP_BYTES + 1 - sent);
      controller.enqueue(new Uint8Array(size)); sent += size;
    },
  });
  const response = await fetch(`${harbor.url}/v1/imports/slack/preview`, {
    method: 'PUT', headers: { authorization: 'Bearer dev-previewer' }, body: stream, duplex: 'half',
  } as RequestInit);
  expect(response.status).toBe(413);
});

it('previews and queues an archive larger than the former 25 MiB cap', async () => {
  const files = JSON.parse(readFileSync(new URL('./fixtures/slack/public.json', import.meta.url), 'utf8'));
  // Stored padding exercises upload bytes without inflating message counts or entry limits.
  for (let i = 0; i < 4; i++) files['padding-' + i + '.txt'] = ' '.repeat(7 * 1024 * 1024);
  const large = zip(files);
  expect(large.length).toBeGreaterThan(25 * 1024 * 1024);
  expect((await upload(large)).status).toBe(200);
  const response = await fetch(harbor.url + '/v1/imports/slack/jobs', {
    method: 'POST', headers: { authorization: 'Bearer dev-previewer', 'content-type': 'application/json' },
    body: JSON.stringify({ bytes: large.toString('base64'), workspace: 'large.slack.com', channelIds: ['C1'] }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ workspace: 'large.slack.com' });
}, 30000);
