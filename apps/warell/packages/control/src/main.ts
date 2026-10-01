import { serve } from '@hono/node-server';
import pg from 'pg';
import { createApp } from './app.js';
import { ASSUMPTIONS, MEDIA_PACKS, OFFERS } from './catalog.js';
import { packCredits, plansFrom } from './pricing.js';
import { migrate, poolDb } from './db.js';
import { PgStore } from './pg-store.js';
import { MemoryStore, hashToken, type Account, type ControlStore } from './store.js';

// Entry point (roadmap §4): the owner, their instance token, the plan catalog
// of catalog.ts. With DATABASE_URL, everything lives in Postgres (decided
// 01/10/2026); without it, in memory, forgotten when the machine stops.

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

const instanceToken = required('WARELL_INSTANCE_TOKEN');
let store: ControlStore;
if (process.env.DATABASE_URL) {
  const db = poolDb(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));
  console.log(`[control] ${await migrate(db)} migration(s) applied`);
  const pgStore = new PgStore(db, plans);
  // An existing account keeps its creation date: its weeks stay anchored there.
  await pgStore.upsertAccount(owner);
  await pgStore.grantToken(instanceToken, owner.id);
  store = pgStore;
} else {
  store = new MemoryStore(new Map([[hashToken(instanceToken), owner]]), plans);
}

// The owner's media credits, granted once: in Postgres the reference is
// already taken on the next start; in memory everything was forgotten, so
// the grant comes back (phase 0 only).
const ownerMediaCredits = Number(process.env.WARELL_OWNER_MEDIA_CREDITS ?? '0');
if (Number.isInteger(ownerMediaCredits) && ownerMediaCredits > 0) {
  await store.applyMediaEntry({ accountId: owner.id, at: Date.now(), kind: 'topup', credits: ownerMediaCredits, reference: 'owner-grant' });
}

const app = createApp({
  store,
  openRouterKey: required('OPENROUTER_API_KEY'),
  publicUrl,
  appName: process.env.WARELL_APP_NAME ?? 'Warell',
  // Optional: without it, media generation answers 503 and text still works.
  pixazoKey: process.env.PIXAZO_API_KEY || undefined,
  mediaPacks: MEDIA_PACKS.map((pack) => ({ id: pack.id, credits: packCredits(pack, ASSUMPTIONS), prices: pack.prices })),
  adminTokenHash: process.env.WARELL_ADMIN_TOKEN ? hashToken(process.env.WARELL_ADMIN_TOKEN) : undefined,
  fetch: globalThis.fetch,
  now: Date.now,
});

const port = Number(process.env.PORT ?? '8080');
serve({ fetch: app.fetch, port }, () => {
  console.log(`[control] listening on :${port}`);
});
