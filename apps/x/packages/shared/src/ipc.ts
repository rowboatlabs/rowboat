import { z } from 'zod';
import { RelPath, Encoding, Stat, DirEntry, ReaddirOptions, ReadFileResult, WorkspaceChangeEvent, WriteFileOptions, WriteFileResult, RemoveOptions } from './workspace.js';
import { ListToolsResponse } from './mcp.js';
import { AskHumanResponsePayload, CreateRunOptions, Run, ListRunsResponse, ToolPermissionAuthorizePayload } from './runs.js';

// ============================================================================
// Runtime Validation Schemas (Single Source of Truth)
// ============================================================================

const ipcSchemas = {
  'app:getVersions': {
    req: z.null(),
    res: z.object({
      chrome: z.string(),
      node: z.string(),
      electron: z.string(),
    }),
  },
  'workspace:getRoot': {
    req: z.null(),
    res: z.object({
      root: z.string(),
    }),
  },
  'workspace:exists': {
    req: z.object({
      path: RelPath,
    }),
    res: z.object({
      exists: z.boolean(),
    }),
  },
  'workspace:stat': {
    req: z.object({
      path: RelPath,
    }),
    res: Stat,
  },
  'workspace:readdir': {
    req: z.object({
      path: z.string(), // Empty string allowed for root directory
      opts: ReaddirOptions.optional(),
    }),
    res: z.array(DirEntry),
  },
  'workspace:readFile': {
    req: z.object({
      path: RelPath,
      encoding: Encoding.optional(),
    }),
    res: ReadFileResult,
  },
  'workspace:writeFile': {
    req: z.object({
      path: RelPath,
      data: z.string(),
      opts: WriteFileOptions.optional(),
    }),
    res: WriteFileResult,
  },
  'workspace:mkdir': {
    req: z.object({
      path: RelPath,
      recursive: z.boolean().optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  'workspace:rename': {
    req: z.object({
      from: RelPath,
      to: RelPath,
      overwrite: z.boolean().optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  'workspace:copy': {
    req: z.object({
      from: RelPath,
      to: RelPath,
      overwrite: z.boolean().optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  'workspace:remove': {
    req: z.object({
      path: RelPath,
      opts: RemoveOptions.optional(),
    }),
    res: z.object({
      ok: z.literal(true),
    }),
  },
  'workspace:didChange': {
    req: WorkspaceChangeEvent,
    res: z.null(),
  },
  'mcp:listTools': {
    req: z.object({
      serverName: z.string(),
      cursor: z.string().optional(),
    }),
    res: ListToolsResponse,
  },
  'mcp:executeTool': {
    req: z.object({
      serverName: z.string(),
      toolName: z.string(),
      input: z.record(z.string(), z.unknown()),
    }),
    res: z.object({
      result: z.unknown(),
    }),
  },
  'runs:create': {
    req: CreateRunOptions,
    res: Run,
  },
  'runs:createMessage': {
    req: z.object({
      runId: z.string(),
      message: z.string(),
    }),
    res: z.object({
      messageId: z.string(),
    }),
  },
  'runs:authorizePermission': {
    req: z.object({
      runId: z.string(),
      authorization: ToolPermissionAuthorizePayload,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'runs:provideHumanInput': {
    req: z.object({
      runId: z.string(),
      reply: AskHumanResponsePayload,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'runs:stop': {
    req: z.object({
      runId: z.string(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'runs:fetch': {
    req: z.object({
      runId: z.string(),
    }),
    res: Run,
  },
  'runs:list': {
    req: z.object({
      cursor: z.string().optional(),
    }),
    res: ListRunsResponse,
  },
  'runs:events': {
    req: z.null(),
    res: z.null(),
  },
  'oauth:connect': {
    req: z.object({
      provider: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'oauth:disconnect': {
    req: z.object({
      provider: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
    }),
  },
  'oauth:is-connected': {
    req: z.object({
      provider: z.string(),
    }),
    res: z.object({
      isConnected: z.boolean(),
    }),
  },
  'oauth:list-providers': {
    req: z.null(),
    res: z.object({
      providers: z.array(z.string()),
    }),
  },
  'oauth:get-connected-providers': {
    req: z.null(),
    res: z.object({
      providers: z.array(z.string()),
    }),
  },
  'oauth:didConnect': {
    req: z.object({
      provider: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
    res: z.null(),
  },
  'granola:getConfig': {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
    }),
  },
  'granola:setConfig': {
    req: z.object({
      enabled: z.boolean(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'onboarding:getStatus': {
    req: z.null(),
    res: z.object({
      showOnboarding: z.boolean(),
    }),
  },
  'onboarding:markComplete': {
    req: z.null(),
    res: z.object({
      success: z.literal(true),
    }),
  },
} as const;

// ============================================================================
// Type Helpers
// ============================================================================

export type IPCChannels = {
  [K in keyof typeof ipcSchemas]: {
    req: z.infer<typeof ipcSchemas[K]['req']>;
    res: z.infer<typeof ipcSchemas[K]['res']>;
  };
};

/**
 * Channels that use invoke/handle (request/response pattern)
 * These are channels with non-null responses
 */
export type InvokeChannels = {
  [K in keyof IPCChannels]:
    IPCChannels[K]['res'] extends null ? never : K
}[keyof IPCChannels];

/**
 * Channels that use send/on (fire-and-forget pattern)
 * These are channels with null responses (no response expected)
 */
export type SendChannels = {
  [K in keyof IPCChannels]:
    IPCChannels[K]['res'] extends null ? K : never
}[keyof IPCChannels];

// ============================================================================
// Type Guards
// ============================================================================

export function validateRequest<K extends keyof IPCChannels>(
  channel: K,
  data: unknown
): IPCChannels[K]['req'] {
  const schema = ipcSchemas[channel].req;
  return schema.parse(data) as IPCChannels[K]['req'];
}

export function validateResponse<K extends keyof IPCChannels>(
  channel: K,
  data: unknown
): IPCChannels[K]['res'] {
  const schema = ipcSchemas[channel].res;
  return schema.parse(data) as IPCChannels[K]['res'];
}