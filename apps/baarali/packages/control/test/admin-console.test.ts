import { describe, expect, it } from 'vitest';
import { adminPage, deniedPage } from '../src/admin-page.js';
import { createApp } from '../src/app.js';
import { selectAccountPage } from '../src/sign-in-page.js';
import type { BaaraliAuth, SessionUser } from '../src/auth.js';
import type { FlyApi, MachineConfig } from '../src/fly.js';
import { createGateway } from '../src/gateway.js';
import { Instances } from '../src/instances.js';
import { MemoryStore, hashToken, type Account, type Plan } from '../src/store.js';

// The admin console (/admin, decided 03/10/2026): who opens it, what each
// action changes, and the journal that keeps every one of them.

const T0 = Date.UTC(2026, 9, 3, 8, 0, 0);
const FREE: Plan = { id: 'decouverte', category: 'free', displayName: 'Découverte', weekCredits: 1_000_000, monthlyPrices: [], models: { models: ['deepseek/flash'], settings: { reasoning: { enabled: false } } } };
const PRO100: Plan = { id: 'pro-100', category: 'pro', displayName: 'Pro', weekCredits: 25_000_000, monthlyPrices: [{ amount: 10000, currency: 'EUR' }], models: null };
const PRO: Plan = { id: 'pro-200', category: 'pro', displayName: 'Pro', weekCredits: 50_000_000, monthlyPrices: [{ amount: 20000, currency: 'EUR' }], models: null };
const OWNER: Account = { id: 'acc_owner', email: 'boss@example.test', planId: 'decouverte', createdAt: T0 };
const AWA: Account = { id: 'acc_awa', email: 'awa@example.test', planId: 'decouverte', createdAt: T0 + 1000 };

const UPSTREAM = [
  { id: 'openai/gpt-6', name: 'OpenAI: GPT-6', pricing: { prompt: '0.000002', completion: '0.00001' } },
  { id: 'deepseek/flash', name: 'DeepSeek: Flash', pricing: { prompt: '0.0000001', completion: '0.0000004' } },
  { id: 'anthropic/opus', name: 'Anthropic: Claude Opus', pricing: { prompt: '0.000015', completion: '0.000075' } },
  { id: 'anthropic/sonnet', name: 'Anthropic: Claude Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
];

// The browser's session, played by a cookie naming who is signed in.
const SESSIONS: Record<string, SessionUser> = {
  boss: { id: OWNER.id, email: 'Boss@example.test', emailVerified: true },
  unproved: { id: 'u_x', email: 'boss@example.test', emailVerified: false },
  awa: { id: AWA.id, email: AWA.email, emailVerified: true },
};

const auth: BaaraliAuth = {
  methods: { email: true, phone: false, social: [] },
  handle: async () => new Response(null, { status: 404 }),
  userIdForAccessToken: async (t) => ({ 'at-awa': AWA.id })[t] ?? null,
  spacesTokenFor: async () => null,
  sessionUser: async (headers) => SESSIONS[headers.get('cookie')?.match(/session=(\w+)/)?.[1] ?? ''] ?? null,
};

function setup(opts: { adminEmails?: string[]; noAuth?: boolean } = {}) {
  const calls: string[] = [];
  const fly: FlyApi = {
    createVolume: async () => ({ id: 'vol_1' }),
    createMachine: async (_app, { config }: { region: string; config: MachineConfig }) => ({ id: 'm_1', state: 'started', config }),
    machine: async (_app, id) => ({ id, state: id === 'm_broken' ? 'failed' : 'suspended', config: { image: 'registry.fly.io/baarali-instances:v10' } }),
    updateMachine: async (_app, id, config) => {
      calls.push(`update ${id} ${config.image}`);
      return { id, state: 'started', config };
    },
    start: async (_app, id) => void calls.push(`start ${id}`),
    restart: async (_app, id) => void calls.push(`restart ${id}`),
    waitStarted: async () => {},
  };
  const store = new MemoryStore(new Map([[hashToken('tok-owner'), OWNER], [hashToken('tok-awa'), AWA]]), [FREE, PRO100, PRO]);
  let clock = T0 + 60_000;
  const instances = new Instances({
    store,
    secret: 'test-secret-0123456789abcdef0123',
    fly,
    config: { app: 'baarali-instances', region: 'cdg', image: 'registry.fly.io/baarali-instances:v11', apiUrl: 'https://app.baarali.test', maxInstances: 5 },
    now: () => clock,
  });
  const app = createApp({
    store,
    openRouterKey: 'k',
    publicUrl: 'https://app.baarali.test',
    appName: 'Baarali',
    mediaPacks: [{ id: 'medias-2', credits: 71, prices: [{ amount: 200, currency: 'EUR' }] }],
    adminTokenHash: hashToken('operator-token'),
    adminEmails: opts.adminEmails ?? ['boss@example.test'],
    auth: opts.noAuth ? undefined : auth,
    instances,
    gateway: createGateway({ store, instances, now: () => clock, fetch: globalThis.fetch }),
    now: () => clock,
    // OpenRouter, played here: its model list, priced per token.
    fetch: (async (url: string) => {
      if (String(url).endsWith('/models')) return Response.json({ data: UPSTREAM });
      return new Response('{}');
    }) as typeof fetch,
  });
  const as = (who: string | null, path: string, init: RequestInit & { write?: boolean } = {}) =>
    app.request(path, {
      ...init,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        ...(who ? { cookie: `session=${who}` } : {}),
        ...(init.write === false ? {} : init.method === 'POST' ? { 'x-baarali-admin': '1' } : {}),
        ...(init.headers as Record<string, string>),
      },
    });
  const post = (who: string | null, path: string, body: unknown = {}) => as(who, path, { method: 'POST', body: JSON.stringify(body) });
  return { app, store, as, post, calls, tick: (ms: number) => { clock += ms; } };
}

