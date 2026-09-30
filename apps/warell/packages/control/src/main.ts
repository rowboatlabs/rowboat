import { serve } from '@hono/node-server';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { createApp } from './app.js';
import { MemoryStore, hashToken, type Account, type Plan } from './store.js';

// Phase 0 entry point (roadmap §4, PR 2): one owner, one instance token, one
// plan whose week budget comes from the environment. Accounts, plans and
// usage move to Postgres with the first multi-user deployment.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const publicUrl = required('WARELL_PUBLIC_URL').replace(/\/+$/, '');
const weekBudgetUsd = Number(process.env.WARELL_WEEK_BUDGET_USD ?? '5');
if (!Number.isFinite(weekBudgetUsd) || weekBudgetUsd <= 0) {
  throw new Error('WARELL_WEEK_BUDGET_USD must be a positive number of dollars');
}

const plan: Plan = {
  id: 'phase0',
  category: 'starter',
  displayName: 'Phase 0',
  weekCredits: Math.round(weekBudgetUsd * CREDITS_PER_DOLLAR),
};
const owner: Account = {
  id: process.env.WARELL_ACCOUNT_ID ?? 'owner',
  email: process.env.WARELL_ACCOUNT_EMAIL ?? null,
  planId: plan.id,
  createdAt: Date.parse(process.env.WARELL_ACCOUNT_CREATED_AT ?? '') || Date.now(),
};

const store = new MemoryStore(new Map([[hashToken(required('WARELL_INSTANCE_TOKEN')), owner]]), [plan]);

const app = createApp({
  store,
  openRouterKey: required('OPENROUTER_API_KEY'),
  publicUrl,
  appName: process.env.WARELL_APP_NAME ?? 'Warell',
  fetch: globalThis.fetch,
  now: Date.now,
});

const port = Number(process.env.PORT ?? '8080');
serve({ fetch: app.fetch, port }, () => {
  console.log(`[control] listening on :${port}`);
});
