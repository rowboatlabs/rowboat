import { describe, expect, it } from 'vitest';
import { BillingInfoSchema, BillingUsageBucketSchema, CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { RowboatApiConfig } from '@x/shared/dist/rowboat-account.js';
import { createApp } from '../src/app.js';
import { DISCOVERY_MODELS } from '../src/catalog.js';
import { FLOOR_CREDITS, SESSION_MS, WEEK_MS } from '../src/quota.js';
import { MemoryStore, hashToken, type Account, type Plan } from '../src/store.js';

const T0 = Date.UTC(2026, 8, 30, 8, 0, 0);
const TOKEN = 'instance-token';
const plan: Plan = { id: 'p', category: 'starter', displayName: 'P', weekCredits: 4 * CREDITS_PER_DOLLAR, monthlyPrices: [{ amount: 4900, currency: 'EUR' }], models: null };
const freePlan: Plan = { id: 'free', category: 'free', displayName: 'F', weekCredits: 4 * CREDITS_PER_DOLLAR, monthlyPrices: [], models: DISCOVERY_MODELS };
const owner: Account = { id: 'acc', email: 'owner@example.test', planId: 'p', createdAt: T0 };

interface Seen { url: string; init: RequestInit }

function setup(respond: (seen: Seen) => Response | Promise<Response>, planId = 'p', adminEmails: string[] = []) {
  const store = new MemoryStore(new Map([[hashToken(TOKEN), { ...owner, planId }]]), [plan, freePlan]);
  const seen: Seen[] = [];
  let clock = T0;
  const app = createApp({
    store,
    openRouterKey: 'or-secret',
    publicUrl: 'https://control.example.test',
    appName: 'Baarali',
    mediaPacks: [],
    adminEmails,
    now: () => clock,
    fetch: (async (url: string, init: RequestInit) => {
      const s = { url: String(url), init };
      seen.push(s);
      return respond(s);
    }) as typeof fetch,
  });
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    app.request(path, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) },
    });
  return { store, seen, call, tick: (ms: number) => { clock += ms; } };
}

