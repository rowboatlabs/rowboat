import type { GraphOptions } from './core/graph.js';
import { jevFromEnv, type JevApi } from './jev.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { bindAuth, type AuthDriver, type OrgAuth } from './auth.js';
import { billingFromEnv, type BillingAccounts } from './billing.js';
import { connectionsBackendFromEnv, type ConnectionsBackend } from './connections/backend.js';
import { gatewayWriter, type UpdateWriter } from './connections/writer.js';
import { DEFAULT_CONNECTION_APPS, type ConnectionsOptions } from './core/connections.js';
import { seal, unseal } from './sealing.js';
import type { BlobStore } from './blobs.js';
import { HostedConnectors, orgUrl } from './connectors/host.js';
import { maritimeProvisioner } from './connectors/maritime/provisioning.js';
import type { HostingProvider } from './core/hosting.js';
import { buildHttpApp } from './http.js';
import type { SpaceHub } from './hub.js';
import { handleMcpRequest } from './mcp.js';
import { Notifier } from './notify.js';
import { PushSender } from './push.js';
import { HarborService, type OrgInfo } from './service.js';
import type { Store } from './store.js';
import type { LiveDeps } from './ws.js';

// The one place an org's object graph is assembled: the service core, the
// notifier and its push sender, the store-bound auth handle, the render and
// agent faces, and what the live face needs. The single-org server
// (server.ts) and the multi-org deployment (deployment.ts) both build their
// orgs here, so the assembly that ships is the assembly every test
// exercises — and there is exactly one answer to "how is an org wired".

export interface OrgRuntimeInput {
  /** The org's store: a PgStore scoped to the org on a deployment, the whole store single-org. */
  store: Store;
  /** The org’s hub keeps member-addressed notifications within its runtime. */
  hub: SpaceHub;
  org: OrgInfo;
  /** The org's id as the store knows it; push payloads carry it so phones route to the right org. */
  orgId: string;
  /** Token → identity. Per issuer: orgs on the same AS share one driver and its JWKS cache. */
  auth: AuthDriver;
  /** Absent = uploads unconfigured on this org (the routes refuse loudly, everything else works). */
  blobs?: BlobStore;
  /** Test injection; default = Expo push for this org. */
  pushSender?: PushSender;
  /** Mounts /oauth/consent; takes effect only with an oidc driver (the issuer comes from its metadata). */
  consentPublishableKey?: string;
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
  /** Browser origins allowed to call the render face cross-origin (cors.ts), and to use the session cookie (session.ts). */
  webOrigins?: readonly string[];
  /** The session cookie's Domain: the apex on a deployment. */
  sessionCookieDomain?: string;
  /** The Spaces web app, which an org link opened in a browser offers beside the desktop app (http.ts, the landings). */
  webAppUrl?: string;
  /** Managed hosting (spec §8 Maritime, 2026-10-26): a stand-in provider and tick in tests; absent = from HARBOR_MARITIME_API_KEY. */
  hosting?: { provider: HostingProvider; tickMs?: number; trialMs?: number; billing?: BillingAccounts; settleEveryMs?: number };
  /** Test knob: how long an agent may be away before it is announced offline (default 15s). */
  agentPresenceGraceMs?: number;
  /** The space graph (spec §8 Space graph, 2026-11-12): a stand-in Jev and faster clocks in tests; absent = from HARBOR_JEV_OPENROUTER_KEY. */
  graph?: { jev: JevApi } & GraphOptions;
  /**
   * Space connections (spec §8 Space connections, 2026-11-28): stand-ins for
   * the control plane, billing and the model in tests, with faster clocks;
   * absent = from HARBOR_BILLING_URL and HARBOR_BILLING_KEY, and none without them.
   */
  connections?: { backend: ConnectionsBackend; billing: Pick<BillingAccounts, 'accountFor' | 'mintGatewayKey' | 'revokeGatewayKey'>; writer: UpdateWriter; apps?: readonly string[] | '*' } & ConnectionsOptions;
}

/** The apps a space may connect: the operator's list (HARBOR_CONNECTION_APPS, comma-separated slugs, or `*` for all), else the default pair. */
function connectionAppsFromEnv(): readonly string[] | '*' {
  const raw = process.env.HARBOR_CONNECTION_APPS?.trim();
  if (!raw) return DEFAULT_CONNECTION_APPS;
  if (raw === '*') return '*';
  return raw.split(',').map((slug) => slug.trim().toLowerCase()).filter(Boolean);
}

/** What space connections run on in production: the control plane's routes, billing's accounts and its LLM gateway, or nothing when the deployment names no control plane. */
function connectionsFromEnv(): OrgRuntimeInput['connections'] {
  const backend = connectionsBackendFromEnv();
  const billing = billingFromEnv();
  if (!backend || !billing) return undefined;
  return { backend, billing, writer: gatewayWriter(billing.gatewayUrl), apps: connectionAppsFromEnv() };
}

/** The managed-hosting provider the deployment's own Maritime key makes, or none. */
function hostingFromEnv(): HostingProvider | undefined {
  const apiKey = process.env.HARBOR_MARITIME_API_KEY;
  if (!apiKey) return undefined;
  const cap = Number(process.env.HARBOR_MARITIME_LLM_CAP_CENTS);
  const idle = Number(process.env.HARBOR_MARITIME_IDLE_SECONDS);
  return maritimeProvisioner({
    apiKey,
    ...(Number.isFinite(cap) && cap > 0 ? { llmCapCents: cap } : {}),
    ...(Number.isFinite(idle) && idle > 0 ? { idleSeconds: idle } : {}),
  });
}

