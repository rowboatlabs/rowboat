import fs from 'node:fs/promises';
import { ipc, spaces as spacesShared } from '@x/shared';
import * as orgs from '@x/core/dist/spaces/orgs.js';
import * as spacesOAuth from '@x/core/dist/spaces/oauth.js';
import { oauthConnectBus } from '@x/core/dist/auth/connector-events.js';
import { cancelScheduled, listScheduled, scheduleItem } from '@x/core/dist/spaces/scheduler.js';
import { invokeTopicAgent, stopTopicAgent, topicSessionId } from '@x/core/dist/spaces/topic-agent.js';
import { onSpaceAgentActivity, startSpaceAgentActivity } from '@x/core/dist/spaces/agent-activity.js';
import { startSpaceNotifications } from '@x/core/dist/spaces/notify.js';
import { resolveResponseSession, startSpaceResponseIndex } from '@x/core/dist/spaces/response-index.js';
import { fetchLinkPreview } from '@x/core/dist/spaces/link-preview.js';
import { SpaceSubscriptions, harborChannelHandlers, type HarborChannelHandlers } from '@x/spaces-client';
import { openExternalUrl } from '@x/core/dist/auth/url-opener.js';

// Spaces handlers, server-side (Phase 9). The channels that are one Harbor
// call each are the shared table in @x/spaces-client (2026-10-09); these are
// the ones that need core, as in apps/main/src/spaces/ipc.ts minus the
// client-only ones (save dialogs — those stay in main). Spaces is core-coupled
// — the topic agent runs turns through the session runtime, mention offsets
// and org tokens live in the workdir — so it runs where core runs. Browser
// opens ride the url-opener seam (shell.openExternal in-process, the
// open-url reverse call from the standalone server).
//
// Live frames: one core-level subscription per (org, space), pushed to every
// connected client over the WS hub's 'spaces:events' channel (the desktop
// relays them to its windows). The renderer's afterOffset drives replay on
// first subscribe; core's SpacesLive owns reconnect after that.

const openBrowser = (url: string) => openExternalUrl(url);

type SpacesEventListener = (event: spacesShared.SpacesBusEvent) => void;
const spacesEventListeners = new Set<SpacesEventListener>();

export function subscribeSpacesEvents(listener: SpacesEventListener): () => void {
  spacesEventListeners.add(listener);
  return () => spacesEventListeners.delete(listener);
}

function emitSpacesEvent(event: spacesShared.SpacesBusEvent): void {
  for (const listener of spacesEventListeners) listener(event);
}

// The agent-activity feed ("my Rowboat is working on this thread"): core
// folds turn/session bus events into per-org lists and emits each whole list
// on change; clients replace their copy. Started here, before any mention
// can be sent.
onSpaceAgentActivity((event) => emitSpacesEvent(event));
void startSpaceAgentActivity().catch((err) => console.error('[spaces] agent activity feed failed to start:', err));
// The org's `notify` frames become OS notifications (unread arc, 2026-09-10).
startSpaceNotifications();
// The per-response index ("which run posted this reply"): same bus, its own
// consumer — see core/spaces/response-index.
void startSpaceResponseIndex().catch((err) => console.error('[spaces] response index failed to start:', err));

// One core-level live subscription per (org, space), fanned out to every
// client. The registry tracks each entry's resume point and re-subscribes
// on a fresh client whenever core replaces an org's socket (@x/spaces-client
// subscriptions.ts) — a subscription left on the dead one would swallow frames.
const subscriptions = new SpaceSubscriptions({ getLive: orgs.getLive, onRuntimeReset: orgs.onRuntimeReset });

// Member-addressed frames (space_added) ride no space subscription — relay
// them to every client as they arrive.
orgs.onMemberFrame((orgId, frame) => emitSpacesEvent({ orgId, frame }));

async function orgSummary(record: orgs.OrgRecord): Promise<spacesShared.SpacesOrgSummary> {
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    baseUrl: record.baseUrl,
    memberId: record.auth.memberId,
    ...(await orgs.describeOrgAuth(record)),
  };
}

const orgSummaries = (records: orgs.OrgRecord[]) => Promise.all(records.map(orgSummary));

// A Rowboat sign-in or sign-out changes what the apex would list for us:
// the next org listing re-syncs instead of trusting a recent one.
oauthConnectBus.subscribe((event) => {
  if (event.provider === 'rowboat') spacesOAuth.invalidateManagedOrgsSync();
});

// The Spaces channels that depend on this host; the ones that are one Harbor
// call each come from the shared table (@x/spaces-client channels.ts).
type SpacesHostChannel =
  | 'spaces:listOrgs' | 'spaces:addOrg' | 'spaces:resolveInviteLink' | 'spaces:joinInvite'
  | 'spaces:signInOrg' | 'spaces:createOrg' | 'spaces:apexInfo' | 'spaces:removeOrg'
  | 'spaces:accountState' | 'spaces:signInRowboat' | 'spaces:addOrgByAddress'
  | 'spaces:uploadBlob' | 'spaces:linkPreview'
  | 'spaces:invokeRowboat' | 'spaces:topicSession' | 'spaces:responseSession' | 'spaces:stopRowboat'
  | 'spaces:bounceLive'
  | 'spaces:schedule' | 'spaces:listScheduled' | 'spaces:cancelScheduled';
