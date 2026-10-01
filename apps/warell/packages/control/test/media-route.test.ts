import { describe, expect, it } from 'vitest';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { createApp } from '../src/app.js';
import { MemoryStore, hashToken, type Account, type Plan } from '../src/store.js';

const T0 = Date.UTC(2026, 8, 30, 8, 0, 0);
const plan = (id: string, category: Plan['category'], weekUsd: number): Plan =>
  ({ id, category, displayName: id, weekCredits: weekUsd * CREDITS_PER_DOLLAR, monthlyPrices: [], models: null });
const PLANS = [plan('pro', 'pro', 20), plan('small', 'starter', 2), plan('free', 'free', 1)];

interface Seen { url: string; init: RequestInit }

function setup(respond: (s: Seen) => Response, opts: { planId?: string; key?: string | null } = {}) {
  const accounts = new Map<string, Account>([
    [hashToken('me'), { id: 'me', email: null, planId: opts.planId ?? 'pro', createdAt: T0 }],
    [hashToken('other'), { id: 'other', email: null, planId: 'pro', createdAt: T0 }],
  ]);
  const store = new MemoryStore(accounts, PLANS);
  const seen: Seen[] = [];
  const app = createApp({
    store, openRouterKey: 'or', publicUrl: 'https://c.test', appName: 'Warell', now: () => T0,
    pixazoKey: opts.key === null ? undefined : (opts.key ?? 'pz-secret'),
    fetch: (async (url: string, init: RequestInit = {}) => { const s = { url: String(url), init }; seen.push(s); return respond(s); }) as typeof fetch,
  });
  const call = (path: string, init: RequestInit = {}, token = 'me') =>
    app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const generate = (body: unknown, token = 'me') => call('/v1/media/generations', { method: 'POST', body: JSON.stringify(body) }, token);
  return { store, seen, call, generate };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const used = async (store: MemoryStore) => (await store.quotaState('me'))?.weekUsed ?? 0;

describe('/v1/media', () => {
  it('submits with our key, charges the price and answers 202', async () => {
    const { generate, seen, store } = setup(() => json({ request_id: 'job1' }));
    const res = await generate({ model: 'veo-fast', prompt: 'Un marché', duration: 4 });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ id: 'job1', status: 'pending', model: 'veo-fast', kind: 'video' });
    expect(seen[0].url).toBe('https://gateway.pixazo.ai/veo31f/v1/veo-3.1-fast/generate');
    expect((seen[0].init.headers as Record<string, string>)['ocp-apim-subscription-key']).toBe('pz-secret');
    expect(JSON.parse(seen[0].init.body as string)).toMatchObject({ prompt: 'Un marché', duration: 4, resolution: '720p', generate_audio: false });
    expect(await used(store)).toBe(Math.ceil(0.4 * CREDITS_PER_DOLLAR));
    expect(store.usage[0]).toMatchObject({ path: '/media/video', model: 'veo-fast', status: 202 });
  });

  it('follows the job to its file', async () => {
    let status = 'IN_PROGRESS';
    const { generate, call, seen } = setup((s) => s.url.includes('/v2/requests/status/')
      ? json({ status, output: { media_url: ['https://cdn.test/v.mp4'] } })
      : json({ request_id: 'job1' }));
    await generate({ model: 'lyria', prompt: 'Coupé-décalé' });
    expect(await (await call('/v1/media/generations/job1')).json()).toMatchObject({ status: 'processing', url: null });
    status = 'COMPLETED';
    expect(await (await call('/v1/media/generations/job1')).json()).toMatchObject({ status: 'completed', url: 'https://cdn.test/v.mp4' });
    const polls = seen.length;
    await call('/v1/media/generations/job1');
    expect(seen.length).toBe(polls); // finished: not asked again
  });

  it('refunds a failed job once', async () => {
    const { generate, call, store } = setup((s) => s.url.includes('/status/') ? json({ status: 'FAILED' }) : json({ request_id: 'job1' }));
    await generate({ model: 'lyria', prompt: 'x' });
    expect(await used(store)).toBeGreaterThan(0);
    expect(await (await call('/v1/media/generations/job1')).json()).toMatchObject({ status: 'failed' });
    await call('/v1/media/generations/job1');
    expect(await used(store)).toBe(0);
    expect(store.usage.filter((u) => u.path === '/media/refund')).toHaveLength(1);
  });

  it('treats a completed job without a file as failed', async () => {
    const { generate, call, store } = setup((s) => s.url.includes('/status/') ? json({ status: 'COMPLETED', output: {} }) : json({ request_id: 'job1' }));
    await generate({ model: 'lyria', prompt: 'x' });
    expect(await (await call('/v1/media/generations/job1')).json()).toMatchObject({ status: 'failed' });
    expect(await used(store)).toBe(0);
  });

  it('refunds when Pixazo refuses the submission', async () => {
    const { generate, store } = setup(() => json({ message: 'no' }, 400));
    expect((await generate({ model: 'lyria', prompt: 'x' })).status).toBe(502);
    expect(await used(store)).toBe(0);
  });

  it("hides someone else's job", async () => {
    const { generate, call } = setup(() => json({ request_id: 'job1' }));
    await generate({ model: 'lyria', prompt: 'x' });
    expect((await call('/v1/media/generations/job1', {}, 'other')).status).toBe(404);
  });

  it('refuses what does not fit, and says whether waiting helps', async () => {
    const { generate, seen } = setup(() => json({ request_id: 'j' }), { planId: 'small' });
    // Week of 2 $, session of 0.50 $: a 3.20 $ Veo never fits.
    const over = await generate({ model: 'veo', prompt: 'x' });
    expect(over.status).toBe(403);
    expect((await over.json()).error).toMatchObject({ code: 'over_plan', window: 'week' });
    expect((await generate({ model: 'veo-fast', prompt: 'x', duration: 4 })).status).toBe(202);
    const full = await generate({ model: 'veo-fast', prompt: 'x', duration: 4 });
    expect(full.status).toBe(429);
    expect((await full.json()).error).toMatchObject({ code: 'quota_reached', window: 'session' });
    expect(seen).toHaveLength(1);
  });

  it('is not part of Découverte, and is off without a key', async () => {
    const free = setup(() => json({}), { planId: 'free' });
    expect((await free.generate({ model: 'lyria', prompt: 'x' })).status).toBe(403);
    expect(await (await free.call('/v1/media/models')).json()).toEqual({ data: [] });
    const off = setup(() => json({}), { key: null });
    expect((await off.generate({ model: 'lyria', prompt: 'x' })).status).toBe(503);
    expect(free.seen.length + off.seen.length).toBe(0);
  });

  it('lists the models with their kind and durations', async () => {
    const { call } = setup(() => json({}));
    const { data } = await (await call('/v1/media/models')).json();
    expect(data.find((m: { id: string }) => m.id === 'veo-fast')).toEqual({ id: 'veo-fast', kind: 'video', name: 'Veo 3.1 Fast', durations: [8, 4, 6] });
  });

  it('refuses a bad request before charging', async () => {
    const { generate, store } = setup(() => json({ request_id: 'j' }));
    expect((await generate({ model: 'veo-fast', prompt: 'x', duration: 7 })).status).toBe(400);
    expect(await store.quotaState('me')).toBeNull();
  });
});
