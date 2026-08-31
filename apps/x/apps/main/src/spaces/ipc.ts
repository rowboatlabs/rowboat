import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import { ipc, spaces as spacesShared } from '@x/shared';
import * as orgs from '@x/core/dist/spaces/orgs.js';
import * as blobCache from './blob-cache.js';
import * as spacesOAuth from '@x/core/dist/spaces/oauth.js';
import { syncSpaceMentionWatch } from '@x/core/dist/spaces/mention-watch.js';
import { getDndUntil, getNotifyPrefs, setDndUntil, setNotifyPref } from '@x/core/dist/spaces/notify-prefs.js';
import { cancelScheduled, listScheduled, scheduleItem } from '@x/core/dist/spaces/scheduler.js';
import { invokeTopicAgent, topicSessionId } from '@x/core/dist/spaces/topic-agent.js';
import { SpacesClient } from '@x/core/dist/spaces/client.js';
import { fetchLinkPreview } from './link-preview.js';

type IPCChannels = ipc.IPCChannels;

type InvokeHandler<K extends keyof IPCChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]['req'],
) => IPCChannels[K]['res'] | Promise<IPCChannels[K]['res']>;

type SpacesHandlers = {
  'spaces:listOrgs': InvokeHandler<'spaces:listOrgs'>;
  'spaces:addOrg': InvokeHandler<'spaces:addOrg'>;
  'spaces:resolveInviteLink': InvokeHandler<'spaces:resolveInviteLink'>;
  'spaces:joinInvite': InvokeHandler<'spaces:joinInvite'>;
  'spaces:signInOrg': InvokeHandler<'spaces:signInOrg'>;
  'spaces:createOrg': InvokeHandler<'spaces:createOrg'>;
  'spaces:apexInfo': InvokeHandler<'spaces:apexInfo'>;
  'spaces:removeOrg': InvokeHandler<'spaces:removeOrg'>;
  'spaces:listSpaces': InvokeHandler<'spaces:listSpaces'>;
  'spaces:createSpace': InvokeHandler<'spaces:createSpace'>;
  'spaces:listMembers': InvokeHandler<'spaces:listMembers'>;
  'spaces:createInvite': InvokeHandler<'spaces:createInvite'>;
  'spaces:resolveInvite': InvokeHandler<'spaces:resolveInvite'>;
  'spaces:acceptInvite': InvokeHandler<'spaces:acceptInvite'>;
  'spaces:listAssets': InvokeHandler<'spaces:listAssets'>;
  'spaces:moveAsset': InvokeHandler<'spaces:moveAsset'>;
  'spaces:deleteAsset': InvokeHandler<'spaces:deleteAsset'>;
  'spaces:restoreAsset': InvokeHandler<'spaces:restoreAsset'>;
  'spaces:uploadBlob': InvokeHandler<'spaces:uploadBlob'>;
  'spaces:saveBlob': InvokeHandler<'spaces:saveBlob'>;
  'spaces:saveImageUrl': InvokeHandler<'spaces:saveImageUrl'>;
  'spaces:linkPreview': InvokeHandler<'spaces:linkPreview'>;
  'spaces:readAsset': InvokeHandler<'spaces:readAsset'>;
  'spaces:proposeChange': InvokeHandler<'spaces:proposeChange'>;
  'spaces:assetHistory': InvokeHandler<'spaces:assetHistory'>;
  'spaces:diff': InvokeHandler<'spaces:diff'>;
  'spaces:listTopics': InvokeHandler<'spaces:listTopics'>;
  'spaces:listMessages': InvokeHandler<'spaces:listMessages'>;
  'spaces:postMessage': InvokeHandler<'spaces:postMessage'>;
  'spaces:manageTopic': InvokeHandler<'spaces:manageTopic'>;
  'spaces:reactToMessage': InvokeHandler<'spaces:reactToMessage'>;
  'spaces:deleteMessage': InvokeHandler<'spaces:deleteMessage'>;
  'spaces:editMessage': InvokeHandler<'spaces:editMessage'>;
  'spaces:invokeRowboat': InvokeHandler<'spaces:invokeRowboat'>;
  'spaces:topicSession': InvokeHandler<'spaces:topicSession'>;
  'spaces:getNotifyPrefs': InvokeHandler<'spaces:getNotifyPrefs'>;
  'spaces:setNotifyPref': InvokeHandler<'spaces:setNotifyPref'>;
  'spaces:schedule': InvokeHandler<'spaces:schedule'>;
  'spaces:listScheduled': InvokeHandler<'spaces:listScheduled'>;
  'spaces:cancelScheduled': InvokeHandler<'spaces:cancelScheduled'>;
  'spaces:getDnd': InvokeHandler<'spaces:getDnd'>;
  'spaces:setDnd': InvokeHandler<'spaces:setDnd'>;
  'spaces:subscribeSpace': InvokeHandler<'spaces:subscribeSpace'>;
  'spaces:unsubscribeSpace': InvokeHandler<'spaces:unsubscribeSpace'>;
  'spaces:presence': InvokeHandler<'spaces:presence'>;
  'spaces:bounceLive': InvokeHandler<'spaces:bounceLive'>;
};

