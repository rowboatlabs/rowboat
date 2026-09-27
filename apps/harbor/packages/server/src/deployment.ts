import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { buildApexApp } from './apex.js';
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
   * Per-org blob stores (dedup scope is per org, never global — spec §6). The
   * factory is called once per org runtime, typically an S3 driver with an
   * org-scoped key prefix. Absent = uploads unconfigured on every org.
   */
  blobs?: (orgId: string) => BlobStore;
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
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
  const hub = new SpaceHub(stats);
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
              hub,
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
      if (apex && host && normalizeDomain(host) === apexDomain) {
        apex(req, res);
        return;
      }
      const runtime = await runtimeFor(host);
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

  const closeLive = attachLive(server, async (host) => (await runtimeFor(host))?.live, { stats });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));
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
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
