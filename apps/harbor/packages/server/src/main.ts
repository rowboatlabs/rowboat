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

// Dev entry: a seeded single-org Harbor for dogfooding. The seed is the
// Roadboard slice from spec §11 — the team, the space, the roadmap.
// PGlite in-memory by default — the Postgres store, in-process; restart =
// clean slate — or durable Postgres with DATABASE_URL (seeding is idempotent
// across restarts). Set AUTH_ISSUER
// to a pinned AS issuer URL for real OAuth (dev tokens otherwise — never
// expose those publicly). Until the invite ceremony lands, oidc members are
// seeded by inserting (iss, sub) rows into member_identities directly.

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

// Blob storage from env, either mode. Dedup scope is per org (spec §6), so the
// deployment factory scopes every driver by orgId; the single-org dev path
// passes orgId 'org-default'.
//   BLOBS_S3_BUCKET (+ BLOBS_S3_ENDPOINT/REGION/FORCE_PATH_STYLE,
//     credentials via the AWS provider chain or BLOBS_S3_ACCESS_KEY_ID/SECRET)
//   BLOBS_DIR — disk driver (self-hosted single-node)
// Neither set: dev mode keeps blob bytes in memory (restart = clean slate);
// deployment mode leaves uploads unconfigured and the routes refuse loudly.
function blobStoreFactory(): ((orgId: string) => BlobStore) | undefined {
  const bucket = process.env.BLOBS_S3_BUCKET;
  if (bucket) {
    return (orgId) =>
      new S3BlobStore({
        bucket,
        prefix: `blobs/${orgId}/`,
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
  if (dir) return (orgId) => new DiskBlobStore(path.join(dir, orgId));
  return undefined;
}

const maxBlobBytes = process.env.HARBOR_MAX_BLOB_BYTES ? Number(process.env.HARBOR_MAX_BLOB_BYTES) : undefined;
// Postgres pool ceiling (sql.ts): pg's default of 10 is shared by every org on
// a deployment; set DATABASE_POOL_MAX below the plan's connection limit.
const poolOpts = process.env.DATABASE_POOL_MAX ? { max: Number(process.env.DATABASE_POOL_MAX) } : {};
// The operator face (internal.ts): the live-load line lands in the log once
// a minute whenever the binary runs; HARBOR_INTERNAL_KEY additionally enables
// GET /internal/stats. Unset = the route does not exist, the line still prints.
const internal = { internal: { log: true, ...(process.env.HARBOR_INTERNAL_KEY ? { key: process.env.HARBOR_INTERNAL_KEY } : {}) } };

// Deployment mode (the managed fleet / any multi-org host): HARBOR_MODE=deployment
// + DATABASE_URL + APEX_DOMAIN + AUTH_ISSUER. No seeding, no dev tokens —
// orgs are created self-serve on the apex face; members arrive via OAuth +
// invite binds. Render sets PORT.
if (process.env.HARBOR_MODE === 'deployment') {
  const { startHarborDeployment } = await import('./deployment.js');
  const required = ['DATABASE_URL', 'APEX_DOMAIN', 'AUTH_ISSUER'] as const;
  for (const name of required) {
    if (!process.env[name]) {
      console.error(`HARBOR_MODE=deployment requires ${name}`);
      process.exit(1);
    }
  }
  const blobs = blobStoreFactory();
  const deployment = await startHarborDeployment({
    db: postgresDb(process.env.DATABASE_URL!, poolOpts),
    port,
    apexDomain: process.env.APEX_DOMAIN!,
    issuer: process.env.AUTH_ISSUER!,
    ...(process.env.AUTH_PUBLISHABLE_KEY ? { consentPublishableKey: process.env.AUTH_PUBLISHABLE_KEY } : {}),
    ...(blobs ? { blobs } : {}),
    ...(maxBlobBytes !== undefined ? { maxBlobBytes } : {}),
    ...internal,
  });
  console.log(`Harbor deployment (multi-org, Postgres)`);
  console.log(``);
  console.log(`  apex       https://${process.env.APEX_DOMAIN}  (create org, my orgs)`);
  console.log(`  orgs       https://<slug>.${process.env.APEX_DOMAIN}  (render /v1/*, live /v1/live, agent /mcp)`);
  console.log(`  issuer     ${process.env.AUTH_ISSUER}`);
  console.log(
    `  blobs      ${process.env.BLOBS_S3_BUCKET ? `s3 bucket ${process.env.BLOBS_S3_BUCKET}` : process.env.BLOBS_DIR ? `disk ${process.env.BLOBS_DIR}` : 'UNCONFIGURED — uploads will be refused (set BLOBS_S3_BUCKET or BLOBS_DIR)'}`,
  );
  console.log(`  internal   ${process.env.HARBOR_INTERNAL_KEY ? 'GET /internal/stats (operator key set)' : 'off (set HARBOR_INTERNAL_KEY)'}`);
  console.log(`  listening  :${deployment.port}`);
  process.on('SIGTERM', () => void deployment.close().then(() => process.exit(0)));
} else {
  await startDevHarbor();
}

async function startDevHarbor(): Promise<void> {
// Durable Postgres via DATABASE_URL; otherwise the same store in-process on
// PGlite (restart = clean slate). The WASM engine is loaded here and only
// here — deployment mode never imports it.
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

const blobFactory = blobStoreFactory();

const harbor = await startHarbor({
  port,
  store,
  ...(blobFactory ? { blobs: blobFactory('org-default') } : {}),
  ...(maxBlobBytes !== undefined ? { maxBlobBytes } : {}),
  ...internal,
  ...(auth ? { auth } : {}),
  ...(auth && process.env.AUTH_PUBLISHABLE_KEY
    ? { consent: { publishableKey: process.env.AUTH_PUBLISHABLE_KEY } }
    : {}),
  orgName: process.env.HARBOR_ORG ?? 'Rowboat Labs (dev)',
  ...(process.env.HARBOR_ALLOWED_DOMAINS
    ? { allowedEmailDomains: process.env.HARBOR_ALLOWED_DOMAINS.split(',').map((d) => d.trim()).filter(Boolean) }
    : {}),
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
});

const spaces = await harbor.service.listSpaces({ memberId: 'ramnique' });

console.log(`Harbor (single org, ${process.env.DATABASE_URL ? 'Postgres via DATABASE_URL' : 'PGlite in-memory — restart = clean slate'})`);
console.log(
  `  blobs      ${process.env.BLOBS_S3_BUCKET ? `s3 bucket ${process.env.BLOBS_S3_BUCKET}` : process.env.BLOBS_DIR ? `disk ${process.env.BLOBS_DIR}` : 'in-memory (set BLOBS_DIR or BLOBS_S3_BUCKET for durable uploads)'}`,
);
console.log(``);
console.log(`  org        ${harbor.service.org.name}  @  ${harbor.address}`);
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
console.log(`  members    ${TEAM.map((m) => m.id).join(', ')}`);
for (const s of spaces) {
  console.log(`  space      ${s.name}  ${s.id}`);
}
console.log(``);
console.log(`  try        curl -H 'Authorization: Bearer dev-ramnique' ${harbor.url}/v1/spaces`);
}
