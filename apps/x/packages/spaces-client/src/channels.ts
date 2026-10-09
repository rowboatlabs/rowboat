import type { ipc, spaces as spacesShared } from '@x/shared';
import { SpacesClient } from './client.js';
import type { SpacesLive } from './live.js';
import type { SpaceSubscriptions } from './subscriptions.js';

// The Spaces IPC channels that are one Harbor call each, served the same way
// wherever they run. The desktop's main process and rowboat-server each
// carried this table verbatim until 2026-10-09; one copy now, and the browser
// host of the Spaces web-app plan serves it too. Channels that depend on the
// host stay with the host: signing in, the org registry, uploads by file
// path, save dialogs, link previews, the local agent, scheduled sends.
//
// Everything a person does through these is attributed 'direct': the app is
// the human surface; agents write through the org's MCP face.

type IPCChannels = ipc.IPCChannels;

export type HarborChannel =
  | 'spaces:listSpaces' | 'spaces:browseSpaces' | 'spaces:joinSpace' | 'spaces:createSpace' | 'spaces:renameSpace'
  | 'spaces:addMembers' | 'spaces:openDirect' | 'spaces:listMembers' | 'spaces:listOrgMembers'
  | 'spaces:listAgents' | 'spaces:addAgent' | 'spaces:setAgentCredential' | 'spaces:setAgentHook' | 'spaces:clearAgentHook'
  | 'spaces:createAgentKey' | 'spaces:revokeAgentKey'
  | 'spaces:createInvite' | 'spaces:resolveInvite' | 'spaces:acceptInvite'
  | 'spaces:listAssets' | 'spaces:createAsset' | 'spaces:moveAsset' | 'spaces:deleteAsset' | 'spaces:restoreAsset'
  | 'spaces:readAsset' | 'spaces:proposeChange' | 'spaces:assetHistory' | 'spaces:diff'
  | 'spaces:listTopics' | 'spaces:createTopic' | 'spaces:manageTopic' | 'spaces:search'
  | 'spaces:listStream' | 'spaces:getMessage' | 'spaces:listThread' | 'spaces:postMessage'
  | 'spaces:reactToMessage' | 'spaces:deleteMessage' | 'spaces:editMessage' | 'spaces:votePoll' | 'spaces:endPoll'
  | 'spaces:listInvocations' | 'spaces:cancelInvocation' | 'spaces:getAgentCapabilities' | 'spaces:setAgentOptionDefaults'
  | 'spaces:decideApproval'
  | 'spaces:subscribeSpace' | 'spaces:unsubscribeSpace' | 'spaces:presence' | 'spaces:whiteboard'
  | 'spaces:markRead' | 'spaces:followThread' | 'spaces:getUnread' | 'spaces:getActivity' | 'spaces:markActivitySeen'
  | 'spaces:readAll';

export type HarborChannelHandlers = {
  [K in HarborChannel]: (args: IPCChannels[K]['req']) => Promise<IPCChannels[K]['res']>;
};

export interface HarborChannelDeps {
  /** The org's REST client; throws for an org the host doesn't know. */
  getClient(orgId: string): SpacesClient;
  /** The org's live socket. */
  getLive(orgId: string): Pick<SpacesLive, 'presence' | 'whiteboard'>;
  /** The host's per-space subscriptions (one per org and space). */
  subscriptions: SpaceSubscriptions;
  /** Where a subscribed space's frames go: every window on the desktop. */
  emit(event: spacesShared.SpacesBusEvent): void;
}

