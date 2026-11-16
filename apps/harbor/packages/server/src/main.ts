#!/usr/bin/env node
import path from 'node:path';
import type { AuthDriver } from './auth.js';
import { OidcAuthDriver } from './auth-oidc.js';
import type { BlobStore } from './blobs.js';
import { DiskBlobStore } from './blobs-disk.js';
import { S3BlobStore } from './blobs-s3.js';
import { PgStore } from './pg-store.js';
import { startHarbor } from './server.js';
import { postgresDb } from './sql.js';

// The binary (spec §4, one server since 2026-11-09). Without HARBOR_ADDRESS it
// is the seeded dev server: the Roadboard slice from spec §11 — the team, the
// space, the roadmap — on PGlite in memory (restart = clean slate) or durable
// Postgres with DATABASE_URL (seeding is idempotent across restarts), with dev
// tokens unless AUTH_ISSUER names a pinned AS. With HARBOR_ADDRESS it is a
// deployment: DATABASE_URL and AUTH_ISSUER required, no seed, no dev tokens.

const TEAM = [
  { id: 'ramnique', displayName: 'Ramnique' },
  { id: 'arjun', displayName: 'Arjun' },
  { id: 'harsh', displayName: 'Harsh' },
  { id: 'gagan', displayName: 'Gagan' },
  { id: 'prakhar', displayName: 'Prakhar' },
];

const ROADBOARD_README = `# Roadboard

The Rowboat team roadmap, as a space.

- [roadmap.md](roadmap.md) — the living roadmap. Edit directly or push via your agent.
- Standups land here: push what you shipped, your agent merges it in.
- Questions and calls happen in the feed; decisions get folded back into the roadmap.
`;

const ROADBOARD_ROADMAP = `# Roadmap

## Now
- [ ] Spaces v1 — protocol, stub Harbor, client surfaces
- [ ] Roadboard dogfood — this file is the test

## Next
- [ ] Real Harbor (Postgres) behind the same contract
- [ ] Subscriptions, if explicit pushes feel like a chore

## Later
- [ ] Open-source Harbor
`;

const port = Number(process.env.PORT ?? 4272);

