import fs from 'fs';
import path from 'path';
import * as oauthClient from '../auth/oauth-client.js';
import { getSessionAccessToken, readSession } from '../auth/tokens.js';
import { WorkDir } from '../config/config.js';
import { getRowboatConfig } from '../config/rowboat.js';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { SpacesClient, SpacesLive } from '@x/spaces-client';

// The server this install talks to, and its live client pair (REST + WS).
// One server since 2026-11-09 (harbor spec §4: orgs dissolved): the record
// below is the whole registry. The module keeps the many-org vocabulary of
// its API (`OrgRecord`, `listOrgs`, `getOrg(orgId)`) so the hosts and tools
// built on it keep their calls; the id every caller passes is
// SPACES_SERVER_ID, and `listOrgs()` has one entry or none. Config only
// carries identity/credentials — spaces and content always come live from
// the server (the app is a browser).
//
// Three auth kinds (2026-09-14, one session two uses — auth/tokens.ts):
//
//   session  Rowboat's server: it trusts the login desk the Rowboat account
//            comes from, so the record holds no tokens — every request
//            borrows the account's session. Written by oauth.ts
//            syncManagedServer on sign-in, launch and focus; dropped when
//            the session goes.
//   oauth    a self-hosted Harbor on its own login desk: the record owns its
//            issuer, client id and tokens. An `oauth` record whose issuer IS
//            the Rowboat desk is treated as session-backed at every read.
//   dev      the stub Harbor's dev tokens.
//
// Foreign OAuth refresh tokens ROTATE on every use (spike-verified), so
// refresh is single-flight and the new refresh token is persisted BEFORE the
// new access token is handed out. A dead refresh marks the record
// needs-relogin (`auth.error`) — visible and gentle, never a silently failing
// server (spec §4). The Rowboat session's own refresh lives in auth/tokens.ts.

/** The one record's id: what every `orgId` on the Spaces IPC surface is since 2026-11-09. */
export const SPACES_SERVER_ID = 'server';

export interface OrgOAuthTokens {
  access: string;
  refresh: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export type OrgAuth =
  | { kind: 'dev'; memberId: string }
  | {
      /** Rowboat's server: borrows the Rowboat account session (auth/tokens.ts). */
      kind: 'session';
      issuer: string;
      memberId: string;
    }
  | {
      kind: 'oauth';
      issuer: string;
      clientId: string;
      /** Learned from POST /v1/me (or the invite bind) after the dance. */
      memberId: string;
      tokens: OrgOAuthTokens;
      /** Set when refresh fails: the server needs a re-login. Cleared by a fresh dance. */
      error?: string;
    };

export interface OrgRecord {
  /** Always SPACES_SERVER_ID (the many-org registry's local key, kept as the IPC handle). */
  id: string;
  name: string;
  /** The server's address links are minted on, e.g. localhost:4272 or spaces.x.rowboatlabs.com. */
  address: string;
  /** Where to reach it, scheme included, e.g. http://localhost:4272. */
  baseUrl: string;
  auth: OrgAuth;
}

interface SpacesServerConfig {
  version: 2;
  server: OrgRecord | null;
}

// `spaces_server.json`, not the pre-2026-11-09 `spaces_orgs.json`: the old
// registry is left where it is and ignored — Rowboat's server comes back on
// the account session by itself, a self-hosted one by its address.
const CONFIG_FILE = path.join(WorkDir, 'config', 'spaces_server.json');

function readRecord(): OrgRecord | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Partial<SpacesServerConfig>;
    return raw.server && typeof raw.server === 'object' ? { ...raw.server, id: SPACES_SERVER_ID } : null;
  } catch {
    return null;
  }
}

function writeRecord(record: OrgRecord | null): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const config: SpacesServerConfig = { version: 2, server: record };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// --- the managed issuer ------------------------------------------------------

let managedIssuerCache: string | null | undefined;
let managedIssuerFailedAt = 0;
const MANAGED_ISSUER_RETRY_MS = 60_000;

