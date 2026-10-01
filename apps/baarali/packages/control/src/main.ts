import { serve } from '@hono/node-server';
import pg from 'pg';
import { createApp } from './app.js';
import { SOCIAL_PROVIDERS, createAuth, migrateAuth, type AuthDeps, type SocialCredentials, type BaaraliAuth } from './auth.js';
import { LogSender, NoSender, ResendSender, type CodeSender } from './codes.js';
import { ASSUMPTIONS, MEDIA_PACKS, OFFERS } from './catalog.js';
import { packCredits, plansFrom } from './pricing.js';
import { migrate, poolDb } from './db.js';
import { PgStore } from './pg-store.js';
import { MemoryStore, hashToken, type Account, type ControlStore } from './store.js';

// Entry point (roadmap §4): the owner, their instance token, the plan catalog
// of catalog.ts. With DATABASE_URL, everything lives in Postgres (decided
// 01/10/2026); without it, in memory, forgotten when the machine stops.

/** Codes in the log are for development only: never set BAARALI_DEV_CODES in production. */
function codeSender(): CodeSender {
  if (process.env.BAARALI_DEV_CODES === '1') return new LogSender();
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return new ResendSender(process.env.RESEND_API_KEY, process.env.EMAIL_FROM);
  return new NoSender();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const publicUrl = required('BAARALI_PUBLIC_URL').replace(/\/+$/, '');
const plans = plansFrom(OFFERS, ASSUMPTIONS);
const planId = process.env.BAARALI_PLAN_ID ?? 'essentiel';
if (!plans.some((p) => p.id === planId)) {
  throw new Error(`BAARALI_PLAN_ID must be one of: ${plans.map((p) => p.id).join(', ')}`);
}
const owner: Account = {
  id: process.env.BAARALI_ACCOUNT_ID ?? 'owner',
  email: process.env.BAARALI_ACCOUNT_EMAIL ?? null,
  planId,
  createdAt: Date.parse(process.env.BAARALI_ACCOUNT_CREATED_AT ?? '') || Date.now(),
};

const instanceToken = required('BAARALI_INSTANCE_TOKEN');
let store: ControlStore;
let auth: BaaraliAuth | undefined;
if (process.env.DATABASE_URL) {
  // Our statements name the `baarali` schema; Better Auth's do not, so the
  // search path puts its tables there too (architecture §3.5).
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  // Set on each new connection rather than as a startup option, which some
  // poolers drop silently (seen 01/10/2026: Better Auth's tables then landed
  // in `public`). A client runs its queries in order, so this one goes first
  // (pg 8 warns that queueing is deprecated; pinned to 8, revisit with pg 9).
  pool.on('connect', (client) => {
    client.query('SET search_path TO baarali').catch((err: unknown) => console.error('[control] search_path', err));
  });
  const db = poolDb(pool);
  console.log(`[control] ${await migrate(db)} migration(s) applied`);
  const pgStore = new PgStore(db, plans);
  // An existing account keeps its creation date: its weeks stay anchored there.
  await pgStore.upsertAccount(owner);
  await pgStore.grantToken(instanceToken, owner.id);
  store = pgStore;

  // The sign-in server (architecture §3.5 "Comptes et connexion"): only with
  // its secret, so a deployment without one keeps phase 0's instance token.
  if (process.env.BAARALI_AUTH_SECRET) {
    const social = Object.fromEntries(
      SOCIAL_PROVIDERS.flatMap((p): Array<[string, SocialCredentials]> => {
        const id = process.env[`${p.toUpperCase()}_CLIENT_ID`];
        const secret = process.env[`${p.toUpperCase()}_CLIENT_SECRET`];
        return id && secret ? [[p, { clientId: id, clientSecret: secret }]] : [];
      }),
    );
    const authDeps: AuthDeps = {
      publicUrl,
      secret: process.env.BAARALI_AUTH_SECRET,
      database: pool,
      db,
      sender: codeSender(),
      social,
      onUserCreated: (u) => pgStore.upsertAccount({ id: u.id, email: u.email, planId: 'decouverte', createdAt: u.createdAt }),
      now: Date.now,
    };
    await migrateAuth(authDeps);
    auth = createAuth(authDeps);
    console.log(`[control] sign-in: ${[...(authDeps.sender.email ? ['email'] : []), ...(authDeps.sender.sms ? ['sms'] : []), ...Object.keys(social)].join(', ') || 'no method yet'}`);
  }
} else {
  store = new MemoryStore(new Map([[hashToken(instanceToken), owner]]), plans);
}

// The owner's media credits, granted once: in Postgres the reference is
// already taken on the next start; in memory everything was forgotten, so
// the grant comes back (phase 0 only).
const ownerMediaCredits = Number(process.env.BAARALI_OWNER_MEDIA_CREDITS ?? '0');
if (Number.isInteger(ownerMediaCredits) && ownerMediaCredits > 0) {
  await store.applyMediaEntry({ accountId: owner.id, at: Date.now(), kind: 'topup', credits: ownerMediaCredits, reference: 'owner-grant' });
}

const app = createApp({
  store,
  openRouterKey: required('OPENROUTER_API_KEY'),
  publicUrl,
  appName: process.env.BAARALI_APP_NAME ?? 'Baarali',
  // Optional: without it, media generation answers 503 and text still works.
  pixazoKey: process.env.PIXAZO_API_KEY || undefined,
  mediaPacks: MEDIA_PACKS.map((pack) => ({ id: pack.id, credits: packCredits(pack, ASSUMPTIONS), prices: pack.prices })),
  adminTokenHash: process.env.BAARALI_ADMIN_TOKEN ? hashToken(process.env.BAARALI_ADMIN_TOKEN) : undefined,
  auth,
  fetch: globalThis.fetch,
  now: Date.now,
});

const port = Number(process.env.PORT ?? '8080');
serve({ fetch: app.fetch, port }, () => {
  console.log(`[control] listening on :${port}`);
});
