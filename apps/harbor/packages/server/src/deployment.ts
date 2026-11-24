import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { buildApexApp } from './apex.js';
import { AGENT_KEY_PREFIX, hashAgentKey } from './agent-keys.js';
import { DevAuthDriver, type AuthDriver } from './auth.js';
import { OidcAuthDriver } from './auth-oidc.js';
import type { BlobStore } from './blobs.js';
import { OrgDirectory, normalizeDomain, type CreateOrgInput, type OrgConfig } from './directory.js';
import { HarborError } from './errors.js';
import { SpaceHub } from './hub.js';
import { internalHandler } from './internal.js';
import { LiveStats } from './stats.js';
import { migrate } from './migrations.js';
import { PgStore } from './pg-store.js';
import { buildOrgRuntime, type OrgRuntime } from './runtime.js';
import type { SqlDb } from './sql.js';
import { attachLive } from './ws.js';
import { HARBOR_RUN_CONNECTIONS } from '@rowboat/spaces-protocol';

// The multi-org deployment (spec §4 "Deployment and tenancy"): one process,
// 1..N orgs, resolved from the Host header (X-Forwarded-Host wins — every
// supported platform proxies). HarborService stays single-org; this layer
// maps Host → org and caches one runtime per org — assembled by
// buildOrgRuntime (runtime.ts), the same wiring startHarbor (server.ts) uses
// for its one org — over one shared SqlDb and one shared hub (space ids are
// globally unique, so a shared hub cannot cross-deliver). One token verifier
// per issuer: every org on the deployment's AS shares one JWKS cache.

export interface DeploymentOptions {
  db: SqlDb;
  /** 0 (default) picks an ephemeral port. */
  port?: number;
  /**
   * The AS publishable key for the consent page — mounted on every org that
   * has an issuer (one AS per managed deployment; per-org keys can come later).
   */
  consentPublishableKey?: string;
  /**
   * Allow orgs with NO issuer to run dev auth. Default false: on a public
   * deployment an issuer-less org is a misconfiguration, not a fallback.
   */
  allowDevOrgs?: boolean;
  /**
   * Mounts the deployment face (apex.ts: self-serve org creation, "my orgs")
   * on this domain; created orgs live at `<slug>.<apexDomain>` and pin
   * `issuer`. Both required together.
   */
  apexDomain?: string;
  /** The deployment's AS — apex auth + the issuer every created org pins. */
  issuer?: string;
  /**
   * Orgs share the deployment’s content-addressed bytes so existing flat keys
   * remain readable after orgs return (2026-11-24). Each space checks its
   * upload registry before serving a blob.
   */
  blobs?: (orgId: string) => BlobStore;
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
  /** Browser origins allowed to call every org and the apex cross-origin (cors.ts). */
  webOrigins?: readonly string[];
  /** The Spaces web app, offered by every org's link landings (http.ts). */
  webAppUrl?: string;
  /**
   * The operator face (internal.ts). `key` enables GET /internal/stats; `log`
   * prints the live-load line once a minute — independent of the key, the
   * line is the passive record for whoever never polls. main.ts sets it;
   * tests leave it off.
   */
  internal?: { key?: string; log?: boolean };
}

export interface RunningDeployment {
  url: string;
  port: number;
  stats: LiveStats;
  directory: OrgDirectory;
  server: HttpServer;
  createOrg(input: CreateOrgInput): Promise<OrgConfig>;
  close(): Promise<void>;
}