function orgSummary(record: orgs.OrgRecord): spacesShared.SpacesOrgSummary {
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    baseUrl: record.baseUrl,
    memberId: record.auth.memberId,
    authKind: record.auth.kind,
    ...(record.auth.kind === 'oauth' && record.auth.error ? { authError: record.auth.error } : {}),
  };
}

const openBrowser = (url: string) => shell.openExternal(url);

function broadcastSpacesEvent(event: spacesShared.SpacesBusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send('spaces:events', event);
    }
  }
}

// One core-level live subscription per (org, space), fanned out to all windows.
// The renderer's afterOffset drives replay on first subscribe; core's
// SpacesLive owns reconnect + resume from the last seen offset after that.
const liveSubscriptions = new Map<string, () => void>();

/**
 * Spaces IPC handlers, exported as a plain object and spread into the main
 * `registerIpcHandlers({...})` call in ipc.ts — same convention as
 * `browserIpcHandlers`. Handlers delegate to core (spaces/orgs.js); everything
 * the renderer does is attributed 'direct' (the app is the human surface;
 * agents write through the org's MCP face).
 */
export const spacesIpcHandlers: SpacesHandlers = {
  'spaces:listOrgs': async () => ({ orgs: orgs.listOrgs().map(orgSummary) }),

  'spaces:addOrg': async (_event, args) => {
    const org = orgSummary(await orgs.addDevOrg({ baseUrl: args.baseUrl, memberId: args.memberId }));
    void syncSpaceMentionWatch({ force: true });
    return { org };
  },

  'spaces:resolveInviteLink': async (_event, args) => {
    const { baseUrl, resolved } = await spacesOAuth.resolveInviteLink(args.url);
    return { baseUrl, resolved };
  },

  'spaces:joinInvite': async (_event, args) => {
    const { org, result } = await spacesOAuth.joinViaInviteLink({ url: args.url, openBrowser });
    void syncSpaceMentionWatch({ force: true });
    return { org: orgSummary(org), space: result.space };
  },

  'spaces:signInOrg': async (_event, args) => {
    const record = orgs.getOrg(args.orgId);
    if (!record) throw new Error(`unknown org ${args.orgId}`);
    const updated = await spacesOAuth.signInOrg({ baseUrl: record.baseUrl, openBrowser, orgId: record.id });
    return { org: orgSummary(updated) };
  },

  'spaces:createOrg': async (_event, args) => {
    const org = orgSummary(await spacesOAuth.createOrgOnDeployment({ name: args.name, slug: args.slug, openBrowser }));
    void syncSpaceMentionWatch({ force: true });
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
    void syncSpaceMentionWatch({ force: true });
    for (const [key, unsubscribe] of liveSubscriptions) {
      if (key.startsWith(`${args.orgId}/`)) {
        unsubscribe();
        liveSubscriptions.delete(key);
      }
    }
    await orgs.removeOrg(args.orgId);
    return { success: true };
  },

  'spaces:listSpaces': async (_event, args) => {
    const spaces = await orgs.getClient(args.orgId).listSpaces();
    // The renderer just reached this org — if it was down at boot (or restarted),
    // this is the earliest signal that its spaces are watchable again. Unforced:
    // repeated refreshes collapse into one sync.
    void syncSpaceMentionWatch();
    return { spaces };
  },

  'spaces:createSpace': async (_event, args) => {
    const space = await orgs.getClient(args.orgId).createSpace(args.name);
    void syncSpaceMentionWatch({ force: true });
    return { space };
  },

  'spaces:listMembers': async (_event, args) => ({
    members: await orgs.getClient(args.orgId).listMembers(args.spaceId),
  }),

  'spaces:createInvite': async (_event, args) =>
    orgs.getClient(args.orgId).createInvite(args.spaceId, args.expiresInHours),

  // Pre-auth: works before the org has been added, so the join flow can show
  // what's being joined (spec §4). The token is unused on this route.
  'spaces:resolveInvite': async (_event, args) =>
    new SpacesClient({ baseUrl: args.baseUrl, token: 'dev-preauth' }).resolveInvite(args.token),

  'spaces:acceptInvite': async (_event, args) => orgs.getClient(args.orgId).acceptInvite(args.token),

  'spaces:listAssets': async (_event, args) => ({
    entries: await orgs.getClient(args.orgId).listAssets(args.spaceId, {
      ...(args.includeDeleted !== undefined ? { includeDeleted: args.includeDeleted } : {}),
    }),
  }),

  // Namespace ops — the renderer is the human surface, so everything here is
  // 'direct' (agents move/delete through the org's MCP face, attributed there).
  'spaces:moveAsset': async (_event, args) =>
    orgs.getClient(args.orgId).moveAsset(args.spaceId, {
      fromPath: args.fromPath,
      toPath: args.toPath,
      baseVersion: args.baseVersion,
      ...(args.reason ? { reason: args.reason } : {}),
      actingMode: 'direct',
    }),

  'spaces:deleteAsset': async (_event, args) =>
    orgs.getClient(args.orgId).deleteAsset(args.spaceId, {
      path: args.path,
      baseVersion: args.baseVersion,
      ...(args.reason ? { reason: args.reason } : {}),
      actingMode: 'direct',
    }),

  'spaces:restoreAsset': async (_event, args) =>
    orgs.getClient(args.orgId).restoreAsset(args.spaceId, { path: args.path, actingMode: 'direct' }),

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

  'spaces:readAsset': async (_event, args) =>
    orgs.getClient(args.orgId).readAsset(args.spaceId, args.path, args.version),

  'spaces:proposeChange': async (_event, args) =>
    orgs.getClient(args.orgId).proposeChange(args.spaceId, {
      assetPath: args.input.assetPath,
      baseVersion: args.input.baseVersion,
      // Exactly one of the two variants (contract decision 1, amended).
      ...(args.input.blob !== undefined ? { blob: args.input.blob } : { newContent: args.input.newContent ?? '' }),
      ...(args.input.reason ? { reason: args.input.reason } : {}),
      actingMode: 'direct',
    }),

  'spaces:assetHistory': async (_event, args) => ({
    changeSets: await orgs.getClient(args.orgId).assetHistory(args.spaceId, {
      ...(args.path !== undefined ? { path: args.path } : {}),
      ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),
  }),

  'spaces:diff': async (_event, args) => ({
    unified: await orgs.getClient(args.orgId).diff(args.spaceId, args.path, args.from, args.to),
  }),

  'spaces:listTopics': async (_event, args) => ({
    topics: await orgs.getClient(args.orgId).listTopics(args.spaceId, args.includeArchived ?? false),
  }),

  'spaces:listMessages': async (_event, args) =>
    orgs.getClient(args.orgId).listMessages(args.spaceId, args.topicId, {
      ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),

  'spaces:postMessage': async (_event, args) =>
    orgs.getClient(args.orgId).postMessage(args.spaceId, {
      ...(args.topicId ? { topicId: args.topicId } : {}),
      ...(args.anchorChangeSetId ? { anchorChangeSetId: args.anchorChangeSetId } : {}),
      ...(args.anchorMessageId ? { anchorMessageId: args.anchorMessageId } : {}),
      body: args.body,
      actingMode: 'direct',
    }),

  'spaces:manageTopic': async (_event, args) => ({
    topic: await orgs.getClient(args.orgId).manageTopic(args.spaceId, args.topicId, args.action),
  }),

  'spaces:reactToMessage': async (_event, args) => ({
    message: await orgs.getClient(args.orgId).reactToMessage(args.spaceId, args.messageId, {
      emoji: args.emoji,
      action: args.action,
      actingMode: 'direct',
    }),
  }),

  'spaces:deleteMessage': async (_event, args) => ({
    message: await orgs.getClient(args.orgId).deleteMessage(args.spaceId, args.messageId, {
      actingMode: 'direct',
    }),
  }),

  'spaces:editMessage': async (_event, args) => ({
    message: await orgs.getClient(args.orgId).editMessage(args.spaceId, args.messageId, {
      body: args.body,
      actingMode: 'direct',
    }),
  }),

  'spaces:invokeRowboat': async (_event, args) => invokeTopicAgent(args),

  'spaces:topicSession': async (_event, args) => ({
    sessionId: topicSessionId(args.orgId, args.spaceId, args.topicId),
  }),

  'spaces:getNotifyPrefs': async (_event, args) => getNotifyPrefs(args.orgId, args.spaceId),

  'spaces:setNotifyPref': async (_event, args) => {
    setNotifyPref(args.orgId, args.spaceId, args.topicId, args.level);
    return { success: true };
  },

  'spaces:schedule': async (_event, args) => ({
    id: scheduleItem({
      kind: args.kind,
      orgId: args.orgId,
      spaceId: args.spaceId,
      topicId: args.topicId,
      body: args.body,
      at: args.at,
    }).id,
  }),

  'spaces:listScheduled': async (_event, args) => ({ items: listScheduled(args.orgId, args.spaceId) }),

  'spaces:cancelScheduled': async (_event, args) => {
    cancelScheduled(args.id);
    return { success: true };
  },

  'spaces:getDnd': async () => ({ until: getDndUntil() }),

  'spaces:setDnd': async (_event, args) => {
    setDndUntil(args.until);
    return { success: true };
  },

  'spaces:subscribeSpace': async (_event, args) => {
    const key = `${args.orgId}/${args.spaceId}`;
    if (!liveSubscriptions.has(key)) {
      const unsubscribe = orgs.getLive(args.orgId).subscribe(
        args.spaceId,
        (frame) => broadcastSpacesEvent({ orgId: args.orgId, frame }),
        args.afterOffset,
      );
      liveSubscriptions.set(key, unsubscribe);
    }
    return { success: true };
  },

  'spaces:unsubscribeSpace': async (_event, args) => {
    const key = `${args.orgId}/${args.spaceId}`;
    liveSubscriptions.get(key)?.();
    liveSubscriptions.delete(key);
    return { success: true };
  },

  'spaces:presence': async (_event, args) => {
    orgs.getLive(args.orgId).presence(args.spaceId, args.state, args.topicId);
    return { success: true };
  },

  // In-process (kill-switch) parity for the wake bounce; in child/remote
  // mode this channel forwards to the server, which owns the sockets.
  'spaces:bounceLive': async () => {
    orgs.bounceAllLive();
    return { success: true };
  },
};
