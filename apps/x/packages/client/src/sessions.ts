import type { z } from 'zod';
import type { message, sessions, turns } from '@x/shared';
import type { RpcClient } from './rpc.js';

// HTTP implementation of the renderer's SessionsClient seam
// (apps/renderer/src/lib/session-chat/client.ts) so session/chat store logic
// ports to the phone with only this constructor swapped in.

export interface SendMessageConfig {
  agent: z.infer<typeof turns.RequestedAgent>;
  autoPermission?: boolean;
  maxModelCalls?: number;
}

export interface SessionsClient {
  create(input: { title?: string }): Promise<{ sessionId: string }>;
  list(): Promise<{ sessions: sessions.SessionIndexEntry[] }>;
  get(sessionId: string): Promise<sessions.SessionState>;
  getTurn(turnId: string): Promise<{ turnId: string; events: Array<z.infer<typeof turns.TurnEvent>> }>;
  sendMessage(
    sessionId: string,
    input: z.infer<typeof message.UserMessage>,
    config: SendMessageConfig,
  ): Promise<{ turnId: string }>;
  respondToPermission(
    turnId: string,
    toolCallId: string,
    decision: 'allow' | 'deny',
    metadata?: turns.JsonValue,
  ): Promise<void>;
  respondToAskHuman(turnId: string, toolCallId: string, answer: string): Promise<void>;
  stopTurn(turnId: string, reason?: string): Promise<void>;
  resumeTurn(sessionId: string): Promise<void>;
  setTitle(sessionId: string, title: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export function createSessionsClient(rpc: RpcClient): SessionsClient {
  return {
    create: (input) => rpc.call('sessions:create', input),
    list: () => rpc.call('sessions:list', {}),
    get: (sessionId) => rpc.call('sessions:get', { sessionId }),
    getTurn: (turnId) => rpc.call('sessions:getTurn', { turnId }),
    sendMessage: (sessionId, input, config) =>
      rpc.call('sessions:sendMessage', { sessionId, input, config }),
    respondToPermission: async (turnId, toolCallId, decision, metadata) => {
      await rpc.call('sessions:respondToPermission', { turnId, toolCallId, decision, metadata });
    },
    respondToAskHuman: async (turnId, toolCallId, answer) => {
      await rpc.call('sessions:respondToAskHuman', { turnId, toolCallId, answer });
    },
    stopTurn: async (turnId, reason) => {
      await rpc.call('sessions:stopTurn', { turnId, reason });
    },
    resumeTurn: async (sessionId) => {
      await rpc.call('sessions:resumeTurn', { sessionId });
    },
    setTitle: async (sessionId, title) => {
      await rpc.call('sessions:setTitle', { sessionId, title });
    },
    delete: async (sessionId) => {
      await rpc.call('sessions:delete', { sessionId });
    },
  };
}