/**
 * The login desk the Rowboat account comes from — `<supabaseUrl>/auth/v1`,
 * from the api's /v1/config — which is also the issuer Rowboat's server
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
 * Does this record ride the Rowboat session? `session` records by definition;
 * `oauth` records by issuer (their stored tokens are ignored).
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

function mutateOrgAuth(fn: (auth: Extract<OrgAuth, { kind: 'oauth' }>) => void): void {
  const record = readRecord();
  if (!record || record.auth.kind !== 'oauth') return;
  fn(record.auth);
  writeRecord(record);
}

let refreshFlight: Promise<string> | null = null;

/**
 * A token guaranteed usable right now: dev tokens verbatim; OAuth access
 * tokens refreshed when expired (or on `forceRefresh` — the 401 path).
 * Single-flight: rotation means two parallel refreshes would invalidate
 * each other's result.
 */
export async function freshTokenFor(orgId: string, opts?: { forceRefresh?: boolean }): Promise<string> {
  const org = getOrg(orgId);
  if (!org) throw new Error(`unknown server ${orgId}`);
  if (org.auth.kind === 'dev') return `dev-${org.auth.memberId}`;
  if (await isSessionBacked(org.auth)) return getSessionAccessToken(opts);
  if (org.auth.kind !== 'oauth') throw new Error(`server ${orgId} has no credentials`);
  const now = Math.floor(Date.now() / 1000);
  if (!opts?.forceRefresh && org.auth.tokens.expiresAt > now + 60) return org.auth.tokens.access;
  if (refreshFlight) return refreshFlight;
  refreshFlight = refreshOrgTokens(org.auth).finally(() => {
    refreshFlight = null;
  });
  return refreshFlight;
}

