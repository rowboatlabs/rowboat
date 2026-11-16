import { beforeAll, afterAll, expect, it } from 'vitest';
import { SlackImportPreview } from '@rowboat/spaces-protocol';
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
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(25 * 1024 * 1024 + 1)); controller.close(); } });
  const response = await fetch(`${harbor.url}/v1/imports/slack/preview`, {
    method: 'PUT', headers: { authorization: 'Bearer dev-previewer' }, body: stream, duplex: 'half',
  } as RequestInit);
  expect(response.status).toBe(413);
});
