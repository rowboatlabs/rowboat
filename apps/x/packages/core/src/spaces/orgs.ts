import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { SpacesClient } from './client.js';
import { SpacesLive } from './live.js';

// Org registry: which orgs this install is signed into, and the live client
// pair (REST + WS) for each. Config only carries identity/credentials — spaces
// and content always come live from the org (spec: one canonical copy, the app
// is a browser).
//
// v0 auth is the stub's dev tokens. The OAuth journey (discovery/DCR/PKCE/
// refresh, per the protocol's invite.ts header) replaces OrgAuth and
// tokenFor() — nothing else in this file changes shape.

export interface OrgAuth {
  kind: 'dev';
  memberId: string;
}

export interface OrgRecord {
  /** Local identifier (not the org address — addresses can change via aliases). */
  id: string;
  name: string;
  /** The org address links are minted on, e.g. localhost:4272 or acme.rowboat.space. */
  address: string;
  /** Where to reach it, scheme included, e.g. http://localhost:4272. */
  baseUrl: string;
  auth: OrgAuth;
}

interface SpacesOrgsConfig {
  version: 1;
  orgs: OrgRecord[];
}

const CONFIG_FILE = path.join(WorkDir, 'config', 'spaces_orgs.json');

function readConfig(): SpacesOrgsConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { version: 1, orgs: [] };
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Partial<SpacesOrgsConfig>;
    return { version: 1, orgs: Array.isArray(raw.orgs) ? raw.orgs : [] };
  } catch {
    return { version: 1, orgs: [] };
  }
}

function writeConfig(config: SpacesOrgsConfig): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function tokenFor(auth: OrgAuth): string {
  return `dev-${auth.memberId}`;
}

// Each org's MCP agent face is exposed to the user's own agent as a DERIVED
// MCP server entry — never written to mcp.json. The org registry (this file's
// config) is the single source of truth; core/mcp merges these entries into
// its server list at read time (spec §11 build item 3: same tools, same token
// as any foreign agent — no privileged path). Deriving instead of registering
// makes registry↔mcp.json drift structurally impossible.

export interface DerivedMcpServer {
  url: string;
  headers: Record<string, string>;
}

function deriveWithNames(orgRecords: OrgRecord[]): {
  entries: Record<string, DerivedMcpServer>;
  nameByOrgId: Record<string, string>;
} {
  const entries: Record<string, DerivedMcpServer> = {};
  const nameByOrgId: Record<string, string> = {};
  for (const org of orgRecords) {
    const slug = org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || org.id;
    // Deterministic names, unique even when the same org is added under two
    // identities (the multiplayer-testing case): slug, then slug-member, then id.
    let name = `spaces-${slug}`;
    if (entries[name]) name = `spaces-${slug}-${org.auth.memberId}`;
    if (entries[name]) name = `spaces-${org.id}`;
    entries[name] = {
      url: `${org.baseUrl}/mcp`,
      headers: {
        authorization: `Bearer ${tokenFor(org.auth)}`,
        'x-agent-name': 'Rowboat',
      },
    };
    nameByOrgId[org.id] = name;
  }
  return { entries, nameByOrgId };
}

/** Pure derivation — exported for tests; `spacesMcpServers()` is the live view. */
export function deriveSpacesMcpServers(orgRecords: OrgRecord[]): Record<string, DerivedMcpServer> {
  return deriveWithNames(orgRecords).entries;
}

export function spacesMcpServers(): Record<string, DerivedMcpServer> {
  return deriveSpacesMcpServers(listOrgs());
}

/**
 * The server name assigned to one org in the FULL derived view. Never derive
 * a name from a single org record: dedup suffixes depend on the whole registry
 * (a single-org derivation would name the second identity of an org after the
 * first one's entry — the wrong credentials).
 */
export function spacesMcpServerNameFor(orgId: string): string | null {
  return deriveWithNames(listOrgs()).nameByOrgId[orgId] ?? null;
}

interface OrgRuntime {
  client: SpacesClient;
  live: SpacesLive;
}

const runtimes = new Map<string, OrgRuntime>();

export function listOrgs(): OrgRecord[] {
  return readConfig().orgs;
}

export function getOrg(orgId: string): OrgRecord | undefined {
  return readConfig().orgs.find((o) => o.id === orgId);
}

/**
 * Add an org by reaching it (the health probe doubles as address discovery)
 * and remembering how we authenticate. Idempotent on (baseUrl, memberId).
 */
export async function addDevOrg(input: { baseUrl: string; memberId: string }): Promise<OrgRecord> {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const probe = new SpacesClient({ baseUrl, token: tokenFor({ kind: 'dev', memberId: input.memberId }) });
  const health = await probe.health();

  const config = readConfig();
  const existing = config.orgs.find((o) => o.baseUrl === baseUrl && o.auth.memberId === input.memberId);
  if (existing) {
    existing.name = health.org.name;
    existing.address = health.org.address;
    writeConfig(config);
    return existing;
  }
  const record: OrgRecord = {
    id: `org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: health.org.name,
    address: health.org.address,
    baseUrl,
    auth: { kind: 'dev', memberId: input.memberId },
  };
  config.orgs.push(record);
  writeConfig(config);
  return record;
}

export async function removeOrg(orgId: string): Promise<void> {
  const config = readConfig();
  config.orgs = config.orgs.filter((o) => o.id !== orgId);
  writeConfig(config);
  const runtime = runtimes.get(orgId);
  if (runtime) {
    runtime.live.close();
    runtimes.delete(orgId);
  }
}

/** The client pair for an org — created lazily, one WS per org for the process lifetime. */
export function orgRuntime(orgId: string): OrgRuntime {
  const cached = runtimes.get(orgId);
  if (cached) return cached;
  const org = getOrg(orgId);
  if (!org) throw new Error(`unknown org ${orgId}`);
  const token = tokenFor(org.auth);
  const runtime: OrgRuntime = {
    client: new SpacesClient({ baseUrl: org.baseUrl, token }),
    live: new SpacesLive({ baseUrl: org.baseUrl, token }),
  };
  runtimes.set(orgId, runtime);
  return runtime;
}

export function getClient(orgId: string): SpacesClient {
  return orgRuntime(orgId).client;
}

export function getLive(orgId: string): SpacesLive {
  return orgRuntime(orgId).live;
}

export function closeAll(): void {
  for (const runtime of runtimes.values()) runtime.live.close();
  runtimes.clear();
}
