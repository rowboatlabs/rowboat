import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invocation, Member, Message } from '@rowboat/spaces-protocol';
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
let companyStatus = 200;
let companyBody: unknown;
let personStatus = 200;
let personBody: unknown;
let recordStatus = 200;
let recordBody: unknown;
const company = (number = 1) => ({
  id: { record_id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}` },
  web_url: `https://app.attio.com/test/company/${number}`,
  values: {
    name: [{ value: `Acme ${number}`, active_until: null }],
    description: [{ value: 'Makes useful things.', active_until: null }],
    domains: [{ domain: 'acme.com', active_until: null }],
  },
});
const person = (number = 1) => ({
  id: { record_id: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}` },
  web_url: `https://app.attio.com/test/person/${number}`,
  values: {
    name: [{ full_name: `Jane Doe ${number}`, first_name: 'Jane', last_name: `Doe ${number}`, active_until: null }],
    email_addresses: [{ email_address: 'jane@acme.com', active_until: null }],
    job_title: [{ value: 'Head of Sales', active_until: null }],
  },
});
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
      if ((token === GOOD || token === REPLACEMENT) && JSON.parse(raw).filter) return reply(companyStatus, companyBody);
      if (token === 'probe-ok') return reply(200, { data: [] });
      if (token === 'probe-malformed') return reply(200, { records: [] });
      return reply(403, { message: `denied ${token}` });
    }
    if (req.url === '/v2/objects/people/records/query' && req.method === 'POST' && (token === GOOD || token === REPLACEMENT)) return reply(personStatus, personBody);
    if (/^\/v2\/objects\/[^/]+\/records\/[^/]+$/.test(req.url!) && req.method === 'GET' && (token === GOOD || token === REPLACEMENT)) return reply(recordStatus, recordBody);
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

async function askInSpace(agent: Member, spaceId: string, command: string): Promise<{ invocation: Invocation; reply?: Message }> {
  const posted = await as().post(`/v1/spaces/${spaceId}/messages`, {
    body: `[@Attio](#member:${agent.id}) ${command}`, actingMode: 'direct',
  });
  expect(posted.status).toBe(200);
  let invocation: Invocation | undefined;
  await vi.waitFor(async () => {
    const listed = await as().get(`/v1/spaces/${spaceId}/invocations`);
    invocation = listed.body.invocations.find((item: Invocation) => item.id === posted.body.invocations[0].id);
    expect(['done', 'failed']).toContain(invocation?.state);
  }, { timeout: 5000 });
  const thread = await as().get(`/v1/spaces/${spaceId}/threads/${posted.body.message.id}`);
  return { invocation: invocation!, reply: thread.body.messages.find((message: Message) => message.author.memberId === agent.id) };
}