describe('who opens the console', () => {
  it('does not exist without admin emails', async () => {
    const { as } = setup({ adminEmails: [] });
    expect((await as('boss', '/admin')).status).toBe(404);
    expect((await as('boss', '/admin/api/clients')).status).toBe(404);
  });

  it('sends a stranger to sign in, and comes back to /admin after', async () => {
    const { as } = setup();
    const res = await as(null, '/admin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/v1/sign-in#admin');
    expect((await as(null, '/admin/api/clients')).status).toBe(404);
  });

  it('opens for an admin email, proved, whatever its case', async () => {
    const { as } = setup();
    const page = await as('boss', '/admin');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Boss@example.test');
    // Like the sign-in pages: only its own script, by nonce.
    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
  });

  it('refuses another account, and an admin email not proved, offering to switch', async () => {
    const { as } = setup();
    for (const who of ['awa', 'unproved']) {
      const page = await as(who, '/admin');
      expect(await page.text()).toContain('Changer de compte');
      expect((await as(who, '/admin/api/clients')).status).toBe(404);
    }
  });

  it('has no page without the sign-in server, only the token\'s JSON routes', async () => {
    const { as } = setup({ noAuth: true });
    expect((await as(null, '/admin')).status).toBe(404);
    expect((await as(null, '/admin/api/clients', { headers: { authorization: 'Bearer operator-token' } })).status).toBe(200);
  });

  it('opens the JSON routes to the operator token too, for scripts', async () => {
    const { as } = setup();
    const res = await as(null, '/admin/api/clients', { headers: { authorization: 'Bearer operator-token' } });
    expect(res.status).toBe(200);
    expect((await as(null, '/admin/api/clients', { headers: { authorization: 'Bearer wrong' } })).status).toBe(404);
  });

  it('changes nothing on a cookie alone: a write needs the console\'s header', async () => {
    const { as, store } = setup();
    const res = await as('boss', `/admin/api/clients/${AWA.id}/plan`, { method: 'POST', write: false, body: JSON.stringify({ plan: 'pro-200' }) });
    expect(res.status).toBe(403);
    expect((await store.account(AWA.id))?.planId).toBe('decouverte');
  });
});

