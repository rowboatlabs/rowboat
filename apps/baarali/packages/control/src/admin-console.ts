import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { isAdmin, type SoldPack } from './admin.js';
import { adminPage, deniedPage } from './admin-page.js';
import { AUTH_BASE_PATH, type BaaraliAuth } from './auth.js';
import { ASSUMPTIONS, OFFERS } from './catalog.js';
import { html } from './html.js';
import {
  compareVendors,
  deduceStrength,
  isFreePlan,
  isStrength,
  planLabeler,
  presentFor,
  STRENGTHS,
  vendorName,
  vendorOf,
  pickerGroups,
  mediaKey,
  mediaOpen,
  type ModelSetting,
  type PickerModel,
} from './model-access.js';
import type { ModelCatalog, UpstreamModels } from './model-catalog.js';
import { displayName } from './models.js';
import { MEDIA_MODELS, mediaCredits } from './media.js';
import { WEEKS_PER_MONTH } from './pricing.js';
import type { Instances } from './instances.js';
import { advance, budgetsForWeek, gauges, initialState, WEEK_MS } from './quota.js';
import type { AccountSummary, ControlStore, InstanceRecord, Plan } from './store.js';

// The admin console (decided 03/10/2026): app.baarali.com/admin, for the
// emails in BAARALI_ADMIN_EMAILS only, signed in like everyone else. It
// reads accounts, changes a plan, gives media credits, suspends, and wakes,
// updates or restarts an instance; every change is written to admin_log.
// What a model call really costs is shown here, never to a customer.

export interface ConsoleDeps {
  store: ControlStore;
  auth?: BaaraliAuth;
  /** Lowercase; empty: the console does not exist (404). */
  adminEmails: string[];
  /** The operator token still opens the JSON routes, for scripts. */
  adminTokenHash?: string;
  mediaPacks: SoldPack[];
  instances?: Instances;
  models: ModelCatalog;
  upstreamModels: UpstreamModels;
  now: () => number;
}

/** One write touches this many models at most: a whole vendor fits, a slip does not empty the catalog. */
export const MAX_MODELS_PER_WRITE = 500;

const blank = (modelId: string): ModelSetting => ({ modelId, enabled: true, minPlan: null, recommended: false, strength: null, freeRank: null });

/** OpenRouter prices a token in dollars; the console reads them per million. */
function perMillion(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 100) / 100 : null;
}

/** Who is acting: an admin's email, or `token` for the operator token. */
type Actor = string;

/** A media credit gift has a ceiling: a slip of the keyboard must not give away a fortune. */
export const MAX_GIFT_CREDITS = 10_000;

const XOF_PER_USD = 1 / ASSUMPTIONS.usdPerUnit.XOF;

/** What model calls cost us, in dollars and CFA francs (rounded). */
export function costOf(credits: number): { usd: number; xof: number } {
  const usd = credits / CREDITS_PER_DOLLAR;
  return { usd: Math.round(usd * 100) / 100, xof: Math.round(usd * XOF_PER_USD) };
}

/**
 * What one subscriber of the plan brings in a month, in euros: a weekly plan
 * (Semaine) has no monthly price, so its week counts 52/12 times.
 */
function monthlyEur(planId: string): number {
  const billing = OFFERS.find((o) => o.id === planId)?.billing;
  if (!billing || billing.kind !== 'paid') return 0;
  const eur = billing.prices.find((p) => p.currency === 'EUR')?.amount ?? 0;
  return (billing.period === 'week' ? eur * WEEKS_PER_MONTH : eur) / 100;
}

const percent = (used: number, of: number) => (of > 0 ? Math.min(100, Math.round((used / of) * 100)) : 0);