describe('Attio company lookup', () => {
  let agent: Member;
  let spaceId: string;

  beforeAll(async () => {
    agent = (await add(GOOD)).body.agent;
    spaceId = (await as().post('/v1/spaces', { name: 'Company lookups' })).body.space.id;
    await as().post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
  });

  beforeEach(() => {
    companyStatus = 200;
    companyBody = { data: [company()] };
  });

  const ask = (command: string) => askInSpace(agent, spaceId, command);

  it('queries an exact normalized domain and replies as Attio in the same thread', async () => {
    const count = calls.length;
    const { invocation, reply } = await ask('company ACME.COM.');
    expect(invocation.state).toBe('done');
    expect(calls.slice(count)).toEqual([{
      token: GOOD, method: 'POST', path: '/v2/objects/companies/records/query',
      body: { filter: { domains: { domain: { $eq: 'acme.com' } } }, limit: 11, offset: 0 },
    }]);
    expect(reply?.body).toContain('**Acme 1**');
    expect(reply?.body).toContain('Domains: acme.com');
    expect(reply?.body).toContain('Makes useful things.');
    expect(reply?.body).toContain(company().id.record_id);
    expect(reply?.body).toContain('[Open in Attio](<https://app.attio.com/test/company/1>)');
  });

  it('documents the command in help and unknown-command replies without calling Attio', async () => {
    const count = calls.length;
    for (const command of ['help', 'unknown']) expect((await ask(command)).reply?.body).toContain('@Attio company <domain>');
    expect(calls).toHaveLength(count);
  });

  it.each(['company', 'company acme', 'company https://acme.com', 'company acme.com/path', 'company jane@acme.com',
    'company acme.com other.com', 'company -acme.com', 'company acme..com', 'company 127.0.0.1'])('rejects invalid input: %s', async (command) => {
    const count = calls.length;
    const { invocation, reply } = await ask(command);
    expect(invocation.state).toBe('done');
    expect(reply?.body).toContain('Usage: `@Attio company <domain>`');
    expect(calls).toHaveLength(count);
  });

  it('normalizes international domain names', async () => {
    await ask('company bücher.de');
    expect(calls.at(-1)?.body).toMatchObject({ filter: { domains: { domain: { $eq: 'xn--bcher-kva.de' } } } });
  });

  it('reports no matches as a successful answer', async () => {
    companyBody = { data: [] };
    const { invocation, reply } = await ask('company absent.com');
    expect(invocation.state).toBe('done');
    expect(reply?.body).toBe('No companies found for **absent.com**.');
  });

  it('shows all matches up to ten without choosing a company', async () => {
    companyBody = { data: [company(1), company(2)] };
    const reply = (await ask('company acme.com')).reply!;
    expect(reply.body).toContain('2 companies match **acme.com**');
    expect(reply.body).toContain(company(1).id.record_id);
    expect(reply.body).toContain(company(2).id.record_id);
    companyBody = { data: Array.from({ length: 11 }, (_, i) => company(i + 1)) };
    const capped = (await ask('company acme.com')).reply!;
    expect(capped.body).toContain('Showing the first 10');
    expect(capped.body).toContain(company(10).id.record_id);
    expect(capped.body).not.toContain(company(11).id.record_id);
  });

  it('handles absent attributes and does not show historical values', async () => {
    companyBody = { data: [{ id: company().id, values: {} }] };
    expect((await ask('company acme.com')).reply?.body).toBe(`**Unnamed company**\n\nRecord ID: \`${company().id.record_id}\``);
    const record = company();
    companyBody = { data: [{ ...record, values: { ...record.values, name: [{ value: 'Old name', active_until: '2026-01-01' }, ...record.values.name] } }] };
    const reply = (await ask('company acme.com')).reply!;
    expect(reply.body).toContain('Acme 1');
    expect(reply.body).not.toContain('Old name');
  });

  it('keeps CRM text from creating Space mentions and bounds long descriptions', async () => {
    const record = company();
    record.values.name[0]!.value = '[@Owner](#member:owner) [@here](#here)';
    record.web_url = 'https://app.attio.com/[@here](#here)';
    record.values.description[0]!.value = '<script>alert(1)</script> ' + 'x'.repeat(2000);
    companyBody = { data: [record] };
    const reply = (await ask('company acme.com')).reply!;
    expect(reply.mentions).toEqual([]);
    expect(reply.mentionsHere).toBe(false);
    expect(reply.body).not.toContain('[@Owner]');
    expect(reply.body).not.toContain('<script>');
    expect(reply.body).not.toContain('x'.repeat(501));
    expect(reply.body).toContain('…');
  });

  it.each(['javascript:alert(1)', 'https://app.attio.com.evil.test/record', 'https://user:pass@app.attio.com/record', 'not a URL'])('omits unsafe record links: %s', async (web_url) => {
    companyBody = { data: [{ ...company(), web_url }] };
    const reply = (await ask('company acme.com')).reply!;
    expect(reply.body).toContain('Acme 1');
    expect(reply.body).not.toContain('Open in Attio');
  });

  it.each([403, 404, 429, 503])('fails cleanly on HTTP %i without rejecting the credential', async (status) => {
    companyStatus = status;
    companyBody = { message: GOOD };
    const { invocation, reply } = await ask('company acme.com');
    expect(invocation.state).toBe('failed');
    expect(invocation.error).not.toContain(GOOD);
    expect(reply).toBeUndefined();
    expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeUndefined();
  });

  it('fails malformed responses instead of reporting no matches', async () => {
    companyBody = { data: [{ id: { record_id: 'invalid' }, values: {} }] };
    const { invocation } = await ask('company acme.com');
    expect(invocation).toMatchObject({ state: 'failed', error: expect.stringContaining('unexpected company response') });
  });

  it('marks revoked credentials and recovers after replacement', async () => {
    companyStatus = 401;
    expect((await ask('company acme.com')).invocation.state).toBe('failed');
    expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeDefined();
    expect((await as().put(`/v1/agents/${agent.id}/credential`, { secret: REPLACEMENT })).status).toBe(200);
    companyStatus = 200;
    expect((await ask('company acme.com')).invocation.state).toBe('done');
    expect(calls.at(-1)?.token).toBe(REPLACEMENT);
    expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeUndefined();
  });
});

