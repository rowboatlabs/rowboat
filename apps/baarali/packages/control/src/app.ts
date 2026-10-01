import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { buildApiConfig } from './config.js';
import { proxyLlm, type ProxyDeps } from './llm-proxy.js';
import { isAdmin, topUpMedia, type SoldPack } from './admin.js';
import { AUTH_BASE_PATH, type BaaraliAuth } from './auth.js';
import { createGeneration, getGeneration, listMediaModels, mediaBalance } from './media-route.js';
import { budgetsForWeek, gauges, initialState } from './quota.js';
import type { Account } from './store.js';

export type ControlDeps = ProxyDeps & {
  /** Unset: media generation is off (503). */
  pixazoKey?: string;
  pixazoBase?: string;
  /** The media credit packs on sale (pricing.ts, packCredits). */
  mediaPacks: SoldPack[];
  /** SHA-256 of the operator token; unset: /v1/admin answers 404. */
  adminTokenHash?: string;
  /** The sign-in server; unset: only instance tokens open /v1 (phase 0). */
  auth?: BaaraliAuth;
};

type Env = { Variables: { account: Account } };

function bearer(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function createApp(deps: ControlDeps) {
  const app = new Hono<Env>();

  app.get('/health', (c) => c.json({ ok: true }));

  // Unauthenticated, like the Rowboat Labs route: core reads it before login.
  app.get('/v1/config', async (c) =>
    c.json(buildApiConfig({ publicUrl: deps.publicUrl }, await deps.store.plans())),
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
    return userId ? deps.store.account(userId) : null;
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

  // Same body as the Rowboat Labs /v1/me (core billing/billing.ts reads it).
  // Session → `daily`, week → `monthly`: see architecture §3.5.
  app.get('/v1/me', async (c) => {
    const account = c.get('account');
    const plan = await deps.store.plan(account.planId);
    const state = (await deps.store.quotaState(account.id)) ?? initialState(account.createdAt);
    const g = gauges(state, budgetsForWeek(plan?.weekCredits ?? 0), deps.now());
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
          monthly: bucket(g.week),
          daily: { ...bucket(g.session), usageDay: new Date(g.session.resetsAt).toISOString() },
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

  app.post('/v1/admin/media-credits', async (c) => {
    if (!isAdmin({ ...deps, packs: deps.mediaPacks }, bearer(c.req.header('authorization')))) {
      return c.json({ error: { code: 'not_found' } }, 404);
    }
    return topUpMedia({ ...deps, packs: deps.mediaPacks }, c.req.raw);
  });

  return app;
}
