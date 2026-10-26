import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import { calAlert, calPlatform } from '../src/connectors/cal/index.js';
import { commandText, zonedToUtc } from '../src/connectors/commands.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { hogqlString, posthogAlert, posthogPlatform } from '../src/connectors/posthog/index.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { freshStore, restClient } from './helpers.js';

// Integrations and alerts (spec §8, 2026-10-03), end to end: a real Harbor
// running the PostHog and Cal.com connectors against stand-ins for their APIs
// that answer as their docs say, record every call, and refuse any key but
// the good one.

interface Call {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

/** A stand-in API: `route` answers [status, body] for a call; every call is kept. */
async function fakeApi(route: (call: Call) => [number, unknown]): Promise<{ url: string; calls: Call[]; close: () => Promise<void> }> {
  const calls: Call[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const call = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      calls.push(call);
      const [status, body] = route(call);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

const GOOD_POSTHOG = 'phx_good';
const GOOD_CAL = 'cal_live_good';

function posthogRoute(call: Call): [number, unknown] {
  if (call.headers.authorization !== `Bearer ${GOOD_POSTHOG}`) return [401, { detail: 'Invalid personal API key.' }];
  const path = call.path.split('?')[0];
  if (path === '/api/users/@me/') return [200, { team: { id: 42, name: 'Rowboat' } }];
  if (path === '/api/projects/42/query/') {
    const query = (call.body as { query: { query: string } }).query.query;
    if (query.includes('group by event')) return [200, { columns: ['event', 'total'], results: [['$pageview', 1200], ['signup', 31]] }];
    if (query.startsWith('select count()')) return [200, { columns: ['count()', 'count(distinct person_id)'], results: [[31, 29]] }];
    return [200, { columns: ['a'], results: [[1]] }];
  }
  if (path === '/api/projects/42/insights/') return [200, { results: [{ short_id: 'AbC', name: 'Weekly signups' }] }];
  if (path === '/api/projects/42/feature_flags/') return [200, { results: [{ id: 7, key: 'new-onboarding', name: 'New onboarding', active: true }] }];
  return [404, { detail: 'Not found.' }];
}

function calRoute(call: Call): [number, unknown] {
  if (calRevoked) return [401, { status: 'error', error: { message: 'API key revoked' } }];
  if (call.headers.authorization !== `Bearer ${GOOD_CAL}`) return [401, { status: 'error', error: { message: 'Invalid API Key' } }];
  const path = call.path.split('?')[0];
  if (path === '/me') return [200, { status: 'success', data: { id: 1, username: 'arjun', email: 'arjun@example.com', timeZone: 'America/New_York' } }];
  if (path === '/event-types') return [200, { status: 'success', data: [{ id: 10, slug: 'intro', title: 'Intro call', lengthInMinutes: 30 }] }];
  if (path === '/bookings' && call.method === 'GET') {
    const afterStart = new URL(call.path, 'http://x').searchParams.get('afterStart')!;
    const start = new Date(new Date(afterStart).getTime() + 15 * 3_600_000).toISOString();
    return [200, { status: 'success', data: [{ uid: 'bk_1', title: 'Intro call', start, status: 'accepted', location: 'https://meet.example.com/x', attendees: [{ name: 'Jane', email: 'jane@example.com' }] }] }];
  }
  if (path === '/bookings' && call.method === 'POST') {
    const body = call.body as { start: string };
    return [201, { status: 'success', data: { uid: 'bk_2', title: 'Intro call', start: body.start } }];
  }
  if (path === '/bookings/bk_1/cancel') return [200, { status: 'success', data: { uid: 'bk_1', status: 'cancelled' } }];
  if (path === '/slots') return [200, { status: 'success', data: {} }];
  return [404, { status: 'error', error: { message: 'Not found' } }];
}

async function until<T>(check: () => Promise<T | undefined | false>, what: string, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const originals = { posthog: PLATFORMS.posthog, cal: PLATFORMS.cal };
let posthog: Awaited<ReturnType<typeof fakeApi>>;
let cal: Awaited<ReturnType<typeof fakeApi>>;
let harbor: RunningHarbor;
let spaceId = '';
const as = (token: string) => restClient(harbor, token);
/** A call with no bearer, as a service makes it. */
const hook = (path: string, init: RequestInit) => fetch(`${harbor.url}${path}`, init);
const remove = async (token: string, path: string) => (await fetch(`${harbor.url}${path}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status;
/** Cal.com revoking the key: every call refused until it is put back. */
let calRevoked = false;
const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

async function addAgent(name: string, connection: string, credential: string): Promise<Member> {
  const created = await as('dev-ramnique').post('/v1/agents', { displayName: name, kind: connection, connection, credential });
  expect(created.status).toBe(200);
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: [created.body.agent.id], actingMode: 'direct' });
  return created.body.agent;
}

/** Post a mention and wait for its invocation to end; the reply in its thread, if any. */
async function ask(body: string): Promise<{ invocation: Invocation; reply?: Message }> {
  const r = await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct' });
  expect(r.status).toBe(200);
  const posted = routes.postMessage.response.parse(r.body);
  const id = posted.invocations[0]!.id;
  const invocation = await until(async () => {
    const all = (await as('dev-ramnique').get(`/v1/spaces/${spaceId}/invocations`)).body.invocations as Invocation[];
    const i = all.find((x) => x.id === id);
    return i && ['done', 'failed', 'cancelled'].includes(i.state) ? i : undefined;
  }, `invocation ${id}`);
  const thread = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/threads/${posted.message.id}`)).body.messages as Message[];
  return { invocation, reply: thread.find((m) => m.id !== posted.message.id) };
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'c'.repeat(64);
  posthog = await fakeApi(posthogRoute);
  cal = await fakeApi(calRoute);
  // A refusing region first, as US Cloud refuses an EU key.
  const refusing = await fakeApi(() => [401, { detail: 'Invalid personal API key.' }]);
  afterAll(() => refusing.close());
  PLATFORMS.posthog = posthogPlatform([refusing.url, posthog.url]);
  PLATFORMS.cal = calPlatform(cal.url);
  harbor = await startHarbor({
    store: (await freshStore()).store,
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
    blobs: new MemoryBlobStore(),
  });
  await harbor.store.putMember({ id: 'gagan', displayName: 'Gagan', role: 'admin', kind: 'human' });
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Growth' })).body.space.id;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
  await posthog.close();
  await cal.close();
  PLATFORMS.posthog = originals.posthog!;
  PLATFORMS.cal = originals.cal!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the PostHog agent', () => {
  let agent: Member;
  beforeAll(async () => {
    agent = await addAgent('PostHog', 'posthog', GOOD_POSTHOG);
  });

  it('refuses a key PostHog does not accept, creating nothing', async () => {
    const r = await as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'posthog', connection: 'posthog', credential: 'phx_bad' });
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/PostHog did not accept this key/) } });
  });

  it('answers help, and an unknown command with the list', async () => {
    const help = await ask(`${mention(agent)} help`);
    expect(help.invocation.state).toBe('done');
    expect(help.reply?.body).toMatch(/@PostHog count <event> \[days\]/);
    const unknown = await ask(`${mention(agent)} dance`);
    expect(unknown.reply?.body).toMatch(/I don't know "dance"/);
  });

  it('counts an event with HogQL, in the region that knows the key', async () => {
    const { invocation, reply } = await ask(`${mention(agent)} count signup 30`);
    expect(invocation.state).toBe('done');
    expect(reply?.body).toBe('**signup**, last 30 days: 31 times, 29 people.');
    const query = posthog.calls.filter((c) => c.path === '/api/projects/42/query/').at(-1)!;
    expect((query.body as { query: { query: string } }).query.query).toContain(`event = 'signup' and timestamp > now() - interval 30 day`);
  });

  it('lists top events, insights and flags with links', async () => {
    expect((await ask(`${mention(agent)} top`)).reply?.body).toContain('| $pageview | 1,200 |');
    expect((await ask(`${mention(agent)} insights`)).reply?.body).toBe(`- [Weekly signups](${posthog.url}/project/42/insights/AbC)`);
    expect((await ask(`${mention(agent)} flags`)).reply?.body).toBe(`- 🟢 [\`new-onboarding\`](${posthog.url}/project/42/feature_flags/7): New onboarding`);
  });

  it('says how to use a command it was given wrongly', async () => {
    const { invocation, reply } = await ask(`${mention(agent)} count signup 900`);
    expect(invocation.state).toBe('done');
    expect(reply?.body).toMatch(/isn't a number of days[\s\S]*Usage: `@PostHog count <event> \[days\]`/);
  });
});

