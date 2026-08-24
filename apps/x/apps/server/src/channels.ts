import type { ipc } from '@x/shared';

// The RPC surface this server exposes over POST /rpc/{channel}. This is the
// strangler-fig migration frontier: channels move here from Electron main's
// in-process handlers group by group; anything not listed 404s (the full
// channel surface is not leaked to unauthenticated probing by name).
//
// turns:subscribe / turns:unsubscribe are deliberately absent — delta
// subscription needs connection identity, so it lives on the WebSocket
// (`{type:'subscribe', topic:'turn-deltas', turnId}`), not HTTP.
export const RPC_CHANNELS = [
  'sessions:list',
  'sessions:create',
  'sessions:get',
  'sessions:getTurn',
  'sessions:sendMessage',
  'sessions:respondToPermission',
  'sessions:respondToAskHuman',
  'sessions:stopTurn',
  'sessions:resumeTurn',
  'sessions:setTitle',
  'sessions:delete',
  'account:getRowboat',
  'workspace:getRoot',
  'workspace:exists',
  'workspace:stat',
  'workspace:readdir',
  'workspace:readFile',
  // Phase 1 (SEPARATION_PLAN.md): read-only queries. Connectors, code-mode,
  // and apps namespaces migrate in their own phases.
  'mcp:listTools',
  'runs:list',
  'runs:listByWorkDir',
  'sessions:listQueued',
  'models:list',
  'models:listForProvider',
  'models:getConfig',
  'llm:getDefaultModel',
  'rowboat:getConfig',
  'granola:getConfig',
  'knowledgeSources:getConfig',
  'onboarding:getStatus',
  'agent-schedule:getConfig',
  'agent-schedule:getState',
  'voice:getConfig',
  'live-note:get',
  'live-note:listNotes',
  'todo:get',
  'todo:getPlanner',
  'todo:getSessionConversation',
  'todo:getConversation',
  'todo:listArchived',
  'home:threads',
  'bg-task:get',
  'bg-task:list',
  'bg-task:listRunIds',
  'billing:getInfo',
  'credits:getState',
  'notifications:getSettings',
  'turnLimits:getSettings',
  'retention:getSettings',
  // Phase 2 (SEPARATION_PLAN.md): workspace & knowledge writes, todo/home/
  // deck state, settings setters. pickImage/exportCopy stay client-local
  // (native dialogs).
  'workspace:writeFile',
  'workspace:mkdir',
  'workspace:rename',
  'workspace:copy',
  'workspace:remove',
  'deck:generateOutline',
  'deck:generateSlide',
  'deck:editSlide',
  'knowledgeSources:upsert',
  'onboarding:markComplete',
  'knowledge:history',
  'knowledge:fileAtCommit',
  'knowledge:restore',
  'todo:acceptSuggestion',
  'todo:declineSuggestion',
  'todo:setPlanner',
  'todo:save',
  'todo:addItem',
  'todo:addSubItem',
  'todo:runItem',
  'todo:stopRun',
  'todo:startChat',
  'todo:chatReply',
  'todo:comment',
  'todo:clearCompleted',
  'todo:dismiss',
  'todo:teach',
  'todo:deleteArchived',
  'todo:restore',
  'home:markSeen',
  'home:setPinned',
  'home:snooze',
  'home:dismiss',
  'home:commandCenter',
  'notifications:setSettings',
  'turnLimits:setSettings',
  'retention:setSettings',
  'retention:consumeFirstRunNotice',
] as const satisfies readonly ipc.InvokeChannels[];

export type RpcChannel = (typeof RPC_CHANNELS)[number];

export function isRpcChannel(channel: string): channel is RpcChannel {
  return (RPC_CHANNELS as readonly string[]).includes(channel);
}

// One handler per exposed channel. No Electron event argument — handlers are
// transport-agnostic; connection identity is a WS concern, never an RPC one.
export type RpcHandlers = {
  [K in RpcChannel]: (
    args: ipc.IPCChannels[K]['req'],
  ) => ipc.IPCChannels[K]['res'] | Promise<ipc.IPCChannels[K]['res']>;
};
