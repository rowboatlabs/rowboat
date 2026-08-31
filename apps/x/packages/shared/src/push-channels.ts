// The one roster of server→client push channels. The WS hub broadcasts
// exactly these, and the desktop client relays exactly these to its renderer
// windows — both sides derive from this list, so adding a channel here is the
// whole registration (plus wiring its producer into the server's
// EventSources). Turn deltas are not listed: they're per-connection,
// subscription-scoped traffic on the same socket, not a broadcast channel.
export const PUSH_CHANNELS = [
  'turns:events',
  'sessions:events',
  'workspace:didChange',
  'knowledge:didCommit',
  'oauth:didConnect',
  'composio:didConnect',
  'chatgpt:statusChanged',
  'terminal:data',
  'terminal:exit',
  'voice:tts-chunk',
  'spaces:events',
  'todo:events',
  'runs:events',
  'codeRun:events',
  'codeSession:status',
  'home:threadsChanged',
  'services:events',
  'live-note-agent:events',
  'bg-task-agent:events',
  'channels:status',
  'credits:didActivate',
] as const;

export type PushChannel = (typeof PUSH_CHANNELS)[number];
