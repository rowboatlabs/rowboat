import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { bindAuth, type AuthDriver, type ServerAuth } from './auth.js';
import { billingFromEnv, type BillingAccounts } from './billing.js';
import type { BlobStore } from './blobs.js';
import { HostedConnectors } from './connectors/host.js';
import { jevApiKey } from './connectors/jev/index.js';
import { maritimeProvisioner } from './connectors/maritime/provisioning.js';
import type { HostingProvider } from './core/hosting.js';
import { buildHttpApp } from './http.js';
import type { SpaceHub } from './hub.js';
import { handleMcpRequest } from './mcp.js';
import { Notifier } from './notify.js';
import { PushSender } from './push.js';
import { HarborService, type ServerInfo } from './service.js';
import type { Store } from './store.js';
import type { LiveDeps } from './ws.js';

// The one place the server's object graph is assembled: the service core, the
// notifier and its push sender, the store-bound auth handle, the render and
// agent faces, and what the live face needs. server.ts builds the server
// here, so the assembly that ships is the assembly every test exercises — and
// there is exactly one answer to "how is the server wired". Until 2026-11-09
// a multi-org deployment built one of these per org (spec §4).

export interface RuntimeInput {
  store: Store;
  hub: SpaceHub;
  server: ServerInfo;
  /** Token → identity. */
  auth: AuthDriver;
  /** Absent = uploads unconfigured (the routes refuse loudly, everything else works). */
  blobs?: BlobStore;
  /** Test injection; default = Expo push. */
  pushSender?: PushSender;
  /** Mounts /oauth/consent; takes effect only with an oidc driver (the issuer comes from its metadata). */
  consentPublishableKey?: string;
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
  /** Browser origins allowed to call the render face cross-origin (cors.ts), and to use the session cookie (session.ts). */
  webOrigins?: readonly string[];
  /** The Spaces web app, which a link opened in a browser offers beside the desktop app (http.ts, the landings). */
  webAppUrl?: string;
  /** Managed hosting (spec §8 Maritime, 2026-10-26): a stand-in provider and tick in tests; absent = from HARBOR_MARITIME_API_KEY. */
  hosting?: { provider: HostingProvider; tickMs?: number; trialMs?: number; billing?: BillingAccounts; settleEveryMs?: number };
  /** Test knob: how long an agent may be away before it is announced offline (default 15s). */
  agentPresenceGraceMs?: number;
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

export interface Runtime {
  service: HarborService;
  auth: ServerAuth;
  /** Every HTTP request: /mcp to the agent face, the rest to the render face. */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** What the live face needs for a connection. */
  live: LiveDeps;
  /** Stops the connectors Harbor runs. */
  close(): Promise<void>;
}

export async function buildRuntime(input: RuntimeInput): Promise<Runtime> {
  const { store, hub } = input;
  const service = new HarborService(
    store,
    hub,
    input.server,
    input.blobs,
    new Notifier(store, hub, input.pushSender ?? new PushSender(store)),
    input.agentPresenceGraceMs !== undefined ? { presenceGraceMs: input.agentPresenceGraceMs } : {},
  );
  // The mentions backfill (service.migrateMentions): idempotent, ledgered once, before the faces serve.
  await service.migrateMentions();
  // Connectors Harbor runs (spec §8 Connectors, 2026-09-30): one per agent whose
  // connection is a platform, from boot, and for each such agent added later.
  const connectors = new HostedConnectors({ store, hub, service });
  service.attachConnectors({
    verify: (connection, secret, target) => connectors.verify(connection, secret, target),
    save: (agentId, secret, setBy) => connectors.save(agentId, secret, setBy),
    added: (agent) => connectors.ensure(agent),
    alert: (connection, payload) => connectors.alert(connection, payload),
    setup: (connection) => connectors.setup(connection),
  });
  // Managed hosting (spec §8 Maritime, 2026-10-26): agents Rowboat's own account creates, when the deployment has its key.
  const provider = input.hosting?.provider ?? hostingFromEnv();
  if (provider) {
    // Billing (2026-11-04): what managed agents cost goes to their owners' Rowboat accounts, when the deployment says where.
    const billing = input.hosting ? input.hosting.billing : billingFromEnv();
    service.attachHosting(
      provider,
      {
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
  // Jev (spec §8 Jev, 2026-10-07): created once when the deployment has its key.
  if (jevApiKey()) await service.ensureJev();
  await connectors.startAll();
  if (provider) service.startHosting(input.hosting?.tickMs);
  const auth = bindAuth(input.auth, store);
  const issuer = input.auth.metadata?.()?.authorizationServers[0];
  const render = getRequestListener(
    buildHttpApp({
      service,
      auth,
      ...(input.consentPublishableKey && issuer ? { consent: { issuer, publishableKey: input.consentPublishableKey } } : {}),
      ...(input.maxBlobBytes !== undefined ? { maxBlobBytes: input.maxBlobBytes } : {}),
      ...(input.webOrigins ? { webOrigins: input.webOrigins } : {}),
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
      await connectors.stopAll();
    },
  };
}
