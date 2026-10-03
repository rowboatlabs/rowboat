import { describe, expect, it } from 'vitest';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { createApp } from '../src/app.js';
import { MemoryStore, hashToken, type Account, type Plan } from '../src/store.js';

const T0 = Date.UTC(2026, 8, 30, 8, 0, 0);
const plan = (id: string, category: Plan['category'], weekUsd: number): Plan =>
  ({ id, category, displayName: id, weekCredits: weekUsd * CREDITS_PER_DOLLAR, monthlyPrices: [], models: null });
const PLANS = [plan('pro', 'pro', 20), plan('small', 'starter', 2), plan('free', 'free', 1)];

interface Seen { url: string; init: RequestInit }

function setup(respond: (s: Seen) => Response, opts: { planId?: string; key?: string | null; credits?: number; admin?: string } = {}) {
  const accounts = new Map<string, Account>([
    [hashToken('me'), { id: 'me', email: null, planId: opts.planId ?? 'pro', createdAt: T0 }],
    [hashToken('other'), { id: 'other', email: null, planId: 'pro', createdAt: T0 }],
  ]);
  const store = new MemoryStore(accounts, PLANS);
  const credits = opts.credits ?? 1000;
  if (credits > 0) void store.applyMediaEntry({ accountId: 'me', at: T0, kind: 'topup', credits, reference: 'seed' });
  const seen: Seen[] = [];
  const app = createApp({
    store, openRouterKey: 'or', publicUrl: 'https://c.test', appName: 'Baarali', now: () => T0,
    pixazoKey: opts.key === null ? undefined : (opts.key ?? 'pz-secret'),
    mediaPacks: [{ id: 'medias-5', credits: 203, prices: [{ amount: 500, currency: 'EUR' }] }],
    adminTokenHash: opts.admin ? hashToken(opts.admin) : undefined,
    fetch: (async (url: string, init: RequestInit = {}) => { const s = { url: String(url), init }; seen.push(s); return respond(s); }) as typeof fetch,
  });
  const call = (path: string, init: RequestInit = {}, token = 'me') =>
    app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const generate = (body: unknown, token = 'me') => call('/v1/media/generations', { method: 'POST', body: JSON.stringify(body) }, token);
  const topUp = (body: unknown, token: string) =>
    app.request('/v1/admin/media-credits', { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  return { store, seen, call, generate, topUp };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const balance = (store: MemoryStore) => store.mediaBalance('me');

describe('/v1/media', () => {
  it('submits with our key, charges the price and answers 202', async () => {
    const { generate, seen, store } = setup(() => json({ request_id: 'job1' }));
    const res = await generate({ model: 'veo-fast', prompt: 'Un marché', duration: 4 });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ id: 'job1', status: 'pending', model: 'veo-fast', kind: 'video', credits: 40, balance: 960 });
    expect(seen[0].url).toBe('https://gateway.pixazo.ai/veo31f/v1/veo-3.1-fast/generate');
    expect((seen[0].init.headers as Record<string, string>)['ocp-apim-subscription-key']).toBe('pz-secret');
    expect(JSON.parse(seen[0].init.body as string)).toMatchObject({ prompt: 'Un marché', duration: 4, resolution: '720p', generate_audio: false });
    expect(await balance(store)).toBe(960);
    // The text quota is untouched; the usage record keeps our cost in its unit.
    expect(await store.quotaState('me')).toBeNull();
    expect(store.usage[0]).toMatchObject({ path: '/media/video', model: 'veo-fast', status: 202, credits: 0.4 * CREDITS_PER_DOLLAR });
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
    expect(await balance(store)).toBe(995);
    expect(await (await call('/v1/media/generations/job1')).json()).toMatchObject({ status: 'failed' });
    await call('/v1/media/generations/job1');
    expect(await balance(store)).toBe(1000);
    expect(store.ledger.filter((e) => e.kind === 'refund')).toHaveLength(1);
  });

  it('treats a completed job without a file as failed', async () => {
    const { generate, call, store } = setup((s) => s.url.includes('/status/') ? json({ status: 'COMPLETED', output: {} }) : json({ request_id: 'job1' }));
    await generate({ model: 'lyria', prompt: 'x' });
    expect(await (await call('/v1/media/generations/job1')).json()).toMatchObject({ status: 'failed' });
    expect(await balance(store)).toBe(1000);
  });

  it('refunds when Pixazo refuses the submission', async () => {
    const { generate, store } = setup(() => json({ message: 'no' }, 400));
    expect((await generate({ model: 'lyria', prompt: 'x' })).status).toBe(502);
    expect(await balance(store)).toBe(1000);
  });

  it("hides someone else's job", async () => {
    const { generate, call } = setup(() => json({ request_id: 'job1' }));
    await generate({ model: 'lyria', prompt: 'x' });
    expect((await call('/v1/media/generations/job1', {}, 'other')).status).toBe(404);
  });

  it('refuses what the balance cannot pay, before calling Pixazo', async () => {
    const { generate, seen, store } = setup(() => json({ request_id: 'j' }), { credits: 45 });
    expect((await generate({ model: 'veo-fast', prompt: 'x', duration: 4 })).status).toBe(202);
    const short = await generate({ model: 'veo-fast', prompt: 'x', duration: 4 });
    expect(short.status).toBe(402);
    expect((await short.json()).error).toMatchObject({ code: 'insufficient_media_credits', cost: 40, balance: 5 });
    expect(seen).toHaveLength(1);
    expect(await balance(store)).toBe(5);
  });

  it('is open to every plan with credits, and off without a key', async () => {
    const free = setup(() => json({ request_id: 'j' }), { planId: 'free' });
    expect((await free.generate({ model: 'lyria', prompt: 'x' })).status).toBe(202);
    const off = setup(() => json({}), { key: null });
    expect((await off.generate({ model: 'lyria', prompt: 'x' })).status).toBe(503);
    expect(await (await off.call('/v1/media/models')).json()).toEqual({ data: [], balance: 1000 });
    expect(off.seen).toHaveLength(0);
  });

  it('shows the balance and the packs', async () => {
    const { call } = setup(() => json({}), { credits: 12 });
    expect(await (await call('/v1/media/balance')).json()).toEqual({ credits: 12 });
    expect((await (await call('/v1/media/packs')).json()).data[0]).toMatchObject({ id: 'medias-5', credits: 203 });
  });

  it('tells what the credits went to, with the kind of media', async () => {
    const { generate, call } = setup(() => json({ request_id: 'job1' }));
    await generate({ model: 'veo-fast', prompt: 'Un marché', duration: 4 });
    const { data } = await (await call('/v1/media/history')).json();
    expect(data[0]).toMatchObject({ kind: 'charge', credits: -40, media: 'video', model: 'Veo 3.1 Fast' });
    expect(data[1]).toMatchObject({ kind: 'topup', credits: 1000, media: null, model: null });
  });

  it('lists the models with their kind and durations', async () => {
    const { call } = setup(() => json({}));
    const { data } = await (await call('/v1/media/models')).json();
    expect(data.find((m: { id: string }) => m.id === 'veo-fast')).toEqual({ id: 'veo-fast', kind: 'video', name: 'Veo 3.1 Fast', durations: [8, 4, 6], credits: 80 });
  });

  it('refuses a bad request before charging', async () => {
    const { generate, store } = setup(() => json({ request_id: 'j' }));
    expect((await generate({ model: 'veo-fast', prompt: 'x', duration: 7 })).status).toBe(400);
    expect(await balance(store)).toBe(1000);
  });
});

describe('/v1/admin/media-credits', () => {
  it('adds a pack once per payment reference', async () => {
    const { topUp, store } = setup(() => json({}), { credits: 0, admin: 'op' });
    const body = { account_id: 'me', pack: 'medias-5', reference: 'ligdi-123' };
    expect(await (await topUp(body, 'op')).json()).toEqual({ added: 203, duplicate: false, balance: 203 });
    expect(await (await topUp(body, 'op')).json()).toEqual({ added: 0, duplicate: true, balance: 203 });
    expect(await store.mediaBalance('me')).toBe(203);
  });

  it('refuses a bad pack or an unknown account', async () => {
    const { topUp } = setup(() => json({}), { admin: 'op' });
    expect((await topUp({ account_id: 'me', pack: 'medias-999', reference: 'r' }, 'op')).status).toBe(400);
    expect((await topUp({ account_id: 'nobody', pack: 'medias-5', reference: 'r' }, 'op')).status).toBe(404);
  });

  it('does not exist without the operator token, or without one configured', async () => {
    const body = { account_id: 'me', pack: 'medias-5', reference: 'r' };
    expect((await setup(() => json({}), { admin: 'op' }).topUp(body, 'me')).status).toBe(404);
    expect((await setup(() => json({})).topUp(body, 'op')).status).toBe(404);
  });
});