describe('Attio person lookup', () => {
  let agent: Member;
  let spaceId: string;
  const ask = (command: string) => askInSpace(agent, spaceId, command);

  beforeAll(async () => {
    agent = (await add(GOOD)).body.agent;
    spaceId = (await as().post('/v1/spaces', { name: 'Contact lookups' })).body.space.id;
    await as().post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
  });

  beforeEach(() => {
    personStatus = 200;
    personBody = { data: [person()] };
  });

  it('queries an exact email and replies with contact details in the same thread', async () => {
    const count = calls.length;
    const { invocation, reply } = await ask('person JANE@ACME.COM');
    expect(invocation.state).toBe('done');
    expect(calls.slice(count)).toEqual([{
      token: GOOD, method: 'POST', path: '/v2/objects/people/records/query',
      body: { filter: { email_addresses: { email_address: { $eq: 'jane@acme.com' } } }, limit: 11, offset: 0 },
    }]);
    expect(reply?.body).toContain('**Jane Doe 1**');
    expect(reply?.body).toContain('Email: jane@acme.com');
    expect(reply?.body).toContain('Job title: Head of Sales');
    expect(reply?.body).toContain(person().id.record_id);
    expect(reply?.body).toContain('[Open in Attio](<https://app.attio.com/test/person/1>)');
  });

  it('lists person lookup in help and unknown-command replies', async () => {
    const count = calls.length;
    for (const command of ['help', 'unknown']) expect((await ask(command)).reply?.body).toContain('@Attio person <email>');
    expect(calls).toHaveLength(count);
  });

  it.each(['person', 'person jane', 'person jane@', 'person @acme.com', 'person jane@@acme.com',
    'person mailto:jane@acme.com', 'person Jane <jane@acme.com>', 'person jane@acme.com extra',
    'person jane@acme.com/path', 'person jane@acme.com?x=1', 'person jane..doe@acme.com'])('rejects invalid input: %s', async (command) => {
    const count = calls.length;
    const { invocation, reply } = await ask(command);
    expect(invocation.state).toBe('done');
    expect(reply?.body).toContain('Usage: `@Attio person <email>`');
    expect(calls).toHaveLength(count);
  });

  it('preserves plus aliases and dots, and normalizes international domains', async () => {
    await ask('person Jane.Doe+sales@bücher.de');
    expect(calls.at(-1)?.body).toMatchObject({ filter: { email_addresses: { email_address: { $eq: 'jane.doe+sales@xn--bcher-kva.de' } } } });
  });

  it('reports no matches without failing', async () => {
    personBody = { data: [] };
    const { invocation, reply } = await ask('person absent@acme.com');
    expect(invocation.state).toBe('done');
    expect(reply?.body).toBe('No people found for **absent@acme.com**.');
  });

  it('shows ambiguous matches and caps the list at ten', async () => {
    personBody = { data: [person(1), person(2)] };
    const reply = (await ask('person jane@acme.com')).reply!;
    expect(reply.body).toContain('2 people match');
    expect(reply.body).toContain(person(1).id.record_id);
    expect(reply.body).toContain(person(2).id.record_id);
    personBody = { data: Array.from({ length: 11 }, (_, i) => person(i + 1)) };
    const capped = (await ask('person jane@acme.com')).reply!;
    expect(capped.body).toContain('Showing the first 10');
    expect(capped.body).toContain(person(10).id.record_id);
    expect(capped.body).not.toContain(person(11).id.record_id);
  });

  it('handles missing fields, falls back to name parts and excludes historical values', async () => {
    personBody = { data: [{ id: person().id, values: {} }] };
    expect((await ask('person jane@acme.com')).reply?.body).toBe(`**Unnamed person**\n\nRecord ID: \`${person().id.record_id}\``);
    const record = person();
    personBody = { data: [{ ...record, values: {
      ...record.values,
      name: [{ full_name: 'Old name', active_until: '2026-01-01' }, { first_name: 'Jane', last_name: 'Doe' }],
      email_addresses: [{ email_address: 'old@example.com', active_until: '2026-01-01' }, ...record.values.email_addresses],
      job_title: [{ value: 'Old title', active_until: '2026-01-01' }],
    } }] };
    const reply = (await ask('person jane@acme.com')).reply!;
    expect(reply.body).toContain('**Jane Doe**');
    expect(reply.body).not.toMatch(/Old name|old@example.com|Old title/);
  });

  it('escapes contact fields and ignores unsafe links', async () => {
    const record = person();
    record.values.name[0]!.full_name = '[@Owner](#member:owner)';
    record.values.email_addresses[0]!.email_address = '[@here](#here)';
    record.values.job_title[0]!.value = '<script>bad</script>' + 'x'.repeat(500);
    record.web_url = 'javascript:alert(1)';
    personBody = { data: [record] };
    const reply = (await ask('person jane@acme.com')).reply!;
    expect(reply.mentions).toEqual([]);
    expect(reply.mentionsHere).toBe(false);
    expect(reply.body).not.toMatch(/\[@Owner\]|\[@here\]|<script>|Open in Attio/);
    expect(reply.body).not.toContain('x'.repeat(201));
  });

  it.each([403, 429, 503])('handles HTTP %i without rejecting a usable key', async (status) => {
    personStatus = status;
    personBody = { message: GOOD };
    const { invocation } = await ask('person jane@acme.com');
    expect(invocation.state).toBe('failed');
    expect(invocation.error).not.toContain(GOOD);
    expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeUndefined();
  });

  it('fails malformed responses instead of claiming no contacts exist', async () => {
    personBody = { data: [{ id: person().id, values: { name: 'Jane' } }] };
    expect((await ask('person jane@acme.com')).invocation).toMatchObject({ state: 'failed', error: expect.stringContaining('unexpected person response') });
  });
});

