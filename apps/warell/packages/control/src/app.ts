import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { buildApiConfig } from './config.js';
import { proxyLlm, type ProxyDeps } from './llm-proxy.js';
import { budgetsForWeek, gauges, initialState } from './quota.js';
import type { Account } from './store.js';

export type ControlDeps = ProxyDeps;

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

  const authed = createMiddleware<Env>(async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    const account = token ? await deps.store.accountByToken(token) : null;
    if (!account) return c.json({ error: { code: 'unauthorized' } }, 401);
    c.set('account', account);
    await next();
  });
  app.use('/v1/me', authed);
  app.use('/v1/llm/*', authed);

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

  return app;
}