/** One account as the console shows it. */
export function clientRow(s: AccountSummary, plan: Plan | null, now: number, label: (p: Plan) => string) {
  const g = gauges(s.quota ?? initialState(s.account.createdAt), budgetsForWeek(plan?.weekCredits ?? 0), now);
  return {
    id: s.account.id,
    email: s.account.email,
    planId: s.account.planId,
    planName: plan ? label(plan) : s.account.planId,
    createdAt: s.account.createdAt,
    suspendedAt: s.account.suspendedAt ?? null,
    session: percent(g.session.usedCredits, g.session.sanctionedCredits),
    week: percent(g.week.usedCredits, g.week.sanctionedCredits),
    weekResetsAt: g.week.resetsAt,
    mediaBalance: s.mediaBalance,
    lastActiveAt: s.lastActiveAt,
    cost: costOf(s.recentCredits),
  };
}

export function mountAdminConsole(app: Hono<any>, deps: ConsoleDeps): void {
  if (deps.adminEmails.length === 0) return;
  const { store } = deps;

  async function sessionAdmin(c: Context): Promise<{ actor: Actor } | { who: string | null } | null> {
    const user = deps.auth ? await deps.auth.sessionUser(c.req.raw.headers) : null;
    if (!user) return null;
    if (user.email && user.emailVerified && deps.adminEmails.includes(user.email.toLowerCase())) return { actor: user.email };
    return { who: user.email };
  }

  // The page: signed in as an admin, or sent to sign in, or told no.
  app.get('/admin', async (c) => {
    // Without the sign-in server nobody can sign in: only the operator token's JSON routes remain.
    if (!deps.auth) return c.notFound();
    const who = await sessionAdmin(c);
    if (!who) return c.redirect(`${AUTH_BASE_PATH}/sign-in#admin`, 302);
    if (!('actor' in who)) return html((nonce) => deniedPage({ nonce, who: who.who }));
    return html((nonce) => adminPage({ nonce, admin: who.actor }));
  });

  // The JSON routes. A cookie alone is not enough to change anything: the
  // page sends a header no other site can set without our CORS consent.
  const api = async (c: Context, write: boolean): Promise<Actor | Response> => {
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    if (bearer && isAdmin({ store, adminTokenHash: deps.adminTokenHash, packs: deps.mediaPacks, now: deps.now }, bearer)) return 'token';
    const who = await sessionAdmin(c);
    if (!who || !('actor' in who)) return c.json({ error: { code: 'not_found' } }, 404);
    if (write && c.req.header('x-baarali-admin') !== '1') return c.json({ error: { code: 'forbidden' } }, 403);
    return who.actor;
  };
  const body = async (c: Context): Promise<Record<string, unknown>> => {
    const parsed: unknown = await c.req.json().catch(() => null);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  };
  const log = (actor: Actor, action: string, accountId: string | null, detail: string) =>
    store.appendAdminLog({ at: deps.now(), actor, action, accountId, detail });

  const summaries = async () => {
    const now = deps.now();
    const plans = await store.plans();
    const list = await store.listAccounts(now - WEEK_MS);
    const label = planLabeler(plans);
    return { now, plans, label, list, rows: list.map((s) => clientRow(s, plans.find((p) => p.id === s.account.planId) ?? null, now, label)) };
  };

  app.get('/admin/api/overview', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    const { now, plans, label, list, rows } = await summaries();
    const instances = await store.allInstances();
    const outdated = deps.instances?.currentImage
      ? instances.filter((i) => i.managed && i.image !== deps.instances!.currentImage).length
      : 0;
    // A machine that failed to start is the first thing to see (mockup of 03/10/2026).
    const failed = deps.instances
      ? (await Promise.all(instances.map((r) => deps.instances!.machineState(r).catch(() => null))))
          .flatMap((m, i) => (m?.state === 'failed' ? [instances[i].accountId] : []))
      : [];
    const paid = rows.filter((r) => plans.find((p) => p.id === r.planId)?.category !== 'free');
    const monthly = paid.reduce((sum, r) => sum + monthlyEur(r.planId), 0);
    const weekCredits = list.reduce((sum, s) => sum + s.recentCredits, 0);
    return c.json({
      clients: rows.length,
      newThisWeek: rows.filter((r) => r.createdAt >= now - WEEK_MS).length,
      activeThisWeek: rows.filter((r) => r.lastActiveAt !== null && r.lastActiveAt >= now - WEEK_MS).length,
      paid: paid.length,
      monthlyValueEur: Math.round(monthly),
      weekCost: costOf(weekCredits),
      plans: plans.map((p) => ({ id: p.id, name: label(p), count: rows.filter((r) => r.planId === p.id).length })),
      attention: {
        atLimit: rows.filter((r) => r.week >= 100 || r.session >= 100).map((r) => ({ id: r.id, email: r.email })),
        suspended: rows.filter((r) => r.suspendedAt !== null).length,
        outdatedInstances: outdated,
        failedInstances: failed.map((id) => ({ id, email: rows.find((r) => r.id === id)?.email ?? null })),
      },
    });
  });

  app.get('/admin/api/clients', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    const { rows, plans, label } = await summaries();
    return c.json({
      data: rows,
      plans: plans.map((p) => ({ id: p.id, name: label(p) })),
      // The packs as sold, to give one in a click; any other amount stays possible.
      packs: deps.mediaPacks.map((p) => ({ id: p.id, credits: p.credits, eur: (p.prices.find((m) => m.currency === 'EUR')?.amount ?? 0) / 100 })),
    });
  });

  app.get('/admin/api/clients/:id', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    const { rows } = await summaries();
    const row = rows.find((r) => r.id === c.req.param('id'));
    if (!row) return c.json({ error: { code: 'not_found' } }, 404);
    const [devices, history, journal, instance] = await Promise.all([
      store.devices(row.id),
      store.mediaHistory(row.id, 10),
      store.adminLog(20, row.id),
      store.instance(row.id),
    ]);
    return c.json({
      ...row,
      devices: devices.map((d) => ({ name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, revoked: d.revokedAt !== null })),
      media: history,
      journal,
      instance: instance && { image: instance.image, managed: instance.managed },
    });
  });

  app.post('/admin/api/clients/:id/plan', async (c) => {
    const actor = await api(c, true);
    if (actor instanceof Response) return actor;
    const id = c.req.param('id');
    const account = await store.account(id);
    if (!account) return c.json({ error: { code: 'not_found' } }, 404);
    const planId = (await body(c)).plan;
    const plan = typeof planId === 'string' ? await store.plan(planId) : null;
    if (!plan) return c.json({ error: { code: 'invalid_request', message: 'Unknown plan' } }, 400);
    if (plan.id === account.planId) return c.json({ changed: false });
    // Named before the change: the memory store hands out the record it changes.
    const label = planLabeler(await store.plans());
    const before = await store.plan(account.planId);
    const from = before ? label(before) : account.planId;
    await store.setPlan(id, plan.id);
    await log(actor, 'plan', id, `${from} → ${label(plan)}`);
    return c.json({ changed: true });
  });

  app.post('/admin/api/clients/:id/credits', async (c) => {
    const actor = await api(c, true);
    if (actor instanceof Response) return actor;
    const id = c.req.param('id');
    if (!(await store.account(id))) return c.json({ error: { code: 'not_found' } }, 404);
    const b = await body(c);
    const credits = b.credits;
    if (typeof credits !== 'number' || !Number.isInteger(credits) || credits < 1 || credits > MAX_GIFT_CREDITS) {
      return c.json({ error: { code: 'invalid_request', message: `credits: a whole number from 1 to ${MAX_GIFT_CREDITS}` } }, 400);
    }
    // A payment reference makes a second click on the same payment harmless.
    // It is the receipt as is, like /v1/admin/media-credits and the payment
    // rail to come: one receipt credits once, whichever way it came in.
    const given = typeof b.reference === 'string' ? b.reference.trim().slice(0, 80) : '';
    const reference = given || `admin:gift-${randomUUID()}`;
    const result = await store.applyMediaEntry({ accountId: id, at: deps.now(), kind: 'topup', credits, reference });
    if (result === 'applied') await log(actor, 'credits', id, `+${credits} crédits médias${given ? ` · ${given}` : ''}`);
    return c.json({ added: result === 'applied' ? credits : 0, duplicate: result === 'duplicate', balance: await store.mediaBalance(id) });
  });

  app.post('/admin/api/clients/:id/reset-session', async (c) => {
    const actor = await api(c, true);
    if (actor instanceof Response) return actor;
    const id = c.req.param('id');
    const account = await store.account(id);
    if (!account) return c.json({ error: { code: 'not_found' } }, 404);
    const state = advance((await store.quotaState(id)) ?? initialState(account.createdAt), deps.now());
    await store.saveQuotaState(id, { ...state, sessionStart: null, sessionUsed: 0 });
    await log(actor, 'session', id, 'Session de 5 h remise à zéro');
    return c.json({ ok: true });
  });

  app.post('/admin/api/clients/:id/suspend', async (c) => {
    const actor = await api(c, true);
    if (actor instanceof Response) return actor;
    const id = c.req.param('id');
    const account = await store.account(id);
    if (!account) return c.json({ error: { code: 'not_found' } }, 404);
    const suspend = (await body(c)).suspended === true;
    if (suspend === Boolean(account.suspendedAt)) return c.json({ changed: false });
    await store.setSuspended(id, suspend ? deps.now() : null);
    await log(actor, suspend ? 'suspend' : 'restore', id, suspend ? 'Compte suspendu' : 'Compte rétabli');
    return c.json({ changed: true });
  });

  app.get('/admin/api/instances', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    const [records, accounts] = await Promise.all([store.allInstances(), store.listAccounts(deps.now())]);
    const current = deps.instances?.currentImage ?? null;
    const data = await Promise.all(
      records.map(async (r) => {
        // One machine Fly cannot describe must not hide the others.
        const live = deps.instances ? await deps.instances.machineState(r).catch(() => 'unknown' as const) : null;
        return {
          accountId: r.accountId,
          email: accounts.find((a) => a.account.id === r.accountId)?.account.email ?? null,
          app: r.app,
          machineId: r.machineId,
          managed: r.managed,
          // Its logs and metrics, on Fly's dashboard (signed in there).
          logsUrl: r.managed && r.machineId ? `https://fly.io/apps/${r.app}/machines/${r.machineId}` : null,
          image: imageLabel(r.image),
          outdated: Boolean(current && r.managed && r.image !== current),
          state: live === 'unknown' ? 'unknown' : (live?.state ?? null),
        };
      }),
    );
    return c.json({ currentImage: imageLabel(current), data });
  });

  for (const action of ['wake', 'update', 'restart'] as const) {
    app.post(`/admin/api/instances/:accountId/${action}`, async (c) => {
      const actor = await api(c, true);
      if (actor instanceof Response) return actor;
      const accountId = c.req.param('accountId');
      const record = await store.instance(accountId);
      if (!record || !deps.instances) return c.json({ error: { code: 'not_found' } }, 404);
      try {
        const done = await act(deps.instances, record, action);
        if (done) await log(actor, `instance-${action}`, accountId, INSTANCE_WORDS[action]);
        return c.json({ done });
      } catch (err) {
        console.error(`[admin] instance ${action} of ${accountId} failed`, err);
        return c.json({ error: { code: 'instance_failed' } }, 502);
      }
    });
  }

  // The models (decided 03/10/2026): OpenRouter's catalog, the owner's
  // settings over it, and what each plan's picker then shows.
  const upstream = async () => {
    const parsed = JSON.parse(await deps.upstreamModels.get()) as { data?: unknown };
    if (!Array.isArray(parsed.data)) throw new Error('unexpected catalog');
    return parsed.data.filter((m): m is { id: string; name?: unknown; pricing?: { prompt?: unknown; completion?: unknown } } =>
      !!m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string');
  };

  app.get('/admin/api/models', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    let list;
    try {
      list = await upstream();
    } catch (err) {
      console.error('[admin] OpenRouter catalog unreadable', err);
      return c.json({ error: { code: 'upstream_failed', message: 'Le catalogue OpenRouter ne répond pas' } }, 502);
    }
    deps.models.clear();
    const catalog = await deps.models.get();
    const label = planLabeler(catalog.plans);
    const byVendor = new Map<string, unknown[]>();
    const known = new Set(list.map((m) => m.id));
    for (const m of list) {
      const s = catalog.settings.get(m.id);
      const vendor = vendorOf(m.id);
      byVendor.set(vendor, [...(byVendor.get(vendor) ?? []), {
        id: m.id,
        name: typeof m.name === 'string' ? displayName(m.name) : m.id,
        configured: Boolean(s),
        enabled: s?.enabled ?? true,
        minPlan: s?.minPlan ?? null,
        recommended: s?.recommended ?? false,
        strength: s?.strength ?? null,
        deduced: deduceStrength(m.id),
        free: catalog.free.indexOf(m.id),
        price: { prompt: perMillion(m.pricing?.prompt), completion: perMillion(m.pricing?.completion) },
      }]);
    }
    const vendors = [...byVendor.entries()]
      .sort(([a], [b]) => compareVendors(a, b))
      .map(([id, models]) => ({ id, name: vendorName(id), models }));
    return c.json({
      plans: catalog.plans.map((p) => ({ id: p.id, name: label(p), free: isFreePlan(p) })),
      strengths: STRENGTHS,
      free: catalog.free,
      // Découverte's list as the code sets it, until the console sets one.
      freeFromCode: ![...catalog.settings.values()].some((s) => s.freeRank !== null),
      // Settings for models OpenRouter no longer lists: kept, shown apart.
      gone: [...catalog.settings.keys()].filter((id) => !known.has(id)),
      vendors,
    });
  });

  app.post('/admin/api/models', async (c) => {
    const actor = await api(c, true);
    if (actor instanceof Response) return actor;
    const b = await body(c);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x): x is string => typeof x === 'string' && x.includes('/')))] : [];
    const set = b.set && typeof b.set === 'object' && !Array.isArray(b.set) ? (b.set as Record<string, unknown>) : {};
    if (ids.length === 0 || ids.length > MAX_MODELS_PER_WRITE) {
      return c.json({ error: { code: 'invalid_request', message: `ids: 1 to ${MAX_MODELS_PER_WRITE} models` } }, 400);
    }
    const catalog = await deps.models.get();
    const paid = catalog.plans.filter((p) => !isFreePlan(p)).map((p) => p.id);
    const change: Partial<ModelSetting> = {};
    if (typeof set.enabled === 'boolean') change.enabled = set.enabled;
    if (typeof set.recommended === 'boolean') change.recommended = set.recommended;
    if ('minPlan' in set) {
      if (set.minPlan !== null && !(typeof set.minPlan === 'string' && paid.includes(set.minPlan))) {
        return c.json({ error: { code: 'invalid_request', message: `minPlan: null or one of ${paid.join(', ')}` } }, 400);
      }
      change.minPlan = set.minPlan as string | null;
    }
    if ('strength' in set) {
      if (set.strength !== null && !isStrength(set.strength)) return c.json({ error: { code: 'invalid_request', message: 'Unknown strength' } }, 400);
      change.strength = set.strength;
    }
    if (Object.keys(change).length === 0) return c.json({ error: { code: 'invalid_request', message: 'Nothing to change' } }, 400);
    const settings = ids.map((id) => ({ ...(catalog.settings.get(id) ?? blank(id)), ...change, modelId: id }));
    await store.saveModelSettings(settings, deps.now());
    deps.models.clear();
    const label = planLabeler(catalog.plans);
    const words = [
      change.enabled !== undefined ? (change.enabled ? 'ouvert' : 'masqué') : null,
      change.recommended !== undefined ? (change.recommended ? 'conseillé' : 'plus conseillé') : null,
      change.minPlan !== undefined ? `dès ${change.minPlan ? label(catalog.plans.find((p) => p.id === change.minPlan)!) : 'tout forfait payant'}` : null,
      change.strength !== undefined ? `point fort : ${change.strength ? STRENGTHS[change.strength] : 'automatique'}` : null,
    ].filter(Boolean).join(', ');
    await log(actor, 'models', null, `${ids.length === 1 ? ids[0] : `${ids.length} modèles`} : ${words}`);
    return c.json({ saved: settings.length });
  });

  // Découverte's list, in order: the first is the default, the others take over.
  app.post('/admin/api/models/free', async (c) => {
    const actor = await api(c, true);
    if (actor instanceof Response) return actor;
    const raw = (await body(c)).ids;
    const ids = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.includes('/')))] : [];
    if (ids.length === 0 || ids.length > 10) {
      return c.json({ error: { code: 'invalid_request', message: 'Découverte needs 1 to 10 models' } }, 400);
    }
    const catalog = await deps.models.get();
    const leaving = [...catalog.settings.values()].filter((s) => s.freeRank !== null && !ids.includes(s.modelId));
    const settings = [
      ...leaving.map((s) => ({ ...s, freeRank: null })),
      ...ids.map((id, i) => ({ ...(catalog.settings.get(id) ?? blank(id)), modelId: id, enabled: true, freeRank: i })),
    ];
    await store.saveModelSettings(settings, deps.now());
    deps.models.clear();
    await log(actor, 'models-free', null, `Découverte : ${ids.join(', ')}`);
    return c.json({ free: ids });
  });

  // Exactly what one plan's picker receives (/v1/llm/models).
  app.get('/admin/api/models/preview', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    const catalog = await deps.models.get();
    const plan = catalog.plans.find((p) => p.id === c.req.query('plan'));
    if (!plan) return c.json({ error: { code: 'invalid_request', message: 'Unknown plan' } }, 400);
    const label = planLabeler(catalog.plans);
    let shown: string | null;
    try {
      shown = presentFor(catalog, plan, await deps.upstreamModels.get(), (id) => {
        const p = catalog.plans.find((x) => x.id === id);
        return p ? label(p) : id;
      });
    } catch {
      shown = null;
    }
    if (shown === null) return c.json({ error: { code: 'upstream_failed', message: 'Le catalogue OpenRouter ne répond pas' } }, 502);
    const { data } = JSON.parse(shown) as { data: PickerModel[] };
    return c.json({ default: data[0]?.id ?? null, groups: pickerGroups(data) });
  });

  // Pixazo's models (03/10/2026): media.ts is their catalog, since Pixazo
  // lists none; the console opens, closes and recommends them.
  const MEDIA_KINDS = { video: 'Vidéo', speech: 'Voix', music: 'Musique' } as const;

  app.get('/admin/api/media-models', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    deps.models.clear();
    const catalog = await deps.models.get();
    const label = planLabeler(catalog.plans);
    return c.json({
      plans: catalog.plans.map((p) => ({ id: p.id, name: label(p) })),
      kinds: MEDIA_KINDS,
      models: MEDIA_MODELS.map((m) => {
        const s = catalog.settings.get(mediaKey(m.id));
        const credits = mediaCredits(m, { model: m.id, prompt: 'x' });
        return {
          id: m.id,
          kind: m.kind,
          name: m.displayName,
          ...(m.durations ? { durations: m.durations } : {}),
          configured: Boolean(s),
          enabled: s?.enabled ?? true,
          minPlan: s?.minPlan ?? null,
          recommended: s?.recommended ?? false,
          // The default request: what the agent quotes first.
          credits,
          usd: Math.round(m.costUsd({ model: m.id, prompt: 'x' }) * 1000) / 1000,
          openFor: catalog.plans.filter((p) => mediaOpen(catalog, p, m.id)).map((p) => p.id),
        };
      }),
    });
  });

  app.post('/admin/api/media-models', async (c) => {
    const actor = await api(c, true);
    if (actor instanceof Response) return actor;
    const b = await body(c);
    const known = new Set(MEDIA_MODELS.map((m) => m.id));
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x): x is string => typeof x === 'string' && known.has(x)))] : [];
    const set = b.set && typeof b.set === 'object' && !Array.isArray(b.set) ? (b.set as Record<string, unknown>) : {};
    if (ids.length === 0) return c.json({ error: { code: 'invalid_request', message: `ids: some of ${[...known].join(', ')}` } }, 400);
    const catalog = await deps.models.get();
    const change: Partial<ModelSetting> = {};
    if (typeof set.enabled === 'boolean') change.enabled = set.enabled;
    if (typeof set.recommended === 'boolean') change.recommended = set.recommended;
    if ('minPlan' in set) {
      // Every plan may open a media model, Découverte included: credits pay for it.
      if (set.minPlan !== null && !(typeof set.minPlan === 'string' && catalog.plans.some((p) => p.id === set.minPlan))) {
        return c.json({ error: { code: 'invalid_request', message: 'minPlan: null or a plan id' } }, 400);
      }
      change.minPlan = set.minPlan as string | null;
    }
    if (Object.keys(change).length === 0) return c.json({ error: { code: 'invalid_request', message: 'Nothing to change' } }, 400);
    const settings = ids.map((id) => ({ ...(catalog.settings.get(mediaKey(id)) ?? blank(mediaKey(id))), ...change, modelId: mediaKey(id) }));
    await store.saveModelSettings(settings, deps.now());
    deps.models.clear();
    const label = planLabeler(catalog.plans);
    const words = [
      change.enabled !== undefined ? (change.enabled ? 'ouvert' : 'masqué') : null,
      change.recommended !== undefined ? (change.recommended ? 'conseillé' : 'plus conseillé') : null,
      change.minPlan !== undefined ? `dès ${change.minPlan ? label(catalog.plans.find((p) => p.id === change.minPlan)!) : 'tout forfait'}` : null,
    ].filter(Boolean).join(', ');
    await log(actor, 'media-models', null, `Pixazo ${ids.join(', ')} : ${words}`);
    return c.json({ saved: settings.length });
  });

  app.get('/admin/api/journal', async (c) => {
    const actor = await api(c, false);
    if (actor instanceof Response) return actor;
    const [entries, accounts] = await Promise.all([store.adminLog(200), store.listAccounts(deps.now())]);
    const emailOf = (id: string | null) => (id ? (accounts.find((a) => a.account.id === id)?.account.email ?? id) : null);
    return c.json({ data: entries.map((e) => ({ ...e, account: emailOf(e.accountId) })) });
  });
}

const INSTANCE_WORDS = { wake: 'Instance réveillée', update: 'Instance mise à jour', restart: 'Instance redémarrée' } as const;

async function act(instances: Instances, record: InstanceRecord, action: 'wake' | 'update' | 'restart'): Promise<boolean> {
  if (action === 'wake') {
    await instances.wake(record);
    return true;
  }
  if (action === 'update') return instances.updateNow(record);
  await instances.restart(record);
  return true;
}

/** `registry.fly.io/baarali-instances:v11` → `v11`. */
function imageLabel(image: string | null): string | null {
  if (!image) return null;
  const tag = image.split(':').at(-1);
  return tag && !tag.includes('/') ? tag : image;
}
