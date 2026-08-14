#!/usr/bin/env node
import { PgStore } from './pg-store.js';
import { startHarbor } from './server.js';
import { postgresDb } from './sql.js';
import type { Store } from './store.js';

// Dev entry: a seeded single-org Harbor for dogfooding. The seed is the
// Roadboard slice from spec §11 — the team, the space, the roadmap.
// In-memory by default (restart = clean slate); set DATABASE_URL for durable
// Postgres storage (seeding is idempotent across restarts).

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

let store: Store | undefined;
if (process.env.DATABASE_URL) {
  const pgStore = new PgStore(postgresDb(process.env.DATABASE_URL));
  await pgStore.init();
  store = pgStore;
}

const harbor = await startHarbor({
  port,
  ...(store ? { store } : {}),
  orgName: process.env.HARBOR_ORG ?? 'Rowboat Labs (dev)',
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
console.log(`  auth       Bearer dev-<memberId>   e.g. "Authorization: Bearer dev-ramnique"`);
console.log(`  members    ${TEAM.map((m) => m.id).join(', ')}`);
for (const s of spaces) {
  console.log(`  space      ${s.name}  ${s.id}`);
}
console.log(``);
console.log(`  try        curl -H 'Authorization: Bearer dev-ramnique' ${harbor.url}/v1/spaces`);
