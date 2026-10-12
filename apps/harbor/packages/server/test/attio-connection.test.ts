import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Member } from '@rowboat/spaces-protocol';
import { attioPlatform } from '../src/connectors/attio/index.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { DEFAULT_ORG_ID } from '../src/pg-store.js';
import { unseal } from '../src/sealing.js';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

const READ = 'object_configuration:read record_permission:read';
const GOOD = 'attio-test-valid-key-1234';
const REPLACEMENT = 'attio-test-replacement-key-5678';
const calls: { token: string; method: string; path: string; body?: unknown }[] = [];
const originalPlatform = PLATFORMS.attio;
let api: Server;
let harbor: RunningHarbor;
const as = (token = 'dev-owner') => restClient(harbor, token);
const add = (credential: string) => as().post('/v1/agents', { displayName: 'Attio', kind: 'attio', connection: 'attio', credential });

beforeAll(async () => {
  vi.stubEnv('HARBOR_INTEGRATION_KEY', 'a'.repeat(64));
  api = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    calls.push({ token, method: req.method!, path: req.url!, ...(raw ? { body: JSON.parse(raw) } : {}) });
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (token === 'network-failure') return req.socket.destroy();
    if (token === 'invalid-json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json');
      return;
    }
    if (/^http-\d+$/.test(token)) return reply(Number(token.slice(5)), { message: `echoed secret: ${token}` });
    if (req.url === '/v2/self' && req.method === 'GET') {
      if (token === GOOD || token === REPLACEMENT) return reply(200, { active: true, scope: READ });
      if (token === 'write-scopes') return reply(200, { active: true, scope: 'object_configuration:read-write record_permission:read-write' });
      if (token === 'missing-scope') return reply(200, { active: true, scope: 'object_configuration:read' });
      if (token === 'empty-scope') return reply(200, { active: true, scope: '' });
      if (token.startsWith('probe-')) return reply(200, { active: true });
      if (token === 'malformed-identity') return reply(200, { active: 'true', scope: READ });
      return reply(200, { active: false });
    }
    if (req.url === '/v2/objects/companies/records/query' && req.method === 'POST') {
      if (token === 'probe-ok') return reply(200, { data: [] });
      if (token === 'probe-malformed') return reply(200, { records: [] });
      return reply(403, { message: `denied ${token}` });
    }
    return reply(404, {});
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  PLATFORMS.attio = attioPlatform(`http://127.0.0.1:${(api.address() as AddressInfo).port}`);
  harbor = await startTestHarbor({
    seedMembers: [{ id: 'owner', displayName: 'Owner' }, { id: 'other', displayName: 'Other' }],
  });
});

afterAll(async () => {
  await harbor?.close();
  if (api) await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  PLATFORMS.attio = originalPlatform!;
  vi.unstubAllEnvs();
});

