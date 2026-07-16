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