// The scripts live in TypeScript template strings, where one backslash too
// few changes a regex or breaks the whole page: each must still compile.
it('serves page scripts that compile', () => {
  const pages = [adminPage({ nonce: 'n', admin: 'a@x' }), deniedPage({ nonce: 'n', who: null }), selectAccountPage({ who: 'a@x', lang: null, nonce: 'n' })];
  for (const html of pages) {
    const script = html.match(/<script nonce="n">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  }
});

describe('what the console changes', () => {
  it('lists the clients, newest first, with what they cost', async () => {
    const { as } = setup();
    const { data, plans, packs } = (await (await as('boss', '/admin/api/clients')).json()) as { data: Array<{ id: string; planName: string; cost: { xof: number } }>; plans: Array<{ name: string }>; packs: unknown };
    expect(data.map((c) => c.id)).toEqual([AWA.id, OWNER.id]);
    expect(data[0]).toMatchObject({ planName: 'Découverte', cost: { xof: 0 } });
    // Two Pro levels share a name: the dearer is « Pro max ».
    expect(plans.map((p) => p.name)).toEqual(['Découverte', 'Pro', 'Pro max']);
    // The packs as sold, to give one in a click.
    expect(packs).toEqual([{ id: 'medias-2', credits: 71, eur: 2 }]);
  });

  it('changes a plan, which the account\'s next call sees, and writes it down', async () => {
    const { post, as, store } = setup();
    expect(await (await post('boss', `/admin/api/clients/${AWA.id}/plan`, { plan: 'pro-200' })).json()).toEqual({ changed: true });
    expect((await store.accountByToken('tok-awa'))?.planId).toBe('pro-200');
    const overview = (await (await as('boss', '/admin/api/overview')).json()) as { paid: number; monthlyValueEur: number };
    expect(overview).toMatchObject({ paid: 1, monthlyValueEur: 200 });
    expect(await (await post('boss', `/admin/api/clients/${AWA.id}/plan`, { plan: 'pro-200' })).json()).toEqual({ changed: false });
    expect((await post('boss', `/admin/api/clients/${AWA.id}/plan`, { plan: 'gratuit-a-vie' })).status).toBe(400);
    expect((await post('boss', '/admin/api/clients/acc_nobody/plan', { plan: 'pro-200' })).status).toBe(404);

    const { data } = (await (await as('boss', '/admin/api/journal')).json()) as { data: Array<Record<string, unknown>> };
    expect(data).toEqual([expect.objectContaining({ actor: 'Boss@example.test', action: 'plan', account: AWA.email, detail: 'Découverte → Pro max' })]);
  });

  it('gives media credits once per payment reference, within a ceiling', async () => {
    const { post, store } = setup();
    const give = (body: unknown) => post('boss', `/admin/api/clients/${AWA.id}/credits`, body);
    expect(await (await give({ credits: 50, reference: 'OM-123' })).json()).toEqual({ added: 50, duplicate: false, balance: 50 });
    expect(await (await give({ credits: 50, reference: 'OM-123' })).json()).toEqual({ added: 0, duplicate: true, balance: 50 });
    // Without a reference, every gift is its own.
    await give({ credits: 5 });
    await give({ credits: 5 });
    expect(await store.mediaBalance(AWA.id)).toBe(60);
    for (const credits of [0, -5, 2.5, 10_001, '50']) expect((await give({ credits })).status).toBe(400);
    expect((await store.adminLog(10, AWA.id)).map((e) => e.detail)).toEqual(['+5 crédits médias', '+5 crédits médias', '+50 crédits médias · OM-123']);
  });

  it('credits one receipt once, whether it came by the console or the operator route', async () => {
    const { post, as, store } = setup();
    const route = await as(null, '/v1/admin/media-credits', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' },
      body: JSON.stringify({ account_id: AWA.id, pack: 'medias-2', reference: 'OM-777' }),
    });
    expect(await route.json()).toMatchObject({ added: 71 });
    expect(await (await post('boss', `/admin/api/clients/${AWA.id}/credits`, { credits: 71, reference: 'OM-777' })).json()).toMatchObject({ added: 0, duplicate: true });
    expect(await store.mediaBalance(AWA.id)).toBe(71);
  });

  it('resets the 5-hour session and leaves the week as it was', async () => {
    const { post, store } = setup();
    await store.saveQuotaState(AWA.id, { sessionStart: T0, sessionUsed: 900_000, weekStart: T0, weekUsed: 900_000 });
    expect((await post('boss', `/admin/api/clients/${AWA.id}/reset-session`)).status).toBe(200);
    expect(await store.quotaState(AWA.id)).toMatchObject({ sessionStart: null, sessionUsed: 0, weekUsed: 900_000 });
  });

  it('suspends an account: its tokens and its devices open nothing until restored', async () => {
    const { post, as, store, app } = setup();
    const added = await app.request('/v1/devices', { method: 'POST', headers: { authorization: 'Bearer at-awa', 'content-type': 'application/json' } });
    const { server } = (await added.json()) as { server: { key: string } };
    const me = () => app.request('/v1/me', { headers: { authorization: 'Bearer tok-awa' } });
    const gateway = () => app.request('/instance/rpc/x', { headers: { authorization: `Bearer ${server.key}` } });
    expect((await me()).status).toBe(200);

    expect(await (await post('boss', `/admin/api/clients/${AWA.id}/suspend`, { suspended: true })).json()).toEqual({ changed: true });
    expect((await me()).status).toBe(403);
    expect((await app.request('/v1/me', { headers: { authorization: 'Bearer at-awa' } })).status).toBe(403);
    expect((await gateway()).status).toBe(403);
    const { data } = (await (await as('boss', '/admin/api/clients')).json()) as { data: Array<{ id: string; suspendedAt: number | null }> };
    expect(data.find((c) => c.id === AWA.id)?.suspendedAt).not.toBeNull();

    await post('boss', `/admin/api/clients/${AWA.id}/suspend`, { suspended: false });
    expect((await me()).status).toBe(200);
    expect((await gateway()).status).not.toBe(403);
    expect((await store.adminLog(10, AWA.id)).map((e) => e.action)).toEqual(['restore', 'suspend']);
  });
});

