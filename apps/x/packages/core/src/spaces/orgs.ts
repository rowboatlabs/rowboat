import fs from 'fs';
import path from 'path';
import * as oauthClient from '../auth/oauth-client.js';
import { WorkDir } from '../config/config.js';
import { SpacesClient } from './client.js';
import { SpacesLive } from './live.js';

// Org registry: which orgs this install is signed into, and the live client
// pair (REST + WS) for each. Config only carries identity/credentials — spaces
// and content always come live from the org (spec: one canonical copy, the app
// is a browser).
//
// Two auth kinds: the stub's dev tokens, and real OAuth (the dance lives in
// oauth.ts; this file owns the tokens' lifecycle). OAuth refresh tokens
// ROTATE on every use (spike-verified), so refresh is single-flight per org
// and the new refresh token is persisted BEFORE the new access token is
// handed out. A dead refresh marks the org needs-relogin (`auth.error`) —
// visible and gentle, never a silently failing org (spec §4).

export interface OrgOAuthTokens {
  access: string;
  refresh: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export type OrgAuth =
  | { kind: 'dev'; memberId: string }
  | {
      kind: 'oauth';
      issuer: string;
      clientId: string;
      /** Learned from /v1/me (or the invite bind) after the dance. */
      memberId: string;
      tokens: OrgOAuthTokens;
      /** Set when refresh fails: the org needs a re-login. Cleared by a fresh dance. */
      error?: string;
    };

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

/** The bearer as of right now, no refresh — for synchronous derivation (MCP entries). */
function currentBearer(auth: OrgAuth): string {
  return auth.kind === 'dev' ? `dev-${auth.memberId}` : auth.tokens.access;
}

function mutateOrgAuth(orgId: string, fn: (auth: Extract<OrgAuth, { kind: 'oauth' }>) => void): void {
  const config = readConfig();
  const org = config.orgs.find((o) => o.id === orgId);
  if (!org || org.auth.kind !== 'oauth') return;
  fn(org.auth);
  writeConfig(config);
}

const refreshFlights = new Map<string, Promise<string>>();

/**
 * A token guaranteed usable right now: dev tokens verbatim; OAuth access
 * tokens refreshed when expired (or on `forceRefresh` — the 401 path).
 * Single-flight per org: rotation means two parallel refreshes would
 * invalidate each other's result.
 */
export async function freshTokenFor(orgId: string, opts?: { forceRefresh?: boolean }): Promise<string> {
  const org = getOrg(orgId);
  if (!org) throw new Error(`unknown org ${orgId}`);
  if (org.auth.kind === 'dev') return `dev-${org.auth.memberId}`;
  const now = Math.floor(Date.now() / 1000);
  if (!opts?.forceRefresh && org.auth.tokens.expiresAt > now + 60) return org.auth.tokens.access;
  const inFlight = refreshFlights.get(orgId);
  if (inFlight) return inFlight;
  const flight = refreshOrgTokens(org.id, org.auth).finally(() => refreshFlights.delete(orgId));
  refreshFlights.set(orgId, flight);
  return flight;
}

async function refreshOrgTokens(orgId: string, auth: Extract<OrgAuth, { kind: 'oauth' }>): Promise<string> {
  try {
    const config = await oauthClient.discoverConfiguration(auth.issuer, auth.clientId);
    const refreshed = await oauthClient.refreshTokens(config, auth.tokens.refresh);
    // Rotation discipline: the OLD refresh token just died — persist the new
    // pair before anything uses the new access token.
    mutateOrgAuth(orgId, (a) => {
      a.tokens = {
        access: refreshed.access_token,
        refresh: refreshed.refresh_token ?? auth.tokens.refresh,
        expiresAt: refreshed.expires_at,
      };
      delete a.error;
    });
    return refreshed.access_token;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mutateOrgAuth(orgId, (a) => {
      a.error = message;
    });
    throw new Error(`org needs re-login: ${message}`);
  }
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
    // OAuth orgs: the CURRENT access token (entries derive per-read; a
    // rotation mid-session means one failed MCP call, then recovery on the
    // next derive).
    entries[name] = {
      url: `${org.baseUrl}/mcp`,
      headers: {
        authorization: `Bearer ${currentBearer(org.auth)}`,
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
  const probe = new SpacesClient({ baseUrl, token: `dev-${input.memberId}` });
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

/**
 * Wake-from-sleep / network-change nudge (wired to Electron's powerMonitor in
 * main): drop every org's live socket and reconnect immediately, replaying
 * each stream from its last seen offset. Sleeping laptops hold half-open
 * sockets that never emit close — see SpacesLive's liveness notes.
 */
export function bounceAllLive(): void {
  for (const runtime of runtimes.values()) runtime.live.bounce();
}

/** The client pair for an org — created lazily, one WS per org for the process lifetime. */
export function orgRuntime(orgId: string): OrgRuntime {
  const cached = runtimes.get(orgId);
  if (cached) return cached;
  const org = getOrg(orgId);
  if (!org) throw new Error(`unknown org ${orgId}`);
  const token = (opts?: { forceRefresh?: boolean }) => freshTokenFor(orgId, opts);
  const runtime: OrgRuntime = {
    client: new SpacesClient({ baseUrl: org.baseUrl, token }),
    live: new SpacesLive({ baseUrl: org.baseUrl, token }),
  };
  runtimes.set(orgId, runtime);
  return runtime;
}

/**
 * Save (or re-auth) an OAuth org after a completed dance. Matches an existing
 * record by explicit id (re-login) or by (baseUrl, memberId); otherwise
 * creates one. Clears any needs-relogin error and resets the cached runtime
 * so the next client uses the new tokens immediately.
 */
export function upsertOAuthOrg(input: {
  orgId?: string;
  baseUrl: string;
  name: string;
  address: string;
  issuer: string;
  clientId: string;
  memberId: string;
  tokens: OrgOAuthTokens;
}): OrgRecord {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const auth: OrgAuth = {
    kind: 'oauth',
    issuer: input.issuer,
    clientId: input.clientId,
    memberId: input.memberId,
    tokens: input.tokens,
  };
  const config = readConfig();
  const existing = config.orgs.find((o) =>
    input.orgId ? o.id === input.orgId : o.baseUrl === baseUrl && o.auth.kind === 'oauth' && o.auth.memberId === input.memberId,
  );
  const record: OrgRecord = existing ?? {
    id: `org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    address: input.address,
    baseUrl,
    auth,
  };
  record.name = input.name;
  record.address = input.address;
  record.auth = auth;
  if (!existing) config.orgs.push(record);
  writeConfig(config);
  const runtime = runtimes.get(record.id);
  if (runtime) {
    runtime.live.close();
    runtimes.delete(record.id);
  }
  return record;
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