async function refreshOrgTokens(auth: Extract<OrgAuth, { kind: 'oauth' }>): Promise<string> {
  try {
    const config = await oauthClient.discoverConfiguration(auth.issuer, auth.clientId);
    const refreshed = await oauthClient.refreshTokens(config, auth.tokens.refresh);
    // Rotation discipline: the OLD refresh token just died — persist the new
    // pair before anything uses the new access token.
    mutateOrgAuth((a) => {
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
    mutateOrgAuth((a) => {
      a.error = message;
    });
    throw new Error(`server needs re-login: ${message}`);
  }
}

// The server's MCP agent face is exposed to the user's own agent as a DERIVED
// MCP server entry — never written to mcp.json. The registry (this file's
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
    // Deterministic names: slug, then slug-member, then id (the registry holds
    // one record since 2026-11-09, but the derivation stays total).
    let name = `spaces-${slug}`;
    if (entries[name]) name = `spaces-${slug}-${org.auth.memberId}`;
    if (entries[name]) name = `spaces-${org.id}`;
    // A session-backed record carries the account's FRESH token (spacesMcpServers
    // refreshes it before deriving); a foreign OAuth record its current one
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

/** The live view: the account session's fresh token rides a session-backed entry. */
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

/** The MCP server name the record is derived under, or null with no record. */
export function spacesMcpServerNameFor(orgId: string): string | null {
  return deriveWithNames(listOrgs(), NO_SESSION).nameByOrgId[orgId] ?? null;
}

/**
 * The inverse: the record a derived `spaces-<name>` server name addresses.
 * The agent-facing blob tools take the server name (the only spaces handle
 * the model ever holds) and resolve credentials through here.
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

/** The record, as a list: one entry when this install has a server, else none. */
export function listOrgs(): OrgRecord[] {
  const record = readRecord();
  return record ? [record] : [];
}

export function getOrg(orgId: string): OrgRecord | undefined {
  const record = readRecord();
  return record && record.id === orgId ? record : undefined;
}

/** Replace the record; the live socket turns over only when something it depends on changed. */
function setRecord(record: OrgRecord, opts: { resetAlways?: boolean } = {}): OrgRecord {
  const existing = readRecord();
  const changed =
    !existing ||
    existing.baseUrl !== record.baseUrl ||
    existing.auth.kind !== record.auth.kind ||
    existing.auth.memberId !== record.auth.memberId ||
    (existing.auth.kind !== 'dev' && record.auth.kind !== 'dev' && existing.auth.issuer !== record.auth.issuer);
  writeRecord(record);
  if (existing && (changed || opts.resetAlways)) resetRuntime(record.id);
  return record;
}

/**
 * Connect to a dev Harbor by reaching it (the health probe doubles as address
 * discovery) and remembering how we authenticate.
 */
export async function addDevOrg(input: { baseUrl: string; memberId: string }): Promise<OrgRecord> {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const probe = new SpacesClient({ baseUrl, token: `dev-${input.memberId}` });
  const health = await probe.health();
  return setRecord({
    id: SPACES_SERVER_ID,
    name: health.server.name,
    address: health.server.address,
    baseUrl,
    auth: { kind: 'dev', memberId: input.memberId },
  });
}

/** Forget the server: the record goes, and its socket with it. */
export async function removeOrg(orgId: string): Promise<void> {
  const record = readRecord();
  if (!record || record.id !== orgId) return;
  writeRecord(null);
  resetRuntime(orgId);
}

/**
 * Wake-from-sleep / network-change nudge (wired to Electron's powerMonitor in
 * main): drop the live socket and reconnect immediately, replaying each
 * stream from its last seen offset. Sleeping laptops hold half-open sockets
 * that never emit close — see SpacesLive's liveness notes.
 */
export function bounceAllLive(): void {
  for (const runtime of runtimes.values()) runtime.live.bounce();
}

type MemberFrameListener = (orgId: string, frame: ServerFrame) => void;
const memberFrameListeners = new Set<MemberFrameListener>();

/**
 * Member-addressed live frames (`space_added`: someone opened a DM with us —
 * direct messages 2026-09-07). One registration covers a server connected
 * later too: the socket fans out to this set as it is created. Hosts relay
 * these to the renderer, whose store refreshes its listing on them.
 */
export function onMemberFrame(listener: MemberFrameListener): () => void {
  memberFrameListeners.add(listener);
  return () => {
    memberFrameListeners.delete(listener);
  };
}

/** The client pair — created lazily, one WS for the process lifetime. */
export function orgRuntime(orgId: string): OrgRuntime {
  const cached = runtimes.get(orgId);
  if (cached) return cached;
  const org = getOrg(orgId);
  if (!org) throw new Error(`unknown server ${orgId}`);
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
 * Save (or re-auth) a self-hosted server after a completed dance. Clears any
 * needs-relogin error and resets the cached runtime so the next client uses
 * the new tokens immediately.
 */
export function upsertOAuthOrg(input: {
  baseUrl: string;
  name: string;
  address: string;
  issuer: string;
  clientId: string;
  memberId: string;
  tokens: OrgOAuthTokens;
}): OrgRecord {
  return setRecord(
    {
      id: SPACES_SERVER_ID,
      name: input.name,
      address: input.address,
      baseUrl: input.baseUrl.replace(/\/$/, ''),
      auth: { kind: 'oauth', issuer: input.issuer, clientId: input.clientId, memberId: input.memberId, tokens: input.tokens },
    },
    { resetAlways: true },
  );
}

/**
 * How the renderer should show the server's auth: its kind, and the one
 * gentle error state — a self-hosted server whose refresh died, or a
 * session-backed record with no Rowboat session (signed out). Both read as
 * "Sign in again".
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

type RuntimeResetListener = (orgId: string) => void;
const runtimeResetListeners = new Set<RuntimeResetListener>();

/**
 * The live client was closed and discarded — a re-auth, a removal, a record
 * whose address or identity changed — and the next getLive builds a fresh
 * one. Hosts that hold per-space subscriptions re-subscribe on it: a
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
 * Save Rowboat's server after signing in, joining or syncing: the record
 * borrows the account session, so it carries no tokens. An unchanged record
 * keeps its socket (the sync runs on every listing, at most every 30s, and
 * must not close a socket carrying subscriptions).
 */
export function upsertSessionOrg(input: { baseUrl: string; name: string; address: string; issuer: string; memberId: string }): OrgRecord {
  return setRecord({
    id: SPACES_SERVER_ID,
    name: input.name,
    address: input.address,
    baseUrl: input.baseUrl.replace(/\/$/, ''),
    auth: { kind: 'session', issuer: input.issuer, memberId: input.memberId },
  });
}

/** No Rowboat session (signed out): a record that borrowed it goes too. */
export function dropSessionOrgs(): void {
  const record = readRecord();
  if (!record || record.auth.kind !== 'session') return;
  writeRecord(null);
  resetRuntime(record.id);
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