describe('Attio record lookup', () => {
  let agent: Member;
  let spaceId: string;
  const id = '20000000-0000-4000-8000-000000000001';
  const ask = (command = `record projects ${id}`) => askInSpace(agent, spaceId, command);
  const record = (values: Record<string, unknown[]> = {}) => ({
    id: { record_id: id }, web_url: `https://app.attio.com/test/project/${id}`, values,
  });

  beforeAll(async () => {
    agent = (await add(GOOD)).body.agent;
    spaceId = (await as().post('/v1/spaces', { name: 'Record lookups' })).body.space.id;
    await as().post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
  });

  beforeEach(() => {
    recordStatus = 200;
    recordBody = { data: record({ name: [{ attribute_type: 'text', value: 'Launch' }] }) };
  });

  it.each(['companies', 'people', 'custom_projects', 'projects-v2', '30000000-0000-4000-8000-000000000001'])('reads object %s with one GET and replies in the original thread', async (object) => {
    const count = calls.length;
    const { invocation, reply } = await ask(`record ${object} ${id}`);
    expect(invocation.state).toBe('done');
    expect(calls.slice(count)).toEqual([{ token: GOOD, method: 'GET', path: `/v2/objects/${object}/records/${id}` }]);
    expect(reply?.body).toContain('**name:** Launch');
    expect(reply?.body).toContain(`Record ID: \`${id}\``);
    expect(reply?.body).toContain('[Open in Attio]');
  });

  it('lists the record command in help', async () => {
    expect((await ask('help')).reply?.body).toContain('@Attio record <object> <record-id>');
  });

  it.each(['record', 'record companies', 'record companies not-a-uuid', `record companies ${id} extra`,
    `record ../people ${id}`, `record companies/people ${id}`, `record companies?x=1 ${id}`, `record %2e%2e ${id}`])('rejects invalid arguments: %s', async (command) => {
    const count = calls.length;
    const { invocation, reply } = await ask(command);
    expect(invocation.state).toBe('done');
    expect(reply?.body).toContain('Usage: `@Attio record <object> <record-id>`');
    expect(calls).toHaveLength(count);
  });

  it('formats common attribute types, preserving zero and false', async () => {
    recordBody = { data: record({
      title: [{ attribute_type: 'text', value: 'Launch' }],
      count: [{ attribute_type: 'number', value: 0 }],
      rating: [{ attribute_type: 'rating', value: 4 }],
      enabled: [{ attribute_type: 'checkbox', value: false }],
      deadline: [{ attribute_type: 'date', value: '2026-12-01' }],
      updated: [{ attribute_type: 'timestamp', value: '2026-10-12T12:00:00Z' }],
      domain: [{ attribute_type: 'domain', domain: 'acme.com' }],
      email: [{ attribute_type: 'email-address', email_address: 'jane@acme.com' }],
      contact: [{ attribute_type: 'personal-name', first_name: 'Jane', last_name: 'Doe' }],
      category: [{ attribute_type: 'select', option: { title: 'Enterprise' } }],
      stage: [{ attribute_type: 'status', status: { title: 'In progress' } }],
      amount: [{ attribute_type: 'currency', currency_code: 'USD', currency_value: '499.00' }],
      company: [{ attribute_type: 'record-reference', target_object: 'companies', target_record_id: company().id.record_id }],
    }) };
    const reply = (await ask()).reply!;
    for (const text of ['count:** 0', 'rating:** 4', 'enabled:** No', '2026-12-01', '2026-10-12T12:00:00Z', 'acme.com',
      'jane@acme.com', 'Jane Doe', 'Enterprise', 'In progress', 'USD 499.00', `companies: ${company().id.record_id}`]) expect(reply.body).toContain(text);
  });

  it('omits unsupported, malformed and historical values without hiding the record', async () => {
    recordBody = { data: record({
      future: [{ attribute_type: 'future-type', value: 'hidden' }],
      old: [{ attribute_type: 'text', value: 'past', active_until: '2026-01-01' }],
      broken: [null, 12, { attribute_type: 'number', value: 'wrong type' }, { attribute_type: 'select', option: null }],
    }) };
    const { invocation, reply } = await ask();
    expect(invocation.state).toBe('done');
    expect(reply?.body).toContain('No supported current fields to display.');
    expect(reply?.body).toContain('[Open in Attio]');
    expect(reply?.body).not.toMatch(/hidden|past|wrong type/);
  });

  it('bounds fields, multi-values and long strings', async () => {
    const values = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`field${i}`, [{ attribute_type: 'text', value: 'x'.repeat(1000) }]]));
    values.field0 = Array.from({ length: 7 }, (_, i) => ({ attribute_type: 'text', value: `option${i}` }));
    recordBody = { data: record(values) };
    const reply = (await ask()).reply!;
    expect(reply.body).toContain('field19');
    expect(reply.body).not.toContain('field20');
    expect(reply.body).toContain('Showing the first 20 fields');
    expect(reply.body).toContain('option4 (+2 more)');
    expect(reply.body).not.toContain('option5');
    expect(reply.body).not.toContain('x'.repeat(301));
  });

  it('escapes field names and values and omits unsafe links', async () => {
    recordBody = { data: { ...record({ '[@here](#here)': [{ attribute_type: 'text', value: '[@Owner](#member:owner)' }] }), web_url: 'javascript:alert(1)' } };
    const reply = (await ask()).reply!;
    expect(reply.mentions).toEqual([]);
    expect(reply.mentionsHere).toBe(false);
    expect(reply.body).not.toMatch(/\[@here\]|\[@Owner\]|Open in Attio/);
  });

  it('answers missing or inaccessible records as a normal not-found reply', async () => {
    recordStatus = 404;
    recordBody = { message: GOOD };
    const { invocation, reply } = await ask();
    expect(invocation.state).toBe('done');
    expect(reply?.body).toContain('was not found or is unavailable');
    expect(reply?.body).not.toContain(GOOD);
  });

  it.each([403, 429, 503])('fails HTTP %i without rejecting the credential', async (status) => {
    recordStatus = status;
    recordBody = { message: GOOD };
    const { invocation } = await ask();
    expect(invocation.state).toBe('failed');
    expect(invocation.error).not.toContain(GOOD);
    expect((await harbor.store.getAgentCredential(agent.id))?.rejectedAt).toBeUndefined();
  });

  it.each([
    { data: { id: { record_id: id }, values: null } },
    { data: { id: { record_id: company().id.record_id }, values: {} } },
  ])('rejects malformed or mismatched records', async (body) => {
    recordBody = body;
    expect((await ask()).invocation).toMatchObject({ state: 'failed', error: expect.stringContaining('unexpected record response') });
  });
});
