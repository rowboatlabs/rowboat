import { z } from 'zod';
import { RelPath, Encoding, Stat, DirEntry, ReaddirOptions, ReadFileResult, WorkspaceChangeEvent, WriteFileOptions, WriteFileResult, RemoveOptions } from './workspace.js';
import { ListToolsResponse } from './mcp.js';
import { AskHumanResponsePayload, CreateRunOptions, Run, ListRunsResponse, ToolPermissionAuthorizePayload } from './runs.js';
import { LlmModelConfig, LlmProvider } from './models.js';
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
import { PermissionDecision, ApprovalPolicy, CodingAgent } from './code-mode.js';
import { NotificationSettingsSchema } from './notification-settings.js';
import { CodeProject, CodeSession, CodeSessionMode, CodeSessionStatus, GitRepoInfo, GitStatusFile, CodeAgentModelOptions } from './code-sessions.js';

// ============================================================================
// Runtime Validation Schemas (Single Source of Truth)
// ============================================================================

const KnowledgeSourceScopeSchema = z.object({
  type: z.string(),
  id: z.string(),
  name: z.string().optional(),
  workspaceUrl: z.string().optional(),
});

// Mirrors AgentSlackErrorKind in @x/core/slack/agent-slack-exec. Kept as a
// standalone enum so the renderer can branch on failure cause without
// importing core.
const SlackErrorKindSchema = z.enum([
  'not_installed', 'timeout', 'parse_error',
  'not_authed', 'rate_limited', 'network', 'bad_channel', 'unknown',
]);