// Blob storage from env:
//   BLOBS_S3_BUCKET (+ BLOBS_S3_ENDPOINT/REGION/FORCE_PATH_STYLE,
//     credentials via the AWS provider chain or BLOBS_S3_ACCESS_KEY_ID/SECRET)
//   BLOBS_DIR — disk driver (self-hosted single-node)
// Neither set: in-memory (restart = clean slate). Until 2026-11-09 each org had
// its own prefix under these; a deployment that carries bytes from then over
// runs scripts/flatten-blobs.ts once before starting this build.
function blobStore(): BlobStore | undefined {
  const bucket = process.env.BLOBS_S3_BUCKET;
  if (bucket) {
    return new S3BlobStore({
      bucket,
      ...(process.env.BLOBS_S3_REGION ? { region: process.env.BLOBS_S3_REGION } : {}),
      ...(process.env.BLOBS_S3_ENDPOINT ? { endpoint: process.env.BLOBS_S3_ENDPOINT } : {}),
      ...(process.env.BLOBS_S3_FORCE_PATH_STYLE ? { forcePathStyle: true } : {}),
      ...(process.env.BLOBS_S3_ACCESS_KEY_ID && process.env.BLOBS_S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.BLOBS_S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.BLOBS_S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }
  const dir = process.env.BLOBS_DIR;
  if (dir) return new DiskBlobStore(dir);
  return undefined;
}

const maxBlobBytes = process.env.HARBOR_MAX_BLOB_BYTES ? Number(process.env.HARBOR_MAX_BLOB_BYTES) : undefined;
// Postgres pool ceiling (sql.ts): set DATABASE_POOL_MAX below the plan's connection limit.
const poolOpts = process.env.DATABASE_POOL_MAX ? { max: Number(process.env.DATABASE_POOL_MAX) } : {};
// The operator face (internal.ts): the live-load line lands in the log once
// a minute whenever the binary runs; HARBOR_INTERNAL_KEY additionally enables
// GET /internal/stats. Unset = the route does not exist, the line still prints.
const internal = { internal: { log: true, ...(process.env.HARBOR_INTERNAL_KEY ? { key: process.env.HARBOR_INTERNAL_KEY } : {}) } };
// A public address (HARBOR_ADDRESS, e.g. spaces.x.rowboatlabs.com) means a
// deployment: no dev tokens, no seed, real OAuth, the web origins you list.
// Without it this is the local dev server: seeded, dev tokens, the web app's
// dev origin allowed.
const address = process.env.HARBOR_ADDRESS?.trim() || undefined;
const deployment = address !== undefined;
// Browser origins allowed to call the server cross-origin (cors.ts, 2026-10-09): the Spaces web app's, comma-separated.
const webOrigins = (process.env.HARBOR_WEB_ORIGINS ?? (deployment ? '' : 'http://localhost:5174'))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
// The web app the link landings offer (http.ts, 2026-10-13): a link opened in a browser with no desktop app goes on to <this>/open.
const webAppUrl = process.env.HARBOR_WEB_APP_URL ?? (deployment ? undefined : 'http://localhost:5174');
const web = { ...(webOrigins.length > 0 ? { webOrigins } : {}), ...(webAppUrl ? { webAppUrl } : {}) };

if (deployment) {
  for (const name of ['DATABASE_URL', 'AUTH_ISSUER'] as const) {
    if (!process.env[name]) {
      console.error(`HARBOR_ADDRESS requires ${name}`);
      process.exit(1);
    }
  }
}

await start();

async function start(): Promise<void> {
// Durable Postgres via DATABASE_URL; otherwise the same store in-process on
// PGlite (restart = clean slate). The WASM engine is loaded here and only
// here — a deployment never imports it.
const db = process.env.DATABASE_URL
  ? postgresDb(process.env.DATABASE_URL, poolOpts)
  : await (await import('./sql-pglite.js')).pgliteDb();
const store = new PgStore(db);
await store.init();

let auth: AuthDriver | undefined;
if (process.env.AUTH_ISSUER) {
  auth = new OidcAuthDriver({
    issuer: process.env.AUTH_ISSUER,
    ...(process.env.AUTH_AUDIENCE ? { audience: process.env.AUTH_AUDIENCE } : {}),
  });
}

const blobs = blobStore();

const harbor = await startHarbor({
  port,
  store,
  ...(blobs ? { blobs } : {}),
  ...(maxBlobBytes !== undefined ? { maxBlobBytes } : {}),
  ...internal,
  ...web,
  ...(auth ? { auth } : {}),
  ...(auth && process.env.AUTH_PUBLISHABLE_KEY
    ? { consent: { publishableKey: process.env.AUTH_PUBLISHABLE_KEY } }
    : {}),
  name: process.env.HARBOR_NAME ?? 'Rowboat Spaces',
  ...(address ? { address } : {}),
  // The dev seed (spec §11's Roadboard): never on a deployment.
  ...(deployment
    ? {}
    : {
        seedMembers: TEAM,
        seedSpaces: [
          {
            name: 'Roadboard',
            creator: 'ramnique',
            assets: [
              { path: 'README.md', content: ROADBOARD_README, reason: 'seed the space front page' },
              { path: 'roadmap.md', content: ROADBOARD_ROADMAP, reason: 'seed the roadmap' },
            ],
          },
        ],
      }),
});

const spaces = deployment ? [] : await harbor.service.listSpaces({ memberId: 'ramnique' });

console.log(`Harbor (${process.env.DATABASE_URL ? 'Postgres via DATABASE_URL' : 'PGlite in-memory — restart = clean slate'})`);
console.log(
  `  blobs      ${process.env.BLOBS_S3_BUCKET ? `s3 bucket ${process.env.BLOBS_S3_BUCKET}` : process.env.BLOBS_DIR ? `disk ${process.env.BLOBS_DIR}` : 'in-memory (set BLOBS_DIR or BLOBS_S3_BUCKET for durable uploads)'}`,
);
console.log(``);
console.log(`  server     ${harbor.service.server.name}  @  ${harbor.address}`);
console.log(`  render     ${harbor.url}/v1/*`);
console.log(`  live       ws://localhost:${harbor.port}/v1/live`);
console.log(`  agent      ${harbor.mcpUrl}  (MCP streamable HTTP)`);
console.log(``);
if (auth) {
  console.log(`  auth       OIDC — issuer ${process.env.AUTH_ISSUER} (JWKS-verified bearers)`);
  if (process.env.AUTH_PUBLISHABLE_KEY) {
    console.log(`  consent    ${harbor.url}/oauth/consent  (point the AS's authorization_url here)`);
  }
} else {
  console.log(`  auth       Bearer dev-<memberId>   e.g. "Authorization: Bearer dev-ramnique"`);
  console.log(`             *** DEV AUTH — anyone can be anyone. NEVER expose this publicly. ***`);
}
if (!deployment) console.log(`  members    ${TEAM.map((m) => m.id).join(', ')}`);
for (const s of spaces) {
  console.log(`  space      ${s.name}  ${s.id}`);
}
console.log(``);
if (!deployment) console.log(`  try        curl -H 'Authorization: Bearer dev-ramnique' ${harbor.url}/v1/spaces`);
console.log(`  web        ${webOrigins.length > 0 ? webOrigins.join(', ') : 'no browser origins (set HARBOR_WEB_ORIGINS)'}`);
console.log(`  platforms  ${process.env.HARBOR_INTEGRATION_KEY ? 'Replicas, Agent37, Conductor, PostHog and Cal.com agents can be added (sealing key set)' : 'off — Replicas, Agent37, Conductor, PostHog and Cal.com agents need HARBOR_INTEGRATION_KEY'}`);
process.on('SIGTERM', () => void harbor.close().then(() => process.exit(0)));
}
