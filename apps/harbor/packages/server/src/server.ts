import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { DevAuthDriver, ensureMember, type AuthDriver } from './auth.js';
import { MemoryBlobStore, type BlobStore } from './blobs.js';
import { buildHttpApp } from './http.js';
import { SpaceHub } from './hub.js';
import { handleMcpRequest } from './mcp.js';
import { MemoryStore } from './memory-store.js';
import { HarborService } from './service.js';
import type { Store } from './store.js';
import { attachLive } from './ws.js';

// Assembly: one node server carrying all three faces —
//   REST render face     /v1/*  (+ /join/<token>)
//   live face            /v1/live (WebSocket upgrade)
//   MCP agent face       /mcp
// One in-memory org per process; multi-org routing arrives with the real Harbor.

export interface SeedMember {
  id: string;
  displayName: string;
}

export interface SeedSpace {
  name: string;
  /** Member id of the creator; every seed member joins the space. */
  creator: string;
  assets?: Array<{ path: string; content: string; reason?: string }>;
}

export interface HarborOptions {
  /** 0 (default) picks an ephemeral port — tests never collide. */
  port?: number;
  orgName?: string;
  /** Org address links are minted on; defaults to localhost:<actual port>. */
  address?: string;
  /** Org policy v1: restrict invite binds to these email domains (spec §4). */
  allowedEmailDomains?: string[];
  /** Storage; defaults to in-memory. Pass a PgStore (init() run) for durable deployments. */
  store?: Store;
  /** Blob bytes; defaults to in-memory (matching the store default). Pass Disk/S3 for durable deployments. */
  blobs?: BlobStore;
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
  /** Auth driver; defaults to dev tokens (never expose publicly). Pass an OidcAuthDriver for real deployments. */
  auth?: AuthDriver;
  /**
   * Mounts /oauth/consent (the login/consent page). The issuer comes from the
   * auth driver's metadata, so this only takes effect alongside an oidc driver.
   */
  consent?: { publishableKey: string };
  seedMembers?: SeedMember[];
  seedSpaces?: SeedSpace[];
}

export interface RunningHarbor {
  url: string;
  mcpUrl: string;
  address: string;
  port: number;
  service: HarborService;
  store: Store;
  hub: SpaceHub;
  server: HttpServer;
  close(): Promise<void>;
}

export async function startHarbor(options: HarborOptions = {}): Promise<RunningHarbor> {
  const store = options.store ?? new MemoryStore();
  const blobs = options.blobs ?? new MemoryBlobStore();
  const auth: AuthDriver = options.auth ?? new DevAuthDriver();
  const hub = new SpaceHub();
  const service = new HarborService(
    store,
    hub,
    {
      name: options.orgName ?? 'Harbor (dev)',
      address: options.address ?? 'localhost',
      ...(options.allowedEmailDomains ? { allowedEmailDomains: options.allowedEmailDomains } : {}),
    },
    blobs,
  );

  for (const m of options.seedMembers ?? []) {
    const existing = await store.getMember(m.id);
    await store.putMember({ id: m.id, displayName: m.displayName, role: existing?.role ?? 'member' });
  }
  for (const seed of options.seedSpaces ?? []) {
    // The seed creator is the provisioned first admin (spec §4, roles).
    const creator = await ensureMember(store, seed.creator);
    if (creator.role !== 'admin') await store.putMember({ ...creator, role: 'admin' });
    // Idempotent across restarts on durable stores: the seed space is only
    // created if the creator doesn't already have one by this name.
    const existing = await service.listSpaces({ memberId: seed.creator });
    if (existing.some((s) => s.name === seed.name)) continue;
    const space = await service.createSpace({ memberId: seed.creator }, seed.name);
    for (const m of options.seedMembers ?? []) {
      if (m.id === seed.creator) continue;
      const invite = await service.createInvite({ memberId: seed.creator }, space.id);
      await service.acceptInvite({ memberId: m.id }, invite.token);
    }
    for (const asset of seed.assets ?? []) {
      await service.proposeChange({ memberId: seed.creator }, space.id, {
        assetPath: asset.path,
        baseVersion: 0,
        newContent: asset.content,
        ...(asset.reason ? { reason: asset.reason } : {}),
        actingMode: 'direct',
      });
    }
  }

  const issuer = auth.metadata?.()?.authorizationServers[0];
  const app = buildHttpApp({
    service,
    store,
    auth,
    ...(options.consent && issuer ? { consent: { issuer, publishableKey: options.consent.publishableKey } } : {}),
    ...(options.maxBlobBytes !== undefined ? { maxBlobBytes: options.maxBlobBytes } : {}),
  });
  const honoListener = getRequestListener(app.fetch);
  const server = createServer((req, res) => {
    if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
      void handleMcpRequest(req, res, { service, store, auth });
      return;
    }
    honoListener(req, res);
  });
  const closeLive = attachLive(server, () => ({ service, hub, store, auth }));

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));
  const port = (server.address() as AddressInfo).port;
  if (!options.address) service.org.address = `localhost:${port}`;

  return {
    url: `http://localhost:${port}`,
    mcpUrl: `http://localhost:${port}/mcp`,
    address: service.org.address,
    port,
    service,
    store,
    hub,
    server,
    close: async () => {
      closeLive();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