const KnowledgeSourceConfigSchema = z.object({
  id: z.string(),
  provider: z.enum(['gmail', 'meeting', 'voice_memo', 'slack', 'github', 'linear']),
  enabled: z.boolean(),
  artifactDir: z.string(),
  syncMode: z.enum(['file', 'poll', 'event', 'manual']).default('file'),
  intervalMs: z.number().int().positive().optional(),
  scopes: z.array(KnowledgeSourceScopeSchema).default([]),
  instructions: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

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
      attachments: z
        .array(
          z.object({
            filename: z.string(),
            mimeType: z.string(),
            contentBase64: z.string(),
          }),
        )
        .optional(),
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
  'gmail:getAccountName': {
    req: z.object({}),
    res: z.object({
      name: z.string().nullable(),
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
      // Code-section sessions pin the coding agent's working directory and
      // approval policy for the whole turn (see code_agent_run overrides).
      codeCwd: z.string().optional(),
      codePolicy: ApprovalPolicy.optional(),
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
  'runs:listByWorkDir': {
    req: z.object({
      dir: z.string(),
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
  'models:listForProvider': {
    req: z.object({
      provider: LlmProvider,
    }),
    res: z.object({
      success: z.boolean(),
      models: z.array(z.string()).optional(),
      error: z.string().optional(),
    }),
  },
  'llm:getDefaultModel': {
    req: z.null(),
    res: z.object({
      model: z.string(),
      provider: z.string(),
    }),
  },
  'llm:generate': {
    req: z.object({
      prompt: z.string().min(1),
      system: z.string().optional(),
      model: z.string().optional(),
      provider: z.string().optional(),
    }),
    res: z.object({
      text: z.string().optional(),
      model: z.string().optional(),
      provider: z.string().optional(),
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
  // Download + install an agent's native engine (the Settings "Enable" action).
  // Streams progress over the 'codeMode:engineProgress' push channel while it runs.
  'codeMode:provisionEngine': {
    req: z.object({ agent: z.enum(['claude', 'codex']) }),
    res: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  // Push (main -> renderer): engine provisioning progress for the Settings UI.
  'codeMode:engineProgress': {
    req: z.object({
      agent: z.enum(['claude', 'codex']),
      phase: z.enum(['download', 'verify', 'extract', 'done']),
      receivedBytes: z.number().optional(),
      totalBytes: z.number().optional(),
    }),
    res: z.null(),
  },
  // ==========================================================================
  // Code section: project registry + coding sessions
  // ==========================================================================
  'codeProject:add': {
    req: z.object({
      path: z.string(),
    }),
    res: z.object({
      project: CodeProject,
      git: GitRepoInfo,
    }),
  },
  'codeProject:remove': {
    req: z.object({
      projectId: z.string(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'codeProject:list': {
    req: z.null(),
    res: z.object({
      projects: z.array(z.object({
        project: CodeProject,
        git: GitRepoInfo,
      })),
    }),
  },
  'codeSession:create': {
    req: z.object({
      projectId: z.string(),
      title: z.string().optional(),
      agent: CodingAgent,
      mode: CodeSessionMode,
      policy: ApprovalPolicy,
      isolation: z.enum(['in-repo', 'worktree']),
      // LLM for Rowboat-mode turns. Unset = the configured default. Like any
      // chat, the model is fixed once the session's run exists.
      model: z.string().optional(),
      provider: z.string().optional(),
      // The coding agent's own model + reasoning effort (ACP engine). Unlike the
      // Rowboat model these are re-applied each turn, so they stay editable.
      agentModel: z.string().optional(),
      agentEffort: z.string().optional(),
    }),
    res: z.object({
      session: CodeSession,
    }),
  },
  'codeSession:list': {
    req: z.null(),
    res: z.object({
      sessions: z.array(CodeSession),
      statuses: z.record(z.string(), CodeSessionStatus),
    }),
  },
  'codeSession:update': {
    req: z.object({
      sessionId: z.string(),
      patch: CodeSession.pick({ title: true, mode: true, policy: true, agent: true, agentModel: true, agentEffort: true }).partial(),
    }),
    res: z.object({
      session: CodeSession,
    }),
  },
  // Live model + effort choices for a coding agent, discovered from the engine
  // (cached per agent in the main process). Mirrors what `/model` would show.
  'codeMode:listModelOptions': {
    req: z.object({ agent: CodingAgent }),
    res: CodeAgentModelOptions,
  },
  'codeSession:delete': {
    req: z.object({
      sessionId: z.string(),
      removeWorktree: z.boolean().optional(),
      deleteBranch: z.boolean().optional(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Direct-drive: send the user's message straight to the session's ACP agent
  // (no copilot LLM in between). Streams back over `runs:events`.
  'codeSession:sendMessage': {
    req: z.object({
      sessionId: z.string(),
      text: z.string().min(1),
    }),
    res: z.object({
      accepted: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'codeSession:stop': {
    req: z.object({
      sessionId: z.string(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  'codeSession:gitStatus': {
    req: z.object({
      sessionId: z.string(),
    }),
    res: z.object({
      isRepo: z.boolean(),
      branch: z.string().nullable(),
      hasCommits: z.boolean(),
      files: z.array(GitStatusFile),
    }),
  },
  'codeSession:fileDiff': {
    req: z.object({
      sessionId: z.string(),
      path: z.string(),
    }),
    res: z.object({
      oldText: z.string(),
      newText: z.string(),
      isBinary: z.boolean(),
      tooLarge: z.boolean(),
    }),
  },
  'codeSession:readdir': {
    req: z.object({
      sessionId: z.string(),
      relPath: z.string(),
    }),
    res: z.object({
      entries: z.array(z.object({
        name: z.string(),
        kind: z.enum(['file', 'dir']),
        size: z.number().optional(),
      })),
    }),
  },
  'codeSession:readFile': {
    req: z.object({
      sessionId: z.string(),
      relPath: z.string(),
    }),
    res: z.object({
      content: z.string(),
      isBinary: z.boolean(),
      tooLarge: z.boolean(),
    }),
  },
  'codeSession:mergeBack': {
    req: z.object({
      sessionId: z.string(),
    }),
    res: z.object({
      ok: z.boolean(),
      conflict: z.boolean().optional(),
      message: z.string(),
    }),
  },
  'codeSession:cleanupWorktree': {
    req: z.object({
      sessionId: z.string(),
      deleteBranch: z.boolean(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // main → renderer: live session status transitions from the status tracker.
  'codeSession:status': {
    req: z.object({
      sessionId: z.string(),
      status: CodeSessionStatus,
    }),
    res: z.null(),
  },
  // ==========================================================================
  // Embedded terminal (Code section): one PTY per coding session
  // ==========================================================================
  // Create-or-attach. Returns the scrollback backlog so a remounted view can
  // repaint what happened while it was closed.
  'terminal:ensure': {
    req: z.object({
      id: z.string(),
      cwd: z.string(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }),
    res: z.object({
      backlog: z.string(),
      running: z.boolean(),
    }),
  },
  'terminal:input': {
    req: z.object({
      id: z.string(),
      data: z.string(),
    }),
    res: z.object({ success: z.literal(true) }),
  },
  'terminal:resize': {
    req: z.object({
      id: z.string(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }),
    res: z.object({ success: z.literal(true) }),
  },
  'terminal:dispose': {
    req: z.object({ id: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  // main → renderer streams
  'terminal:data': {
    req: z.object({ id: z.string(), data: z.string() }),
    res: z.null(),
  },
  'terminal:exit': {
    req: z.object({ id: z.string(), exitCode: z.number() }),
    res: z.null(),
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
  'slack:cliStatus': {
    req: z.null(),
    res: z.object({
      available: z.boolean(),
      version: z.string().optional(),
      source: z.enum(['bundled', 'global', 'path']).optional(),
    }),
  },
  'slack:listWorkspaces': {
    req: z.null(),
    res: z.object({
      workspaces: z.array(z.object({ url: z.string(), name: z.string() })),
      error: z.string().optional(),
      errorKind: SlackErrorKindSchema.optional(),
    }),
  },
  'slack:importDesktopAuth': {
    req: z.null(),
    res: z.object({
      ok: z.boolean(),
      workspaces: z.array(z.object({ url: z.string(), name: z.string() })),
      error: z.string().optional(),
      errorKind: SlackErrorKindSchema.optional(),
    }),
  },
  'slack:quitAndImportDesktop': {
    req: z.null(),
    res: z.object({
      ok: z.boolean(),
      workspaces: z.array(z.object({ url: z.string(), name: z.string() })),
      error: z.string().optional(),
      errorKind: SlackErrorKindSchema.optional(),
    }),
  },
  'slack:parseCurlAuth': {
    req: z.object({ curl: z.string() }),
    res: z.object({
      ok: z.boolean(),
      workspaces: z.array(z.object({ url: z.string(), name: z.string() })),
      error: z.string().optional(),
      errorKind: SlackErrorKindSchema.optional(),
    }),
  },
  'slack:knowledgeStatus': {
    req: z.null(),
    res: z.object({
      cli: z.object({
        available: z.boolean(),
        version: z.string().optional(),
        source: z.enum(['bundled', 'global', 'path']).optional(),
      }),
      sources: z.array(z.object({
        id: z.string(),
        enabled: z.boolean(),
        lastSyncAt: z.string().optional(),
        lastStatus: z.enum(['ok', 'error']).optional(),
        lastError: z.object({ kind: z.string(), message: z.string() }).optional(),
        nextDueAt: z.string().optional(),
      })),
    }),
  },
  'slack:listChannels': {
    req: z.object({
      workspaceUrl: z.string(),
    }),
    res: z.object({
      channels: z.array(z.object({
        id: z.string(),
        name: z.string(),
        isPrivate: z.boolean().optional(),
        isMember: z.boolean().optional(),
      })),
      error: z.string().optional(),
    }),
  },
  'slack:getRecentMessages': {
    req: z.object({
      limit: z.number().int().positive().max(20).optional(),
    }),
    res: z.object({
      enabled: z.boolean(),
      messages: z.array(z.object({
        id: z.string(),
        workspaceName: z.string().optional(),
        workspaceUrl: z.string().optional(),
        channelId: z.string().optional(),
        channelName: z.string().optional(),
        author: z.string().optional(),
        text: z.string(),
        ts: z.string(),
        url: z.string().optional(),
      })),
      error: z.string().optional(),
      errorKind: SlackErrorKindSchema.optional(),
    }),
  },
  'knowledgeSources:getConfig': {
    req: z.null(),
    res: z.object({
      sources: z.array(KnowledgeSourceConfigSchema),
    }),
  },
  'knowledgeSources:upsert': {
    req: KnowledgeSourceConfigSchema,
    res: z.object({
      sources: z.array(KnowledgeSourceConfigSchema),
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
  // Mini Apps: execute a Composio tool by slug (scoped to a connected toolkit).
  'composio:execute-tool': {
    req: z.object({
      toolkitSlug: z.string(),
      toolSlug: z.string(),
      arguments: z.record(z.string(), z.unknown()).optional(),
    }),
    res: z.object({
      successful: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
  },
  // Mini Apps: search Composio tools within a toolkit (returns slugs + schemas).
  'composio:search-tools': {
    req: z.object({
      toolkitSlug: z.string(),
      query: z.string(),
    }),
    res: z.object({
      tools: z.array(z.object({
        slug: z.string(),
        name: z.string(),
        description: z.string().optional(),
      })),
      error: z.string().optional(),
    }),
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
  'dialog:openFiles': {
    req: z.object({
      defaultPath: z.string().optional(),
      title: z.string().optional(),
    }),
    res: z.object({
      paths: z.array(z.string()),
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
  // Google Docs linked knowledge files
  'google-docs:getStatus': {
    req: z.null(),
    res: z.object({
      connected: z.boolean(),
      hasRequiredScopes: z.boolean(),
      missingScopes: z.array(z.string()),
    }),
  },
  'google-docs:import': {
    req: z.object({
      fileId: z.string().min(1),
      targetFolder: RelPath,
    }),
    res: z.object({
      path: RelPath,
      doc: z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        modifiedTime: z.string().nullable(),
        owner: z.string().nullable(),
      }),
    }),
  },
  // Managed OAuth-redirect Picker: the Rowboat backend runs the pick with the
  // company Google client; the desktop opens the start URL, waits for the deep
  // link, and imports with the existing managed token. No API key or BYOK creds.
  'google-docs:pickViaManaged': {
    req: z.object({
      targetFolder: RelPath,
    }),
    res: z.object({
      path: RelPath,
      doc: z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        modifiedTime: z.string().nullable(),
        owner: z.string().nullable(),
      }),
    }).nullable(),
  },
  'google-docs:refreshSnapshot': {
    req: z.object({
      path: RelPath,
    }),
    res: z.object({
      ok: z.literal(true),
      syncedAt: z.string(),
    }),
  },
  'google-docs:sync': {
    req: z.object({
      path: RelPath,
      // Overwrite the Google Doc even if it changed remotely since last sync.
      force: z.boolean().optional(),
      // Legacy field from the markdown-link path; ignored by the .docx sync.
      markdown: z.string().optional(),
    }),
    res: z.object({
      synced: z.boolean(),
      syncedAt: z.string().optional(),
      // True when a remote edit was detected and the push was held back.
      conflict: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },
  // Is this local .docx linked to a Google Doc? Drives the sync UI in the viewer.
  'google-docs:getLink': {
    req: z.object({
      path: RelPath,
    }),
    res: z.object({
      link: z.object({
        id: z.string(),
        url: z.string(),
        title: z.string(),
        syncedAt: z.string(),
        remoteModifiedTime: z.string().optional(),
      }).nullable(),
    }),
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
      projectId: z.string().optional(),
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