describe('instances from the console', () => {
  async function withInstance() {
    const s = setup();
    await s.store.saveInstance({ accountId: AWA.id, app: 'baarali-instances', machineId: 'm_awa', volumeId: 'vol_awa', image: 'registry.fly.io/baarali-instances:v10', managed: true });
    return s;
  }

  it('shows each machine with its state and whether it is behind', async () => {
    const { as } = await withInstance();
    const body = await (await as('boss', '/admin/api/instances')).json();
    expect(body).toEqual({
      currentImage: 'v11',
      data: [expect.objectContaining({
        accountId: AWA.id, email: AWA.email, image: 'v10', outdated: true, state: 'suspended',
        logsUrl: 'https://fly.io/apps/baarali-instances/machines/m_awa',
      })],
    });
    const overview = (await (await as('boss', '/admin/api/overview')).json()) as { attention: { outdatedInstances: number; failedInstances: unknown[] } };
    expect(overview.attention).toMatchObject({ outdatedInstances: 1, failedInstances: [] });
  });

  it('puts a machine that failed to start first in what needs attention', async () => {
    const { as, store } = await withInstance();
    await store.saveInstance({ accountId: OWNER.id, app: 'baarali-instances', machineId: 'm_broken', volumeId: 'v', image: 'registry.fly.io/baarali-instances:v11', managed: true });
    const overview = (await (await as('boss', '/admin/api/overview')).json()) as { attention: { failedInstances: unknown[] } };
    expect(overview.attention.failedInstances).toEqual([{ id: OWNER.id, email: OWNER.email }]);
  });

  it('updates, restarts and wakes a machine, each written down', async () => {
    const { post, calls, store } = await withInstance();
    expect(await (await post('boss', `/admin/api/instances/${AWA.id}/update`)).json()).toEqual({ done: true });
    expect(calls).toContain('update m_awa registry.fly.io/baarali-instances:v11');
    // Already on the current image: nothing to do, nothing written.
    expect(await (await post('boss', `/admin/api/instances/${AWA.id}/update`)).json()).toEqual({ done: false });
    expect(await (await post('boss', `/admin/api/instances/${AWA.id}/restart`)).json()).toEqual({ done: true });
    expect(calls).toContain('restart m_awa');
    expect((await post('boss', '/admin/api/instances/acc_nobody/wake')).status).toBe(404);
    expect((await store.adminLog(10, AWA.id)).map((e) => e.action)).toEqual(['instance-restart', 'instance-update']);
  });
});