type SpacesHandlers = HarborChannelHandlers & {
  [K in SpacesHostChannel]: (
    args: ipc.IPCChannels[K]['req'],
  ) => ipc.IPCChannels[K]['res'] | Promise<ipc.IPCChannels[K]['res']>;
};

export const spacesRpcHandlers: SpacesHandlers = {
  // The router serves only the channels main forwards (channels.ts); the
  // table's roster, agent and invocation channels still run in main.
  ...harborChannelHandlers({ getClient: orgs.getClient, getLive: orgs.getLive, subscriptions, emit: emitSpacesEvent }),

  // The listing first makes the managed orgs match the apex (cheap when a
  // sync ran moments ago; a failed sync keeps the cached records and logs).
  'spaces:listOrgs': async () => {
    await spacesOAuth.syncManagedOrgs({ maxAgeMs: 30_000 }).catch((err) => {
      console.warn('[spaces] managed org sync failed:', err instanceof Error ? err.message : err);
    });
    return { orgs: await orgSummaries(orgs.listOrgs()) };
  },

  'spaces:accountState': async () => spacesOAuth.accountState(),

  'spaces:signInRowboat': async () => ({ orgs: await orgSummaries(await spacesOAuth.signInForSpaces()) }),

  'spaces:addOrgByAddress': async (args) => ({
    org: await orgSummary(await spacesOAuth.addOrgByAddress({ address: args.address, openBrowser })),
  }),

  'spaces:addOrg': async (args) => {
    const org = await orgSummary(await orgs.addDevOrg({ baseUrl: args.baseUrl, memberId: args.memberId }));
    return { org };
  },

  'spaces:resolveInviteLink': async (args) => {
    const { baseUrl, resolved } = await spacesOAuth.resolveInviteLink(args.url);
    return { baseUrl, resolved };
  },

  'spaces:joinInvite': async (args) => {
    const { org, result } = await spacesOAuth.joinViaInviteLink({ url: args.url, openBrowser });
    return { org: await orgSummary(org), space: result.space };
  },

  'spaces:signInOrg': async (args) => {
    const record = orgs.getOrg(args.orgId);
    if (!record) throw new Error(`unknown org ${args.orgId}`);
    const updated = await spacesOAuth.signInOrg({ baseUrl: record.baseUrl, openBrowser, orgId: record.id });
    return { org: await orgSummary(updated) };
  },

  'spaces:createOrg': async (args) => {
    const org = await orgSummary(await spacesOAuth.createOrgOnDeployment({ name: args.name, openBrowser }));
    return { org };
  },

  'spaces:apexInfo': async () => {
    try {
      return { apexDomain: new URL(await spacesOAuth.apexUrl()).host };
    } catch {
      return { apexDomain: null };
    }
  },

  'spaces:removeOrg': async (args) => {
    subscriptions.dropOrg(args.orgId);
    await orgs.removeOrg(args.orgId);
    return { success: true };
  },

  // Upload phase 1. Pastes arrive as bytes; drag-drop / picker sends the
  // absolute path so big files never cross IPC. NOTE: the path is read on the
  // machine core runs on — same-machine in child mode; with a remote server,
  // path uploads need the bytes variant (client-local file pickers gap).
  'spaces:uploadBlob': async (args) => {
    const bytes = args.bytes !== undefined ? new Uint8Array(Buffer.from(args.bytes, 'base64')) : await fs.readFile(args.filePath!);
    const blob = await orgs.getClient(args.orgId).uploadBlob(args.spaceId, bytes, {
      ...(args.mime ? { declaredMime: args.mime } : {}),
    });
    return { blob };
  },

  'spaces:linkPreview': async (args) => ({ preview: await fetchLinkPreview(args.url) }),

  'spaces:invokeRowboat': async (args) => invokeTopicAgent(args),

  'spaces:topicSession': async (args) => ({
    sessionId: topicSessionId(args.orgId, args.spaceId, args.threadRootId),
  }),

  'spaces:responseSession': async (args) => resolveResponseSession(args),

  'spaces:stopRowboat': async (args) => stopTopicAgent(args),

  // Sleep leaves spaces WebSockets half-open (no close ever fires). The
  // client's powerMonitor calls this on wake so every stream reconnects and
  // replays immediately instead of waiting out the watchdog.
  'spaces:bounceLive': async () => {
    orgs.bounceAllLive();
    return { success: true };
  },

  // Scheduled sends + reminders: the 20s scheduler tick lives in this process.
  'spaces:schedule': async (args) => ({
    id: scheduleItem({
      kind: args.kind,
      orgId: args.orgId,
      spaceId: args.spaceId,
      ...(args.threadRootId ? { threadRootId: args.threadRootId } : {}),
      body: args.body,
      at: args.at,
    }).id,
  }),

  'spaces:listScheduled': async (args) => ({ items: listScheduled(args.orgId, args.spaceId) }),

  'spaces:cancelScheduled': async (args) => {
    cancelScheduled(args.id);
    return { success: true };
  },
};
