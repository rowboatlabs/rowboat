import fs from 'fs';
import path from 'path';
import * as oauthClient from '../auth/oauth-client.js';
import { getSessionAccessToken, readSession } from '../auth/tokens.js';
import { WorkDir } from '../config/config.js';
import { getRowboatConfig } from '../config/rowboat.js';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { SpacesClient } from './client.js';
import { SpacesLive } from './live.js';

// Org registry: which orgs this install is signed into, and the live client
// pair (REST + WS) for each. Config only carries identity/credentials — spaces
// and content always come live from the org (spec: one canonical copy, the app
// is a browser).
//
// Three auth kinds (2026-09-14, one session two uses — auth/tokens.ts):
//
//   session  a MANAGED org (one on the Rowboat deployment): the org trusts
//            the same login desk the Rowboat account comes from, so the
//            record holds no tokens — every request borrows the account's
//            session. These records are a CACHE of the apex's "my orgs"
//            listing (oauth.ts syncManagedOrgs): rebuilt on sign-in, launch
//            and focus, dropped when the session goes.
//   oauth    a FOREIGN org (self-hosted Harbor on its own login desk): the
//            record owns its issuer, client id and tokens, exactly as before.
//            An `oauth` record whose issuer IS the Rowboat desk — written by
//            builds before `session` existed — is treated as session-backed
//            at every read (its stored tokens are ignored, never migrated);
//            the next sync rewrites it as `session`.
//   dev      the stub Harbor's dev tokens.
//
// Foreign OAuth refresh tokens ROTATE on every use (spike-verified), so
// refresh is single-flight per org and the new refresh token is persisted
// BEFORE the new access token is handed out. A dead refresh marks the org
// needs-relogin (`auth.error`) — visible and gentle, never a silently failing
// org (spec §4). The Rowboat session's own refresh lives in auth/tokens.ts.

