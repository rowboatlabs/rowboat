import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { isAdmin, type SoldPack } from './admin.js';
import { adminPage, deniedPage } from './admin-page.js';
import { AUTH_BASE_PATH, type BaaraliAuth } from './auth.js';
import { ASSUMPTIONS, OFFERS } from './catalog.js';
import { html } from './html.js';
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
  now: () => number;
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

/**
 * Two Pro levels share a display name: the dearer one is « Pro max », the
 * owner's word for it (03/10/2026). Any other plan keeps its name.
 */
export function planLabeler(plans: Plan[]): (plan: Plan) => string {
  const eur = (p: Plan) => p.monthlyPrices.find((m) => m.currency === 'EUR')?.amount ?? 0;
  return (plan) => {
    const twins = plans.filter((p) => p.displayName === plan.displayName);
    return twins.length > 1 && eur(plan) === Math.max(...twins.map(eur)) ? `${plan.displayName} max` : plan.displayName;
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