describe('the Cal.com agent', () => {
  let agent: Member;
  beforeAll(async () => {
    agent = await addAgent('Cal', 'cal', GOOD_CAL);
  });

  it("lists today's bookings in the owner's time zone, with their ids", async () => {
    const { reply } = await ask(`${mention(agent)} today`);
    expect(reply?.body).toMatch(/^Today:\n- \*\*.+ (EDT|EST)\*\*: Intro call with Jane · \[join\]\(https:\/\/meet\.example\.com\/x\) · `bk_1`$/);
    const listed = cal.calls.find((c) => c.method === 'GET' && c.path.startsWith('/bookings'))!;
    expect(listed.headers['cal-api-version']).toBe('2026-05-01');
  });

  it('gives booking links', async () => {
    expect((await ask(`${mention(agent)} links`)).reply?.body).toBe('- **Intro call** (`intro`, 30 min): https://cal.com/arjun/intro');
  });

  it("books at a wall-clock time in the owner's zone", async () => {
    const { reply } = await ask(`${mention(agent)} book intro 2026-10-05T15:00 jane@example.com Jane Doe`);
    expect(reply?.body).toMatch(/^Booked: \*\*Intro call\*\*, Mon, Oct 5, 3:00 PM EDT with jane@example.com · `bk_2`$/);
    const booked = cal.calls.find((c) => c.method === 'POST' && c.path === '/bookings')!;
    expect(booked.body).toEqual({ eventTypeId: 10, start: '2026-10-05T19:00:00.000Z', attendee: { name: 'Jane Doe', email: 'jane@example.com', timeZone: 'America/New_York' } });
  });

  it('cancels with a reason, and names an event type it does not have', async () => {
    expect((await ask(`${mention(agent)} cancel bk_1 moved to next week`)).reply?.body).toBe('Cancelled `bk_1`.');
    expect(cal.calls.find((c) => c.path === '/bookings/bk_1/cancel')!.body).toEqual({ cancellationReason: 'moved to next week' });
    expect((await ask(`${mention(agent)} slots demo`)).reply?.body).toMatch(/There's no event type "demo". Yours: intro\./);
  });

  it('fails fast and marks the key rejected when Cal.com stops accepting it', async () => {
    calRevoked = true;
    const { invocation, reply } = await ask(`${mention(agent)} today`);
    calRevoked = false;
    expect(invocation).toMatchObject({ state: 'failed', error: expect.stringMatching(/Cal.com did not accept my key \(API key revoked\)\. Its owner needs to replace the key in Agents\./) });
    expect(reply).toBeUndefined();
    const listed = (await as('dev-ramnique').get('/v1/agents')).body.agents.find((a: { agent: Member }) => a.agent.id === agent.id);
    expect(listed.credential.rejectedReason).toMatch(/API key revoked/);
    expect((await as('dev-ramnique').put(`/v1/agents/${agent.id}/credential`, { secret: GOOD_CAL })).status).toBe(200);
    expect((await ask(`${mention(agent)} links`)).invocation.state).toBe('done');
  });
});

describe('alert hooks', () => {
  let agent: Member;
  let url = '';
  beforeAll(async () => {
    agent = (await as('dev-ramnique').get('/v1/agents')).body.agents.find((a: { agent: Member }) => a.agent.agentConnection === 'cal').agent;
  });

  it('are set by the owner, in a space with the agent, and shown once', async () => {
    expect((await as('dev-harsh').put(`/v1/agents/${agent.id}/hook`, { spaceId })).status).toBe(403);
    const other = (await as('dev-ramnique').post('/v1/spaces', { name: 'Elsewhere' })).body.space.id;
    expect(await as('dev-ramnique').put(`/v1/agents/${agent.id}/hook`, { spaceId: other })).toMatchObject({ status: 400, body: { message: 'add Cal to the space first' } });
    const set = await as('dev-ramnique').put(`/v1/agents/${agent.id}/hook`, { spaceId });
    expect(set.status).toBe(200);
    url = set.body.url;
    expect(url).toMatch(new RegExp(`/v1/hooks/${agent.id}/rbh_[A-Za-z0-9_-]{43}$`));
    const listed = (await as('dev-ramnique').get('/v1/agents')).body.agents.find((a: { agent: Member }) => a.agent.id === agent.id);
    expect(listed.hook).toEqual({ spaceId, setBy: 'ramnique', setAt: expect.any(String) });
    expect(JSON.stringify(listed)).not.toContain('rbh_');
  });

  it("post the service's alert into the space as the agent, without a bearer", async () => {
    const path = new URL(url).pathname;
    const r = await hook(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { title: 'Intro call', startTime: '2026-10-05T19:00:00Z', organizer: { timeZone: 'America/New_York' }, attendees: [{ name: 'Jane' }] } }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ posted: true });
    const stream = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/stream?limit=5`)).body.messages as Message[];
    const alert = stream.find((m) => m.author.memberId === agent.id && !m.threadRoot);
    expect(alert?.body).toBe('📅 New booking: **Intro call**, Mon, Oct 5, 3:00 PM EDT with Jane');
  });

  it('refuse a wrong secret like an unknown agent, and say nothing for an unknown event', async () => {
    const send = (path: string, body: unknown) => hook(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await send(`/v1/hooks/${agent.id}/rbh_wrong`, { triggerEvent: 'PING' })).status).toBe(404);
    expect((await send(`/v1/hooks/nobody/rbh_wrong`, { triggerEvent: 'PING' })).status).toBe(404);
    const path = new URL(url).pathname;
    expect(await (await send(path, { hello: 'world' })).json()).toEqual({ posted: false });
    expect((await hook(path, { method: 'POST', body: 'not json' })).status).toBe(400);
  });

  it('stop working once replaced or turned off', async () => {
    const path = new URL(url).pathname;
    const again = await as('dev-ramnique').put(`/v1/agents/${agent.id}/hook`, { spaceId });
    const send = (p: string) => hook(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ triggerEvent: 'PING' }) });
    expect((await send(path)).status).toBe(404);
    const fresh = new URL(again.body.url).pathname;
    expect((await send(fresh)).status).toBe(200);
    expect(await remove('dev-harsh', `/v1/agents/${agent.id}/hook`)).toBe(403);
    expect(await remove('dev-gagan', `/v1/agents/${agent.id}/hook`)).toBe(200);
    expect((await send(fresh)).status).toBe(404);
  });
});

describe('integration pieces', () => {
  it('reads the command without the agent’s own mention', () => {
    expect(commandText('[@Cal](#member:a1)  book intro with [@Jane](#member:j)', 'a1')).toBe('book intro with @Jane');
  });

  it('turns a wall-clock time in a zone into the instant, across DST', () => {
    expect(zonedToUtc('2026-10-05T15:00:00', 'America/New_York').toISOString()).toBe('2026-10-05T19:00:00.000Z');
    expect(zonedToUtc('2026-12-05T15:00:00', 'America/New_York').toISOString()).toBe('2026-12-05T20:00:00.000Z');
    expect(zonedToUtc('2026-10-05T09:30:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-05T04:00:00.000Z');
  });

  it('quotes HogQL strings', () => {
    expect(hogqlString("it's \\ here")).toBe("'it\\'s \\\\ here'");
  });

  it('says Cal.com alerts by trigger, and PostHog alerts by what the template sent', () => {
    expect(calAlert({ triggerEvent: 'PING', payload: {} })).toMatch(/connected/);
    expect(calAlert({ triggerEvent: 'BOOKING_CANCELLED', payload: { title: 'Intro', cancellationReason: 'sick' } })).toBe('❌ Cancelled: **Intro**\n> sick');
    expect(calAlert({ triggerEvent: 'MEETING_ENDED', title: 'Intro' })).toBe('⏹️ Meeting ended: **Intro**');
    expect(calAlert({ hello: 1 })).toBeUndefined();
    expect(posthogAlert({ text: 'Signups dropped 40%' })).toBe('Signups dropped 40%');
    expect(posthogAlert({ event: { event: '$insight_alert_firing', properties: { alert_name: 'Signups low', insight_name: 'Weekly signups', insight_url: 'https://us.posthog.com/x' } } })).toBe(
      '🔔 **Signups low** on Weekly signups ($insight_alert_firing)\nhttps://us.posthog.com/x',
    );
    expect(posthogAlert({ other: true })).toMatch(/^🔔 PostHog sent:/);
  });
});
