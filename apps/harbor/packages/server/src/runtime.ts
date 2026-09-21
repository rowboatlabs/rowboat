import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { bindAuth, type AuthDriver, type OrgAuth } from './auth.js';
import type { BlobStore } from './blobs.js';
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
  /** The process-wide hub — space ids are globally unique, so one hub serves every org. */
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
}

export interface OrgRuntime {
  service: HarborService;
  auth: OrgAuth;
  /** Every HTTP request addressed to this org: /mcp to the agent face, the rest to the render face. */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** What the live face needs for a connection to this org. */
  live: LiveDeps;
}

export async function buildOrgRuntime(input: OrgRuntimeInput): Promise<OrgRuntime> {
  const { store, hub } = input;
  const service = new HarborService(
    store,
    hub,
    input.org,
    input.blobs,
    new Notifier(store, hub, input.pushSender ?? new PushSender(store, input.orgId)),
  );
  // The mentions backfill (service.migrateMentions): idempotent, ledgered once per org, before the faces serve.
  await service.migrateMentions();
  const auth = bindAuth(input.auth, store);
  const issuer = input.auth.metadata?.()?.authorizationServers[0];
  const render = getRequestListener(
    buildHttpApp({
      service,
      auth,
      ...(input.consentPublishableKey && issuer ? { consent: { issuer, publishableKey: input.consentPublishableKey } } : {}),
      ...(input.maxBlobBytes !== undefined ? { maxBlobBytes: input.maxBlobBytes } : {}),
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
    live: { service, hub, auth },
  };
}
