import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { buildApiConfig } from './config.js';
import { proxyLlm, type ProxyDeps } from './llm-proxy.js';
import { isAdmin, topUpMedia, type SoldPack } from './admin.js';
import { asset } from './assets.js';
import { AUTH_BASE_PATH, type BaaraliAuth } from './auth.js';
import { homePage, type HomeData } from './home-page.js';
import { planOffers, PRICING_PATH, pricingPage } from './pricing-page.js';
import { html } from './html.js';
import { LEGAL_PATHS, legalPage, type LegalDoc } from './legal-page.js';
import { GATEWAY_PATH, type Gateway } from './gateway.js';
import { InstanceUnavailable, type Instances } from './instances.js';
import { createGeneration, getGeneration, listMediaModels, mediaBalance } from './media-route.js';
import { advance, budgetsForWeek, gauges, initialState } from './quota.js';
import { hashToken, type Account } from './store.js';

export type ControlDeps = ProxyDeps & {
  /** Unset: media generation is off (503). */
  pixazoKey?: string;
  pixazoBase?: string;
  /** The media credit packs on sale (pricing.ts, packCredits). */
  mediaPacks: SoldPack[];
  /** SHA-256 of the operator token; unset: /v1/admin answers 404. */
  adminTokenHash?: string;
  /** The home page with the prices (baarali.com); unset: `/` answers 404. */
  home?: HomeData;
  /** The sign-in server; unset: only instance tokens open /v1 (phase 0). */
  auth?: BaaraliAuth;
  /** One instance per account and the door to it; unset: no device can connect. */
  instances?: Instances;
  gateway?: Gateway;
  /**
   * Our Spaces server (Harbor), told to the apps by /v1/config. Only with
   * the sign-in server: Harbor trusts the tokens it signs, no others.
   */
  spacesUrl?: string;
};

type Env = { Variables: { account: Account } };