describe('models from the console', () => {
  type Listed = { vendors: Array<{ id: string; name: string; models: Array<Record<string, unknown>> }>; free: string[]; freeFromCode: boolean };
  type Preview = { default: string | null; groups: Array<{ name: string; models: Array<{ id: string; baarali: { unlock?: string; recommended: boolean } }> }> };
  const preview = async (as: ReturnType<typeof setup>['as'], plan: string) => (await (await as('boss', `/admin/api/models/preview?plan=${plan}`)).json()) as Preview;

  it('lists OpenRouter\'s models by vendor, in the vendors\' order, priced per million', async () => {
    const { as } = setup();
    const r = (await (await as('boss', '/admin/api/models')).json()) as Listed;
    expect(r.vendors.map((v) => v.name)).toEqual(['Anthropic', 'OpenAI', 'DeepSeek']);
    expect(r.vendors[0].models[0]).toMatchObject({
      id: 'anthropic/opus', name: 'Claude Opus', configured: false, enabled: true, minPlan: null, deduced: 'puissant', free: -1,
      price: { prompt: 15, completion: 75 },
    });
    expect(r).toMatchObject({ free: ['deepseek/flash'], freeFromCode: true });
  });

  it('closes a model to the plans below its minimum, padlocked, and writes it down', async () => {
    const { as, post, store } = setup();
    expect((await post('boss', '/admin/api/models', { ids: ['anthropic/opus'], set: { minPlan: 'pro-200', recommended: true } })).status).toBe(200);
    const pro = await preview(as, 'pro-100');
    const opus = pro.groups[0].models.find((m) => m.id === 'anthropic/opus');
    expect(opus?.baarali).toMatchObject({ unlock: 'Pro max', recommended: true });
    // A padlocked model comes last in its vendor's group.
    expect(pro.groups[0].models.map((m) => m.id)).toEqual(['anthropic/sonnet', 'anthropic/opus']);
    expect((await preview(as, 'pro-200')).default).toBe('anthropic/opus');
    expect((await store.adminLog(1))[0]).toMatchObject({ action: 'models', detail: 'anthropic/opus : conseillé, dès Pro max' });
  });

  it('reaches the apps\' list at once, and their calls', async () => {
    const { post, app } = setup();
    await post('boss', '/admin/api/models', { ids: ['anthropic/opus', 'anthropic/sonnet'], set: { enabled: false } });
    const listed = await app.request('/v1/llm/models', { headers: { authorization: 'Bearer tok-awa' } });
    const { data } = (await listed.json()) as { data: Array<{ id: string }> };
    expect(data.map((m) => m.id)).toEqual(['deepseek/flash']);
  });

  it('refuses a minimum that is not a paid plan, or an unknown strength, or no model', async () => {
    const { post } = setup();
    expect((await post('boss', '/admin/api/models', { ids: ['anthropic/opus'], set: { minPlan: 'decouverte' } })).status).toBe(400);
    expect((await post('boss', '/admin/api/models', { ids: ['anthropic/opus'], set: { strength: 'magique' } })).status).toBe(400);
    expect((await post('boss', '/admin/api/models', { ids: [], set: { enabled: false } })).status).toBe(400);
    expect((await post('boss', '/admin/api/models', { ids: ['anthropic/opus'], set: {} })).status).toBe(400);
  });

  it('sets Découverte\'s list and its order, and takes out what left it', async () => {
    const { as, post } = setup();
    await post('boss', '/admin/api/models/free', { ids: ['openai/gpt-6', 'deepseek/flash'] });
    let r = (await (await as('boss', '/admin/api/models')).json()) as Listed;
    expect(r).toMatchObject({ free: ['openai/gpt-6', 'deepseek/flash'], freeFromCode: false });
    await post('boss', '/admin/api/models/free', { ids: ['deepseek/flash'] });
    r = (await (await as('boss', '/admin/api/models')).json()) as Listed;
    expect(r.free).toEqual(['deepseek/flash']);
    const free = await preview(as, 'decouverte');
    expect(free.default).toBe('deepseek/flash');
    // gpt-6 was set up: Découverte sees it padlocked, open from the first paid plan.
    expect(free.groups.flatMap((g) => g.models).find((m) => m.id === 'openai/gpt-6')?.baarali.unlock).toBe('Pro');
    expect((await post('boss', '/admin/api/models/free', { ids: [] })).status).toBe(400);
  });
});