describe('Attio connection through the agent API', () => {
  it('validates a trimmed key and seals it using the existing credential store', async () => {
    const secret = `  ${GOOD}  `;
    const result = await add(secret);
    expect(result.status).toBe(200);
    expect(result.body.agent).toMatchObject({ ownerId: 'owner', agentKind: 'attio', agentConnection: 'attio' });
    const id = result.body.agent.id;
    expect(calls.at(-1)).toEqual({ token: GOOD, method: 'GET', path: '/v2/self' });
    const stored = (await harbor.store.getAgentCredential(id))!;
    expect(stored.sealed).not.toContain(GOOD);
    expect(unseal(stored.sealed, DEFAULT_ORG_ID, id)).toBe(secret);
    const listed = await as().get('/v1/agents');
    expect(JSON.stringify([result.body, listed.body])).not.toContain(GOOD);
    expect(listed.body.agents.find((item: { agent: Member }) => item.agent.id === id).credential).toMatchObject({ setBy: 'owner' });
  });

  it('accepts read-write scopes without probing or requiring workspace metadata', async () => {
    const count = calls.length;
    expect((await add('write-scopes')).status).toBe(200);
    expect(calls.slice(count)).toEqual([{ token: 'write-scopes', method: 'GET', path: '/v2/self' }]);
  });

  it('proves read access when identity omits scopes, including an empty workspace', async () => {
    const count = calls.length;
    expect((await add('probe-ok')).status).toBe(200);
    expect(calls.slice(count)).toEqual([
      { token: 'probe-ok', method: 'GET', path: '/v2/self' },
      { token: 'probe-ok', method: 'POST', path: '/v2/objects/companies/records/query', body: { limit: 1 } },
    ]);
  });

  it.each([
    ['revoked-key', /inactive or revoked/],
    ['missing-scope', /record_permission:read/],
    ['empty-scope', /object_configuration:read, record_permission:read/],
    ['probe-denied', /Access denied/],
    ['probe-malformed', /unexpected records response/],
    ['malformed-identity', /unexpected identity response/],
    ['invalid-json', /invalid JSON response/],
    ['http-401', /did not accept this key/],
    ['http-403', /could not check this key.*Access denied/],
    ['http-429', /rate limiting/],
    ['http-503', /HTTP 503/],
    ['network-failure', /Could not reach Attio/],
    ['   ', /Enter an Attio workspace API key/],
  ])('rejects %j without creating an agent or returning the secret', async (secret, message) => {
    const before = await as().get('/v1/agents');
    const result = await add(secret);
    expect(result).toMatchObject({ status: 400, body: { code: 'invalid_request', message: expect.stringMatching(message) } });
    expect(JSON.stringify(result.body)).not.toContain(secret);
    expect((await as().get('/v1/agents')).body).toEqual(before.body);
  });

  it('refuses setup before contacting Attio when sealing is not configured', async () => {
    const before = await as().get('/v1/agents');
    const count = calls.length;
    vi.stubEnv('HARBOR_INTEGRATION_KEY', '');
    try {
      expect(await add(GOOD)).toMatchObject({ status: 400, body: { message: expect.stringContaining('HARBOR_INTEGRATION_KEY') } });
      expect(calls).toHaveLength(count);
      expect((await as().get('/v1/agents')).body).toEqual(before.body);
    } finally {
      vi.stubEnv('HARBOR_INTEGRATION_KEY', 'a'.repeat(64));
    }
  });

  it('keeps the old credential on invalid replacement; only the owner can replace it', async () => {
    const created = await add(GOOD);
    const id = created.body.agent.id;
    const path = `/v1/agents/${id}/credential`;
    const before = await harbor.store.getAgentCredential(id);
    expect((await as().put(path, { secret: 'revoked-key' })).status).toBe(400);
    expect(await harbor.store.getAgentCredential(id)).toEqual(before);
    const count = calls.length;
    expect((await as('dev-other').put(path, { secret: REPLACEMENT })).status).toBe(403);
    expect(calls).toHaveLength(count);
    expect(await harbor.store.getAgentCredential(id)).toEqual(before);

    await harbor.store.rejectAgentCredential(id, new Date().toISOString(), 'Previously rejected');
    const replaced = await as().put(path, { secret: REPLACEMENT });
    expect(replaced.status).toBe(200);
    expect(JSON.stringify(replaced.body)).not.toContain(REPLACEMENT);
    const stored = (await harbor.store.getAgentCredential(id))!;
    expect(unseal(stored.sealed, DEFAULT_ORG_ID, id)).toBe(REPLACEMENT);
    expect(stored.rejectedAt).toBeUndefined();
    expect(stored.rejectedReason).toBeUndefined();
    expect(calls.at(-1)?.token).toBe(REPLACEMENT);
  });

  it('starts the shared connector and answers help in the original thread', async () => {
    const agent = (await add(GOOD)).body.agent as Member;
    const spaceId = (await as().post('/v1/spaces', { name: 'CRM' })).body.space.id;
    await as().post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
    const count = calls.length;
    const posted = await as().post(`/v1/spaces/${spaceId}/messages`, {
      body: `[@Attio](#member:${agent.id}) help`, actingMode: 'direct',
    });
    expect(posted.status).toBe(200);
    await vi.waitFor(async () => {
      const thread = await as().get(`/v1/spaces/${spaceId}/threads/${posted.body.message.id}`);
      expect(thread.body.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('@Attio help'), author: expect.objectContaining({ memberId: agent.id }) }),
      ]));
    });
    expect(calls).toHaveLength(count);
  });
});
