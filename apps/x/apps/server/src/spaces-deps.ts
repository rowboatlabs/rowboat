import fs from 'node:fs/promises';
import { ipc, spaces as spacesShared } from '@x/shared';
import * as orgs from '@x/core/dist/spaces/orgs.js';
import * as spacesOAuth from '@x/core/dist/spaces/oauth.js';
import { syncSpaceMentionWatch } from '@x/core/dist/spaces/mention-watch.js';
import { getDndUntil, getNotifyPrefs, setDndUntil, setNotifyPref } from '@x/core/dist/spaces/notify-prefs.js';
import { cancelScheduled, listScheduled, scheduleItem } from '@x/core/dist/spaces/scheduler.js';
import { invokeTopicAgent, topicSessionId } from '@x/core/dist/spaces/topic-agent.js';
import { fetchLinkPreview } from '@x/core/dist/spaces/link-preview.js';
import { SpacesClient } from '@x/core/dist/spaces/client.js';
import { openExternalUrl } from '@x/core/dist/auth/url-opener.js';

// Spaces handlers, server-side (Phase 9). Verbatim lifts of the Electron
// handlers in apps/main/src/spaces/ipc.ts, minus the client-only ones
// (save dialogs — those stay in main). Spaces is core-coupled
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

const liveSubscriptions = new Map<string, () => void>();

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

type SpacesRpcChannel =
  | 'spaces:listOrgs' | 'spaces:addOrg' | 'spaces:resolveInviteLink' | 'spaces:joinInvite'
  | 'spaces:signInOrg' | 'spaces:createOrg' | 'spaces:apexInfo' | 'spaces:removeOrg'
  | 'spaces:listSpaces' | 'spaces:createSpace' | 'spaces:listMembers' | 'spaces:createInvite'
  | 'spaces:resolveInvite' | 'spaces:acceptInvite' | 'spaces:listAssets' | 'spaces:moveAsset'
  | 'spaces:deleteAsset' | 'spaces:restoreAsset' | 'spaces:uploadBlob' | 'spaces:readAsset'
  | 'spaces:proposeChange' | 'spaces:assetHistory' | 'spaces:diff' | 'spaces:listTopics'
  | 'spaces:search'
  | 'spaces:listStream' | 'spaces:listThread' | 'spaces:linkPreview' | 'spaces:postMessage' | 'spaces:createTopic'
  | 'spaces:manageTopic' | 'spaces:reactToMessage'
  | 'spaces:deleteMessage' | 'spaces:editMessage' | 'spaces:votePoll' | 'spaces:endPoll'
  | 'spaces:invokeRowboat' | 'spaces:topicSession'
  | 'spaces:subscribeSpace' | 'spaces:unsubscribeSpace' | 'spaces:presence' | 'spaces:whiteboard'
  | 'spaces:bounceLive'
  | 'spaces:getNotifyPrefs' | 'spaces:setNotifyPref' | 'spaces:getDnd' | 'spaces:setDnd'
  | 'spaces:schedule' | 'spaces:listScheduled' | 'spaces:cancelScheduled';
type SpacesHandlers = {
  [K in SpacesRpcChannel]: (
    args: ipc.IPCChannels[K]['req'],
  ) => ipc.IPCChannels[K]['res'] | Promise<ipc.IPCChannels[K]['res']>;
};