const chat = (extra: Record<string, unknown> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-rowboat-use-case': 'chat', 'x-rowboat-agent-name': 'copilot' },
  body: JSON.stringify({ model: 'vendor/model', messages: [], ...extra }),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('GET /v1/config (contract)', () => {
  it('parses with the upstream schema and serves the plans in its shape', async () => {
    const { call } = setup(() => json({}));
    const body = await (await call('/v1/config', {}, null)).json();
    const parsed = RowboatApiConfig.parse(body);
    expect(parsed.billing.plans[0]).toEqual(
      { id: 'p', category: 'starter', displayName: 'P', monthlyCredits: plan.weekCredits, dailyCredits: plan.weekCredits / 4, monthlyPriceCents: 4900 },
    );
  });
});

describe('GET /v1/me (contract)', () => {
  it('refuses a missing or unknown token', async () => {
    const { call } = setup(() => json({}));
    expect((await call('/v1/me', {}, null)).status).toBe(401);
    expect((await call('/v1/me', {}, 'nope')).status).toBe(401);
  });

  it('serves the session as daily and the week as monthly, in the upstream bucket schema', async () => {
    const { call } = setup(() => json({ usage: { cost: 0.5 } }));
    await call('/v1/llm/chat/completions', chat());
    const body = await (await call('/v1/me')).json();
    expect(body.user).toEqual({ id: 'acc', email: 'owner@example.test' });
    expect(body.billing.planId).toBe('p');
    const monthly = BillingUsageBucketSchema.parse(body.billing.usage.monthly);
    const daily = BillingInfoSchema.shape.daily.parse(body.billing.usage.daily);
    expect(monthly.usedCredits).toBe(0.5 * CREDITS_PER_DOLLAR);
    expect(daily.sanctionedCredits).toBe(CREDITS_PER_DOLLAR);
    expect(body.billing.usage.daily.usageDay).toBe(new Date(T0 + SESSION_MS).toISOString());
    // When each window starts over, for the app to say it.
    expect(daily.resetsAt).toBe(new Date(T0 + SESSION_MS).toISOString());
    expect(monthly.resetsAt).toBe(new Date(T0 + WEEK_MS).toISOString());
  });

  it('points an admin, and only an admin, to the console', async () => {
    const admin = await (await setup(() => json({}), 'p', ['owner@example.test']).call('/v1/me')).json();
    expect(admin.admin).toEqual({ url: 'https://control.example.test/admin' });
    const client = await (await setup(() => json({}), 'p', ['boss@example.test']).call('/v1/me')).json();
    expect(client.admin).toBeUndefined();
  });

  it('gives no end to a session not open yet', async () => {
    const { call } = setup(() => json({}));
    const body = await (await call('/v1/me')).json();
    expect(body.billing.usage.daily.resetsAt).toBeUndefined();
    expect(body.billing.usage.monthly.resetsAt).toBeDefined();
  });
});

describe('/v1/llm proxy', () => {
  it('forwards to OpenRouter with our key, asks for the cost and counts it', async () => {
    const { call, seen, store } = setup(() => json({ id: 'x', usage: { cost: 0.02 } }));
    const res = await call('/v1/llm/chat/completions', chat({ usage: { foo: 1 } }));
    expect(res.status).toBe(200);
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer or-secret');
    expect(JSON.stringify(seen[0].init.headers)).not.toContain(TOKEN);
    expect(JSON.parse(seen[0].init.body as string).usage).toEqual({ foo: 1, include: true });
    expect(store.usage).toEqual([expect.objectContaining({
      accountId: 'acc', model: 'vendor/model', status: 200, credits: 0.02 * CREDITS_PER_DOLLAR,
      estimated: false, useCase: 'chat', agentName: 'copilot', path: '/chat/completions',
    })]);
  });

  it('streams through and counts the cost from the last SSE chunk', async () => {
    const { call, store } = setup(() => sse([
      'data: {"choices":[{"delta":{"content":"Bon"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"co',
      'st":0.004}}\n\ndata: [DONE]\n\n',
    ]));
    const res = await call('/v1/llm/chat/completions', chat({ stream: true }));
    const text = await res.text();
    expect(text).toContain('Bon');
    expect(text).toContain('[DONE]');
    expect(store.usage[0]).toMatchObject({ credits: 0.004 * CREDITS_PER_DOLLAR, estimated: false });
  });

  it('refuses with 429 once the session is spent, without calling OpenRouter', async () => {
    const { call, seen, tick } = setup(() => json({ usage: { cost: 1 } }));
    expect((await call('/v1/llm/chat/completions', chat())).status).toBe(200);
    tick(60_000);
    const res = await call('/v1/llm/chat/completions', chat());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: {
      code: 'quota_reached', window: 'session', resets_at: new Date(T0 + SESSION_MS).toISOString(),
      message: 'Usage limit reached for this session',
    } });
    expect(seen).toHaveLength(1);
    tick(SESSION_MS);
    expect((await call('/v1/llm/chat/completions', chat())).status).toBe(200);
  });

  it('does not count a failed call', async () => {
    const { call, store } = setup(() => json({ error: { message: 'boom' } }, 500));
    expect((await call('/v1/llm/chat/completions', chat())).status).toBe(500);
    expect(store.usage[0]).toMatchObject({ status: 500, credits: 0 });
  });

  it('counts the floor when a success carries no cost', async () => {
    const { call, store } = setup(() => json({ id: 'x' }));
    await call('/v1/llm/chat/completions', chat());
    expect(store.usage[0]).toMatchObject({ credits: FLOOR_CREDITS, estimated: true });
  });

  it('counts the floor when the client leaves mid-stream', async () => {
    const { call, store } = setup(() => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n')); },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const res = await call('/v1/llm/chat/completions', chat({ stream: true }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(store.usage[0]).toMatchObject({ credits: FLOOR_CREDITS, estimated: true });
  });

  it('lets the model catalog through, unmetered, with its query', async () => {
    const { call, seen, store } = setup(() => json({ data: [{ id: 'a/b' }] }));
    const res = await call('/v1/llm/models?output_modalities=image');
    // With what the picker needs beside the id (model-access.ts).
    expect(await res.json()).toEqual({ data: [{ id: 'a/b', baarali: { vendor: 'a', vendorName: 'A', vendorRank: 0, strength: 'Polyvalent', recommended: false } }] });
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/models?output_modalities=image');
    expect(store.usage).toHaveLength(0);
  });

  it('answers 502 when OpenRouter is unreachable', async () => {
    const { call, store } = setup(() => { throw new Error('down'); });
    expect((await call('/v1/llm/chat/completions', chat())).status).toBe(502);
    expect(store.usage[0]).toMatchObject({ status: 502, credits: 0 });
  });
});

