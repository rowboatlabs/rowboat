#!/usr/bin/env node
import type { AuthDriver } from './auth.js';
import { OidcAuthDriver } from './auth-oidc.js';
import { PgStore } from './pg-store.js';
import { startHarbor } from './server.js';
import { postgresDb } from './sql.js';
import type { Store } from './store.js';

// Dev entry: a seeded single-org Harbor for dogfooding. The seed is the
// Roadboard slice from spec §11 — the team, the space, the roadmap.
// In-memory by default (restart = clean slate); set DATABASE_URL for durable
// Postgres storage (seeding is idempotent across restarts). Set AUTH_ISSUER
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
  const deployment = await startHarborDeployment({
    db: postgresDb(process.env.DATABASE_URL!),
    port,
    apexDomain: process.env.APEX_DOMAIN!,
    issuer: process.env.AUTH_ISSUER!,
    ...(process.env.AUTH_PUBLISHABLE_KEY ? { consentPublishableKey: process.env.AUTH_PUBLISHABLE_KEY } : {}),
  });
  console.log(`Harbor deployment (multi-org, Postgres)`);
  console.log(``);
  console.log(`  apex       https://${process.env.APEX_DOMAIN}  (create org, my orgs)`);
  console.log(`  orgs       https://<slug>.${process.env.APEX_DOMAIN}  (render /v1/*, live /v1/live, agent /mcp)`);
  console.log(`  issuer     ${process.env.AUTH_ISSUER}`);
  console.log(`  listening  :${deployment.port}`);
  process.on('SIGTERM', () => void deployment.close().then(() => process.exit(0)));
} else {
  await startDevHarbor();
}

async function startDevHarbor(): Promise<void> {
let store: Store | undefined;
if (process.env.DATABASE_URL) {
  const pgStore = new PgStore(postgresDb(process.env.DATABASE_URL));
  await pgStore.init();
  store = pgStore;
}

let auth: AuthDriver | undefined;
if (process.env.AUTH_ISSUER) {
  auth = new OidcAuthDriver({
    issuer: process.env.AUTH_ISSUER,
    ...(process.env.AUTH_AUDIENCE ? { audience: process.env.AUTH_AUDIENCE } : {}),
  });
}

const harbor = await startHarbor({
  port,
  ...(store ? { store } : {}),
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

console.log(`Harbor (single org, ${store ? 'Postgres via DATABASE_URL' : 'in-memory — restart = clean slate'})`);
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
