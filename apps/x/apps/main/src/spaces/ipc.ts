import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import { ipc, spaces as spacesShared } from '@x/shared';
import * as orgs from '@x/core/dist/spaces/orgs.js';
import * as blobCache from './blob-cache.js';
import * as spacesOAuth from '@x/core/dist/spaces/oauth.js';
import { oauthConnectBus } from '@x/core/dist/auth/connector-events.js';
import { cancelScheduled, listScheduled, scheduleItem } from '@x/core/dist/spaces/scheduler.js';
import { invokeTopicAgent, stopTopicAgent, topicSessionId } from '@x/core/dist/spaces/topic-agent.js';
import { onSpaceAgentActivity, startSpaceAgentActivity } from '@x/core/dist/spaces/agent-activity.js';
import { startSpaceNotifications } from '@x/core/dist/spaces/notify.js';
import { resolveResponseSession, startSpaceResponseIndex } from '@x/core/dist/spaces/response-index.js';
import { SpaceSubscriptions, harborChannelHandlers, type HarborChannel } from '@x/spaces-client';
import { createAgent37Instance, listAgent37Instances } from '@x/core/dist/spaces/agent37.js';
import { fetchLinkPreview } from './link-preview.js';

type IPCChannels = ipc.IPCChannels;

type InvokeHandler<K extends keyof IPCChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]['req'],
) => IPCChannels[K]['res'] | Promise<IPCChannels[K]['res']>;

// The Spaces channels that depend on this host; the ones that are one Harbor
// call each come from the shared table (@x/spaces-client channels.ts).
type SpacesHostChannel =
  | 'spaces:listOrgs' | 'spaces:addOrg' | 'spaces:resolveInviteLink' | 'spaces:joinInvite' | 'spaces:signInOrg'
  | 'spaces:accountState' | 'spaces:signInRowboat' | 'spaces:addOrgByAddress' | 'spaces:createOrg' | 'spaces:apexInfo'
  | 'spaces:removeOrg' | 'spaces:agent37Instances' | 'spaces:agent37CreateInstance' | 'spaces:uploadBlob'
  | 'spaces:saveBlob' | 'spaces:saveAsset' | 'spaces:saveImageUrl' | 'spaces:linkPreview' | 'spaces:invokeRowboat'
  | 'spaces:topicSession' | 'spaces:responseSession' | 'spaces:stopRowboat' | 'spaces:schedule'
  | 'spaces:listScheduled' | 'spaces:cancelScheduled' | 'spaces:bounceLive';

type SpacesHandlers = { [K in HarborChannel | SpacesHostChannel]: InvokeHandler<K> };

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

const openBrowser = (url: string) => shell.openExternal(url);

// Member-addressed frames (space_added: someone opened a DM with us) have no
// space subscription to ride — relay them to every window as they arrive; the
// renderer's orgs store refreshes its listing on them.
orgs.onMemberFrame((orgId, frame) => broadcastSpacesEvent({ orgId, frame }));

// The agent-activity feed ("my Rowboat is working on this thread"): core
// folds turn/session bus events into per-org lists and emits each whole list
// on change; windows replace their copy. Started here, before any mention
// can be sent.
onSpaceAgentActivity((event) => broadcastSpacesEvent(event));
void startSpaceAgentActivity().catch((err) => console.error('[spaces] agent activity feed failed to start:', err));
// The org's `notify` frames become OS notifications (unread arc, 2026-09-10).
startSpaceNotifications();
// The per-response index ("which run posted this reply"): same bus, its own
// consumer — see core/spaces/response-index.
void startSpaceResponseIndex().catch((err) => console.error('[spaces] response index failed to start:', err));

function broadcastSpacesEvent(event: spacesShared.SpacesBusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send('spaces:events', event);
    }
  }
}

// One core-level live subscription per (org, space), fanned out to all windows.
// The renderer's afterOffset drives replay on first subscribe; after that the
// registry tracks each entry's resume point and re-subscribes on a fresh
// client whenever core replaces an org's socket (@x/spaces-client subscriptions.ts).
const subscriptions = new SpaceSubscriptions({ getLive: orgs.getLive, onRuntimeReset: orgs.onRuntimeReset });

// The table's handlers take the request alone; main's take the IPC event first.
const harbor = harborChannelHandlers({ getClient: orgs.getClient, getLive: orgs.getLive, subscriptions, emit: broadcastSpacesEvent });
const harborIpcHandlers = Object.fromEntries(
  Object.entries(harbor).map(([channel, handle]) => [
    channel,
    (_event: Electron.IpcMainInvokeEvent, args: unknown) => (handle as (args: unknown) => unknown)(args),
  ]),
) as { [K in HarborChannel]: InvokeHandler<K> };

/**
 * Spaces IPC handlers, exported as a plain object and spread into the main
 * `registerIpcHandlers({...})` call in ipc.ts — same convention as
 * `browserIpcHandlers`. Handlers delegate to core (spaces/orgs.js); everything
 * the renderer does is attributed 'direct' (the app is the human surface;
 * agents write through the org's MCP face).
 */
