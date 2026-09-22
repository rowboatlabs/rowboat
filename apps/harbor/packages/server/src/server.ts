import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DevAuthDriver, ensureMember, type AuthDriver } from './auth.js';
import { MemoryBlobStore, type BlobStore } from './blobs.js';
import { SpaceHub } from './hub.js';
import { internalHandler } from './internal.js';
import { LiveStats } from './stats.js';
import { DEFAULT_ORG_ID } from './pg-store.js';
import type { PushSender } from './push.js';
import { buildOrgRuntime } from './runtime.js';
import type { HarborService } from './service.js';
import type { Store } from './store.js';
import { attachLive } from './ws.js';

// Assembly: one node server carrying all three faces —
//   REST render face     /v1/*  (+ /join/<token>)
//   live face            /v1/live (WebSocket upgrade)
//   MCP agent face       /mcp
// One org per process; deployment.ts serves many from one process.

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
  /** Test injection: replaces the default PushSender (push.ts). */
  pushSender?: PushSender;
  /** 0 (default) picks an ephemeral port — tests never collide. */
  port?: number;
  orgName?: string;
  /** Org address links are minted on; defaults to localhost:<actual port>. */
  address?: string;
  /** Org policy v1: restrict invite binds to these email domains (spec §4). */
  allowedEmailDomains?: string[];
  /** Storage: a PgStore with init() run — durable Postgres, or PGlite in-process for dev and tests (sql-pglite.ts). */
  store: Store;
  /** Blob bytes; defaults to in-memory. Pass Disk/S3 for durable deployments. */
  blobs?: BlobStore;
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
  /** Live-face heartbeat cadence (default 25s). A test knob; production keeps the default. */
  liveHeartbeatMs?: number;
  /** Test knob: unsent-bytes ceiling before a stalled socket is terminated (ws.ts). */
  liveMaxBufferedBytes?: number;
  /**
   * The operator face (internal.ts). `key` enables GET /internal/stats; `log`
   * prints the live-load line once a minute — independent of the key, the
   * line is the passive record for whoever never polls. main.ts sets it;
   * tests leave it off.
   */
  internal?: { key?: string; log?: boolean };
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
  stats: LiveStats;
  server: HttpServer;
  close(): Promise<void>;
}

export async function startHarbor(options: HarborOptions): Promise<RunningHarbor> {
  const { store } = options;
  const stats = new LiveStats({ log: options.internal?.log === true });
  const hub = new SpaceHub(stats);
  // The same assembly the deployment builds per org (runtime.ts), for the one org here.
  const runtime = await buildOrgRuntime({
    store,
    hub,
    org: {
      name: options.orgName ?? 'Harbor (dev)',
      address: options.address ?? 'localhost',
      ...(options.allowedEmailDomains ? { allowedEmailDomains: options.allowedEmailDomains } : {}),
    },
    orgId: DEFAULT_ORG_ID,
    auth: options.auth ?? new DevAuthDriver(),
    blobs: options.blobs ?? new MemoryBlobStore(),
    ...(options.pushSender ? { pushSender: options.pushSender } : {}),
    ...(options.consent ? { consentPublishableKey: options.consent.publishableKey } : {}),
    ...(options.maxBlobBytes !== undefined ? { maxBlobBytes: options.maxBlobBytes } : {}),
  });
  await seedOrg(runtime.service, store, options);

  const internal = internalHandler({ key: options.internal?.key, stats });
  const server = createServer((req, res) => {
    if (!internal(req, res)) runtime.handle(req, res);
  });
  const closeLive = attachLive(server, () => runtime.live, {
    stats,
    ...(options.liveHeartbeatMs !== undefined ? { heartbeatMs: options.liveHeartbeatMs } : {}),
    ...(options.liveMaxBufferedBytes !== undefined ? { maxBufferedBytes: options.liveMaxBufferedBytes } : {}),
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));
  const port = (server.address() as AddressInfo).port;
  if (!options.address) runtime.service.org.address = `localhost:${port}`;

  return {
    url: `http://localhost:${port}`,
    mcpUrl: `http://localhost:${port}/mcp`,
    address: runtime.service.org.address,
    port,
    service: runtime.service,
    store,
    hub,
    stats,
    server,
    close: async () => {
      closeLive();
      stats.close();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

/**
 * The dev/test seed (main.ts's Roadboard, the suites' fixtures): members,
 * then each seed space — made by its creator (the provisioned first admin,
 * spec §4), joined by every seed member, filled with its files. Idempotent
 * on durable stores: a creator's existing space of the same name is left alone.
 */
async function seedOrg(
  service: HarborService,
  store: Store,
  options: Pick<HarborOptions, 'seedMembers' | 'seedSpaces'>,
): Promise<void> {
  for (const m of options.seedMembers ?? []) {
    const existing = await store.getMember(m.id);
    await store.putMember({ id: m.id, displayName: m.displayName, role: existing?.role ?? 'member' });
  }
  for (const seed of options.seedSpaces ?? []) {
    const creator = await ensureMember(store, seed.creator);
    if (creator.role !== 'admin') await store.putMember({ ...creator, role: 'admin' });
    const existing = await service.listSpaces({ memberId: seed.creator });
    if (existing.some((s) => s.name === seed.name)) continue;
    const space = await service.createSpace({ memberId: seed.creator }, seed.name);
    for (const m of options.seedMembers ?? []) {
      if (m.id === seed.creator) continue;
      const invite = await service.createInvite({ memberId: seed.creator }, space.id);
      await service.acceptInvite({ memberId: m.id }, invite.token);
    }
    for (const asset of seed.assets ?? []) {
      await service.createAsset({ memberId: seed.creator }, space.id, {
        path: asset.path,
        newContent: asset.content,
        ...(asset.reason ? { reason: asset.reason } : {}),
        actingMode: 'direct',
      });
    }
  }
}