function bearer(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Each sign-in on an app adds one; old ones are revoked from the list. */
const MAX_DEVICES = 10;

const publicDevice = (d: { id: string; name: string; createdAt: number; lastSeenAt: number | null; revokedAt: number | null }) => ({
  id: d.id,
  name: d.name,
  created_at: new Date(d.createdAt).toISOString(),
  last_seen_at: d.lastSeenAt === null ? null : new Date(d.lastSeenAt).toISOString(),
  revoked_at: d.revokedAt === null ? null : new Date(d.revokedAt).toISOString(),
});

export function createApp(deps: ControlDeps) {
  const app = new Hono<Env>();

  app.get('/health', (c) => c.json({ ok: true }));

  if (deps.home) {
    const home = deps.home;
    app.get('/', (c) => {
      // The app's « Upgrade » buttons open `${appUrl}?intent=upgrade` (renderer
      // sidebar, billing dialog, settings): the plans are what they came for.
      if (c.req.query('intent') === 'upgrade') return c.redirect(PRICING_PATH, 302);
      return html((nonce) => homePage(home, { lang: c.req.header('accept-language') ?? null, nonce }));
    });
    app.get(PRICING_PATH, (c) => html((nonce) => pricingPage(home, { lang: c.req.header('accept-language') ?? null, nonce })));
    // The same plans, for the app's own window (no browser: the account lives in the app).
    app.get('/v1/plans', (c) => c.json(planOffers(home, c.req.query('lang') ?? c.req.header('accept-language') ?? null)));
    for (const doc of Object.keys(LEGAL_PATHS) as LegalDoc[]) {
      app.get(LEGAL_PATHS[doc], (c) => html((nonce) => legalPage(doc, { lang: c.req.header('accept-language') ?? null, nonce, downloads: Boolean(home.downloadBase) })));
    }
    app.get('/assets/:name', (c) => {
      const file = asset(c.req.param('name'));
      if (!file) return c.notFound();
      // Names never change content: a new font gets a new name.
      return c.body(file.body, 200, { 'content-type': file.type, 'cache-control': 'public, max-age=31536000, immutable' });
    });
  }

  // Unauthenticated, like the Rowboat Labs route: core reads it before login.
  app.get('/v1/config', async (c) =>
    c.json(buildApiConfig({ publicUrl: deps.publicUrl, spacesUrl: deps.auth ? deps.spacesUrl : undefined }, await deps.store.plans())),
  );

  // Where core looks for its OAuth server (`${supabaseUrl}/auth/v1`).
  if (deps.auth) {
    const auth = deps.auth;
    app.all(`${AUTH_BASE_PATH}/*`, (c) => auth.handle(c.req.raw));
  }

  // An instance token, or an access token our sign-in server issued.
  const accountFor = async (token: string) => {
    const byToken = await deps.store.accountByToken(token);
    if (byToken || !deps.auth) return byToken;
    const userId = await deps.auth.userIdForAccessToken(token);
    return userId ? deps.store.accountForUser(userId) : null;
  };

  const authed = createMiddleware<Env>(async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    const account = token ? await accountFor(token) : null;
    if (!account) return c.json({ error: { code: 'unauthorized' } }, 401);
    c.set('account', account);
    await next();
  });
  app.use('/v1/me', authed);
  app.use('/v1/llm/*', authed);
  app.use('/v1/media/*', authed);
  app.use('/v1/spaces/*', authed);

  // A cloud instance trades its token for a Spaces one (core
  // auth/spaces-exchange.ts): Spaces verify only our signed JWTs.
  app.post('/v1/spaces/token', async (c) => {
    const traded = deps.auth && deps.spacesUrl ? await deps.auth.spacesTokenFor(c.get('account').id) : null;
    if (!traded) return c.json({ error: { code: 'not_found' } }, 404);
    return c.json({ access_token: traded.token, token_type: 'Bearer', expires_in: traded.expiresIn });
  });

  // Same body as the Rowboat Labs /v1/me (core billing/billing.ts reads it).
  // Session → `daily`, week → `monthly`: see architecture §3.5.
  app.get('/v1/me', async (c) => {
    const account = c.get('account');
    const plan = await deps.store.plan(account.planId);
    const state = (await deps.store.quotaState(account.id)) ?? initialState(account.createdAt);
    const now = deps.now();
    const g = gauges(state, budgetsForWeek(plan?.weekCredits ?? 0), now);
    // A session opens with its first message: before that, it ends nowhere.
    const sessionOpen = advance(state, now).sessionStart !== null;
    const bucket = ({ sanctionedCredits, usedCredits, availableCredits }: typeof g.week) => ({
      sanctionedCredits,
      usedCredits,
      availableCredits,
    });
    return c.json({
      user: { id: account.id, email: account.email },
      billing: {
        planId: plan ? plan.id : null,
        status: plan ? 'active' : null,
        trialExpiresAt: null,
        usage: {
          monthly: { ...bucket(g.week), resetsAt: new Date(g.week.resetsAt).toISOString() },
          daily: {
            ...bucket(g.session),
            usageDay: new Date(g.session.resetsAt).toISOString(),
            ...(sessionOpen ? { resetsAt: new Date(g.session.resetsAt).toISOString() } : {}),
          },
          store: { availableCredits: 0 },
        },
      },
    });
  });

  app.all('/v1/llm/*', (c) => proxyLlm(deps, c.get('account'), c.req.raw));

  app.get('/v1/media/models', (c) => listMediaModels(deps, c.get('account')));
  app.get('/v1/media/balance', (c) => mediaBalance(deps, c.get('account')));
  app.get('/v1/media/packs', (c) => c.json({ data: deps.mediaPacks }));
  app.post('/v1/media/generations', (c) => createGeneration(deps, c.get('account'), c.req.raw));
  app.get('/v1/media/generations/:id', (c) => getGeneration(deps, c.get('account'), c.req.param('id')));

  // Devices (security §2): only a signed-in person adds one, with the
  // access token of their sign-in, never an instance with its own token.
  if (deps.auth && deps.instances) {
    const auth = deps.auth;
    const instances = deps.instances;
    const person = createMiddleware<Env>(async (c, next) => {
      const token = bearer(c.req.header('authorization'));
      const userId = token ? await auth.userIdForAccessToken(token) : null;
      const account = userId ? await deps.store.accountForUser(userId) : null;
      if (!account) return c.json({ error: { code: 'unauthorized' } }, 401);
      c.set('account', account);
      await next();
    });
    app.use('/v1/devices', person);
    app.use('/v1/devices/*', person);

    // The app calls this once signed in: the instance is created the first
    // time, and the device gets the key it will show the gateway.
    app.post('/v1/devices', async (c) => {
      const account = c.get('account');
      const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Appareil';
      try {
        await instances.ensure(account);
      } catch (err) {
        if (err instanceof InstanceUnavailable) {
          return c.json({ error: { code: err.problem === 'full' ? 'instances_full' : 'instances_off' } }, 503);
        }
        console.error('[control] instance creation failed', err);
        return c.json({ error: { code: 'instance_unavailable' } }, 503);
      }
      const active = (await deps.store.devices(account.id)).filter((d) => d.revokedAt === null);
      if (active.length >= MAX_DEVICES) return c.json({ error: { code: 'too_many_devices' } }, 409);
      const key = `bdk_${randomBytes(32).toString('base64url')}`;
      const device = { id: `dev_${randomUUID()}`, accountId: account.id, name, createdAt: deps.now(), lastSeenAt: null, revokedAt: null };
      await deps.store.addDevice(device, hashToken(key));
      return c.json({ device: publicDevice(device), server: { url: `${deps.publicUrl}${GATEWAY_PATH}`, key } }, 201);
    });

    app.get('/v1/devices', async (c) => c.json({ data: (await deps.store.devices(c.get('account').id)).map(publicDevice) }));

    app.delete('/v1/devices/:id', async (c) => {
      const revoked = await deps.store.revokeDevice(c.get('account').id, c.req.param('id'), deps.now());
      return revoked ? c.body(null, 204) : c.json({ error: { code: 'not_found' } }, 404);
    });
  }

  if (deps.gateway) {
    const gateway = deps.gateway;
    app.all(GATEWAY_PATH, (c) => gateway.http(c.req.raw));
    app.all(`${GATEWAY_PATH}/*`, (c) => gateway.http(c.req.raw));
  }

  app.post('/v1/admin/media-credits', async (c) => {
    if (!isAdmin({ ...deps, packs: deps.mediaPacks }, bearer(c.req.header('authorization')))) {
      return c.json({ error: { code: 'not_found' } }, 404);
    }
    return topUpMedia({ ...deps, packs: deps.mediaPacks }, c.req.raw);
  });

  return app;
}
