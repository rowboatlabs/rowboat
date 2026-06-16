import { z } from 'zod';
import { RelPath, Encoding, Stat, DirEntry, ReaddirOptions, ReadFileResult, WorkspaceChangeEvent, WriteFileOptions, WriteFileResult, RemoveOptions } from './workspace.js';
import { ListToolsResponse } from './mcp.js';
import { AskHumanResponsePayload, CreateRunOptions, Run, ListRunsResponse, ToolPermissionAuthorizePayload } from './runs.js';
import { LlmModelConfig } from './models.js';
import { AgentScheduleConfig, AgentScheduleEntry } from './agent-schedule.js';
import { AgentScheduleState } from './agent-schedule-state.js';
import { ServiceEvent } from './service-events.js';
import { LiveNoteAgentEvent, LiveNoteSchema } from './live-note.js';
import {
    BackgroundTaskAgentEvent,
    BackgroundTaskSchema,
    BackgroundTaskSummarySchema,
    TriggersSchema,
} from './background-task.js';
import { UserMessageContent } from './message.js';
import { RowboatApiConfig } from './rowboat-account.js';
import { ZListToolkitsResponse } from './composio.js';
import { BrowserStateSchema } from './browser-control.js';
import { BillingInfoSchema } from './billing.js';
import { EmailBlockSchema, GmailThreadSchema } from './blocks.js';
import { PermissionDecision, ApprovalPolicy } from './code-mode.js';
import { NotificationSettingsSchema } from './notification-settings.js';
import { PendingApproval } from './approvals.js';

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
  'analytics:bootstrap': {
    req: z.null(),
    res: z.object({
      installationId: z.string(),
      apiUrl: z.string(),
      appVersion: z.string(),
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
  'gmail:getImportant': {
    req: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    res: z.object({
      threads: z.array(GmailThreadSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  'gmail:getEverythingElse': {
    req: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    res: z.object({
      threads: z.array(GmailThreadSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  'gmail:triggerSync': {
    req: z.object({}),
    res: z.object({}),
  },
  'gmail:sendReply': {
    req: z.object({
      threadId: z.string().min(1).optional(),
      to: z.string().min(1),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      subject: z.string(),
      bodyHtml: z.string(),
      bodyText: z.string(),
      inReplyTo: z.string().optional(),
      references: z.string().optional(),
    }),
    res: z.object({
      messageId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'gmail:getConnectionStatus': {
    req: z.object({}),
    res: z.object({
      connected: z.boolean(),
      hasRequiredScope: z.boolean(),
      missingScopes: z.array(z.string()),
      email: z.string().nullable(),
    }),
  },
  'gmail:getAccountEmail': {
    req: z.object({}),
    res: z.object({
      email: z.string().nullable(),
    }),
  },
  'gmail:archiveThread': {
    req: z.object({ threadId: z.string().min(1) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  'gmail:trashThread': {
    req: z.object({ threadId: z.string().min(1) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  'gmail:markThreadRead': {
    req: z.object({ threadId: z.string().min(1) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  'gmail:saveMessageHeight': {
    req: z.object({
      threadId: z.string().min(1),
      messageId: z.string().min(1),
      height: z.number().int().positive(),
    }),
    res: z.object({}),
  },
  'gmail:searchContacts': {
    req: z.object({
      query: z.string(),
      limit: z.number().int().positive().optional(),
      excludeEmails: z.array(z.string()).optional(),
    }),
    res: z.object({
      contacts: z.array(z.object({
        name: z.string(),
        email: z.string(),
        count: z.number(),
        lastSeenMs: z.number(),
      })),
    }),
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
      codeMode: z.enum(['claude', 'codex']).optional(),
      middlePaneContext: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('note'),
          path: z.string(),
          content: z.string(),
        }),
        z.object({
          kind: z.literal('browser'),
          url: z.string(),
          title: z.string(),
        }),
      ]).optional(),
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
  'runs:downloadLog': {
    req: z.object({
      runId: z.string().min(1),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'runs:events': {
    req: z.null(),
    res: z.null(),
  },
  'services:events': {
    req: ServiceEvent,
    res: z.null(),
  },
  'live-note-agent:events': {
    req: LiveNoteAgentEvent,
    res: z.null(),
  },
  'bg-task-agent:events': {
    req: BackgroundTaskAgentEvent,
    res: z.null(),
  },
  // Full snapshot of background-run permission asks waiting on the user,
  // re-broadcast on every change (small data, no delta bugs).
  'approvals:events': {
    req: z.object({
      approvals: z.array(PendingApproval),
    }),
    res: z.null(),
  },
  'approvals:list': {
    req: z.null(),
    res: z.object({
      approvals: z.array(PendingApproval),
    }),
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
  'app:openUrl': {
    req: z.object({
      url: z.string(),
    }),
    res: z.null(),
  },
  'app:takeMeetingNotes': {
    req: z.object({
      // Pass the raw calendar event JSON through; renderer adapts to its existing flow.
      event: z.unknown(),
      // When true, the renderer should also open the meeting URL (Zoom/Meet/etc.)
      // in addition to triggering the take-notes flow.
      openMeeting: z.boolean().optional(),
    }),
    res: z.null(),
  },
  'app:consumePendingDeepLink': {
    req: z.null(),
    res: z.object({
      url: z.string().nullable(),
    }),
  },
  'granola:getConfig': {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
    }),
  },
  'codeMode:getConfig': {
    req: z.null(),
    res: z.object({
      enabled: z.boolean(),
      approvalPolicy: ApprovalPolicy.optional(),
    }),
  },
  'codeMode:setConfig': {
    req: z.object({
      enabled: z.boolean(),
      approvalPolicy: ApprovalPolicy.optional(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Answer a mid-run permission request from a code_agent_run coding turn.
  'codeRun:resolvePermission': {
    req: z.object({
      requestId: z.string(),
      decision: PermissionDecision,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'codeMode:checkAgentStatus': {
    req: z.null(),
    res: z.object({
      claude: z.object({ installed: z.boolean(), signedIn: z.boolean() }),
      codex: z.object({ installed: z.boolean(), signedIn: z.boolean() }),
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
  'migration:check-composio-google': {
    req: z.null(),
    res: z.object({
      shouldShow: z.boolean(),
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
  'shell:showItemInFolder': {
    req: z.object({ path: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  'shell:readFileBase64': {
    req: z.object({ path: z.string() }),
    res: z.object({ data: z.string(), mimeType: z.string(), size: z.number() }),
  },
  // Native dialog channels
  'dialog:openDirectory': {
    req: z.object({
      defaultPath: z.string().optional(),
      title: z.string().optional(),
    }),
    res: z.object({
      path: z.string().nullable(),
    }),
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
  // Ensures the OS-level microphone permission is settled before capturing.
  // On first-ever use (macOS) the permission is 'not-determined'; resolving
  // the native prompt up front prevents the in-flight getUserMedia from
  // rejecting on the first mic click.
  'voice:ensureMicAccess': {
    req: z.null(),
    res: z.object({
      granted: z.boolean(),
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
  // Live-note channels
  'live-note:run': {
    req: z.object({
      filePath: z.string(),
      context: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      runId: z.string().nullable().optional(),
      action: z.enum(['replace', 'no_update']).optional(),
      summary: z.string().nullable().optional(),
      contentAfter: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
  },
  'live-note:get': {
    req: z.object({
      filePath: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      // Fresh, authoritative live-note object from frontmatter, or null when
      // the note is passive. Renderer should use this for display/edit —
      // never a stale cached copy.
      live: LiveNoteSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  'live-note:set': {
    req: z.object({
      filePath: z.string(),
      live: LiveNoteSchema,
    }),
    res: z.object({
      success: z.boolean(),
      live: LiveNoteSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  'live-note:setActive': {
    req: z.object({
      filePath: z.string(),
      active: z.boolean(),
    }),
    res: z.object({
      success: z.boolean(),
      live: LiveNoteSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  'live-note:delete': {
    req: z.object({
      filePath: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'live-note:stop': {
    req: z.object({
      filePath: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'live-note:listNotes': {
    req: z.null(),
    res: z.object({
      notes: z.array(z.object({
        path: RelPath,
        createdAt: z.string().nullable(),
        lastRunAt: z.string().nullable(),
        isActive: z.boolean(),
        objective: z.string(),
      })),
    }),
  },
  // Background-task channels
  'bg-task:run': {
    req: z.object({
      slug: z.string(),
      context: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      runId: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
  },
  'bg-task:get': {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      task: BackgroundTaskSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  'bg-task:patch': {
    req: z.object({
      slug: z.string(),
      partial: BackgroundTaskSchema.partial(),
    }),
    res: z.object({
      success: z.boolean(),
      task: BackgroundTaskSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  'bg-task:create': {
    req: z.object({
      name: z.string(),
      instructions: z.string(),
      triggers: TriggersSchema.optional(),
      model: z.string().optional(),
      provider: z.string().optional(),
    }),
    res: z.object({
      success: z.boolean(),
      slug: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'bg-task:delete': {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'bg-task:stop': {
    req: z.object({
      slug: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'bg-task:list': {
    req: z.object({
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
      sort: z.enum(['createdAt:desc', 'createdAt:asc', 'name:asc']).optional(),
    }),
    res: z.object({
      items: z.array(BackgroundTaskSummarySchema),
      total: z.number().int().nonnegative(),
    }),
  },
  // Returns the runIds recorded in `bg-tasks/<slug>/runs.log` (newest first).
  // The renderer turns each id into a full Run via the existing `runs:fetch`
  // channel — bg-task transcripts now live at the global $WorkDir/runs/.
  'bg-task:listRunIds': {
    req: z.object({
      slug: z.string(),
      limit: z.number().int().positive().optional(),
    }),
    res: z.object({
      runIds: z.array(z.string()),
    }),
  },
  // Embedded browser (WebContentsView) channels
  'browser:setBounds': {
    req: z.object({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().nonnegative(),
      height: z.number().int().nonnegative(),
    }),
    res: z.object({ ok: z.literal(true) }),
  },
  'browser:setVisible': {
    req: z.object({ visible: z.boolean() }),
    res: z.object({ ok: z.literal(true) }),
  },
  'browser:newTab': {
    req: z.object({
      url: z.string().min(1).refine(
        (u) => {
          const lower = u.trim().toLowerCase();
          if (lower.startsWith('javascript:')) return false;
          if (lower.startsWith('file://')) return false;
          if (lower.startsWith('chrome://')) return false;
          if (lower.startsWith('chrome-extension://')) return false;
          return true;
        },
        { message: 'Unsafe URL scheme' },
      ).optional(),
    }),
    res: z.object({
      ok: z.boolean(),
      tabId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'browser:switchTab': {
    req: z.object({ tabId: z.string().min(1) }),
    res: z.object({ ok: z.boolean() }),
  },
  'browser:closeTab': {
    req: z.object({ tabId: z.string().min(1) }),
    res: z.object({ ok: z.boolean() }),
  },
  'browser:navigate': {
    req: z.object({
      url: z.string().min(1).refine(
        (u) => {
          const lower = u.trim().toLowerCase();
          if (lower.startsWith('javascript:')) return false;
          if (lower.startsWith('file://')) return false;
          if (lower.startsWith('chrome://')) return false;
          if (lower.startsWith('chrome-extension://')) return false;
          return true;
        },
        { message: 'Unsafe URL scheme' },
      ),
    }),
    res: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'browser:back': {
    req: z.null(),
    res: z.object({ ok: z.boolean() }),
  },
  'browser:forward': {
    req: z.null(),
    res: z.object({ ok: z.boolean() }),
  },
  'browser:reload': {
    req: z.null(),
    res: z.object({ ok: z.literal(true) }),
  },
  'browser:getState': {
    req: z.null(),
    res: BrowserStateSchema,
  },
  'browser:didUpdateState': {
    req: BrowserStateSchema,
    res: z.null(),
  },
  // Billing channels
  'billing:getInfo': {
    req: z.null(),
    res: BillingInfoSchema,
  },
  // Notification settings channels
  'notifications:getSettings': {
    req: z.null(),
    res: NotificationSettingsSchema,
  },
  'notifications:setSettings': {
    req: NotificationSettingsSchema,
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
