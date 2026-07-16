import container from '@x/core/dist/di/container.js';
import type { ISessions, EmitterSessionBus } from '@x/core/dist/runtime/sessions/index.js';
import type { ITurnEventBus } from '@x/core/dist/runtime/turns/event-hub.js';
import * as workspaceCore from '@x/core/dist/workspace/workspace.js';
import { isSignedIn } from '@x/core/dist/account/account.js';
import { getRowboatConfig } from '@x/core/dist/config/rowboat.js';
import { getAccessToken } from '@x/core/dist/auth/tokens.js';
import type { RpcHandlers } from './channels.js';
import type { EventSources } from './server.js';

// Canonical implementations of the exposed channels against the @x/core DI
// container — the same thin pass-throughs Electron main registers in
// apps/main/src/ipc.ts, minus the Electron event argument. As channels
// migrate off main (strangler-fig), this file is where their server-side
// handler lands.

export function createCoreRpcHandlers(opts?: { sessionsIndexReady?: Promise<void> }): RpcHandlers {
  const sessions = () => container.resolve<ISessions>('sessions');
  return {
    'sessions:create': async (args) => {
      const sessionId = await sessions().createSession(args);
      return { sessionId };
    },
    'sessions:list': async () => {
      await opts?.sessionsIndexReady;
      return { sessions: sessions().listSessions() };
    },
    'sessions:get': async (args) => sessions().getSession(args.sessionId),
    'sessions:getTurn': async (args) => sessions().getTurn(args.turnId),
    'sessions:sendMessage': async (args) => sessions().sendMessage(args.sessionId, args.input, args.config),
    'sessions:respondToPermission': async (args) => {
      await sessions().respondToPermission(args.turnId, args.toolCallId, args.decision, args.metadata);
      return { success: true };
    },
    'sessions:respondToAskHuman': async (args) => {
      await sessions().respondToAskHuman(args.turnId, args.toolCallId, args.answer);
      return { success: true };
    },
    'sessions:stopTurn': async (args) => {
      await sessions().stopTurn(args.turnId, args.reason);
      return { success: true };
    },
    'sessions:resumeTurn': async (args) => {
      await sessions().resumeTurn(args.sessionId);
      return { success: true };
    },
    'sessions:setTitle': async (args) => {
      await sessions().setTitle(args.sessionId, args.title);
      return { success: true };
    },
    'sessions:delete': async (args) => {
      await sessions().deleteSession(args.sessionId);
      return { success: true };
    },
    'account:getRowboat': async () => {
      const signedIn = await isSignedIn();
      if (!signedIn) {
        return { signedIn: false, accessToken: null, config: null };
      }
      const config = await getRowboatConfig();
      try {
        const accessToken = await getAccessToken();
        return { signedIn: true, accessToken, config };
      } catch {
        return { signedIn: true, accessToken: null, config };
      }
    },
    'workspace:getRoot': async () => workspaceCore.getRoot(),
    'workspace:exists': async (args) => workspaceCore.exists(args.path),
    'workspace:stat': async (args) => workspaceCore.stat(args.path),
    'workspace:readdir': async (args) => workspaceCore.readdir(args.path, args.opts),
    'workspace:readFile': async (args) => workspaceCore.readFile(args.path, args.encoding),
  };
}

// Turn/session feeds come from core's in-process buses. workspace:didChange
// is host-sourced (main owns the chokidar watcher today), so hosts wire it
// via EventSources.subscribeWorkspaceEvents themselves.
export function createCoreEventSources(): EventSources {
  return {
    subscribeTurnEvents: (listener) =>
      container.resolve<ITurnEventBus>('turnEventBus').subscribeAll(listener),
    subscribeSessionEvents: (listener) =>
      container.resolve<EmitterSessionBus>('sessionBus').subscribe(listener),
  };
}

export const resolveWorkspacePath = workspaceCore.resolveWorkspacePath;
