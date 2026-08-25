import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { buildApexApp } from './apex.js';
import { DevAuthDriver, type AuthDriver } from './auth.js';
import { OidcAuthDriver } from './auth-oidc.js';
import type { BlobStore } from './blobs.js';
import { OrgDirectory, normalizeDomain, type CreateOrgInput, type OrgConfig } from './directory.js';
import { buildHttpApp } from './http.js';
import { SpaceHub } from './hub.js';
import { handleMcpRequest } from './mcp.js';
import { migrate } from './migrations.js';
import { PgStore } from './pg-store.js';
import { HarborService } from './service.js';
import type { SqlDb } from './sql.js';
import { attachLive } from './ws.js';

// The multi-org deployment (spec §4 "Deployment and tenancy"): one process,
// 1..N orgs, resolved from the Host header (X-Forwarded-Host wins — every
// supported platform proxies). HarborService stays single-org; this layer
// holds one cached runtime (service + faces + auth) per org over one shared
// SqlDb and one shared hub (space ids are globally unique, so a shared hub
// cannot cross-deliver). startHarbor (server.ts) remains the single-org
// self-host/dev path — one org, one config, no directory.

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
}

export interface RunningDeployment {
  url: string;
  port: number;
  directory: OrgDirectory;
  server: HttpServer;
  createOrg(input: CreateOrgInput): Promise<OrgConfig>;
  close(): Promise<void>;
}

interface OrgRuntime {
  service: HarborService;
  store: PgStore;
  auth: AuthDriver;
  hono: (req: IncomingMessage, res: ServerResponse) => void;
}

export async function startHarborDeployment(options: DeploymentOptions): Promise<RunningDeployment> {
  await migrate(options.db);
  const directory = new OrgDirectory(options.db);
  const hub = new SpaceHub();
  const runtimes = new Map<string, OrgRuntime>();

  const apexDomain = options.apexDomain ? normalizeDomain(options.apexDomain) : undefined;
  const apex =
    apexDomain && options.issuer
      ? getRequestListener(
          buildApexApp({
            db: options.db,
            directory,
            auth: new OidcAuthDriver({ issuer: options.issuer }),
            hub,
            apexDomain,
            issuer: options.issuer,
            ...(options.consentPublishableKey ? { consentPublishableKey: options.consentPublishableKey } : {}),
          }).fetch,
        )
      : undefined;

  function buildRuntime(org: OrgConfig): OrgRuntime | undefined {
    if (!org.issuer && !options.allowDevOrgs) return undefined;
    const store = new PgStore(options.db, org.id);
    const service = new HarborService(
      store,
      hub,
      {
        name: org.name,
        address: org.domains[0] ?? org.id,
        ...(org.allowedEmailDomains ? { allowedEmailDomains: org.allowedEmailDomains } : {}),
      },
      options.blobs?.(org.id),
    );
    const auth: AuthDriver = org.issuer ? new OidcAuthDriver({ issuer: org.issuer }) : new DevAuthDriver();
    const app = buildHttpApp({
      service,
      store,
      auth,
      ...(org.issuer && options.consentPublishableKey
        ? { consent: { issuer: org.issuer, publishableKey: options.consentPublishableKey } }
        : {}),
      ...(options.maxBlobBytes !== undefined ? { maxBlobBytes: options.maxBlobBytes } : {}),
    });
    return { service, store, auth, hono: getRequestListener(app.fetch) };
  }

  async function runtimeFor(host: string | undefined): Promise<OrgRuntime | undefined> {
    if (!host) return undefined;
    const domain = normalizeDomain(host);
    const cached = runtimes.get(domain);
    if (cached) return cached;
    const org = await directory.getByDomain(domain);
    if (!org) return undefined;
    const runtime = buildRuntime(org);
    if (runtime) runtimes.set(domain, runtime);
    return runtime;
  }

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
      if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
        await handleMcpRequest(req, res, { service: runtime.service, store: runtime.store, auth: runtime.auth });
        return;
      }
      runtime.hono(req, res);
    })().catch((err) => {
      console.error('[harbor] deployment request error:', err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  const closeLive = attachLive(server, async (host) => {
    const runtime = await runtimeFor(host);
    return runtime ? { service: runtime.service, hub, store: runtime.store, auth: runtime.auth } : undefined;
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${port}`,
    port,
    directory,
    server,
    createOrg: (input) => directory.createOrg(input),
    close: async () => {
      closeLive();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
