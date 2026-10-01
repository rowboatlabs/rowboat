import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ASSUMPTIONS, OFFERS } from './catalog.js';
import { plansFrom } from './pricing.js';
import { MemoryStore, hashToken, type Account } from './store.js';

// Phase 0 entry point (roadmap §4): one owner, one instance token, the plan
// catalog of catalog.ts. Accounts and usage move to Postgres with the first
// multi-user deployment.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const publicUrl = required('WARELL_PUBLIC_URL').replace(/\/+$/, '');
const plans = plansFrom(OFFERS, ASSUMPTIONS);
const planId = process.env.WARELL_PLAN_ID ?? 'essentiel';
if (!plans.some((p) => p.id === planId)) {
  throw new Error(`WARELL_PLAN_ID must be one of: ${plans.map((p) => p.id).join(', ')}`);
}
const owner: Account = {
  id: process.env.WARELL_ACCOUNT_ID ?? 'owner',
  email: process.env.WARELL_ACCOUNT_EMAIL ?? null,
  planId,
  createdAt: Date.parse(process.env.WARELL_ACCOUNT_CREATED_AT ?? '') || Date.now(),
};

const store = new MemoryStore(new Map([[hashToken(required('WARELL_INSTANCE_TOKEN')), owner]]), plans);

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
