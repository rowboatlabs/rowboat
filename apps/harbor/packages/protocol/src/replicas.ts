import { z } from 'zod';
import { MemberId, MessageId, SpaceId } from './ids.js';

// Shared cloud work belongs to a thread, not a desktop session (2026-09-28).
export const ReplicasOptions = z.object({
  environmentId: z.string().min(1).max(256).optional(),
  planMode: z.boolean().optional(),
});
export const ReplicasEnvironment = z.object({ id: z.string(), name: z.string() });
export const ReplicasConfigInput = z.object({
  enabled: z.boolean(),
  apiKey: z.string().min(1).max(4096).optional(),
  environmentId: z.string().max(256).nullable().optional(),
  codingAgent: z.enum(['claude', 'codex', 'cursor', 'opencode', 'pi', 'muse']).optional(),
});
export const ReplicasConfigView = z.object({
  direct: z.boolean(),
  error: z.string().nullable(),
  enabled: z.boolean(), configured: z.boolean(), canConfigure: z.boolean(),
  botMemberId: MemberId.nullable(), environmentId: z.string().nullable(), codingAgent: z.string(),
  environments: z.array(ReplicasEnvironment),
});
export const ReplicasTask = z.object({
  spaceId: SpaceId, threadRootId: MessageId,
  workspaceId: z.string().nullable(), chatId: z.string().nullable(), url: z.string().nullable(),
  environmentId: z.string().nullable(),
  status: z.enum(['queued', 'select_environment', 'sending', 'running', 'idle', 'error', 'uncertain']),
  cancellableMessageIds: z.array(MessageId),
  error: z.string().nullable(), pending: z.number().int().nonnegative(), updatedAt: z.string(),
});
export const ReplicasThreadAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('cancel'), messageId: MessageId }),
  z.object({ action: z.literal('select_environment'), environmentId: z.string().min(1) }),
  z.object({ action: z.literal('attach'), workspaceId: z.string().min(1), chatId: z.string().min(1) }),
  z.object({ action: z.literal('fork'), messageId: MessageId, body: z.string().min(1).max(65536) }),
]);
export type ReplicasTask = z.infer<typeof ReplicasTask>;
export type ReplicasOptions = z.infer<typeof ReplicasOptions>;
export type ReplicasConfigInput = z.infer<typeof ReplicasConfigInput>;
export type ReplicasConfigView = z.infer<typeof ReplicasConfigView>;
export type ReplicasThreadAction = z.infer<typeof ReplicasThreadAction>;