export const spacesRpcHandlers: SpacesHandlers = {
  'spaces:listOrgs': async () => ({ orgs: orgs.listOrgs().map(orgSummary) }),

  'spaces:addOrg': async (args) => {
    const org = orgSummary(await orgs.addDevOrg({ baseUrl: args.baseUrl, memberId: args.memberId }));
    void syncSpaceMentionWatch({ force: true });
    return { org };
  },

  'spaces:resolveInviteLink': async (args) => {
    const { baseUrl, resolved } = await spacesOAuth.resolveInviteLink(args.url);
    return { baseUrl, resolved };
  },

  'spaces:joinInvite': async (args) => {
    const { org, result } = await spacesOAuth.joinViaInviteLink({ url: args.url, openBrowser });
    void syncSpaceMentionWatch({ force: true });
    return { org: orgSummary(org), space: result.space };
  },

  'spaces:signInOrg': async (args) => {
    const record = orgs.getOrg(args.orgId);
    if (!record) throw new Error(`unknown org ${args.orgId}`);
    const updated = await spacesOAuth.signInOrg({ baseUrl: record.baseUrl, openBrowser, orgId: record.id });
    return { org: orgSummary(updated) };
  },

  'spaces:createOrg': async (args) => {
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

  'spaces:removeOrg': async (args) => {
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

  'spaces:listSpaces': async (args) => {
    const spaces = await orgs.getClient(args.orgId).listSpaces();
    // The renderer just reached this org — if it was down at boot (or restarted),
    // this is the earliest signal that its spaces are watchable again. Unforced:
    // repeated refreshes collapse into one sync.
    void syncSpaceMentionWatch();
    return { spaces };
  },

  'spaces:createSpace': async (args) => {
    const space = await orgs.getClient(args.orgId).createSpace(args.name);
    void syncSpaceMentionWatch({ force: true });
    return { space };
  },

  'spaces:listMembers': async (args) => ({
    members: await orgs.getClient(args.orgId).listMembers(args.spaceId),
  }),

  'spaces:createInvite': async (args) =>
    orgs.getClient(args.orgId).createInvite(args.spaceId, args.expiresInHours),

  // Pre-auth: works before the org has been added, so the join flow can show
  // what's being joined (spec §4). The token is unused on this route.
  'spaces:resolveInvite': async (args) =>
    new SpacesClient({ baseUrl: args.baseUrl, token: 'dev-preauth' }).resolveInvite(args.token),

  'spaces:acceptInvite': async (args) => orgs.getClient(args.orgId).acceptInvite(args.token),

  'spaces:listAssets': async (args) => ({
    entries: await orgs.getClient(args.orgId).listAssets(args.spaceId, {
      ...(args.includeDeleted !== undefined ? { includeDeleted: args.includeDeleted } : {}),
    }),
  }),

  // Namespace ops — the renderer is the human surface, so everything here is
  // 'direct' (agents move/delete through the org's MCP face, attributed there).
  'spaces:moveAsset': async (args) =>
    orgs.getClient(args.orgId).moveAsset(args.spaceId, {
      fromPath: args.fromPath,
      toPath: args.toPath,
      baseVersion: args.baseVersion,
      ...(args.reason ? { reason: args.reason } : {}),
      actingMode: 'direct',
    }),

  'spaces:deleteAsset': async (args) =>
    orgs.getClient(args.orgId).deleteAsset(args.spaceId, {
      path: args.path,
      baseVersion: args.baseVersion,
      ...(args.reason ? { reason: args.reason } : {}),
      actingMode: 'direct',
    }),

  'spaces:restoreAsset': async (args) =>
    orgs.getClient(args.orgId).restoreAsset(args.spaceId, { path: args.path, actingMode: 'direct' }),

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

  'spaces:readAsset': async (args) =>
    orgs.getClient(args.orgId).readAsset(args.spaceId, args.path, args.version),

  'spaces:proposeChange': async (args) =>
    orgs.getClient(args.orgId).proposeChange(args.spaceId, {
      assetPath: args.input.assetPath,
      baseVersion: args.input.baseVersion,
      // Exactly one of the two variants (contract decision 1, amended).
      ...(args.input.blob !== undefined ? { blob: args.input.blob } : { newContent: args.input.newContent ?? '' }),
      ...(args.input.reason ? { reason: args.input.reason } : {}),
      actingMode: 'direct',
    }),

  'spaces:assetHistory': async (args) => ({
    changeSets: await orgs.getClient(args.orgId).assetHistory(args.spaceId, {
      ...(args.path !== undefined ? { path: args.path } : {}),
      ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),
  }),

  'spaces:diff': async (args) => ({
    unified: await orgs.getClient(args.orgId).diff(args.spaceId, args.path, args.from, args.to),
  }),

  'spaces:listTopics': async (args) => ({
    topics: await orgs.getClient(args.orgId).listTopics(args.spaceId, args.includeArchived ?? false),
  }),

  'spaces:search': async (args) =>
    orgs.getClient(args.orgId).search(args.spaceId, {
      q: args.q,
      ...(args.kinds !== undefined ? { kinds: args.kinds } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),

  'spaces:listStream': async (args) =>
    orgs.getClient(args.orgId).listStream(args.spaceId, {
      ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),

  'spaces:listThread': async (args) =>
    orgs.getClient(args.orgId).listThread(args.spaceId, args.rootMessageId, {
      ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),

  'spaces:linkPreview': async (args) => ({ preview: await fetchLinkPreview(args.url) }),

  'spaces:postMessage': async (args) =>
    orgs.getClient(args.orgId).postMessage(args.spaceId, {
      ...(args.threadRoot ? { threadRoot: args.threadRoot } : {}),
      ...(args.anchorChangeSetId ? { anchorChangeSetId: args.anchorChangeSetId } : {}),
      body: args.body,
      ...(args.poll ? { poll: args.poll } : {}),
      actingMode: 'direct',
    }),

  'spaces:createTopic': async (args) =>
    orgs.getClient(args.orgId).createTopic(args.spaceId, {
      ...(args.rootMessageId ? { rootMessageId: args.rootMessageId } : {}),
      title: args.title,
      ...(args.body ? { body: args.body } : {}),
      actingMode: 'direct',
    }),

  'spaces:manageTopic': async (args) => ({
    topic: await orgs.getClient(args.orgId).manageTopic(args.spaceId, args.topicId, { ...args.action, actingMode: 'direct' }),
  }),

  'spaces:reactToMessage': async (args) => ({
    message: await orgs.getClient(args.orgId).reactToMessage(args.spaceId, args.messageId, {
      emoji: args.emoji,
      action: args.action,
      actingMode: 'direct',
    }),
  }),

  'spaces:deleteMessage': async (args) => ({
    message: await orgs.getClient(args.orgId).deleteMessage(args.spaceId, args.messageId, {
      actingMode: 'direct',
    }),
  }),

  'spaces:editMessage': async (args) => ({
    message: await orgs.getClient(args.orgId).editMessage(args.spaceId, args.messageId, {
      body: args.body,
      actingMode: 'direct',
    }),
  }),

  'spaces:votePoll': async (args) => ({
    message: await orgs.getClient(args.orgId).votePoll(args.spaceId, args.messageId, {
      answerId: args.answerId,
      action: args.action,
      actingMode: 'direct',
    }),
  }),

  'spaces:endPoll': async (args) => ({
    message: await orgs.getClient(args.orgId).endPoll(args.spaceId, args.messageId, {
      actingMode: 'direct',
    }),
  }),

  'spaces:invokeRowboat': async (args) => invokeTopicAgent(args),

  'spaces:topicSession': async (args) => ({
    sessionId: topicSessionId(args.orgId, args.spaceId, args.threadRootId),
  }),

  'spaces:subscribeSpace': async (args) => {
    const key = `${args.orgId}/${args.spaceId}`;
    if (!liveSubscriptions.has(key)) {
      const unsubscribe = orgs.getLive(args.orgId).subscribe(
        args.spaceId,
        (frame) => emitSpacesEvent({ orgId: args.orgId, frame }),
        args.afterOffset,
      );
      liveSubscriptions.set(key, unsubscribe);
    }
    return { success: true };
  },

  'spaces:unsubscribeSpace': async (args) => {
    const key = `${args.orgId}/${args.spaceId}`;
    liveSubscriptions.get(key)?.();
    liveSubscriptions.delete(key);
    return { success: true };
  },

  'spaces:presence': async (args) => {
    orgs.getLive(args.orgId).presence(args.spaceId, args.state, args.threadRootId);
    return { success: true };
  },

  // Fire-and-forget like presence; incoming whiteboard frames ride the same
  // per-space live subscription and reach clients over 'spaces:events'.
  'spaces:whiteboard': async (args) => {
    orgs.getLive(args.orgId).whiteboard(args.spaceId, args.boardId, args.payload);
    return { success: true };
  },

  // Sleep leaves spaces WebSockets half-open (no close ever fires). The
  // client's powerMonitor calls this on wake so every stream reconnects and
  // replays immediately instead of waiting out the watchdog.
  'spaces:bounceLive': async () => {
    orgs.bounceAllLive();
    return { success: true };
  },

  // Notify prefs + DND: read by the mention watcher in THIS process through
  // notify-prefs' in-memory cache, so the writes have to happen here as well.
  'spaces:getNotifyPrefs': async (args) => getNotifyPrefs(args.orgId, args.spaceId),

  'spaces:setNotifyPref': async (args) => {
    setNotifyPref(args.orgId, args.spaceId, args.topicId, args.level);
    return { success: true };
  },

  'spaces:getDnd': async () => ({ until: getDndUntil() }),

  'spaces:setDnd': async (args) => {
    setDndUntil(args.until);
    return { success: true };
  },

  // Scheduled sends + reminders: same story — the 20s scheduler tick lives here.
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