export interface OrgRuntime {
  service: HarborService;
  auth: OrgAuth;
  /** Every HTTP request addressed to this org: /mcp to the agent face, the rest to the render face. */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** What the live face needs for a connection to this org. */
  live: LiveDeps;
  /** Stops the connectors Harbor runs for this org. */
  close(): Promise<void>;
}

export async function buildOrgRuntime(input: OrgRuntimeInput): Promise<OrgRuntime> {
  const { store, hub } = input;
  const service = new HarborService(
    store,
    hub,
    input.org,
    input.blobs,
    new Notifier(store, hub, input.pushSender ?? new PushSender(store, input.orgId)),
    input.agentPresenceGraceMs !== undefined ? { presenceGraceMs: input.agentPresenceGraceMs } : {},
  );
  // The mentions backfill (service.migrateMentions): idempotent, ledgered once per org, before the faces serve.
  await service.migrateMentions();
  // Connectors Harbor runs (spec §8 Connectors, 2026-09-30): one per agent whose
  // connection is a platform, from boot, and for each such agent added later.
  const connectors = new HostedConnectors({ store, hub, service, orgId: input.orgId });
  service.attachConnectors({
    verify: (connection, secret, target) => connectors.verify(connection, secret, target),
    save: (agentId, secret, setBy) => connectors.save(agentId, secret, setBy),
    added: (agent) => connectors.ensure(agent),
    alert: (connection, payload) => connectors.alert(connection, payload),
    setup: (connection) => connectors.setup(connection),
    stop: (agentId) => connectors.stop(agentId),
  });
  // Managed hosting (spec §8 Maritime, 2026-10-26): agents Rowboat's own account creates, when the deployment has its key.
  const provider = input.hosting?.provider ?? hostingFromEnv();
  if (provider) {
    // Billing (2026-11-04): what managed agents cost goes to their owners' Rowboat accounts, when the deployment says where.
    const billing = input.hosting ? input.hosting.billing : billingFromEnv();
    service.attachHosting(
      provider,
      {
        agentKey: (id) => connectors.agentKey(id),
        orgUrl: () => orgUrl(service.org.address),
        connected: (id) => service.agentConnected(id),
        save: (agentId, secret, setBy) => connectors.save(agentId, secret, setBy),
        added: (agent) => connectors.ensure(agent),
        stop: (agentId) => connectors.stop(agentId),
      },
      {
        ...(input.hosting?.trialMs !== undefined ? { trialMs: input.hosting.trialMs } : {}),
        ...(input.hosting?.settleEveryMs !== undefined ? { settleEveryMs: input.hosting.settleEveryMs } : {}),
        ...(billing ? { billing } : {}),
      },
    );
  }
  await connectors.startAll();
  if (provider) service.startHosting(input.hosting?.tickMs);
  // The space graph (spec §8 Space graph, 2026-11-12): judged with Jev, when the deployment has its key.
  const jev = input.graph?.jev ?? jevFromEnv();
  if (jev) {
    const { jev: _stand, ...graphOptions } = input.graph ?? { jev };
    service.attachGraph(jev, graphOptions);
    service.startGraph();
  }
  // Space connections (spec §8 Space connections, 2026-11-28): apps reached through the control plane, when the deployment has one.
  const connections = input.connections ?? connectionsFromEnv();
  if (connections) {
    const { backend, billing, writer, apps, ...connectionOptions } = connections;
    // The gateway key is sealed like a platform credential, bound to the org and to the connection, never to an agent's id.
    const scope = (connectionId: string) => `connection:${connectionId}`;
    service.attachConnections(
      {
        backend,
        billing,
        writer,
        apps: apps ?? DEFAULT_CONNECTION_APPS,
        seal: (secret, connectionId) => seal(secret, input.orgId, scope(connectionId)),
        unseal: (sealed, connectionId) => unseal(sealed, input.orgId, scope(connectionId)),
        deliverUrl: () => `${orgUrl(service.org.address)}/v1/connections/events`,
      },
      connectionOptions,
    );
    service.startConnections();
  }
  const auth = bindAuth(input.auth, store);
  const issuer = input.auth.metadata?.()?.authorizationServers[0];
  const render = getRequestListener(
    buildHttpApp({
      service,
      auth,
      ...(input.consentPublishableKey && issuer ? { consent: { issuer, publishableKey: input.consentPublishableKey } } : {}),
      ...(input.maxBlobBytes !== undefined ? { maxBlobBytes: input.maxBlobBytes } : {}),
      ...(input.webOrigins ? { webOrigins: input.webOrigins } : {}),
      ...(input.sessionCookieDomain ? { sessionCookieDomain: input.sessionCookieDomain } : {}),
      ...(input.webAppUrl ? { webAppUrl: input.webAppUrl } : {}),
    }).fetch,
  );
  return {
    service,
    auth,
    handle: (req, res) => {
      if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
        void handleMcpRequest(req, res, { service, auth });
        return;
      }
      render(req, res);
    },
    live: { service, hub, auth, webOrigins: new Set(input.webOrigins ?? []) },
    close: async () => {
      service.closePresence();
      await service.stopHosting();
      await service.stopGraph();
      await service.stopConnections();
      await connectors.stopAll();
    },
  };
}
