import { BrowserWindow, shell } from 'electron';
import { ipc, spaces as spacesShared } from '@x/shared';
import * as orgs from '@x/core/dist/spaces/orgs.js';
import * as spacesOAuth from '@x/core/dist/spaces/oauth.js';
import { syncSpaceMentionWatch } from '@x/core/dist/spaces/mention-watch.js';
import { invokeTopicAgent, topicSessionId } from '@x/core/dist/spaces/topic-agent.js';
import { SpacesClient } from '@x/core/dist/spaces/client.js';

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
  'spaces:removeOrg': InvokeHandler<'spaces:removeOrg'>;
  'spaces:listSpaces': InvokeHandler<'spaces:listSpaces'>;
  'spaces:createSpace': InvokeHandler<'spaces:createSpace'>;
  'spaces:listMembers': InvokeHandler<'spaces:listMembers'>;
  'spaces:createInvite': InvokeHandler<'spaces:createInvite'>;
  'spaces:resolveInvite': InvokeHandler<'spaces:resolveInvite'>;
  'spaces:acceptInvite': InvokeHandler<'spaces:acceptInvite'>;
  'spaces:listAssets': InvokeHandler<'spaces:listAssets'>;
  'spaces:readAsset': InvokeHandler<'spaces:readAsset'>;
  'spaces:proposeChange': InvokeHandler<'spaces:proposeChange'>;
  'spaces:assetHistory': InvokeHandler<'spaces:assetHistory'>;
  'spaces:diff': InvokeHandler<'spaces:diff'>;
  'spaces:listTopics': InvokeHandler<'spaces:listTopics'>;
  'spaces:listMessages': InvokeHandler<'spaces:listMessages'>;
  'spaces:postMessage': InvokeHandler<'spaces:postMessage'>;
  'spaces:manageTopic': InvokeHandler<'spaces:manageTopic'>;
  'spaces:invokeRowboat': InvokeHandler<'spaces:invokeRowboat'>;
  'spaces:topicSession': InvokeHandler<'spaces:topicSession'>;
  'spaces:subscribeSpace': InvokeHandler<'spaces:subscribeSpace'>;
  'spaces:unsubscribeSpace': InvokeHandler<'spaces:unsubscribeSpace'>;
  'spaces:presence': InvokeHandler<'spaces:presence'>;
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
    void syncSpaceMentionWatch();
    return { org };
  },

  'spaces:resolveInviteLink': async (_event, args) => {
    const { baseUrl, resolved } = await spacesOAuth.resolveInviteLink(args.url);
    return { baseUrl, resolved };
  },

  'spaces:joinInvite': async (_event, args) => {
    const { org, result } = await spacesOAuth.joinViaInviteLink({ url: args.url, openBrowser });
    void syncSpaceMentionWatch();
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
    void syncSpaceMentionWatch();
    return { org };
  },

  'spaces:removeOrg': async (_event, args) => {
    void syncSpaceMentionWatch();
    for (const [key, unsubscribe] of liveSubscriptions) {
      if (key.startsWith(`${args.orgId}/`)) {
        unsubscribe();
        liveSubscriptions.delete(key);
      }
    }
    await orgs.removeOrg(args.orgId);
    return { success: true };
  },

  'spaces:listSpaces': async (_event, args) => ({
    spaces: await orgs.getClient(args.orgId).listSpaces(),
  }),

  'spaces:createSpace': async (_event, args) => {
    const space = await orgs.getClient(args.orgId).createSpace(args.name);
    void syncSpaceMentionWatch();
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
    entries: await orgs.getClient(args.orgId).listAssets(args.spaceId),
  }),

  'spaces:readAsset': async (_event, args) =>
    orgs.getClient(args.orgId).readAsset(args.spaceId, args.path, args.version),

  'spaces:proposeChange': async (_event, args) =>
    orgs.getClient(args.orgId).proposeChange(args.spaceId, {
      assetPath: args.input.assetPath,
      baseVersion: args.input.baseVersion,
      newContent: args.input.newContent,
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
    orgs.getClient(args.orgId).listMessages(args.spaceId, args.topicId),

  'spaces:postMessage': async (_event, args) =>
    orgs.getClient(args.orgId).postMessage(args.spaceId, {
      ...(args.topicId ? { topicId: args.topicId } : {}),
      ...(args.anchorChangeSetId ? { anchorChangeSetId: args.anchorChangeSetId } : {}),
      body: args.body,
      actingMode: 'direct',
    }),

  'spaces:manageTopic': async (_event, args) => ({
    topic: await orgs.getClient(args.orgId).manageTopic(args.spaceId, args.topicId, args.action),
  }),

  'spaces:invokeRowboat': async (_event, args) => invokeTopicAgent(args),

  'spaces:topicSession': async (_event, args) => ({
    sessionId: topicSessionId(args.orgId, args.spaceId, args.topicId),
  }),

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
};