describe('/v1/llm on a plan with a model policy (Découverte)', () => {
  const [first, second] = DISCOVERY_MODELS.models;
  const sent = (s: Seen) => JSON.parse(s.init.body as string);

  it('replaces a model outside the list by the default, with the fallback and reasoning off', async () => {
    const { call, seen, store } = setup(() => json({ usage: { cost: 0.0001 } }), 'free');
    expect((await call('/v1/llm/chat/completions', chat({ model: 'anthropic/claude-opus-4.7' }))).status).toBe(200);
    expect(sent(seen[0])).toMatchObject({ model: first, models: [first, second], reasoning: { enabled: false }, usage: { include: true } });
    expect(store.usage[0]).toMatchObject({ model: first, requestedModel: 'anthropic/claude-opus-4.7' });
  });

  it('keeps a listed model, the others behind it', async () => {
    const { call, seen, store } = setup(() => json({ usage: { cost: 0.0001 } }), 'free');
    await call('/v1/llm/chat/completions', chat({ model: second, reasoning: { effort: 'high' } }));
    expect(sent(seen[0])).toMatchObject({ model: second, models: [second, first], reasoning: { enabled: false } });
    expect(store.usage[0]).toMatchObject({ model: second, requestedModel: null });
  });

  it('refuses image generation and other endpoints without opening a session', async () => {
    const { call, seen, store } = setup(() => json({}), 'free');
    const image = await call('/v1/llm/chat/completions', chat({ modalities: ['image', 'text'] }));
    expect(image.status).toBe(403);
    expect((await image.json()).error.code).toBe('not_in_plan');
    expect((await call('/v1/llm/embeddings', chat())).status).toBe(403);
    expect(seen).toHaveLength(0);
    expect(await store.quotaState('acc')).toBeNull();
  });

  it('shows only its models in the catalog', async () => {
    const { call } = setup(() => json({ data: [{ id: first }, { id: 'anthropic/claude-opus-4.7' }, { id: second }] }), 'free');
    const { data } = (await (await call('/v1/llm/models')).json()) as { data: Array<{ id: string }> };
    expect(data.map((m) => m.id)).toEqual([first, second]);
  });

  it('leaves paid plans free to pick any model', async () => {
    const { call, seen } = setup(() => json({ usage: { cost: 0.0001 } }));
    await call('/v1/llm/chat/completions', chat({ model: 'anthropic/claude-opus-4.7' }));
    expect(sent(seen[0]).model).toBe('anthropic/claude-opus-4.7');
    expect(sent(seen[0]).models).toBeUndefined();
  });
  it('sends a paid plan\'s model OpenRouter withdrew to the default, once the app has read the list', async () => {
    const { call, seen, store } = setup((s) =>
      s.url.endsWith('/models') ? json({ data: [{ id: first }, { id: 'anthropic/claude-opus-4.7' }] }) : json({ usage: { cost: 0.0001 } }),
    );
    await call('/v1/llm/chat/completions', chat({ model: 'x-ai/withdrawn-alpha' }));
    // The list not read yet: the call goes as it came.
    expect(sent(seen[0]).model).toBe('x-ai/withdrawn-alpha');
    // OpenRouter's own models are closed until the owner opens one.
    await call('/v1/llm/chat/completions', chat({ model: 'openrouter/space-bunny-alpha' }));
    expect(sent(seen[1]).model).toBe(first);
    await call('/v1/llm/models');
    await call('/v1/llm/chat/completions', chat({ model: 'x-ai/withdrawn-alpha' }));
    expect(sent(seen.at(-1)!).model).toBe(first);
    expect(store.usage.at(-1)).toMatchObject({ model: first, requestedModel: 'x-ai/withdrawn-alpha' });
  });
});