export async function startHarborDeployment(options: DeploymentOptions): Promise<RunningDeployment> {
  await migrate(options.db);
  // Derived-index repair rides boot on BOTH boot paths (this one and the
  // single-org PgStore.init()): fill asset_search rows the migrations can't
  // (extraction is TypeScript). Org-agnostic and idempotent — one pass covers
  // every org; per-org runtimes below deliberately never run init().
  await new PgStore(options.db).backfillAssetSearch();
  const directory = new OrgDirectory(options.db);
  const stats = new LiveStats({ log: options.internal?.log === true });
  const internal = internalHandler({ key: options.internal?.key, stats });
  // One runtime per org, built on first sight — a Promise, so concurrent first
  // requests share the build — and one token verifier per issuer.
  const runtimes = new Map<string, Promise<OrgRuntime | undefined>>();
  const orgByDomain = new Map<string, OrgConfig>();
  const drivers = new Map<string, AuthDriver>();
  const driverFor = (issuer: string | undefined): AuthDriver => {
    if (!issuer) return new DevAuthDriver();
    let driver = drivers.get(issuer);
    if (!driver) {
      driver = new OidcAuthDriver({ issuer });
      drivers.set(issuer, driver);
    }
    return driver;
  };

  function runtimeForOrg(org: OrgConfig): Promise<OrgRuntime | undefined> {
    let pending = runtimes.get(org.id);
    if (!pending) {
      // An issuer-less org runs dev auth only where the deployment allows it:
      // on a public deployment that is a misconfiguration, not a fallback.
      pending =
        !org.issuer && !options.allowDevOrgs
          ? Promise.resolve(undefined)
          : buildOrgRuntime({
              store: new PgStore(options.db, org.id),
              hub: new SpaceHub(stats),
              org: {
                name: org.name,
                address: org.domains[0] ?? org.id,
                ...(org.allowedEmailDomains ? { allowedEmailDomains: org.allowedEmailDomains } : {}),
              },
              orgId: org.id,
              auth: driverFor(org.issuer),
              ...(options.blobs ? { blobs: options.blobs(org.id) } : {}),
              ...(org.issuer && options.consentPublishableKey ? { consentPublishableKey: options.consentPublishableKey } : {}),
              ...(options.maxBlobBytes !== undefined ? { maxBlobBytes: options.maxBlobBytes } : {}),
              ...(options.webOrigins ? { webOrigins: options.webOrigins } : {}),
              ...(apexDomain ? { sessionCookieDomain: apexDomain } : {}),
              ...(options.webAppUrl ? { webAppUrl: options.webAppUrl } : {}),
            });
      runtimes.set(org.id, pending);
      // A failed build is not cached — the next request tries again.
      pending.catch(() => runtimes.delete(org.id));
    }
    return pending;
  }

  async function runtimeFor(host: string | undefined): Promise<OrgRuntime | undefined> {
    if (!host) return undefined;
    const domain = normalizeDomain(host);
    let org = orgByDomain.get(domain);
    if (!org) {
      org = await directory.getByDomain(domain);
      if (!org) return undefined;
      orgByDomain.set(domain, org);
    }
    return runtimeForOrg(org);
  }

  const apexDomain = options.apexDomain ? normalizeDomain(options.apexDomain) : undefined;
  const apex =
    apexDomain && options.issuer
      ? getRequestListener(
          buildApexApp({
            db: options.db,
            directory,
            auth: driverFor(options.issuer),
            apexDomain,
            issuer: options.issuer,
            ...(options.consentPublishableKey ? { consentPublishableKey: options.consentPublishableKey } : {}),
            ...(options.webOrigins ? { webOrigins: options.webOrigins } : {}),
            serviceFor: async (org) => {
              const runtime = await runtimeForOrg(org);
              if (!runtime) throw new HarborError('internal', 'the new org has no runtime on this deployment');
              return runtime.service;
            },
          }).fetch,
        )
      : undefined;

  const hostOf = (req: IncomingMessage): string | undefined => {
    const forwarded = req.headers['x-forwarded-host'];
    return typeof forwarded === 'string' ? forwarded : req.headers.host;
  };

  // Installed connectors can still use the bare November 9 host (2026-11-24).
  // The selected runtime authenticates the credential again before serving it.
  async function runtimeForKey(key: string): Promise<OrgRuntime | undefined> {
    const [row] = await options.db.query<{ org_id: string }>(
      'select org_id from agent_keys where hash = $1 and revoked_at is null', [hashAgentKey(key)]);
    const org = row && await directory.getById(row.org_id);
    return org ? runtimeForOrg(org) : undefined;
  }

  const server = createServer((req, res) => {
    void (async () => {
      // Host-independent liveness for platform health checks (they probe the
      // service's own hostname, which routes to no org).
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      if (internal(req, res)) return;
      const host = hostOf(req);
      const key = req.headers.authorization?.replace(/^Bearer /, '');
      if (key?.startsWith(AGENT_KEY_PREFIX)) {
        const runtime = await runtimeForKey(key);
        if (runtime) runtime.handle(req, res);
        else res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({
          code: 'unauthorized', message: 'unknown or revoked agent key', retryable: false,
        }));
        return;
      }
      if (apex && host && normalizeDomain(host) === apexDomain) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const link = /^\/(s|u|join)\/([^/]+)(?:\/|$)/.exec(url.pathname);
        if (link && req.method === 'GET') {
          const target = await directory.domainForLink(link[1]!, decodeURIComponent(link[2]!));
          if (target && normalizeDomain(target) !== apexDomain) {
            res.writeHead(302, { location: `https://${target}${url.pathname}${url.search}` }).end();
            return;
          }
          if (target) {
            const runtime = await runtimeFor(target);
            if (runtime) { runtime.handle(req, res); return; }
          }
        }
        // Migrated self-hosters can keep reaching their default org on the apex.
        if (/^\/(?:v1\/|mcp$)/.test(url.pathname) && !url.pathname.startsWith('/v1/links/') &&
            !['/v1/orgs', '/v1/orgs/ensure', '/v1/health', '/v1/session'].includes(url.pathname) &&
            !(req.method === 'DELETE' && url.pathname === '/v1/me')) {
          const runtime = await runtimeFor(host);
          if (runtime) { runtime.handle(req, res); return; }
        }
        apex(req, res);
        return;
      }
      const runtime = await runtimeFor(host);
      if (!runtime && req.url === '/v1/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      if (!runtime) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(
          JSON.stringify({ code: 'not_found', message: 'no org on this domain', retryable: false }),
        );
        return;
      }
      runtime.handle(req, res);
    })().catch((err) => {
      console.error('[harbor] deployment request error:', err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  const closeLive = attachLive(server, async (host, token) => (
    await (token?.startsWith(AGENT_KEY_PREFIX) ? runtimeForKey(token) : runtimeFor(host))
  )?.live, { stats });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));

  // An org's runtime is otherwise built on its first request, but the
  // connectors Harbor runs (spec §8 Connectors, 2026-09-30) must pick up
  // their agents' mentions after a restart whether or not anyone visits:
  // build, at boot, the runtime of every org that has such an agent. Jev is
  // in every org with the key (spec §8 Jev, 2026-10-07), so only the orgs
  // where someone has added it to a space are woken for it.
  const connectorOrgs = await options.db.query<{ org_id: string }>(
    `select distinct m.org_id from members m
     where m.kind = 'agent' and m.removed_at is null and m.deactivated_at is null and m.agent_connection = any($1::text[])
     union select org_id from spaces where graph`,
    [[...HARBOR_RUN_CONNECTIONS]],
  );
  for (const { org_id } of connectorOrgs) {
    const org = await directory.getById(org_id);
    if (org) runtimeForOrg(org).catch((err) => console.error(`[harbor] could not start org ${org_id} at boot:`, err));
  }
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${port}`,
    port,
    stats,
    directory,
    server,
    createOrg: (input) => directory.createOrg(input),
    close: async () => {
      closeLive();
      stats.close();
      await Promise.allSettled([...runtimes.values()].map(async (pending) => (await pending)?.close()));
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