export interface OrgOAuthTokens {
  access: string;
  refresh: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export type OrgAuth =
  | { kind: 'dev'; memberId: string }
  | {
      /** Managed org: borrows the Rowboat account session (auth/tokens.ts). */
      kind: 'session';
      issuer: string;
      memberId: string;
    }
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
  /** The server's durable org id (`org-<ulid>`) when known — the cross-device identity; `id` stays the local registry key. */
  serverOrgId?: string;
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

// --- the managed issuer ------------------------------------------------------

let managedIssuerCache: string | null | undefined;
let managedIssuerFailedAt = 0;
const MANAGED_ISSUER_RETRY_MS = 60_000;

/**
 * The login desk the Rowboat account comes from — `<supabaseUrl>/auth/v1`,
 * from the api's /v1/config — which is also the issuer every managed org
 * pins. Resolved once per process; null when the config cannot be fetched
 * (offline first launch — retried a minute later, not on every call), in
 * which case nothing is treated as managed until a later call succeeds.
 */
export async function managedIssuer(): Promise<string | null> {
  if (managedIssuerCache) return managedIssuerCache;
  if (Date.now() - managedIssuerFailedAt < MANAGED_ISSUER_RETRY_MS) return null;
  try {
    const config = await getRowboatConfig();
    managedIssuerCache = config.supabaseUrl ? `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1` : null;
  } catch {
    managedIssuerCache = null;
  }
  if (!managedIssuerCache) managedIssuerFailedAt = Date.now();
  return managedIssuerCache;
}

/** Test seam: pin the managed issuer without the api round trip. */
export function setManagedIssuerForTests(issuer: string | null): void {
  managedIssuerCache = issuer;
  managedIssuerFailedAt = 0;
}

/** Same issuer, trailing slash and case aside. */
export function sameIssuer(a: string, b: string): boolean {
  return a.replace(/\/$/, '').toLowerCase() === b.replace(/\/$/, '').toLowerCase();
}

/**
 * Does this org ride the Rowboat session? `session` records by definition;
 * pre-`session` `oauth` records by issuer (their stored tokens are ignored).
 */
export async function isSessionBacked(auth: OrgAuth): Promise<boolean> {
  if (auth.kind === 'session') return true;
  if (auth.kind !== 'oauth') return false;
  const issuer = await managedIssuer();
  return issuer !== null && sameIssuer(auth.issuer, issuer);
}

/** The bearer for a derived MCP entry: dev verbatim, session-backed = the account session, foreign = the record's own. */
function currentBearer(auth: OrgAuth, sessionBearer: string | null, sessionBacked: boolean): string {
  if (auth.kind === 'dev') return `dev-${auth.memberId}`;
  if (sessionBacked || auth.kind === 'session') return sessionBearer ?? '';
  return auth.tokens.access;
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
  if (await isSessionBacked(org.auth)) return getSessionAccessToken(opts);
  if (org.auth.kind !== 'oauth') throw new Error(`org ${orgId} has no credentials`);
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

function deriveWithNames(
  orgRecords: OrgRecord[],
  session: { bearer: string | null; issuer: string | null },
): {
  entries: Record<string, DerivedMcpServer>;
  nameByOrgId: Record<string, string>;
} {
  const entries: Record<string, DerivedMcpServer> = {};
  const nameByOrgId: Record<string, string> = {};
  for (const org of orgRecords) {
    const sessionBacked =
      org.auth.kind === 'session' ||
      (org.auth.kind === 'oauth' && session.issuer !== null && sameIssuer(org.auth.issuer, session.issuer));
    const slug = org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || org.id;
    // Deterministic names, unique even when the same org is added under two
    // identities (the multiplayer-testing case): slug, then slug-member, then id.
    let name = `spaces-${slug}`;
    if (entries[name]) name = `spaces-${slug}-${org.auth.memberId}`;
    if (entries[name]) name = `spaces-${org.id}`;
    // Session-backed orgs carry the account's FRESH token (spacesMcpServers
    // refreshes it before deriving); foreign OAuth orgs their current one
    // (a rotation mid-session means one failed MCP call, then recovery on
    // the next derive).
    entries[name] = {
      url: `${org.baseUrl}/mcp`,
      headers: {
        authorization: `Bearer ${currentBearer(org.auth, session.bearer, sessionBacked)}`,
        'x-agent-name': 'Rowboat',
      },
    };
    nameByOrgId[org.id] = name;
  }
  return { entries, nameByOrgId };
}

/** Pure derivation — exported for tests; `spacesMcpServers()` is the live view. */
export function deriveSpacesMcpServers(
  orgRecords: OrgRecord[],
  session: { bearer: string | null; issuer: string | null } = { bearer: null, issuer: null },
): Record<string, DerivedMcpServer> {
  return deriveWithNames(orgRecords, session).entries;
}

/** The live view: the account session's fresh token rides every managed org's entry. */
export async function spacesMcpServers(): Promise<Record<string, DerivedMcpServer>> {
  const orgRecords = listOrgs();
  const issuer = orgRecords.some((o) => o.auth.kind !== 'dev') ? await managedIssuer() : null;
  const needsSession = orgRecords.some(
    (o) => o.auth.kind === 'session' || (o.auth.kind === 'oauth' && issuer !== null && sameIssuer(o.auth.issuer, issuer)),
  );
  const bearer = needsSession ? await getSessionAccessToken().catch(() => null) : null;
  return deriveSpacesMcpServers(orgRecords, { bearer, issuer });
}

/** Names only — no credentials are resolved, so this stays synchronous. */
const NO_SESSION = { bearer: null, issuer: null } as const;

/**
 * The server name assigned to one org in the FULL derived view. Never derive
 * a name from a single org record: dedup suffixes depend on the whole registry
 * (a single-org derivation would name the second identity of an org after the
 * first one's entry — the wrong credentials).
 */
export function spacesMcpServerNameFor(orgId: string): string | null {
  return deriveWithNames(listOrgs(), NO_SESSION).nameByOrgId[orgId] ?? null;
}

/**
 * The inverse: which org a derived `spaces-<org>` server name addresses.
 * The agent-facing blob tools take the server name (the only spaces handle
 * the model ever holds) and resolve credentials through here — same
 * whole-registry derivation, so dedup suffixes stay consistent.
 */
export function orgForSpacesMcpServerName(serverName: string): OrgRecord | null {
  const orgRecords = listOrgs();
  const { nameByOrgId } = deriveWithNames(orgRecords, NO_SESSION);
  for (const org of orgRecords) {
    if (nameByOrgId[org.id] === serverName) return org;
  }
  return null;
}

export interface OrgRuntime {
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
  resetRuntime(orgId);
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

type MemberFrameListener = (orgId: string, frame: ServerFrame) => void;
const memberFrameListeners = new Set<MemberFrameListener>();

/**
 * Member-addressed live frames from EVERY org (`space_added`: someone opened
 * a DM with us — direct messages 2026-09-07). One registration covers orgs
 * added later too: each org's socket fans out to this set as it is created.
 * Hosts relay these to the renderer, whose orgs store refreshes on them.
 */
export function onMemberFrame(listener: MemberFrameListener): () => void {
  memberFrameListeners.add(listener);
  return () => {
    memberFrameListeners.delete(listener);
  };
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
  runtime.live.onMemberFrame((frame) => {
    for (const listener of memberFrameListeners) listener(orgId, frame);
  });
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
  serverOrgId?: string;
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
  if (input.serverOrgId) record.serverOrgId = input.serverOrgId;
  if (!existing) config.orgs.push(record);
  writeConfig(config);
  resetRuntime(record.id);
  return record;
}

/**
 * How the renderer should show an org's auth: its kind, and the one gentle
 * error state — a foreign org whose refresh died, or a session-backed org
 * with no Rowboat session (signed out, or a pre-`session` record after an
 * upgrade). Both read as "Sign in again" in the sidebar.
 */
export async function describeOrgAuth(record: OrgRecord): Promise<{
  authKind: 'dev' | 'oauth' | 'session';
  authError?: string;
}> {
  if (record.auth.kind === 'dev') return { authKind: 'dev' };
  if (await isSessionBacked(record.auth)) {
    const session = await readSession();
    if (!session) return { authKind: 'session', authError: 'Sign in with your Rowboat account' };
    return { authKind: 'session', ...(session.error ? { authError: session.error } : {}) };
  }
  if (record.auth.kind === 'oauth') {
    return { authKind: 'oauth', ...(record.auth.error ? { authError: record.auth.error } : {}) };
  }
  return { authKind: record.auth.kind };
}

/** One org as the apex's `GET /v1/orgs` lists it (apex.ts): the caller's membership on each managed org. */
export interface ManagedOrgListing {
  id: string;
  name: string;
  address: string;
  memberId: string;
}

type RuntimeResetListener = (orgId: string) => void;
const runtimeResetListeners = new Set<RuntimeResetListener>();

/**
 * An org's live client was closed and discarded — a re-auth, a removal, a
 * record whose address or identity changed — and the next getLive builds a
 * fresh one. Hosts that hold per-space subscriptions re-subscribe on it: a
 * subscription left on the dead client swallows live frames forever while
 * member frames keep arriving on the new one (the 2026-09-15 silent stream).
 */
export function onRuntimeReset(listener: RuntimeResetListener): () => void {
  runtimeResetListeners.add(listener);
  return () => {
    runtimeResetListeners.delete(listener);
  };
}

function resetRuntime(orgId: string): void {
  const runtime = runtimes.get(orgId);
  if (!runtime) return;
  runtime.live.close();
  runtimes.delete(orgId);
  for (const listener of runtimeResetListeners) listener(orgId);
}

/** Test seam: install a runtime without a socket, so reset behaviour is observable offline. */
export function setRuntimeForTests(orgId: string, runtime: OrgRuntime): void {
  runtimes.set(orgId, runtime);
}

/**
 * Save a managed org after joining, creating, or listing it: the record
 * borrows the account session, so it carries no tokens. Matches an existing
 * record by server org id, else by address (a pre-`session` `oauth` record
 * of the same org is rewritten in place — its ignored tokens go away here).
 */
export function upsertSessionOrg(input: {
  baseUrl: string;
  name: string;
  address: string;
  serverOrgId?: string;
  issuer: string;
  memberId: string;
}): OrgRecord {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const config = readConfig();
  const existing = config.orgs.find(
    (o) =>
      o.auth.kind !== 'dev' &&
      ((input.serverOrgId && o.serverOrgId === input.serverOrgId) || o.baseUrl === baseUrl),
  );
  // The live socket turns over only when something it depends on changed.
  // The apex lists us again on every refresh (listOrgs, at most every 30s),
  // and an unchanged record must not close a socket carrying subscriptions.
  const changed =
    existing !== undefined &&
    (existing.baseUrl !== baseUrl ||
      existing.auth.kind !== 'session' ||
      existing.auth.issuer !== input.issuer ||
      existing.auth.memberId !== input.memberId);
  const record: OrgRecord = existing ?? {
    id: `org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    address: input.address,
    baseUrl,
    auth: { kind: 'session', issuer: input.issuer, memberId: input.memberId },
  };
  record.name = input.name;
  record.address = input.address;
  record.baseUrl = baseUrl;
  record.auth = { kind: 'session', issuer: input.issuer, memberId: input.memberId };
  if (input.serverOrgId) record.serverOrgId = input.serverOrgId;
  if (!existing) config.orgs.push(record);
  writeConfig(config);
  if (changed) resetRuntime(record.id);
  return record;
}

/**
 * Make the registry's managed orgs match the apex's listing (the truth for
 * them): every listed org is upserted, every `session` record the listing no
 * longer names is dropped. Foreign and dev records are untouched. Pure over
 * the config file — the fetch lives in oauth.ts.
 */
export function applyManagedListing(listing: ManagedOrgListing[], input: { apexOrigin: string; issuer: string }): OrgRecord[] {
  const protocol = new URL(input.apexOrigin).protocol;
  for (const org of listing) {
    upsertSessionOrg({
      baseUrl: `${protocol}//${org.address}`,
      name: org.name,
      address: org.address,
      serverOrgId: org.id,
      issuer: input.issuer,
      memberId: org.memberId,
    });
  }
  const listed = new Set(listing.map((o) => o.id));
  const config = readConfig();
  const dropped = config.orgs.filter((o) => o.auth.kind === 'session' && (!o.serverOrgId || !listed.has(o.serverOrgId)));
  if (dropped.length > 0) {
    config.orgs = config.orgs.filter((o) => !dropped.includes(o));
    writeConfig(config);
    for (const o of dropped) resetRuntime(o.id);
  }
  return readConfig().orgs;
}

/** No Rowboat session (signed out): the managed orgs that borrowed it go too. */
export function dropSessionOrgs(): void {
  const config = readConfig();
  const dropped = config.orgs.filter((o) => o.auth.kind === 'session');
  if (dropped.length === 0) return;
  config.orgs = config.orgs.filter((o) => o.auth.kind !== 'session');
  writeConfig(config);
  for (const o of dropped) resetRuntime(o.id);
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