export const spacesIpcHandlers: SpacesHandlers = {
  ...harborIpcHandlers,

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

  'spaces:addOrgByAddress': async (_event, args) => ({
    org: await orgSummary(await spacesOAuth.addOrgByAddress({ address: args.address, openBrowser })),
  }),

  'spaces:addOrg': async (_event, args) => {
    const org = await orgSummary(await orgs.addDevOrg({ baseUrl: args.baseUrl, memberId: args.memberId }));
    return { org };
  },

  'spaces:resolveInviteLink': async (_event, args) => {
    const { baseUrl, resolved } = await spacesOAuth.resolveInviteLink(args.url);
    return { baseUrl, resolved };
  },

  'spaces:joinInvite': async (_event, args) => {
    const { org, result } = await spacesOAuth.joinViaInviteLink({ url: args.url, openBrowser });
    return { org: await orgSummary(org), space: result.space };
  },

  'spaces:signInOrg': async (_event, args) => {
    const record = orgs.getOrg(args.orgId);
    if (!record) throw new Error(`unknown org ${args.orgId}`);
    const updated = await spacesOAuth.signInOrg({ baseUrl: record.baseUrl, openBrowser, orgId: record.id });
    return { org: await orgSummary(updated) };
  },

  'spaces:createOrg': async (_event, args) => {
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

  'spaces:removeOrg': async (_event, args) => {
    subscriptions.dropOrg(args.orgId);
    await orgs.removeOrg(args.orgId);
    return { success: true };
  },

  'spaces:agent37Instances': async (_event, { key }) => ({ instances: await listAgent37Instances(key) }),
  'spaces:agent37CreateInstance': async (_event, { key, ...input }) => ({ instance: await createAgent37Instance(key, input) }),

  // Upload phase 1. Pastes arrive as bytes; drag-drop / picker sends the
  // absolute path (via electronUtils.getPathForFile) so big files never cross
  // IPC — main reads them from disk. mime falls back to the filename extension
  // server-side sniffing has the final word anyway.
  'spaces:uploadBlob': async (_event, args) => {
    const bytes = args.bytes !== undefined ? new Uint8Array(Buffer.from(args.bytes, 'base64')) : await fs.readFile(args.filePath!);
    const blob = await orgs.getClient(args.orgId).uploadBlob(args.spaceId, bytes, {
      ...(args.mime ? { declaredMime: args.mime } : {}),
    });
    return { blob };
  },

  'spaces:saveBlob': async (event, args) => {
    const { bytes } = await blobCache.getBlob(args.orgId, args.spaceId, args.hash);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { defaultPath: path.basename(args.suggestedName ?? args.hash.slice(0, 12)) };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, bytes);
    return { saved: true, path: result.filePath };
  },

  'spaces:saveAsset': async (event, args) => {
    const asset = await orgs.getClient(args.orgId).readAsset(args.spaceId, args.assetId);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { defaultPath: path.basename(asset.path) };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { saved: false };
    const bytes = asset.blob
      ? (await blobCache.getBlob(args.orgId, args.spaceId, asset.blob.hash)).bytes
      : Buffer.from(asset.content, 'utf8');
    await fs.writeFile(result.filePath, bytes);
    return { saved: true, path: result.filePath };
  },

  // External image save: dialog first (a cancel never downloads), then main
  // fetches the bytes — the renderer cannot cross-origin. https only.
  'spaces:saveImageUrl': async (event, args) => {
    const url = new URL(args.url);
    if (url.protocol !== 'https:') throw new Error('only https images can be saved');
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { defaultPath: path.basename(url.pathname) || 'image' };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { saved: false };
    const res = await fetch(args.url);
    if (!res.ok) throw new Error(`image fetch failed with ${res.status}`);
    await fs.writeFile(result.filePath, Buffer.from(await res.arrayBuffer()));
    return { saved: true, path: result.filePath };
  },

  'spaces:linkPreview': async (_event, args) => ({ preview: await fetchLinkPreview(args.url) }),

  'spaces:invokeRowboat': async (_event, args) => invokeTopicAgent(args),

  'spaces:topicSession': async (_event, args) => ({
    sessionId: topicSessionId(args.orgId, args.spaceId, args.threadRootId),
  }),

  'spaces:responseSession': async (_event, args) => resolveResponseSession(args),

  'spaces:stopRowboat': async (_event, args) => stopTopicAgent(args),

  'spaces:schedule': async (_event, args) => ({
    id: scheduleItem({
      kind: args.kind,
      orgId: args.orgId,
      spaceId: args.spaceId,
      ...(args.threadRootId ? { threadRootId: args.threadRootId } : {}),
      body: args.body,
      at: args.at,
    }).id,
  }),

  'spaces:listScheduled': async (_event, args) => ({ items: listScheduled(args.orgId, args.spaceId) }),

  'spaces:cancelScheduled': async (_event, args) => {
    cancelScheduled(args.id);
    return { success: true };
  },

  // In-process (kill-switch) parity for the wake bounce; in child/remote
  // mode this channel forwards to the server, which owns the sockets.
  'spaces:bounceLive': async () => {
    orgs.bounceAllLive();
    return { success: true };
  },
};
