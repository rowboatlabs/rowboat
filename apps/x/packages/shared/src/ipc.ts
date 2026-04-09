import { z } from 'zod';
import { RelPath, Encoding, Stat, DirEntry, ReaddirOptions, ReadFileResult, WorkspaceChangeEvent, WriteFileOptions, WriteFileResult, RemoveOptions } from './workspace.js';
import { ListToolsResponse } from './mcp.js';
import { AskHumanResponsePayload, CreateRunOptions, Run, ListRunsResponse, ToolPermissionAuthorizePayload } from './runs.js';
import { LlmModelConfig } from './models.js';
import { AgentScheduleConfig, AgentScheduleEntry } from './agent-schedule.js';
import { AgentScheduleState } from './agent-schedule-state.js';
import { ServiceEvent } from './service-events.js';
import { UserMessageContent } from './message.js';
import { RowboatApiConfig } from './rowboat-account.js';
import { ZListToolkitsResponse } from './composio.js';

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
      message: UserMessageContent,
      voiceInput: z.boolean().optional(),
      voiceOutput: z.enum(['summary', 'full']).optional(),
      searchEnabled: z.boolean().optional(),
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
      force: z.boolean().optional().default(false),
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
  'runs:delete': {
    req: z.object({
      runId: z.string(),
    }),
    res: z.object({ success: z.boolean() }),
  },
  'runs:events': {
    req: z.null(),
    res: z.null(),
  },
  'services:events': {
    req: ServiceEvent,
    res: z.null(),
  },
  'models:list': {
    req: z.null(),
    res: z.object({
      providers: z.array(z.object({
        id: z.string(),
        name: z.string(),
        models: z.array(z.object({
          id: z.string(),
          name: z.string().optional(),
          release_date: z.string().optional(),
        })),
      })),
      lastUpdated: z.string().optional(),
    }),
  },
  'models:test': {
    req: LlmModelConfig,
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'models:saveConfig': {
    req: LlmModelConfig,
    res: z.object({
      success: z.literal(true),
    }),
  },
  'oauth:connect': {
    req: z.object({
      provider: z.string(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
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
  'oauth:list-providers': {
    req: z.null(),
    res: z.object({
      providers: z.array(z.string()),
    }),
  },
  'oauth:getState': {
    req: z.null(),
    res: z.object({
      config: z.record(z.string(), z.object({
        connected: z.boolean(),
        error: z.string().nullable().optional(),
        userId: z.string().optional(),
        clientId: z.string().nullable().optional(),
      })),
    }),
  },
  'account:getRowboat': {
    req: z.null(),
    res: z.object({
      signedIn: z.boolean(),
      accessToken: z.string().nullable(),
      config: RowboatApiConfig.nullable(),
    }),
  },
  'oauth:didConnect': {
    req: z.object({
      provider: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      userId: z.string().optional(),
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
  'slack:getConfig': {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
      workspaces: z.array(z.object({ url: z.string(), name: z.string() })),
    }),
  },
  'slack:setConfig': {
    req: z.object({
      enabled: z.boolean(),
      workspaces: z.array(z.object({ url: z.string(), name: z.string() })),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'slack:listWorkspaces': {
    req: z.null(),
    res: z.object({
      workspaces: z.array(z.object({ url: z.string(), name: z.string() })),
      error: z.string().optional(),
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
  // Composio integration channels
  'composio:is-configured': {
    req: z.null(),
    res: z.object({
      configured: z.boolean(),
    }),
  },
  'composio:set-api-key': {
    req: z.object({
      apiKey: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'composio:initiate-connection': {
    req: z.object({
      toolkitSlug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      redirectUrl: z.string().optional(),
      connectedAccountId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'composio:get-connection-status': {
    req: z.object({
      toolkitSlug: z.string(),
    }),
    res: z.object({
      isConnected: z.boolean(),
      status: z.string().optional(),
    }),
  },
  'composio:sync-connection': {
    req: z.object({
      toolkitSlug: z.string(),
      connectedAccountId: z.string(),
    }),
    res: z.object({
      status: z.string(),
    }),
  },
  'composio:disconnect': {
    req: z.object({
      toolkitSlug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
    }),
  },
  'composio:list-connected': {
    req: z.null(),
    res: z.object({
      toolkits: z.array(z.string()),
    }),
  },
  'composio:use-composio-for-google': {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
    }),
  },
  'composio:use-composio-for-google-calendar': {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
    }),
  },
  'composio:didConnect': {
    req: z.object({
      toolkitSlug: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
    res: z.null(),
  },
  // Composio Tools Library channels
  'composio:list-toolkits': {
    req: z.object({}),
    res: ZListToolkitsResponse,
  },
  // Agent schedule channels
  'agent-schedule:getConfig': {
    req: z.null(),
    res: AgentScheduleConfig,
  },
  'agent-schedule:getState': {
    req: z.null(),
    res: AgentScheduleState,
  },
  'agent-schedule:updateAgent': {
    req: z.object({
      agentName: z.string(),
      entry: AgentScheduleEntry,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'agent-schedule:deleteAgent': {
    req: z.object({
      agentName: z.string(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Shell integration channels
  'shell:openPath': {
    req: z.object({ path: z.string() }),
    res: z.object({ error: z.string().optional() }),
  },
  'shell:readFileBase64': {
    req: z.object({ path: z.string() }),
    res: z.object({ data: z.string(), mimeType: z.string(), size: z.number() }),
  },
  // Knowledge version history channels
  'knowledge:history': {
    req: z.object({ path: RelPath }),
    res: z.object({
      commits: z.array(z.object({
        oid: z.string(),
        message: z.string(),
        timestamp: z.number(),
        author: z.string(),
      })),
    }),
  },
  'knowledge:fileAtCommit': {
    req: z.object({ path: RelPath, oid: z.string() }),
    res: z.object({ content: z.string() }),
  },
  'knowledge:restore': {
    req: z.object({ path: RelPath, oid: z.string() }),
    res: z.object({ ok: z.literal(true) }),
  },
  'knowledge:didCommit': {
    req: z.object({}),
    res: z.null(),
  },
  // Search channels
  'search:query': {
    req: z.object({
      query: z.string(),
      limit: z.number().optional(),
      types: z.array(z.enum(['knowledge', 'chat'])).optional(),
    }),
    res: z.object({
      results: z.array(z.object({
        type: z.enum(['knowledge', 'chat']),
        title: z.string(),
        preview: z.string(),
        path: z.string(),
      })),
    }),
  },
  // Voice mode channels
  'voice:getConfig': {
    req: z.null(),
    res: z.object({
      deepgram: z.object({ apiKey: z.string() }).nullable(),
      elevenlabs: z.object({ apiKey: z.string(), voiceId: z.string().optional() }).nullable(),
    }),
  },
  'voice:synthesize': {
    req: z.object({
      text: z.string(),
    }),
    res: z.object({
      audioBase64: z.string(),
      mimeType: z.string(),
    }),
  },
  'meeting:checkScreenPermission': {
    req: z.null(),
    res: z.object({
      granted: z.boolean(),
    }),
  },
  'meeting:openScreenRecordingSettings': {
    req: z.null(),
    res: z.object({ success: z.boolean() }),
  },
  'meeting:summarize': {
    req: z.object({
      transcript: z.string(),
      meetingStartTime: z.string().optional(),
      calendarEventJson: z.string().optional(),
    }),
    res: z.object({
      notes: z.string(),
    }),
  },
  // Inline task schedule classification
  'export:note': {
    req: z.object({
      markdown: z.string(),
      format: z.enum(['md', 'pdf', 'docx']),
      title: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'inline-task:classifySchedule': {
    req: z.object({
      instruction: z.string(),
    }),
    res: z.object({
      schedule: z.union([
        z.object({ type: z.literal('cron'), expression: z.string(), startDate: z.string(), endDate: z.string(), label: z.string() }),
        z.object({ type: z.literal('window'), cron: z.string(), startTime: z.string(), endTime: z.string(), startDate: z.string(), endDate: z.string(), label: z.string() }),
        z.object({ type: z.literal('once'), runAt: z.string(), label: z.string() }),
      ]).nullable(),
    }),
  },
  'inline-task:process': {
    req: z.object({
      instruction: z.string(),
      noteContent: z.string(),
      notePath: z.string(),
    }),
    res: z.object({
      instruction: z.string(),
      schedule: z.union([
        z.object({ type: z.literal('cron'), expression: z.string(), startDate: z.string(), endDate: z.string() }),
        z.object({ type: z.literal('window'), cron: z.string(), startTime: z.string(), endTime: z.string(), startDate: z.string(), endDate: z.string() }),
        z.object({ type: z.literal('once'), runAt: z.string() }),
      ]).nullable(),
      scheduleLabel: z.string().nullable(),
      response: z.string().nullable(),
    }),
  },
  // Billing channels
  'billing:getInfo': {
    req: z.null(),
    res: z.object({
      userEmail: z.string().nullable(),
      userId: z.string().nullable(),
      subscriptionPlan: z.string().nullable(),
      subscriptionStatus: z.string().nullable(),
      trialExpiresAt: z.string().nullable(),
      sanctionedCredits: z.number(),
      availableCredits: z.number(),
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