export function harborChannelHandlers({ getClient, getLive, subscriptions, emit }: HarborChannelDeps): HarborChannelHandlers {
  return {
    'spaces:listSpaces': async (args) => {
      const { spaces, groupChat } = await getClient(args.orgId).listing({ includeDirect: args.includeDirect ?? false });
      return { spaces, ...(groupChat !== undefined ? { groupChat } : {}) };
    },

    'spaces:browseSpaces': async (args) => getClient(args.orgId).browseSpaces(),

    'spaces:joinSpace': async (args) => getClient(args.orgId).joinSpace(args.spaceId),

    'spaces:createSpace': async (args) => ({
      space: await getClient(args.orgId).createSpace(args.name, args.visibility),
    }),

    'spaces:renameSpace': async (args) => ({
      space: await getClient(args.orgId).renameSpace(args.spaceId, args.name),
    }),

    'spaces:addMembers': async (args) => ({
      memberships: await getClient(args.orgId).addMembers(args.spaceId, args.memberIds),
    }),

    'spaces:openDirect': async (args) => getClient(args.orgId).openDirect(args.memberId),

    'spaces:listMembers': async (args) => ({
      members: await getClient(args.orgId).listMembers(args.spaceId),
    }),

    'spaces:listOrgMembers': async (args) => ({
      members: await getClient(args.orgId).listOrgMembers(),
    }),

    'spaces:listAgents': async (args) => ({ agents: await getClient(args.orgId).listAgents() }),
    'spaces:addAgent': async ({ orgId, ...input }) => getClient(orgId).addAgent(input),
    'spaces:setAgentCredential': async (args) => ({ credential: await getClient(args.orgId).setAgentCredential(args.agentId, args.secret) }),
    'spaces:setAgentHook': async (args) => getClient(args.orgId).setAgentHook(args.agentId, args.spaceId),
    'spaces:clearAgentHook': async (args) => {
      await getClient(args.orgId).clearAgentHook(args.agentId);
      return {};
    },
    'spaces:createAgentKey': async (args) => ({ key: await getClient(args.orgId).createAgentKey(args.agentId) }),
    'spaces:revokeAgentKey': async (args) => ({ key: await getClient(args.orgId).revokeAgentKey(args.agentId, args.keyId) }),

    'spaces:createInvite': async (args) => getClient(args.orgId).createInvite(args.spaceId, args.expiresInHours),

    // Pre-auth: works before the org has been added, so the join flow can show
    // what's being joined (spec §4). The token is unused on this route.
    'spaces:resolveInvite': async (args) =>
      new SpacesClient({ baseUrl: args.baseUrl, token: 'dev-preauth' }).resolveInvite(args.token),

    'spaces:acceptInvite': async (args) => getClient(args.orgId).acceptInvite(args.token),

    'spaces:listAssets': async (args) => ({
      entries: await getClient(args.orgId).listAssets(args.spaceId, {
        ...(args.includeDeleted !== undefined ? { includeDeleted: args.includeDeleted } : {}),
      }),
    }),

    'spaces:createAsset': async (args) =>
      getClient(args.orgId).createAsset(args.spaceId, {
        path: args.input.path,
        // Exactly one of the two variants (contract decision 1, amended).
        ...(args.input.blob !== undefined ? { blob: args.input.blob } : { newContent: args.input.newContent ?? '' }),
        ...(args.input.reason ? { reason: args.input.reason } : {}),
        actingMode: 'direct',
      }),

    'spaces:moveAsset': async (args) =>
      getClient(args.orgId).moveAsset(args.spaceId, {
        assetId: args.assetId,
        toPath: args.toPath,
        baseVersion: args.baseVersion,
        ...(args.reason ? { reason: args.reason } : {}),
        actingMode: 'direct',
      }),

    'spaces:deleteAsset': async (args) =>
      getClient(args.orgId).deleteAsset(args.spaceId, {
        assetId: args.assetId,
        baseVersion: args.baseVersion,
        ...(args.reason ? { reason: args.reason } : {}),
        actingMode: 'direct',
      }),

    'spaces:restoreAsset': async (args) =>
      getClient(args.orgId).restoreAsset(args.spaceId, { assetId: args.assetId, actingMode: 'direct' }),

    'spaces:readAsset': async (args) => getClient(args.orgId).readAsset(args.spaceId, args.assetId, args.version),

    'spaces:proposeChange': async (args) =>
      getClient(args.orgId).proposeChange(args.spaceId, {
        assetId: args.input.assetId,
        baseVersion: args.input.baseVersion,
        // Exactly one of the two variants (contract decision 1, amended).
        ...(args.input.blob !== undefined ? { blob: args.input.blob } : { newContent: args.input.newContent ?? '' }),
        ...(args.input.reason ? { reason: args.input.reason } : {}),
        actingMode: 'direct',
      }),

    'spaces:assetHistory': async (args) => ({
      changeSets: await getClient(args.orgId).assetHistory(args.spaceId, {
        ...(args.assetId !== undefined ? { assetId: args.assetId } : {}),
        ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      }),
    }),

    'spaces:diff': async (args) => ({
      unified: await getClient(args.orgId).diff(args.spaceId, args.assetId, args.from, args.to),
    }),

    'spaces:listTopics': async (args) => ({
      topics: await getClient(args.orgId).listTopics(args.spaceId, args.includeArchived ?? false),
    }),

    'spaces:createTopic': async (args) =>
      getClient(args.orgId).createTopic(args.spaceId, {
        ...(args.rootMessageId ? { rootMessageId: args.rootMessageId } : {}),
        title: args.title,
        ...(args.body ? { body: args.body } : {}),
        ...(args.documentAssetId ? { documentAssetId: args.documentAssetId } : {}),
        actingMode: 'direct',
      }),

    'spaces:manageTopic': async (args) => ({
      topic: await getClient(args.orgId).manageTopic(args.spaceId, args.topicId, { ...args.action, actingMode: 'direct' }),
    }),

    'spaces:search': async (args) =>
      getClient(args.orgId).search(args.spaceId, {
        q: args.q,
        ...(args.kinds !== undefined ? { kinds: args.kinds } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      }),

    'spaces:listStream': async (args) =>
      getClient(args.orgId).listStream(args.spaceId, {
        ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
        ...(args.afterOffset !== undefined ? { afterOffset: args.afterOffset } : {}),
        ...(args.aroundOffset !== undefined ? { aroundOffset: args.aroundOffset } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      }),

    'spaces:getMessage': async (args) => ({
      message: await getClient(args.orgId).getMessage(args.spaceId, args.messageId),
    }),

    'spaces:listThread': async (args) =>
      getClient(args.orgId).listThread(args.spaceId, args.rootMessageId, {
        ...(args.beforeOffset !== undefined ? { beforeOffset: args.beforeOffset } : {}),
        ...(args.afterOffset !== undefined ? { afterOffset: args.afterOffset } : {}),
        ...(args.aroundOffset !== undefined ? { aroundOffset: args.aroundOffset } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      }),

    'spaces:postMessage': async (args) =>
      getClient(args.orgId).postMessage(args.spaceId, {
        ...(args.threadRoot ? { threadRoot: args.threadRoot } : {}),
        ...(args.anchorChangeSetId ? { anchorChangeSetId: args.anchorChangeSetId } : {}),
        body: args.body,
        ...(args.poll ? { poll: args.poll } : {}),
        ...(args.agentOptions ? { agentOptions: args.agentOptions } : {}),
        actingMode: 'direct',
      }),

    'spaces:reactToMessage': async (args) => ({
      message: await getClient(args.orgId).reactToMessage(args.spaceId, args.messageId, {
        emoji: args.emoji,
        action: args.action,
        actingMode: 'direct',
      }),
    }),

    'spaces:deleteMessage': async (args) => ({
      message: await getClient(args.orgId).deleteMessage(args.spaceId, args.messageId, { actingMode: 'direct' }),
    }),

    'spaces:editMessage': async (args) => ({
      message: await getClient(args.orgId).editMessage(args.spaceId, args.messageId, { body: args.body, actingMode: 'direct' }),
    }),

    'spaces:votePoll': async (args) => ({
      message: await getClient(args.orgId).votePoll(args.spaceId, args.messageId, {
        answerId: args.answerId,
        action: args.action,
        actingMode: 'direct',
      }),
    }),

    'spaces:endPoll': async (args) => ({
      message: await getClient(args.orgId).endPoll(args.spaceId, args.messageId, { actingMode: 'direct' }),
    }),

    'spaces:listInvocations': async (args) => ({
      invocations: await getClient(args.orgId).listInvocations(args.spaceId, args.threadRootId),
    }),

    'spaces:cancelInvocation': async (args) => ({
      invocation: await getClient(args.orgId).cancelInvocation(args.invocationId),
    }),

    'spaces:getAgentCapabilities': async (args) => getClient(args.orgId).getAgentCapabilities(args.agentId),

    'spaces:setAgentOptionDefaults': async (args) => ({
      defaults: await getClient(args.orgId).setAgentOptionDefaults(args.agentId, args.defaults),
    }),

    'spaces:decideApproval': async (args) => ({
      approval: await getClient(args.orgId).decideApproval(args.spaceId, args.approvalId, {
        decision: args.decision,
        ...(args.note ? { note: args.note } : {}),
        actingMode: 'direct',
      }),
    }),

    'spaces:subscribeSpace': async (args) => {
      subscriptions.subscribe(args.orgId, args.spaceId, (frame) => emit({ orgId: args.orgId, frame }), args.afterOffset);
      return { success: true };
    },

    'spaces:unsubscribeSpace': async (args) => {
      subscriptions.unsubscribe(args.orgId, args.spaceId);
      return { success: true };
    },

    'spaces:presence': async (args) => {
      getLive(args.orgId).presence(args.spaceId, args.state, args.threadRootId);
      return { success: true };
    },

    // Fire-and-forget like presence; incoming whiteboard frames ride the same
    // per-space live subscription and reach clients on 'spaces:events'.
    'spaces:whiteboard': async (args) => {
      getLive(args.orgId).whiteboard(args.spaceId, args.boardId, args.payload);
      return { success: true };
    },

    // Read state: the org owns the cursors (offsets, per member).
    'spaces:markRead': async (args) =>
      getClient(args.orgId).markRead(args.spaceId, {
        ...(args.threadRootId ? { threadRootId: args.threadRootId } : {}),
        offset: args.offset,
      }),

    'spaces:followThread': async (args) => getClient(args.orgId).followThread(args.spaceId, args.rootMessageId, args.following),

    'spaces:getUnread': async (args) => getClient(args.orgId).unread(),
    'spaces:getActivity': async ({ orgId, ...query }) => getClient(orgId).activity(query),
    'spaces:markActivitySeen': async (args) => getClient(args.orgId).markActivitySeen(args.at),
    'spaces:readAll': async (args) => getClient(args.orgId).readAll(args.spaceId !== undefined ? { spaceId: args.spaceId } : {}),
  };
}
