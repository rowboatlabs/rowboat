import { z } from 'zod';
import { UseCase } from './analytics.js';
import { DeckOutline, DeckOutlineSlide, EditSlideRequest, GenerateDeckOutlineRequest, GenerateSlideRequest } from './deck.js';
import { RelPath, Encoding, Stat, DirEntry, ReaddirOptions, ReadFileResult, WorkspaceChangeEvent, WriteFileOptions, WriteFileResult, RemoveOptions } from './workspace.js';
import { ListToolsResponse } from './mcp.js';
import { AskHumanResponsePayload, CreateRunOptions, Run, ListRunsResponse, ToolPermissionAuthorizePayload } from './runs.js';
import { LlmProvider, ModelRef, ModelSelection, ReasoningEffort } from './models.js';
import { AgentScheduleConfig, AgentScheduleEntry } from './agent-schedule.js';
import { AgentScheduleState } from './agent-schedule-state.js';
import { ServiceEvent } from './service-events.js';
import { LiveNoteAgentEvent, LiveNoteSchema } from './live-note.js';
import { TodoChatBubbleSchema, TodoEvent, TodoItemSchema, TodoListSchema } from './todo.js';
import { HomeThreadSchema } from './home-threads.js';
import {
    BackgroundTaskAgentEvent,
    BackgroundTaskSchema,
    BackgroundTaskSummarySchema,
    TriggersSchema,
} from './background-task.js';
import { UserMessage, UserMessageContent } from './message.js';
import { RequestedAgent, type TurnBusEvent, type TurnEvent } from './turns.js';
import type { QueuedSessionMessage, SessionBusEvent, SessionIndexEntry, SessionState } from './sessions.js';
import { RowboatApiConfig } from './rowboat-account.js';
import { ZListToolkitsResponse } from './composio.js';
import { AppSummarySchema, RegistryRecordSchema, RowboatAppManifestSchema } from './rowboat-app.js';
import { BrowserStateSchema, DisplayMediaRequestSchema, HttpAuthRequestSchema } from './browser-control.js';
import { BillingInfoSchema } from './billing.js';
import { CreditActivatedEventSchema, CreditsStateSchema, ReferralClaimResultSchema } from './credits.js';
import { GmailThreadSchema } from './blocks.js';
import { PermissionDecision, ApprovalPolicy, CodingAgent, type CodeRunFeedEvent } from './code-mode.js';
import { NotificationSettingsSchema } from './notification-settings.js';
import { TurnLimitsSettingsSchema } from './turn-limits.js';
import { RetentionSettingsSchema, RetentionSettingsUpdateSchema } from './retention.js';
import { CodeProject, CodeSession, CodeSessionStatus, GitRepoInfo, GitStatusFile, CodeAgentModelOptions } from './code-sessions.js';
import { ChannelsConfig, ChannelsStatus } from './channels.js';
import {
    SpacesOrgSummary,
    type SpacesAssetEntry,
    type SpacesBusEvent,
    type SpacesManageTopicAction,
    type SpacesPostResult,
    type SpacesProposeInput,
    type SpacesStreamPage,
    type SpacesThreadPage,
} from './spaces.js';
import type * as SpacesTypes from './spaces.js';

// ============================================================================
// Runtime Validation Schemas (Single Source of Truth)
// ============================================================================

// Everything the in-app composer's onSubmit carries, so a bar question
// behaves exactly like a composer message: mentions and attachments flow
// into the turn, and the per-turn config (search/code/permissions) plus the
// bar's model/effort picks are applied by the app window before submitting.
const QuickAskSubmitPayload = z.object({
  text: z.string(),
  mentions: z
    .array(
      z.object({
        id: z.string(),
        path: z.string(),
        displayName: z.string(),
        lineNumber: z.number().optional(),
      }),
    )
    .optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        path: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        isImage: z.boolean(),
        size: z.number(),
        thumbnailUrl: z.string().optional(),
      }),
    )
    .optional(),
  searchEnabled: z.boolean().optional(),
  codeMode: z.enum(['claude', 'codex']).optional(),
  permissionMode: z.enum(['manual', 'auto']).optional(),
  model: ModelRef.nullable().optional(),
  reasoningEffort: ReasoningEffort.nullable().optional(),
});

// Which chat the bar's submits land in (title shown as the bar's
// destination chip) plus recents for its switcher — pushed by the app
// window whenever tabs/runs change.
const QuickAskChatContext = z.object({
  activeRunId: z.string().nullable(),
  activeTitle: z.string().nullable(),
  recent: z.array(z.object({ id: z.string(), title: z.string() })),
});

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

// Lifecycle of the client auto-updater (apps/main/src/updater.ts).
// - disabled: dev build — the updater never initializes
// - unsupported: platform can't auto-update (`reason` says why)
// - ready: an update is downloaded and installed; restart switches to it
const UpdaterStatusSchema = z.object({
  state: z.enum(['disabled', 'unsupported', 'idle', 'checking', 'downloading', 'ready', 'error']),
  version: z.string(),
  reason: z.enum(['dev', 'platform', 'not-in-applications']).optional(),
  newVersion: z.string().optional(),
  // Markdown body of the staged update's GitHub release, when known — the
  // restart card renders it verbatim.
  releaseNotes: z.string().optional(),
  error: z.string().optional(),
  lastCheckedAt: z.number().optional(),
});

export const ipcSchemas = {
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
  // Pick an image from disk for insertion into a document. Returns the bytes
  // rather than a path: the renderer holds them in its edit set until save.
  'workspace:pickImage': {
    req: z.object({}),
    res: z.object({
      picked: z.boolean(),
      name: z.string().optional(),
      /** Lowercase extension without the dot. */
      ext: z.string().optional(),
      dataBase64: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  // Copy a workspace file OUT to a user-chosen location. The destination comes
  // from the OS save dialog, which is also what confirms any overwrite.
  'workspace:exportCopy': {
    req: z.object({
      path: RelPath,
    }),
    res: z.object({
      saved: z.boolean(),
      dest: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'workspace:didChange': {
    req: WorkspaceChangeEvent,
    res: z.null(),
  },
  // One-shot deck outline generation for the AI deck builder. Soft errors,
  // like workspace:exportCopy: failures come back as { error } rather than a
  // rejected invoke.
  'deck:generateOutline': {
    req: GenerateDeckOutlineRequest,
    res: z.object({
      outline: DeckOutline.optional(),
      error: z.string().optional(),
    }),
  },
  // Generate ONE slide to insert into an existing deck (Gamma's sparkle).
  // Soft errors like the outline channel: failures come back as { error }.
  'deck:generateSlide': {
    req: GenerateSlideRequest,
    res: z.object({
      slide: DeckOutlineSlide.optional(),
      error: z.string().optional(),
    }),
  },
  // Apply an instruction to ONE existing slide; the response is the slide
  // AFTER the edit, in the same outline schema. Soft errors as above.
  'deck:editSlide': {
    req: EditSlideRequest,
    res: z.object({
      slide: DeckOutlineSlide.optional(),
      error: z.string().optional(),
    }),
  },
  'gmail:getImportant': {
    req: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    res: z.object({
      threads: z.array(GmailThreadSchema),
      nextCursor: z.string().nullable(),
      categoryCounts: z.record(z.string(), z.number()).optional(),
    }),
  },
  'gmail:getEverythingElse': {
    req: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      // Restrict to one category (filter pills). Whole-section categoryCounts
      // are returned regardless, so the pills stay populated while filtered.
      category: z.string().optional(),
    }),
    res: z.object({
      threads: z.array(GmailThreadSchema),
      nextCursor: z.string().nullable(),
      categoryCounts: z.record(z.string(), z.number()).optional(),
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
  'gmail:saveDraft': {
    req: z.object({
      // Existing Gmail draft to update; omitted on first save (creates a new one).
      draftId: z.string().min(1).optional(),
      threadId: z.string().min(1).optional(),
      // Recipients may be blank for a draft (unlike a send).
      to: z.string().optional(),
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
      draftId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'gmail:deleteDraft': {
    req: z.object({ draftId: z.string().min(1) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  'gmail:getDrafts': {
    req: z.object({}),
    res: z.object({
      threads: z.array(GmailThreadSchema),
      error: z.string().optional(),
    }),
  },
  'gmail:search': {
    req: z.object({
      query: z.string(),
      limit: z.number().int().positive().optional(),
    }),
    res: z.object({
      threads: z.array(GmailThreadSchema),
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
  // User explicitly flips a thread's importance verdict. Sticky on the thread
  // (re-classification never overrides) and recorded as a correction the
  // importance classifier learns from.
  'gmail:setImportance': {
    req: z.object({
      threadId: z.string().min(1),
      importance: z.enum(['important', 'other']),
    }),
    res: z.object({
      ok: z.boolean(),
      previous: z.enum(['important', 'other']).optional(),
      error: z.string().optional(),
    }),
  },
  // User explicitly picks a thread's category. Sticky on the thread
  // (re-classification never overrides) and recorded as a correction the
  // classifier learns from. Never affects the knowledge-graph verdict.
  'gmail:setCategory': {
    req: z.object({
      threadId: z.string().min(1),
      // Open string: valid ids come from the email label registry (built-ins
      // plus user-defined labels), which the renderer fetches at runtime.
      category: z.string().min(1).max(40),
    }),
    res: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // The label registry: built-in categories plus labels the user defined in
  // their agent instructions. Chips, filter pills, and the correction
  // dropdown all render from this list.
  'gmail:getEmailLabels': {
    req: z.object({}),
    res: z.object({
      labels: z.array(z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(['builtin', 'custom']),
      })),
    }),
  },
  // Free-text standing instructions injected into every classification /
  // draft call. Stored at config/email_instructions.md.
  'gmail:getEmailInstructions': {
    req: z.object({}),
    res: z.object({ instructions: z.string() }),
  },
  'gmail:setEmailInstructions': {
    req: z.object({ instructions: z.string().max(8000) }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  // Archive every "Everything else" thread of one category in a single sweep.
  'gmail:archiveCategory': {
    req: z.object({ category: z.string().min(1) }),
    res: z.object({
      archived: z.number(),
      failed: z.number(),
      error: z.string().optional(),
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
    req: z.object({ threadId: z.string().min(1), read: z.boolean().optional() }),
    res: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  'gmail:downloadAttachment': {
    req: z.object({
      messageId: z.string().min(1),
      savedPath: z.string().min(1),
      attachmentId: z.string().optional(),
    }),
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
  // Ephemeral code-run stream (CodeRunFeed): per-event broadcast of a
  // code_agent_run's live ACP activity, keyed by toolCallId. Never persisted —
  // the durable record is the code-run-events-batch tool progress written when
  // the run settles. Typed via z.custom like the other broadcast feeds.
  'codeRun:events': {
    req: z.custom<CodeRunFeedEvent>(),
    res: z.null(),
  },
  // ── New runtime: sessions + turns (session-design.md) ────────────────────
  // Turn-mutating calls return quickly; the renderer follows progress through
  // the turns:events feed and the shared reduceTurn reducer.
  'sessions:create': {
    req: z.object({ title: z.string().optional() }),
    res: z.object({ sessionId: z.string() }),
  },
  'sessions:list': {
    req: z.object({}),
    res: z.object({ sessions: z.array(z.custom<SessionIndexEntry>()) }),
  },
  'sessions:get': {
    req: z.object({ sessionId: z.string() }),
    res: z.custom<SessionState>(),
  },
  'sessions:getTurn': {
    // Events are strictly validated at the repository read; typed via
    // z.custom to avoid re-validating potentially large logs per IPC hop.
    req: z.object({ turnId: z.string() }),
    res: z.custom<{ turnId: string; events: Array<z.infer<typeof TurnEvent>> }>(),
  },
  'sessions:sendMessage': {
    req: z.object({
      sessionId: z.string(),
      input: UserMessage,
      config: z.object({
        agent: RequestedAgent,
        useCase: UseCase.optional(),
        subUseCase: z.string().optional(),
        autoPermission: z.boolean().optional(),
        maxModelCalls: z.number().int().positive().optional(),
        reasoningEffort: ReasoningEffort.optional(),
      }),
    }),
    res: z.object({ turnId: z.string() }),
  },
  // Deliver-ASAP send: starts a turn when the session is settled, otherwise
  // queues (ephemeral, main-process memory) — queued messages steer the live
  // turn at its next model-call boundary or promote to a new turn at settle.
  'sessions:sendOrQueueMessage': {
    req: z.object({
      sessionId: z.string(),
      input: UserMessage,
      config: z.object({
        agent: RequestedAgent,
        useCase: UseCase.optional(),
        subUseCase: z.string().optional(),
        autoPermission: z.boolean().optional(),
        maxModelCalls: z.number().int().positive().optional(),
        reasoningEffort: ReasoningEffort.optional(),
      }),
    }),
    res: z.union([
      z.object({ queued: z.literal(false), turnId: z.string() }),
      z.object({ queued: z.literal(true), queueId: z.string() }),
    ]),
  },
  'sessions:listQueued': {
    req: z.object({ sessionId: z.string() }),
    res: z.object({ queue: z.array(z.custom<QueuedSessionMessage>()) }),
  },
  'sessions:editQueued': {
    req: z.object({
      sessionId: z.string(),
      queueId: z.string(),
      message: UserMessage,
    }),
    res: z.object({ success: z.literal(true) }),
  },
  'sessions:removeQueued': {
    req: z.object({ sessionId: z.string(), queueId: z.string() }),
    res: z.object({ removed: z.custom<QueuedSessionMessage>().nullable() }),
  },
  'sessions:respondToPermission': {
    req: z.object({
      turnId: z.string(),
      toolCallId: z.string(),
      decision: z.enum(['allow', 'deny']),
      metadata: z.json().optional(),
    }),
    res: z.object({ success: z.literal(true) }),
  },
  'sessions:respondToAskHuman': {
    req: z.object({
      turnId: z.string(),
      toolCallId: z.string(),
      answer: z.string(),
    }),
    res: z.object({ success: z.literal(true) }),
  },
  'sessions:stopTurn': {
    req: z.object({
      turnId: z.string(),
      reason: z.string().optional(),
    }),
    // dequeued: pending messages drained by the stop (a stop must not be
    // followed by a queued message auto-starting) — the UI restores their
    // text to the composer.
    res: z.object({
      success: z.literal(true),
      dequeued: z.array(z.custom<QueuedSessionMessage>()),
    }),
  },
  'sessions:resumeTurn': {
    req: z.object({ sessionId: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  'sessions:setTitle': {
    req: z.object({ sessionId: z.string(), title: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  'sessions:downloadLog': {
    // Concatenates the session's turn logs into one JSONL for debugging.
    req: z.object({ sessionId: z.string() }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'sessions:delete': {
    req: z.object({ sessionId: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  'sessions:events': {
    // Typed via z.custom so the renderer's `on` handler is typed without
    // runtime validation (the broadcast path bypasses preload validation,
    // like runs:events).
    req: z.custom<SessionBusEvent>(),
    res: z.null(),
  },
  // Process-wide turn event spine: every turn's durable events (with file
  // offsets), regardless of who started the turn — session chat, headless
  // background/knowledge runners, spawned sub-agents. Text/reasoning deltas
  // ride the same channel but only reach windows that subscribed to that
  // turn via turns:subscribe.
  'turns:events': {
    req: z.custom<TurnBusEvent>(),
    res: z.null(),
  },
  // Per-window delta subscription: deltas are high-volume and ephemeral, so
  // they cross IPC only for turns this window declared it is watching.
  // Durable events are always broadcast regardless.
  'turns:subscribe': {
    req: z.object({ turnId: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  'turns:unsubscribe': {
    req: z.object({ turnId: z.string() }),
    res: z.object({ success: z.literal(true) }),
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
  'todo:events': {
    req: TodoEvent,
    res: z.null(),
  },
  // ── Home thread registry (the Deck) ──────────────────────────────────────
  // One main-process snapshot of every thread through the attention lens:
  // kind (task/code/chat), status (underway/needs-you/ready/idle), live
  // activity, seen marks and pins. Derived in core/home/threads.ts; the
  // Deck, triage pills, and Skipper's sitrep all read this one feed.
  'home:threads': {
    req: z.object({}),
    res: z.object({ threads: z.array(HomeThreadSchema) }),
  },
  'home:markSeen': {
    req: z.object({ sessionId: z.string() }),
    res: z.object({ success: z.boolean() }),
  },
  // The operator's watch flag — a pinned thread keeps its Deck strip even
  // while idle, and takes a 1–9 recall slot.
  'home:setPinned': {
    req: z.object({ sessionId: z.string(), pinned: z.boolean() }),
    res: z.object({ success: z.boolean() }),
  },
  // Snooze a needs-you thread out of the bay. It returns at the chosen time
  // or on new session activity, whichever comes first — a tripwire, never a
  // mute. Default 4 hours.
  'home:snooze': {
    req: z.object({ sessionId: z.string(), hours: z.number().positive().max(168).optional() }),
    res: z.object({ success: z.boolean() }),
  },
  // Dismiss a needs-you thread's claim entirely: no timer, only the
  // activity tripwire returns it. Attention-state only — receipts and the
  // thread itself are untouched.
  'home:dismiss': {
    req: z.object({ sessionId: z.string() }),
    res: z.object({ success: z.boolean() }),
  },
  // Push ping: the registry changed — refetch home:threads. Debounced in
  // the tracker; carries no payload by design (the snapshot is the truth).
  'home:threadsChanged': {
    req: z.object({}),
    res: z.null(),
  },
  // The Command Center session — get-or-create the ONE persistent operator
  // conversation. Any turn on it is command-center-framed server-side
  // (sessionCompositionPins), whatever surface sends it.
  'home:commandCenter': {
    req: z.object({}),
    res: z.object({ sessionId: z.string() }),
  },
  // The unified model catalog (core/models/catalog.ts): every connected
  // provider — Rowboat gateway, ChatGPT subscription (codex), BYOK keys,
  // local/custom endpoints — listed the same way, with per-provider status.
  'models:list': {
    req: z.object({
      // Drop this provider's cached list and refetch (Retry / Refresh).
      refreshProvider: z.string().optional(),
    }).nullable(),
    res: z.object({
      providers: z.array(z.object({
        // Provider INSTANCE id — what ModelRef.provider / assistantModel /
        // refreshProvider reference. One instance per flavor today, so it
        // always equals the flavor key; kept distinct so a future
        // multi-instance setup ("openai-work") is additive.
        id: z.string(),
        // Provider TYPE ("openai", "ollama", "rowboat", "codex", …) —
        // drives display naming and credential-field UI.
        flavor: z.string(),
        // 'error' = provider is connected but its model list failed to load.
        status: z.enum(['ok', 'error']),
        error: z.string().optional(),
        models: z.array(z.object({
          id: z.string(),
          name: z.string().optional(),
          // models.dev "supports reasoning/extended thinking" flag; absent =
          // unknown. Gates the composer's reasoning-effort control.
          reasoning: z.boolean().optional(),
        })),
      })),
      // The effective runtime default (what runs when nothing is picked),
      // effort included — it seeds new chats' composer state.
      defaultModel: ModelSelection.nullable(),
    }),
  },
  // The image-model catalog for the settings "Image model" picker: the
  // connected providers that can generate images, each with the models it
  // lists. Every image flavor lists (see getImageModelCatalog for where
  // each one's list comes from) — the picker only ever offers reported
  // models, so a provider that can't list reports status 'error'.
  'models:listImageModels': {
    req: z.null(),
    res: z.object({
      providers: z.array(z.object({
        id: z.string(),
        flavor: z.string(),
        status: z.enum(['ok', 'error']),
        error: z.string().optional(),
        models: z.array(z.string()),
      })),
    }),
  },
  'models:test': {
    req: z.object({
      provider: LlmProvider,
      model: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
      // Capability caveats from the local-model probe (tool support, context
      // window) — the connection still succeeded.
      warnings: z.array(z.string()).optional(),
      capabilities: z.object({
        supportsTools: z.boolean().optional(),
        maxContextLength: z.number().optional(),
      }).optional(),
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
  // Upsert one provider entry (credentials + connection prefs). Model
  // choices are NOT part of a provider — set them via models:updateConfig.
  'models:setProvider': {
    req: z.object({
      id: z.string(),
      provider: LlmProvider,
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Remove a provider entry plus any assistantModel / task override that
  // references it (dangling selections would just error at run time).
  'models:removeProvider': {
    req: z.object({
      id: z.string(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Current model selections plus credential-FREE provider metadata (the
  // renderer never needs keys to render pickers or provider cards). Null
  // assistantModel = not configured yet.
  'models:getConfig': {
    req: z.null(),
    res: z.object({
      // Configured BYOK provider entries, secrets stripped: enough to
      // render manage/edit surfaces (masked key indicator, endpoint).
      providers: z.array(z.object({
        id: z.string(),
        flavor: z.string(),
        baseURL: z.string().optional(),
        hasApiKey: z.boolean(),
      })),
      assistantModel: ModelSelection.nullable(),
      taskModels: z.object({
        knowledgeGraph: ModelSelection.nullable(),
        meetingNotes: ModelSelection.nullable(),
        liveNoteAgent: ModelSelection.nullable(),
        autoPermissionDecision: ModelSelection.nullable(),
        chatTitle: ModelSelection.nullable(),
        backgroundTask: ModelSelection.nullable(),
        subagent: ModelSelection.nullable(),
      }),
      // The generate-image model — a bare ref (image models take no
      // effort). Null = unset: image generation is unavailable.
      imageModel: ModelRef.nullable(),
      deferBackgroundTasks: z.boolean(),
    }),
  },
  // Partial merge of model selections into models.json. Omitted keys are
  // untouched; null clears a key (a cleared task override inherits the
  // assistant model again). taskModels merges per-key.
  'models:updateConfig': {
    req: z.object({
      assistantModel: ModelSelection.nullable().optional(),
      taskModels: z.object({
        knowledgeGraph: ModelSelection.nullable().optional(),
        meetingNotes: ModelSelection.nullable().optional(),
        liveNoteAgent: ModelSelection.nullable().optional(),
        autoPermissionDecision: ModelSelection.nullable().optional(),
        chatTitle: ModelSelection.nullable().optional(),
        backgroundTask: ModelSelection.nullable().optional(),
        subagent: ModelSelection.nullable().optional(),
      }).optional(),
      imageModel: ModelRef.nullable().optional(),
      deferBackgroundTasks: z.boolean().nullable().optional(),
    }),
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
    }),
  },
  // The unauthenticated /v1/config bootstrap (service URLs, billing catalog,
  // model recommendations). Independent of sign-in state — main caches the
  // fetch once per app run; null when the API is unreachable. Renderer
  // consumers go through the useRowboatConfig() hook.
  'rowboat:getConfig': {
    req: z.null(),
    res: RowboatApiConfig.nullable(),
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
  // --- "Sign in with ChatGPT" (subscription OAuth via the Codex CLI client) ---
  // Raw tokens are never exposed over IPC — the renderer only sees identity
  // and connection state.
  'chatgpt:getStatus': {
    req: z.null(),
    res: z.object({
      signedIn: z.boolean(),
      email: z.string().optional(),
      accountId: z.string().optional(),
    }),
  },
  // Resolves when the browser flow settles (success, denial, timeout, port
  // busy, exchange failure, cancellation) — same shape as getStatus plus an
  // error string; `cancelled` marks expected teardown (no error toast).
  'chatgpt:signIn': {
    req: z.null(),
    res: z.object({
      signedIn: z.boolean(),
      email: z.string().optional(),
      accountId: z.string().optional(),
      cancelled: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },
  // Abort the pending sign-in attempt: stops the loopback server and settles
  // the in-flight chatgpt:signIn with a cancelled outcome. No-op when idle.
  'chatgpt:cancelSignIn': {
    req: z.null(),
    res: z.object({
      success: z.boolean(),
    }),
  },
  'chatgpt:signOut': {
    req: z.null(),
    res: z.object({
      success: z.boolean(),
    }),
  },
  // Push event (main → renderer): ChatGPT sign-in state changed. Model
  // pickers listen and refresh — subscription models appear/disappear with
  // the session.
  'chatgpt:statusChanged': {
    req: z.object({
      signedIn: z.boolean(),
    }),
    res: z.null(),
  },
  'app:openUrl': {
    req: z.object({
      url: z.string(),
    }),
    res: z.null(),
  },
  // Bring the main app window to the foreground (e.g. the assistant navigated
  // the UI during a call while the user was in another app).
  'app:focusMainWindow': {
    req: z.null(),
    res: z.object({}),
  },
  'app:takeMeetingNotes': {
    req: z.object({
      // Pass the raw calendar event JSON through; renderer adapts to its existing flow.
      event: z.unknown(),
      // When true, the renderer should also open the meeting URL (Zoom/Meet/etc.)
      // in addition to triggering the take-notes flow.
      openMeeting: z.boolean().optional(),
      // Origin recorded in the note frontmatter: 'calendar-sync' (default) for
      // notification/deep-link starts, 'detected' for ambient meeting detection.
      source: z.string().optional(),
    }),
    res: z.null(),
  },
  'app:consumePendingDeepLink': {
    req: z.null(),
    res: z.object({
      url: z.string().nullable(),
    }),
  },
  // Consume-once "the app was just updated" notice. `updatedFrom` is the
  // previously recorded version on the first invoke of the first launch
  // after an update, and null on every other invoke (fresh install,
  // unchanged version, or already consumed this run).
  'app:consumeUpdateInfo': {
    req: z.null(),
    res: z.object({
      version: z.string(),
      updatedFrom: z.string().nullable(),
    }),
  },
  // --- Client auto-update (apps/main/src/updater.ts) ---
  // Pushed to all windows whenever the updater state changes.
  'updater:status': {
    req: UpdaterStatusSchema,
    res: z.null(),
  },
  'updater:getStatus': {
    req: z.null(),
    res: UpdaterStatusSchema,
  },
  // Kick off a manual check (no-op unless idle/error); progress arrives via
  // updater:status pushes. Returns the snapshot after initiating.
  'updater:check': {
    req: z.null(),
    res: UpdaterStatusSchema,
  },
  'updater:quitAndInstall': {
    req: z.null(),
    res: z.object({}),
  },
  // Tray commands issued before the renderer was ready (mirrors the pending
  // deep-link pull above): the renderer drains this once on mount.
  'app:consumePendingTrayCommand': {
    req: z.null(),
    res: z.object({
      toggleMeetingNotes: z.boolean(),
    }),
  },
  // Main → renderer: tray menu "Start/Stop meeting notes" — runs the same
  // toggle flow as the Meetings header button.
  'app:toggleMeetingNotes': {
    req: z.null(),
    res: z.null(),
  },
  // The ⌥/⌃+Tab section switcher, forwarded from the main process when an
  // embedded page (e.g. the browser <webview>) holds keyboard focus — its
  // keystrokes go to the guest and never reach the app renderer's listeners.
  'shortcuts:switcherKey': {
    req: z.object({
      type: z.enum(['keyDown', 'keyUp']),
      key: z.string(),
      code: z.string(),
      alt: z.boolean(),
      control: z.boolean(),
      shift: z.boolean(),
    }),
    res: z.null(),
  },
  // Launch-at-login (resident app). The OS login-item registry is the source
  // of truth; these read/write it directly rather than a config file.
  'app:getLoginItemSettings': {
    req: z.null(),
    res: z.object({
      openAtLogin: z.boolean(),
    }),
  },
  'app:setLoginItemSettings': {
    req: z.object({
      openAtLogin: z.boolean(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Renderer → main: meeting capture state, so the tray menu/tooltip can
  // reflect an active recording.
  'meeting:setRecordingState': {
    req: z.object({
      recording: z.boolean(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Renderer → main: meeting notes finished generating — fire the "notes
  // ready" notification (background only; click opens the note).
  'meeting:notifyNotesReady': {
    req: z.object({
      notePath: z.string(),
      title: z.string(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Main → renderer: the meeting app released the microphone while a
  // recording was running — the call likely ended, auto-stop and summarize.
  'meeting:externalCallEnded': {
    req: z.null(),
    res: z.null(),
  },
  // Renderer → main: assistant voice/video call holds the mic — suppresses
  // ambient meeting detection (it would otherwise see our own capture) and
  // runs the global push-to-talk key hook for the duration of the call.
  'voice:setCallActive': {
    req: z.object({
      active: z.boolean(),
    }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // --- Global push-to-talk (right ⌘ on macOS, right Ctrl elsewhere —
  // see ptt-key.ts) ---
  // Push channel: main → app window, a system-wide PTT key transition.
  // 'chord' = another key/click while the talk key was held (it's being used as a
  // modifier, not the talk key) — the renderer cancels the capture.
  'voice:ptt-key': {
    req: z.object({
      type: z.enum(['down', 'up', 'chord']),
      // Ghostwriter chord (⇧ held when the talk key went down): this capture's
      // result should be pasted at the user's cursor.
      paste: z.boolean().optional(),
    }),
    res: z.null(),
  },
  // Health of the global key hook. `eventsSeen` false while `running` means
  // macOS Input Monitoring permission hasn't taken effect — the renderer
  // shows the permission dialog instead of failing silently.
  'ptt:getStatus': {
    req: z.null(),
    res: z.object({
      supported: z.boolean(),
      running: z.boolean(),
      eventsSeen: z.boolean(),
    }),
  },
  // Recreate the event tap after the user grants Input Monitoring (a tap
  // created before the grant stays dead forever).
  'ptt:retryHook': {
    req: z.null(),
    res: z.object({
      running: z.boolean(),
    }),
  },
  'ptt:openInputMonitoringSettings': {
    req: z.null(),
    res: z.object({ success: z.boolean() }),
  },
  // Deep-link to a macOS Privacy & Security pane (permission dialogs and the
  // Settings → Permissions panel). 'notifications' opens the OS notification
  // settings (not under Privacy on either platform).
  'app:openPrivacySettings': {
    req: z.object({
      section: z.enum(['microphone', 'camera', 'screen-recording', 'input-monitoring', 'notifications']),
    }),
    res: z.object({ success: z.boolean() }),
  },
  // Aggregate OS-permission snapshot for Settings → Permissions. States are
  // HONEST: 'unknown' means the OS gives us no way to read it (input
  // monitoring outside a call, notifications, unprobed automation) — the UI
  // must say so rather than fake a verdict. 'not-required' rows are hidden
  // (that permission doesn't exist on this platform).
  'permissions:getStatus': {
    req: z.null(),
    res: z.object({
      platform: z.enum(['darwin', 'win32', 'linux']),
      microphone: z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown', 'not-required']),
      camera: z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown', 'not-required']),
      screenRecording: z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown', 'not-required']),
      inputMonitoring: z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown', 'not-required']),
      notifications: z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown', 'not-required']),
    }),
  },
  // Fire the OS grant flow for one permission where a programmatic path
  // exists: mic/camera native prompts, or re-arming the input-monitoring
  // key hook (its consent prompt). Returns the state afterwards.
  'permissions:request': {
    req: z.object({
      permission: z.enum(['microphone', 'camera', 'input-monitoring']),
    }),
    res: z.object({
      state: z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown', 'not-required']),
    }),
  },
  // Relaunch the app — macOS requires it for a fresh Screen Recording grant
  // to take effect.
  'app:relaunch': {
    req: z.null(),
    res: z.object({}),
  },
  // --- Hover companion (global ⌥⇧Space, own always-on-top window) ---
  // Companion → main: relay a composer submit into the companion's chat.
  'quickAsk:submit': {
    req: QuickAskSubmitPayload,
    res: z.object({}),
  },
  // Push channel: main → app window with the relayed submit.
  'quick-ask:submit': {
    req: QuickAskSubmitPayload,
    res: z.null(),
  },
  // The companion window's current role: `pinned` (the Skipper — the ONE
  // hover surface) or `hidden`. `collapsed` is the Skipper tucked down to
  // just the mascot (voice-to-voice). Pushed on every transition; the
  // invoke covers the load race (the window may finish loading after a
  // transition fired).
  'quickAsk:getMode': {
    req: z.null(),
    res: z.object({
      // Monotonic per push — the renderer echoes it back over
      // quickAsk:modeApplied once that role has PAINTED, and main reveals
      // the window only then (never with the previous role still on screen).
      seq: z.number(),
      mode: z.enum(['hidden', 'pinned']),
      collapsed: z.boolean(),
      // Which surface the pinned role expands to: untuck returns you to the
      // surface you tucked FROM — 'card' (the bar-style text card, for
      // bar-originated sessions; screen share keeps the card, its consent
      // badge rides the card's strip) or 'pill' (only a live CAMERA forces
      // the pill's tiles).
      surface: z.enum(['card', 'pill']),
    }),
  },
  'quick-ask:mode': {
    req: z.object({
      seq: z.number(),
      mode: z.enum(['hidden', 'pinned']),
      collapsed: z.boolean(),
      surface: z.enum(['card', 'pill']),
    }),
    res: z.null(),
  },
  // Companion window → main: the role carried by `seq` is on screen (painted)
  // — main may now show/focus/resize the window for it. Without this ack the
  // window could be revealed mid-transition: the summoned bar's layout for a
  // frame (or, on first creation, for the whole page load) before the
  // Skipper replaced it.
  'quickAsk:modeApplied': {
    req: z.object({ seq: z.number() }),
    res: z.object({}),
  },
  // App window → main: the hover relay listener is registered — a summon
  // that arrived while the app window was (re)loading (or didn't exist: the
  // user closed it, the shortcut recreated it hidden) is delivered now.
  'quickAsk:appReady': {
    req: z.null(),
    res: z.object({}),
  },
  // Bar → main → app window: tuck the text into the mascot. The app starts
  // the voice-preset call (mascot-only floating surface) — or, if a call is
  // already live, just minimizes it to the floating surface.
  'quickAsk:tuck': {
    req: z.null(),
    res: z.object({}),
  },
  'quick-ask:tuck': {
    req: z.null(),
    res: z.null(),
  },
  // App → main: the tuck relay was received and a session is starting —
  // cancel the "nothing answered" text-card fallback (device acquisition can
  // take seconds; the fallback must not flash meanwhile).
  'quickAsk:tuckAck': {
    req: z.null(),
    res: z.object({}),
  },
  // Pill ⇄ tucked-mascot presentation of the pinned role (main resizes the
  // window in place and re-pushes quick-ask:mode).
  'quickAsk:setPinnedCollapsed': {
    req: z.object({ collapsed: z.boolean() }),
    res: z.object({}),
  },
  // Companion → main: per-region click-through. The companion frame is far
  // bigger than anything it paints (a tall transparent stage above the card
  // so popovers can open upward), and transparency is only PAINT — the OS
  // routes a click by the window rect — so the window is click-through by
  // default and the renderer flips it solid while the cursor is actually
  // over painted UI. Without this the invisible stage swallowed every click
  // that landed on it.
  'quickAsk:setInteractive': {
    req: z.object({ interactive: z.boolean() }),
    res: z.object({}),
  },
  // Main → companion: where the cursor is, in the window's own CSS pixels.
  // Main polls it from the OS because mouse events are NOT a reliable
  // witness here: macOS drag regions (the mascot IS one — it's the drag
  // handle) are native views layered over the page, so moves across them
  // never reach the renderer at all. The renderer hit-tests this point and
  // answers on quickAsk:setInteractive.
  'quick-ask:cursor': {
    req: z.object({ x: z.number(), y: z.number() }),
    res: z.null(),
  },
  // Main → companion: the window is being dragged right now. A drag region
  // is a NATIVE affair — on Windows the hit test answers HTCAPTION, on macOS
  // it is a view layered over the page — so the renderer never sees the
  // mousedown and `:active` never fires. Main watches its own 'move' instead
  // and says so, which is what lets the cursor go from grab to grabbing.
  'quick-ask:dragging': {
    req: z.object({ dragging: z.boolean() }),
    res: z.null(),
  },
  // (The old quickAsk:setTextMode / quick-ask:text-mode channels are gone:
  // whether a reply is SPOKEN now follows the question's modality — spoken
  // questions get spoken replies, typed ones stay silent — plus the
  // explicit speaker mute on the Skipper.)
  // Bar → main: jump to the conversation in the app — focuses the app
  // window and tells it to show the chat full-view (no middle pane).
  'quickAsk:openChat': {
    req: z.null(),
    res: z.object({}),
  },
  // Push channel: main → app window for the jump above.
  'quick-ask:open-chat': {
    req: z.null(),
    res: z.null(),
  },
  // App window → main → bar: the destination-chat context (see
  // QuickAskChatContext). Cached in main and replayed on bar load.
  'quickAsk:chatContext': {
    req: QuickAskChatContext,
    res: z.object({}),
  },
  'quick-ask:chat-context': {
    req: QuickAskChatContext,
    res: z.null(),
  },
  // Bar → main → app window: rebind the bar (= the app's active chat tab)
  // to one of the recent chats from the chip's switcher.
  'quickAsk:selectChat': {
    req: z.object({ runId: z.string() }),
    res: z.object({}),
  },
  'quick-ask:select-chat': {
    req: z.object({ runId: z.string() }),
    res: z.null(),
  },
  // Bar → main: start a fresh chat for the next question (the app stays in
  // the background; only the conversation resets).
  'quickAsk:newChat': {
    req: z.null(),
    res: z.object({}),
  },
  // Push channel: main → app window for the reset above.
  'quick-ask:new-chat': {
    req: z.null(),
    res: z.null(),
  },
  // Any window → main: the current global quick-ask chord and whether the
  // OS actually granted it (false = another app owns it — quick-ask is
  // unreachable until the user picks a different chord).
  'quickAsk:getShortcut': {
    req: z.null(),
    res: z.object({
      accelerator: z.string(),
      registered: z.boolean(),
      isDefault: z.boolean(),
    }),
  },
  // Settings → main: rebind the global chord (null = reset to default).
  // Main registers the NEW chord before releasing the old one — a rejected
  // rebind (invalid, system-reserved, or taken by another app) leaves the
  // old binding untouched and comes back ok:false with a human-readable
  // reason for the recorder to show inline.
  'quickAsk:setShortcut': {
    req: z.object({ accelerator: z.string().nullable() }),
    res: z.object({
      ok: z.boolean(),
      accelerator: z.string(),
      registered: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  // Settings → main: the shortcut-recorder modal is capturing keys. While
  // active, main releases the current global chord so pressing it lands in
  // the modal (as keys to display) instead of summoning the quick-ask bar
  // over the recorder. Re-registered when capture ends.
  'quickAsk:setShortcutCaptureActive': {
    req: z.object({ active: z.boolean() }),
    res: z.object({}),
  },
  // Push: main → every window after a successful rebind (or a boot-time
  // registration failure), so the tray tooltip, toast copy, and the bar's
  // hold-to-talk chord detection all follow the one source of truth.
  'quick-ask:shortcut-changed': {
    req: z.object({ accelerator: z.string(), registered: z.boolean() }),
    res: z.null(),
  },
  // --- Theme, across windows ---
  // The setting itself lives in the renderer's localStorage, which every
  // window already shares (one origin, one Electron session), so a freshly
  // loaded utility window paints the right skin with no round trip. These
  // channels carry only the *changes*: utility windows have no ThemeProvider,
  // and a localStorage write in the app window raises no cross-window event
  // they can rely on, so the app window tells main and main tells them.
  // The raw setting travels, not the resolved one — 'system' must resolve
  // per window, against that window's own matchMedia.
  // App window → main, on mount and on every change.
  'theme:set': {
    req: z.object({ theme: z.enum(['light', 'dark', 'system']) }),
    res: z.object({}),
  },
  // Push: main → every OTHER window.
  'theme:changed': {
    req: z.object({ theme: z.enum(['light', 'dark', 'system']) }),
    res: z.null(),
  },
  // --- Ambient meeting detection popup (own always-on-top window) ---
  // Main → popup: the detection to display.
  'meetingDetect:payload': {
    req: z.object({
      title: z.string(),
      message: z.string(),
      // Calendar-linked detections render a solid accent bar; ad-hoc ones a
      // dashed one (Granola's affordance).
      hasCalendarEvent: z.boolean(),
    }),
    res: z.null(),
  },
  // Popup → main: fetch the payload (the push can race listener registration).
  'meetingDetect:getPayload': {
    req: z.null(),
    res: z.object({
      payload: z
        .object({
          title: z.string(),
          message: z.string(),
          hasCalendarEvent: z.boolean(),
        })
        .nullable(),
    }),
  },
  // Popup → main: user clicked a button.
  'meetingDetect:action': {
    req: z.object({
      action: z.enum(['take-notes', 'dismiss']),
    }),
    res: z.object({}),
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
      // The repo coding work defaults into when none is named — set once in
      // Settings → Code. With exactly one registered project, that project
      // is the implicit default and this stays unset.
      defaultProjectId: z.string().optional(),
    }),
  },
  'codeMode:setConfig': {
    req: z.object({
      enabled: z.boolean(),
      approvalPolicy: ApprovalPolicy.optional(),
      defaultProjectId: z.string().optional(),
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
      claude: z.object({
        installed: z.boolean(),
        signedIn: z.boolean(),
        // Who is signed in, when detectable: email plus the subscription tier
        // ("max", "pro", "enterprise" for Claude; "plus", "go", … for Codex).
        account: z.object({ email: z.string().optional(), plan: z.string().optional() }).optional(),
      }),
      codex: z.object({
        installed: z.boolean(),
        signedIn: z.boolean(),
        account: z.object({ email: z.string().optional(), plan: z.string().optional() }).optional(),
      }),
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
      // Only an explicit user choice; a quick-created session omits it and
      // follows the composer chip / global setting ("Auto").
      policy: ApprovalPolicy.optional(),
      isolation: z.enum(['in-repo', 'worktree']),
      // The coding agent's own model + reasoning effort (ACP engine),
      // re-applied each turn so they stay editable. The copilot LLM is
      // whatever the chat composer picks — same as any other chat.
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
      patch: CodeSession.pick({ title: true, policy: true, agent: true, agentModel: true, agentEffort: true }).partial(),
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
  // Done is a flag, not a lifecycle change: the worktree, branch and chat are
  // untouched. `done: false` reopens.
  'codeSession:setDone': {
    req: z.object({ sessionId: z.string(), done: z.boolean() }),
    res: z.object({ session: CodeSession }),
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
  // ── Caffeinate (keep system awake, like macOS `caffeinate`) ──
  'power:getCaffeinate': {
    req: z.null(),
    res: z.object({ enabled: z.boolean() }),
  },
  'power:setCaffeinate': {
    req: z.object({ enabled: z.boolean() }),
    res: z.object({ enabled: z.boolean() }),
  },
  // Push: main → renderer when caffeinate state changes, so indicators stay live.
  'power:caffeinateChanged': {
    req: z.object({ enabled: z.boolean() }),
    res: z.null(),
  },
  // ── Mobile channels (WhatsApp / Telegram bridge) ─────────────
  'channels:getConfig': {
    req: z.null(),
    res: ChannelsConfig,
  },
  'channels:setConfig': {
    req: ChannelsConfig,
    res: z.object({ success: z.literal(true) }),
  },
  'channels:getStatus': {
    req: z.null(),
    res: ChannelsStatus,
  },
  'channels:whatsappLogout': {
    req: z.null(),
    res: z.object({ success: z.literal(true) }),
  },
  // Push: main → renderer status updates (QR rotation, connect/disconnect).
  'channels:status': {
    req: ChannelsStatus,
    res: z.null(),
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
  // Rowboat Apps (spec §13) — M1 local channels.
  'apps:serverStatus': {
    req: z.object({}),
    res: z.object({
      running: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'apps:list': {
    req: z.object({}),
    res: z.object({
      serverRunning: z.boolean(),
      serverError: z.string().optional(),
      apps: z.array(AppSummarySchema),
    }),
  },
  'apps:get': {
    req: z.object({ folder: z.string() }),
    res: z.object({
      app: AppSummarySchema,
      readme: z.string().optional(),
      rollbackAvailable: z.boolean(),
    }),
  },
  'apps:create': {
    req: z.object({ folder: z.string(), name: z.string(), description: z.string() }),
    res: z.object({ app: AppSummarySchema }),
  },
  'apps:delete': {
    req: z.object({ folder: z.string() }),
    res: z.object({ ok: z.literal(true) }),
  },
  'apps:setTheme': {
    req: z.object({ theme: z.enum(['light', 'dark']) }),
    res: z.object({ ok: z.literal(true) }),
  },
  // Catalog + install/update (spec §12–13).
  'apps:catalogIndex': {
    req: z.object({ force: z.boolean().optional() }),
    res: z.object({ records: z.array(RegistryRecordSchema), stale: z.boolean(), fetchedAt: z.string() }),
  },
  'apps:catalogSearch': {
    req: z.object({ query: z.string() }),
    res: z.object({ records: z.array(RegistryRecordSchema) }),
  },
  // GitHub star counts (catalog ranking) + the signed-in user's starred set.
  'apps:catalogStars': {
    req: z.object({ repos: z.array(z.string()) }),
    res: z.object({
      stars: z.record(z.string(), z.number()),
      starred: z.record(z.string(), z.boolean()),
    }),
  },
  'apps:star': {
    req: z.object({ repo: z.string(), star: z.boolean() }),
    res: z.object({ starred: z.boolean() }),
  },
  'apps:catalogDetail': {
    req: z.object({ name: z.string() }),
    res: z.object({
      record: RegistryRecordSchema,
      manifest: RowboatAppManifestSchema.optional(),
      readme: z.string().optional(),
      installedFolder: z.string().optional(),
    }),
  },
  'apps:install': {
    req: z.object({ name: z.string(), confirmed: z.boolean().optional() }),
    res: z.object({
      status: z.enum(['preview', 'installed']),
      name: z.string().optional(),
      version: z.string().optional(),
      description: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      agents: z.array(z.string()).optional(),
      app: AppSummarySchema.optional(),
    }),
  },
  'apps:installFromUrl': {
    req: z.object({ url: z.string(), confirmed: z.boolean() }),
    res: z.object({
      status: z.enum(['preview', 'installed']),
      name: z.string().optional(),
      version: z.string().optional(),
      description: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      agents: z.array(z.string()).optional(),
      updateSource: z.enum(['github', 'none']).optional(),
      app: AppSummarySchema.optional(),
    }),
  },
  'apps:uninstall': {
    req: z.object({ folder: z.string() }),
    res: z.object({ ok: z.literal(true) }),
  },
  'apps:checkUpdate': {
    req: z.object({ folder: z.string() }),
    res: z.object({ current: z.string(), latest: z.string(), updateAvailable: z.boolean() }),
  },
  'apps:update': {
    req: z.object({
      folder: z.string(),
      confirmOverwriteModified: z.boolean().optional(),
      confirmNewCapabilities: z.boolean().optional(),
    }),
    res: z.object({ app: AppSummarySchema }),
  },
  'apps:rollback': {
    req: z.object({ folder: z.string() }),
    res: z.object({ app: AppSummarySchema }),
  },
  // Advisory progress pushes for long-running app operations (§13).
  'apps:progress': {
    req: z.object({ folder: z.string(), step: z.string(), detail: z.string().optional() }),
    res: z.null(),
  },
  'apps:publish': {
    req: z.object({ folder: z.string() }),
    res: z.object({
      status: z.enum(['published', 'pending']),
      repoUrl: z.string(),
      releaseUrl: z.string(),
      prUrl: z.string().optional(),
    }),
  },
  'apps:publishUpdate': {
    req: z.object({ folder: z.string(), increment: z.enum(['patch', 'minor', 'major']) }),
    res: z.object({ version: z.string(), releaseUrl: z.string() }),
  },
  'apps:registerExisting': {
    req: z.object({ name: z.string(), repo: z.string() }),
    res: z.object({ status: z.enum(['published', 'pending']), prUrl: z.string() }),
  },
  // GitHub auth (device flow) — required only for publishing apps (spec §10).
  'githubAuth:start': {
    req: z.object({}),
    res: z.object({ userCode: z.string(), verificationUri: z.string(), expiresIn: z.number() }),
  },
  'githubAuth:poll': {
    req: z.object({}),
    res: z.object({
      status: z.enum(['pending', 'authorized', 'expired', 'denied']),
      login: z.string().optional(),
    }),
  },
  'githubAuth:status': {
    req: z.object({}),
    res: z.object({ signedIn: z.boolean(), login: z.string().optional() }),
  },
  'githubAuth:signOut': {
    req: z.object({}),
    res: z.object({ ok: z.literal(true) }),
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
  // Spreadsheet viewer: windowed read of a local .xlsx/.xls/.csv/.tsv file
  'spreadsheet:load': {
    req: z.object({
      path: z.string(),
      sheet: z.string().optional(),
      offset: z.number().int().min(0),
      limit: z.number().int().min(1).max(1000),
    }),
    res: z.object({
      format: z.enum(['xlsx', 'xls', 'csv', 'tsv']),
      sheets: z.array(z.object({
        name: z.string(),
        rowCount: z.number(),
        columnCount: z.number(),
      })),
      activeSheet: z.string(),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      // Formatted text per cell (dates/currency/percent as Excel shows them)
      display: z.array(z.array(z.string().nullable())),
      // Row 1 of the sheet, for the viewer's pinned-header mode
      firstRow: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
      firstRowDisplay: z.array(z.string().nullable()).nullable(),
      offset: z.number(),
      totalRows: z.number(),
      totalColumns: z.number(),
      etag: z.string(),
    }),
  },
  // Spreadsheet viewer: locate cells matching a query in one sheet
  'spreadsheet:find': {
    req: z.object({
      path: z.string(),
      sheet: z.string().optional(),
      query: z.string(),
      maxMatches: z.number().int().min(1).max(5000).optional(),
    }),
    res: z.object({
      activeSheet: z.string(),
      matches: z.array(z.object({ row: z.number(), col: z.number() })),
      total: z.number(),
    }),
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
  // Streaming TTS: main starts the synthesis and pushes audio chunks over
  // 'voice:tts-chunk' as they arrive, so playback can begin on the first
  // chunk instead of after the full body (~0.5-1s earlier first-audio).
  'voice:synthesizeStreamStart': {
    req: z.object({
      requestId: z.string(),
      text: z.string(),
    }),
    res: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'voice:synthesizeStreamCancel': {
    req: z.object({ requestId: z.string() }),
    res: z.object({}),
  },
  // Push channel: main → renderer with streaming TTS audio. `done: true`
  // (possibly with a final chunk) ends the stream; `error` aborts it.
  'voice:tts-chunk': {
    req: z.object({
      requestId: z.string(),
      chunkBase64: z.string().optional(),
      done: z.boolean(),
      error: z.string().optional(),
    }),
    res: z.null(),
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
  // Same as ensureMicAccess but for the camera — settles the macOS TCC
  // permission before video mode calls getUserMedia({ video: true }).
  'voice:ensureCameraAccess': {
    req: z.null(),
    res: z.object({
      granted: z.boolean(),
    }),
  },
  // Video-mode popout: show/hide the small always-on-top window (user +
  // mascot tiles) that floats over everything for the duration of a screen
  // share, Meet-style.
  'video:setPopout': {
    req: z.object({ show: z.boolean() }),
    res: z.object({}),
  },
  // Main-window renderer pushes the current call state; the main process
  // caches it and relays to the popout window (replayed on popout load).
  'video:popoutState': {
    req: z.object({
      ttsState: z.enum(['idle', 'synthesizing', 'speaking']),
      status: z.enum(['idle', 'listening', 'thinking', 'speaking']).nullable(),
      cameraOn: z.boolean(),
      // User mute: mic audio and frame capture are both paused.
      micMuted: z.boolean(),
      screenSharing: z.boolean(),
      // Output mute: replies are not spoken while set (input mute is micMuted).
      speakerMuted: z.boolean(),
      // High-level "what's happening" while a turn runs ("Searching the
      // web…", "Reasoning…") — tool NAMES only, never arguments.
      activityText: z.string().nullable(),
      // Live transcript of the in-progress utterance.
      interimText: z.string().nullable(),
      // A quick ⌘ tap locked hands-free capture (until the next tap).
      pttLocked: z.boolean(),
      // Latest assistant reply of this call (streaming) — readable in the
      // pill's response panel without switching back to the app.
      responseText: z.string().nullable(),
      questionText: z.string().nullable(),
    }),
    res: z.object({}),
  },
  // Main-window renderer → main: a batch of recording-waveform amplitudes
  // (the voice hook's auto-gained per-frame levels, ~16/s) for the
  // companion's recording bar. Relayed, never cached — a waveform is only
  // meaningful live. (Audio itself can't cross windows; a few numbers a
  // second can.)
  'video:popoutLevels': {
    req: z.object({ levels: z.array(z.number()) }),
    res: z.object({}),
  },
  // Popout → main: grow/shrink the pill window as the response panel
  // opens/closes (height clamped in main).
  'video:popoutResize': {
    req: z.object({ height: z.number() }),
    res: z.object({}),
  },
  // Popout window → fetch the latest cached call state on mount. The
  // did-finish-load replay can race the React listener registration, and the
  // popout must never guess (a wrong camera-on default flashes the user's
  // video before the first state push corrects it).
  'video:getPopoutState': {
    req: z.null(),
    res: z.object({
      state: z
        .object({
          ttsState: z.enum(['idle', 'synthesizing', 'speaking']),
          status: z.enum(['idle', 'listening', 'thinking', 'speaking']).nullable(),
          cameraOn: z.boolean(),
          micMuted: z.boolean(),
          screenSharing: z.boolean(),
          speakerMuted: z.boolean(),
          activityText: z.string().nullable(),
          interimText: z.string().nullable(),
          pttLocked: z.boolean(),
          responseText: z.string().nullable(),
          questionText: z.string().nullable(),
        })
        .nullable(),
    }),
  },
  // Popout control bar → main process → relayed to the app window, which
  // executes the action on the live call. 'expand' additionally focuses the
  // main app window (handled in the main process). 'ptt-down'/'ptt-up' are
  // the on-screen talk button's press/release edges; 'ptt-cancel' discards
  // an open capture without sending (the composer recording bar's ✕).
  'video:popoutAction': {
    req: z.object({
      action: z.enum(['toggle-mic', 'toggle-camera', 'toggle-share', 'toggle-speaker', 'stop-speaking', 'ptt-down', 'ptt-up', 'ptt-cancel', 'end-call', 'expand']),
    }),
    res: z.object({}),
  },
  // Push channel: main → popout window with the latest call state.
  'video:popout-state': {
    req: z.object({
      ttsState: z.enum(['idle', 'synthesizing', 'speaking']),
      status: z.enum(['idle', 'listening', 'thinking', 'speaking']).nullable(),
      cameraOn: z.boolean(),
      micMuted: z.boolean(),
      screenSharing: z.boolean(),
      // Output mute: replies are not spoken while set (input mute is micMuted).
      speakerMuted: z.boolean(),
      // High-level "what's happening" while a turn runs ("Searching the
      // web…", "Reasoning…") — tool NAMES only, never arguments.
      activityText: z.string().nullable(),
      interimText: z.string().nullable(),
      pttLocked: z.boolean(),
      responseText: z.string().nullable(),
      questionText: z.string().nullable(),
    }),
    res: z.null(),
  },
  // Push channel: main → companion with a recording-waveform level batch.
  'video:popout-levels': {
    req: z.object({ levels: z.array(z.number()) }),
    res: z.null(),
  },
  // Push channel: main → app window with a popout control-bar action.
  'video:popout-action': {
    req: z.object({
      action: z.enum(['toggle-mic', 'toggle-camera', 'toggle-share', 'toggle-speaker', 'stop-speaking', 'ptt-down', 'ptt-up', 'ptt-cancel', 'end-call', 'expand']),
    }),
    res: z.null(),
  },
  // Renderer → main: whether a screen share (call or quick-ask) is currently
  // live. Gates the assistant's screen-pointer tool — pointing at a screen
  // the user isn't sharing would be pure confusion — and tears the pointer
  // overlay down the moment the share ends.
  'screenPointer:setShareActive': {
    req: z.object({ active: z.boolean() }),
    res: z.object({}),
  },
  // Push channel: main → pointer-overlay window with the current pointer
  // state. `nonce` re-triggers the ping animation when the assistant points
  // twice at the same spot; coordinates are fractions of the display.
  'screen-pointer:state': {
    req: z.object({
      visible: z.boolean(),
      x: z.number(),
      y: z.number(),
      label: z.string().nullable(),
      nonce: z.number(),
    }),
    res: z.null(),
  },
  // Overlay window → fetch the current pointer state on mount. Same race as
  // video:getPopoutState: the did-finish-load replay can fire before the
  // React listener registers, and a missed push means an invisible pointer.
  'screenPointer:getState': {
    req: z.null(),
    res: z.object({
      state: z
        .object({
          visible: z.boolean(),
          x: z.number(),
          y: z.number(),
          label: z.string().nullable(),
          nonce: z.number(),
        })
        .nullable(),
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
  // Resolve a meeting's attendees against the knowledge base — returns each
  // attendee's existing person note (or null). Deterministic, no LLM; powers
  // the ambient "Next up" prep card.
  'meeting-prep:resolve': {
    req: z.object({
      attendees: z.array(z.object({
        email: z.string().optional(),
        displayName: z.string().optional(),
        self: z.boolean().optional(),
      })),
      // When provided, the response includes any pre-generated prep note for
      // this calendar event (matched by the eventId stamped in frontmatter).
      eventId: z.string().optional(),
    }),
    res: z.object({
      attendees: z.array(z.object({
        label: z.string(),
        email: z.string().optional(),
        displayName: z.string().optional(),
        note: z.object({
          path: z.string(),
          name: z.string(),
          role: z.string().optional(),
          organization: z.string().optional(),
          markdown: z.string(),
        }).nullable(),
      })),
      organizations: z.array(z.object({
        path: z.string(),
        name: z.string(),
        markdown: z.string(),
      })),
      // The pre-generated prep note (brief + path), if one exists for eventId.
      prepNote: z.object({
        path: z.string(),
        brief: z.string(),
      }).nullable(),
      matchedCount: z.number().int().nonnegative(),
      unmatchedCount: z.number().int().nonnegative(),
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
  // Todo (home to-do list) channels
  'todo:get': {
    req: z.null(),
    res: z.object({
      list: TodoListSchema,
      // Keys of items with a run currently in flight — ephemeral state, never
      // in the file; the renderer overlays spinners from this + todo:events.
      running: z.array(z.string()),
      // Item key → sessionId for items whose thread exists; "open in chat"
      // binds the chat dock to that session.
      sessions: z.record(z.string(), z.string()),
      // Pending planner suggestions (todo/suggestions.md) — accepted onto
      // the list or declined, never auto-added.
      suggestions: z.array(z.string()),
    }),
  },
  // Full-model save from the renderer. Core re-normalizes keys and merges
  // against disk so receipts that landed after the renderer's last read
  // survive stale saves.
  'todo:save': {
    req: z.object({
      list: TodoListSchema,
    }),
    res: z.object({
      success: z.boolean(),
      list: TodoListSchema.optional(),
      error: z.string().optional(),
    }),
  },
  'todo:addItem': {
    req: z.object({
      text: z.string(),
      // Fire the item's run immediately (composer delegate / @rowboat typed).
      run: z.boolean(),
      // Files given at creation — copied into todo/attachments and linked
      // on the item's line.
      attachments: z.array(z.object({
        path: z.string(),
        name: z.string(),
      })).optional(),
      // Composer model selection (with its paired reasoning effort) —
      // overrides the todo agent's model when the item runs now.
      model: z.object({
        provider: z.string(),
        model: z.string(),
        effort: z.enum(['low', 'medium', 'high']).optional(),
      }).optional(),
      // Chat-parity permission posture for the run: 'auto' (default) uses
      // the permission judge; 'manual' suspends for the user's approval.
      permissionMode: z.enum(['auto', 'manual']).optional(),
      // Code dispatch (the Helm): materialize a real code session on the
      // item's thread before it runs — worktree lane by default, a row in
      // the Code section, status tracking. The agent's code_agent_run then
      // resolves the pin server-side.
      code: z.object({
        projectId: z.string(),
        agent: z.enum(['claude', 'codex']).optional(),
        isolation: z.enum(['in-repo', 'worktree']).optional(),
      }).optional(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Fire a run for one item, identified by its normalized line text.
  // Fire-and-forget: progress and completion arrive on todo:events.
  // Carries the same model/permission overrides as todo:addItem so the run
  // and retry chips honor the composer's picker instead of silently falling
  // back to the default model.
  'todo:runItem': {
    req: z.object({
      key: z.string(),
      context: z.string().optional(),
      model: z.object({
        provider: z.string(),
        model: z.string(),
        effort: z.enum(['low', 'medium', 'high']).optional(),
      }).optional(),
      permissionMode: z.enum(['auto', 'manual']).optional(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Stop the live run on one item (or `chat:<sessionId>` thread) — the
  // mistaken-assign escape hatch. The cancelled turn settles as 'Stopped'
  // on todo:events, which clears the spinner.
  'todo:stopRun': {
    req: z.object({
      key: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Home-stream chat threads: a plain message from the home composer starts
  // a copilot session; replies continue it. Events ride todo:events keyed
  // `chat:<sessionId>`.
  'todo:startChat': {
    req: z.object({
      text: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      sessionId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'todo:chatReply': {
    req: z.object({
      sessionId: z.string(),
      message: z.string(),
      attachments: z.array(z.object({
        path: z.string(),
        name: z.string(),
      })).optional(),
      model: z.object({
        provider: z.string(),
        model: z.string(),
        effort: z.enum(['low', 'medium', 'high']).optional(),
      }).optional(),
      // Chat-parity permission posture for the run: 'auto' (default) uses
      // the permission judge; 'manual' suspends for the user's approval.
      permissionMode: z.enum(['auto', 'manual']).optional(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // The compact bubble lens over any session (stream threads).
  'todo:getSessionConversation': {
    req: z.object({
      sessionId: z.string(),
    }),
    res: z.object({
      bubbles: z.array(TodoChatBubbleSchema),
    }),
  },
  // Add a sub-item under an existing top-level item (one level only).
  'todo:addSubItem': {
    req: z.object({
      parentKey: z.string(),
      text: z.string(),
      run: z.boolean(),
      attachments: z.array(z.object({
        path: z.string(),
        name: z.string(),
      })).optional(),
      model: z.object({
        provider: z.string(),
        model: z.string(),
        effort: z.enum(['low', 'medium', 'high']).optional(),
      }).optional(),
      // Chat-parity permission posture for the run: 'auto' (default) uses
      // the permission judge; 'manual' suspends for the user's approval.
      permissionMode: z.enum(['auto', 'manual']).optional(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Compact conversation view of an item's session: each turn's user message
  // and the agent's final reply (with todo-report links). Derived, not stored.
  'todo:getConversation': {
    req: z.object({
      key: z.string(),
    }),
    res: z.object({
      sessionId: z.string().nullable(),
      bubbles: z.array(TodoChatBubbleSchema),
    }),
  },
  // Inline comment on an item — the next user message in its session
  // (answers a pending ask-human question when one is waiting). Reopens a
  // checked item. Fire-and-forget like todo:runItem.
  'todo:comment': {
    req: z.object({
      key: z.string(),
      message: z.string(),
      attachments: z.array(z.object({
        path: z.string(),
        name: z.string(),
      })).optional(),
      model: z.object({
        provider: z.string(),
        model: z.string(),
        effort: z.enum(['low', 'medium', 'high']).optional(),
      }).optional(),
      // Chat-parity permission posture for the run: 'auto' (default) uses
      // the permission judge; 'manual' suspends for the user's approval.
      permissionMode: z.enum(['auto', 'manual']).optional(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Archive checked items (receipts intact) to todo/archive/<YYYY-MM>.md.
  'todo:clearCompleted': {
    req: z.null(),
    res: z.object({
      success: z.boolean(),
      archived: z.number().optional(),
      error: z.string().optional(),
    }),
  },
  // Dismiss = move to the archive (never delete); restorable from the
  // "Done & dismissed" section. wasProposed lets the renderer offer the
  // "don't suggest things like this" teaching affordance.
  'todo:dismiss': {
    req: z.object({
      key: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      wasProposed: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },
  // Accept a pending suggestion: it leaves the tray and joins the list
  // (with its via-rowboat badge); recorded as a positive 'kept' signal.
  'todo:acceptSuggestion': {
    req: z.object({
      text: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Decline a pending suggestion: leaves the tray, recorded as 'dismissed'.
  'todo:declineSuggestion': {
    req: z.object({
      text: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // The planner's Home-surface controls: on/off + frequency presets.
  'todo:getPlanner': {
    req: z.null(),
    res: z.object({
      slug: z.string().nullable(),
      active: z.boolean(),
      frequency: z.enum(['morning', 'twice', 'thrice']),
    }),
  },
  'todo:setPlanner': {
    req: z.object({
      active: z.boolean().optional(),
      frequency: z.enum(['morning', 'twice', 'thrice']).optional(),
    }),
    res: z.object({
      slug: z.string().nullable(),
      active: z.boolean(),
      frequency: z.enum(['morning', 'twice', 'thrice']),
    }),
  },
  // "Don't suggest things like this" — writes a rule into the Your-rules
  // section of todo/preferences.md and records the signal.
  'todo:teach': {
    req: z.object({
      text: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Recent archived items (done + dismissed), newest first.
  'todo:listArchived': {
    req: z.null(),
    res: z.object({
      items: z.array(z.object({
        month: z.string(),
        blockIndex: z.number(),
        date: z.string().nullable(),
        item: TodoItemSchema,
      })),
    }),
  },
  // Permanently delete an archived item — the one true delete, only
  // reachable from the archive. Same handle contract as todo:restore.
  'todo:deleteArchived': {
    req: z.object({
      month: z.string(),
      blockIndex: z.number(),
      key: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  // Bring an archived item back onto the list (unchecked). The
  // (month, blockIndex) handle comes from todo:listArchived; key guards
  // against staleness.
  'todo:restore': {
    req: z.object({
      month: z.string(),
      blockIndex: z.number(),
      key: z.string(),
    }),
    res: z.object({
      success: z.boolean(),
      error: z.string().optional(),
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
  // HTTP basic/proxy auth challenge from a page in the embedded browser
  // (main → renderer push). The renderer shows a credential prompt and
  // answers via browser:httpAuthResponse.
  'browser:httpAuthRequest': {
    req: HttpAuthRequestSchema,
    res: z.null(),
  },
  // Main → renderer: a pending auth challenge was resolved without the
  // renderer answering (timed out, or its tab/window was destroyed), so the
  // renderer must drop the corresponding dialog from its queue.
  'browser:httpAuthResolved': {
    req: z.object({ requestId: z.string() }),
    res: z.null(),
  },
  // Renderer → main. Omit username to cancel the challenge; provide it (even
  // empty, for token-style auth) to submit credentials.
  'browser:httpAuthResponse': {
    req: z.object({
      requestId: z.string(),
      username: z.string().optional(),
      password: z.string().optional(),
    }),
    res: z.object({ ok: z.boolean() }),
  },
  // Screen-share picker for pages calling getDisplayMedia() in the embedded
  // browser (main → renderer push). The renderer shows a source picker and
  // answers via browser:displayMediaResponse.
  'browser:displayMediaRequest': {
    req: DisplayMediaRequestSchema,
    res: z.null(),
  },
  // Main → renderer: a pending display-media request was resolved without the
  // renderer answering (timed out, or the window went away), so the renderer
  // must drop the corresponding picker dialog.
  'browser:displayMediaResolved': {
    req: z.object({ requestId: z.string() }),
    res: z.null(),
  },
  // Renderer → main. Omit sourceId to cancel the request; `audio` asks for
  // system-audio loopback alongside the shared screen.
  'browser:displayMediaResponse': {
    req: z.object({
      requestId: z.string(),
      sourceId: z.string().optional(),
      audio: z.boolean().optional(),
    }),
    res: z.object({ ok: z.boolean() }),
  },
  // Billing channels
  'billing:getInfo': {
    req: z.null(),
    res: BillingInfoSchema,
  },
  // First-time-action credit rewards (see shared/src/credits.ts)
  'credits:getState': {
    req: z.null(),
    res: CreditsStateSchema,
  },
  // Main → renderer: the backend confirmed a credit grant. All activation
  // triggers live in main/core (oauth success, gmail send, meeting summarize,
  // bg-task create, app create); the renderer only listens and celebrates.
  'credits:didActivate': {
    req: CreditActivatedEventSchema,
    res: z.null(),
  },
  // Redeem another user's invite (referral) code — both sides earn credits.
  'referral:claim': {
    req: z.object({ code: z.string() }),
    res: ReferralClaimResultSchema,
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
  // Model-call limit settings channels
  'turnLimits:getSettings': {
    req: z.null(),
    res: TurnLimitsSettingsSchema,
  },
  'turnLimits:setSettings': {
    req: TurnLimitsSettingsSchema,
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Storage retention (auto-delete old chats & task transcripts)
  'retention:getSettings': {
    req: z.null(),
    res: RetentionSettingsSchema,
  },
  'retention:setSettings': {
    req: RetentionSettingsUpdateSchema,
    res: z.object({
      success: z.literal(true),
    }),
  },
  // One-time first-run notice: returns { show: true } exactly once (when
  // retention is enabled and the notice hasn't been shown), marking it shown.
  // Same pull-on-boot pattern as app:consumeUpdateInfo.
  'retention:consumeFirstRunNotice': {
    req: z.null(),
    res: z.object({
      show: z.boolean(),
      chatDays: z.number().nullable(),
    }),
  },
  // Rowboat server (phone pairing) channels — client-local: answered by main,
  // which hosts the HTTP/WS transport for external clients.
  'server:getPairingInfo': {
    req: z.null(),
    res: z.object({
      running: z.boolean(),
      // Hostname shown on the phone during pairing.
      name: z.string(),
      port: z.number().nullable(),
      lanEnabled: z.boolean(),
      // Reachable base URLs, loopback first; LAN/Tailscale entries only when
      // lanEnabled.
      urls: z.array(z.string()),
      token: z.string().nullable(),
    }),
  },
  'server:setLanEnabled': {
    req: z.object({ enabled: z.boolean() }),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Mints a new server key and rebinds — every paired phone is revoked and
  // must re-pair. This is the recovery path for a leaked QR/token.
  'server:rotateKey': {
    req: z.null(),
    res: z.object({
      success: z.literal(true),
    }),
  },
  // Remote-server connection (client-local, never forwarded): where this
  // desktop's client points — the local child by default, or a remote
  // rowboat-server saved from Settings. Env vars override and lock the UI.
  'server:getConnection': {
    req: z.null(),
    res: z.object({
      mode: z.enum(['in-process', 'child', 'remote']),
      url: z.string().nullable(),
      fromEnv: z.boolean(),
    }),
  },
  'server:connectRemote': {
    req: z.object({ url: z.string(), token: z.string() }),
    res: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  'server:disconnectRemote': {
    req: z.null(),
    res: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  // OAuth loopback relay (Phase 8b): a loopback-capable client hosting the
  // 127.0.0.1 callback listener for a remote server ships each callback hit
  // here; the response says which page to render in the browser tab. Called
  // by the client's relay listener, never by the renderer.
  'oauth:deliverLoopbackCallback': {
    req: z.object({
      bindingId: z.string(),
      url: z.string(),
    }),
    res: z.object({
      accepted: z.boolean(),
      message: z.string().optional(),
    }),
  },

  // ==========================================================================
  // Spaces — shared containers on orgs speaking the spaces protocol.
  // Wire contract: @rowboat/spaces-protocol (apps/harbor/CONTRACT.md).
  // Protocol-shaped payloads cross as z.custom<T>() (see spaces.ts header).
  // ==========================================================================
  'spaces:listOrgs': {
    req: z.null(),
    res: z.object({ orgs: z.array(SpacesOrgSummary) }),
  },
  // Dev auth (stub Harbor / Tailscale dogfood): base URL + member id.
  'spaces:addOrg': {
    req: z.object({ baseUrl: z.string(), memberId: z.string() }),
    res: z.object({ org: SpacesOrgSummary }),
  },
  // The OAuth journey (spec §4). Paste an invite link → resolve pre-auth →
  // join (system-browser dance if this install has no auth on the org, then
  // the server-side bind ceremony). signInOrg reruns the dance for a
  // needs-relogin org. policy_refused / not_a_member surface as error
  // messages verbatim — they are the honest states.
  'spaces:resolveInviteLink': {
    req: z.object({ url: z.string() }),
    res: z.object({ baseUrl: z.string(), resolved: z.custom<SpacesTypes.ResolveInviteResult>() }),
  },
  'spaces:joinInvite': {
    req: z.object({ url: z.string() }),
    res: z.object({ org: SpacesOrgSummary, space: z.custom<SpacesTypes.Space>() }),
  },
  'spaces:signInOrg': {
    req: z.object({ orgId: z.string() }),
    res: z.object({ org: SpacesOrgSummary }),
  },
  // Self-serve org creation on the managed deployment's apex (free for now —
  // billing/limits parked by decision 2026-08-20). Browser sign-in, then the
  // caller is the org's first admin at <slug>.spaces.rowboatlabs.com.
  'spaces:createOrg': {
    req: z.object({ name: z.string(), slug: z.string() }),
    res: z.object({ org: SpacesOrgSummary }),
  },
  // Where the Create button makes orgs (from /v1/config via core). null =
  // no spaces fleet for this environment; the dialog says so honestly.
  'spaces:apexInfo': {
    req: z.null(),
    res: z.object({ apexDomain: z.string().nullable() }),
  },
  'spaces:removeOrg': {
    req: z.object({ orgId: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  'spaces:listSpaces': {
    req: z.object({ orgId: z.string() }),
    res: z.object({ spaces: z.array(z.custom<SpacesTypes.Space>()) }),
  },
  'spaces:createSpace': {
    req: z.object({ orgId: z.string(), name: z.string() }),
    res: z.object({ space: z.custom<SpacesTypes.Space>() }),
  },
  'spaces:listMembers': {
    req: z.object({ orgId: z.string(), spaceId: z.string() }),
    res: z.object({ members: z.array(z.custom<SpacesTypes.Member>()) }),
  },
  'spaces:createInvite': {
    req: z.object({ orgId: z.string(), spaceId: z.string(), expiresInHours: z.number().optional() }),
    res: z.custom<SpacesTypes.CreateInviteResult>(),
  },
  // Pre-auth by design (spec §4): resolvable before the org has been added,
  // so the app can show what's being joined. baseUrl, not orgId.
  'spaces:resolveInvite': {
    req: z.object({ baseUrl: z.string(), token: z.string() }),
    res: z.custom<SpacesTypes.ResolveInviteResult>(),
  },
  'spaces:acceptInvite': {
    req: z.object({ orgId: z.string(), token: z.string() }),
    res: z.custom<SpacesTypes.AcceptInviteResult>(),
  },
  'spaces:listAssets': {
    req: z.object({ orgId: z.string(), spaceId: z.string(), includeDeleted: z.boolean().optional() }),
    res: z.object({ entries: z.array(z.custom<SpacesAssetEntry>()) }),
  },
  // Namespace ops (inode model server-side): move/rename, delete-to-trash,
  // restore. Conflict outcomes return as values, same as proposeChange.
  'spaces:moveAsset': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      fromPath: z.string(),
      toPath: z.string(),
      baseVersion: z.number(),
      reason: z.string().optional(),
    }),
    res: z.custom<SpacesTypes.MoveAssetResult>(),
  },
  'spaces:deleteAsset': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      path: z.string(),
      baseVersion: z.number(),
      reason: z.string().optional(),
    }),
    res: z.custom<SpacesTypes.DeleteAssetResult>(),
  },
  'spaces:restoreAsset': {
    req: z.object({ orgId: z.string(), spaceId: z.string(), path: z.string() }),
    res: z.custom<SpacesTypes.RestoreAssetResult>(),
  },
  'spaces:readAsset': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      path: z.string(),
      version: z.number().optional(),
    }),
    res: z.custom<SpacesTypes.ReadAssetResult>(),
  },
  // All three outcomes (applied | merged | conflict) return as values — a
  // conflict is a normal result of merge-then-correct, not an error.
  'spaces:proposeChange': {
    req: z.object({ orgId: z.string(), spaceId: z.string(), input: z.custom<SpacesProposeInput>() }),
    res: z.custom<SpacesTypes.ProposeChangeResult>(),
  },
  'spaces:assetHistory': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      path: z.string().optional(),
      beforeOffset: z.number().optional(),
      limit: z.number().optional(),
    }),
    res: z.object({ changeSets: z.array(z.custom<SpacesTypes.ChangeSet>()) }),
  },
  'spaces:diff': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      path: z.string(),
      from: z.number(),
      to: z.number(),
    }),
    res: z.object({ unified: z.string() }),
  },
  'spaces:listTopics': {
    req: z.object({ orgId: z.string(), spaceId: z.string(), includeArchived: z.boolean().optional() }),
    res: z.object({ topics: z.array(z.custom<SpacesTypes.TopicListing>()) }),
  },
  // Space search: categorized top-N (messages / topics / assets), served by
  // the org's GET /v1/spaces/:spaceId/search. Snippets arrive raw — resolve
  // mentions renderer-side like any message body.
  'spaces:search': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      q: z.string(),
      kinds: z.array(z.enum(['messages', 'topics', 'assets'])).optional(),
      /** Per-category cap (org default 10, max 50). */
      limit: z.number().optional(),
    }),
    res: z.custom<SpacesTypes.SearchResults>(),
  },
  // The space's one stream: ROOT messages only, windowed newest-first, with
  // the topic rows annotating this page's roots riding along.
  'spaces:listStream': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      /** Page back: only roots below this offset. Absent = the latest page. */
      beforeOffset: z.number().optional(),
      limit: z.number().optional(),
    }),
    res: z.custom<SpacesStreamPage>(),
  },
  // One flat thread: root + topic annotation (null = plain thread) + windowed
  // replies. A reply id resolves to its root on the org.
  'spaces:listThread': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      rootMessageId: z.string(),
      beforeOffset: z.number().optional(),
      limit: z.number().optional(),
    }),
    res: z.custom<SpacesThreadPage>(),
  },
  // actingMode is set by main ('direct' — the renderer is the human surface;
  // agents write through the org's MCP face, never through IPC). Posting never
  // creates a topic; threadRoot present = a reply, absent = a stream root.
  'spaces:postMessage': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      threadRoot: z.string().optional(),
      anchorChangeSetId: z.string().optional(),
      body: z.string(),
      /** Present = the message carries a poll; body must be its markdown fallback. */
      poll: z.custom<SpacesTypes.SpacesNewPollInput>().optional(),
    }),
    res: z.custom<SpacesPostResult>(),
  },
  // The deliberate ceremony: promote a thread (rootMessageId) or post a new
  // root + annotate it (body) — exactly one of the two, org-enforced.
  'spaces:createTopic': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      rootMessageId: z.string().optional(),
      title: z.string(),
      body: z.string().optional(),
    }),
    res: z.object({ topic: z.custom<SpacesTypes.Topic>(), rootMessage: z.custom<SpacesTypes.Message>() }),
  },
  // One-row lifecycle ops on the annotation ('remove' = convert back to
  // thread; the conversation is untouched).
  'spaces:manageTopic': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      topicId: z.string(),
      action: z.custom<SpacesManageTopicAction>(),
    }),
    res: z.object({ topic: z.custom<SpacesTypes.Topic>() }),
  },
  // Slack-style reaction toggle — any member, any message. Idempotent on the
  // org (re-add / re-remove is a no-op); actingMode is stamped 'direct' by
  // main like postMessage. Returns the message with reactions folded.
  'spaces:reactToMessage': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      messageId: z.string(),
      emoji: z.string(),
      action: z.enum(['add', 'remove']),
    }),
    res: z.object({ message: z.custom<SpacesTypes.Message>() }),
  },
  // Author-only tombstone — the org enforces caller == author; actingMode is
  // stamped 'direct' by main. Returns the tombstone (body '', deletedAt set).
  'spaces:deleteMessage': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      messageId: z.string(),
    }),
    res: z.object({ message: z.custom<SpacesTypes.Message>() }),
  },
  // Author-only body rewrite — the org enforces caller == author; identical
  // bodies no-op. Returns the message with editedAt set.
  'spaces:editMessage': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      messageId: z.string(),
      body: z.string(),
    }),
    res: z.object({ message: z.custom<SpacesTypes.Message>() }),
  },
  // Poll vote toggle — reaction semantics on the org (idempotent; single-
  // select add MOVES the member's vote); actingMode is stamped 'direct' by
  // main, which is also the rule (agents cannot vote). Returns the message
  // with the poll's votes folded.
  'spaces:votePoll': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      messageId: z.string(),
      answerId: z.number(),
      action: z.enum(['add', 'remove']),
    }),
    res: z.object({ message: z.custom<SpacesTypes.Message>() }),
  },
  // End a poll early — author-only on the org; idempotent once closed.
  'spaces:endPoll': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      messageId: z.string(),
    }),
    res: z.object({ message: z.custom<SpacesTypes.Message>() }),
  },
  // @rowboat in a thread (spec §8): the renderer detected an addressed message
  // it just posted; main routes it into the thread's session (keyed on the
  // permanent root message id, creating one on first use — the queue/steer
  // machinery handles the rest). messageId is the posted feed message,
  // stamped into the turn input as provenance.
  'spaces:invokeRowboat': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      threadRootId: z.string(),
      threadLabel: z.string(),
      spaceName: z.string(),
      messageId: z.string(),
      body: z.string(),
      // Per-turn agent options from the space composer's agent strip (shown
      // when the draft addresses @rowboat). Absent = the assistant's defaults.
      options: z
        .object({
          model: z.object({ provider: z.string(), model: z.string(), effort: z.enum(['low', 'medium', 'high']).optional() }).optional(),
          permissionMode: z.enum(['auto', 'manual']).optional(),
          searchEnabled: z.boolean().optional(),
          codeMode: z.enum(['claude', 'codex']).optional(),
        })
        .optional(),
    }),
    res: z.object({ sessionId: z.string(), queued: z.boolean() }),
  },
  // The thread's session, if any — powers the invoker-only "open the turn"
  // affordance on the presence chip.
  'spaces:topicSession': {
    req: z.object({ orgId: z.string(), spaceId: z.string(), threadRootId: z.string() }),
    res: z.object({ sessionId: z.string().nullable() }),
  },
  // Upload phase 1 (spec §6): bytes in, {hash, size, mime} out. Bytes travel
  // either inline (clipboard pastes — ArrayBuffer over structured clone) or as
  // an absolute file path (drag-drop / picker via electronUtils.getPathForFile)
  // so a 100MB file never crosses IPC — main reads it from disk.
  'spaces:uploadBlob': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      // Base64 — bytes must survive the JSON /rpc hop to the server (a raw
      // ArrayBuffer stringifies to '{}' and uploads an empty blob).
      bytes: z.string().optional(),
      filePath: z.string().optional(),
      /** Display filename (drives the markdown label / mime fallback); never storage. */
      name: z.string(),
      mime: z.string().optional(),
    }),
    res: z.object({ blob: z.custom<SpacesTypes.BlobInfo>() }),
  },
  // Explicit download: main pulls through the content-addressed cache and
  // shows the save dialog. saved:false = the person cancelled.
  'spaces:saveBlob': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      hash: z.string(),
      suggestedName: z.string().optional(),
    }),
    res: z.object({ saved: z.boolean(), path: z.string().optional() }),
  },
  // Save an external image (a pasted GIF/image link) to disk. Main fetches
  // the URL — the renderer can't (CORS) — after the save dialog, so a
  // cancel never downloads. https only. saved:false = the person cancelled.
  'spaces:saveImageUrl': {
    req: z.object({ url: z.string() }),
    res: z.object({ saved: z.boolean(), path: z.string().optional() }),
  },
  // OpenGraph metadata for a link card. Main fetches the page — the renderer
  // can't (CORS) — with a size cap and timeout. null preview = nothing
  // usable (not html, too slow, no tags). https only.
  'spaces:linkPreview': {
    req: z.object({ url: z.string() }),
    res: z.object({
      preview: z
        .object({
          url: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          imageUrl: z.string().optional(),
          siteName: z.string().optional(),
        })
        .nullable(),
    }),
  },
  // Live: renderer subscribes per space; frames arrive on 'spaces:events'
  // wrapped with their orgId. Offset resume mirrors the turn-event spine.
  'spaces:subscribeSpace': {
    req: z.object({ orgId: z.string(), spaceId: z.string(), afterOffset: z.number().optional() }),
    res: z.object({ success: z.literal(true) }),
  },
  'spaces:unsubscribeSpace': {
    req: z.object({ orgId: z.string(), spaceId: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  // Notification levels for the mention watcher: a space-wide level plus
  // per-thread overrides. null = inherit (thread → space → the 'mentions'
  // default). Stored main-side (the watcher runs there, screen or no screen).
  // `topicId` is the thread's ROOT MESSAGE id, never a Topic row id: the
  // watcher resolves a message to `threadRoot ?? id` and looks up by that.
  'spaces:getNotifyPrefs': {
    req: z.object({ orgId: z.string(), spaceId: z.string() }),
    res: z.object({
      spaceLevel: z.enum(['all', 'mentions', 'mute']).nullable(),
      topics: z.record(z.string(), z.enum(['all', 'mentions', 'mute'])),
    }),
  },
  'spaces:setNotifyPref': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      /** Absent = set the space-wide level. */
      topicId: z.string().optional(),
      /** null clears the override back to inherit. */
      level: z.enum(['all', 'mentions', 'mute']).nullable(),
    }),
    res: z.object({ success: z.literal(true) }),
  },
  // Scheduled sends and reminders — the main-side queue (core scheduler).
  // 'message' posts to the topic at `at`; 'reminder' notifies the member.
  'spaces:schedule': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      /** The thread to post into; absent = the space's stream. */
      threadRootId: z.string().optional(),
      body: z.string(),
      /** ISO instant to fire at. */
      at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'at must be an ISO instant'),
      kind: z.enum(['message', 'reminder']),
    }),
    res: z.object({ id: z.string() }),
  },
  'spaces:listScheduled': {
    req: z.object({ orgId: z.string(), spaceId: z.string() }),
    res: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['message', 'reminder']),
          orgId: z.string(),
          spaceId: z.string(),
          /** The thread the send targets; absent = the space's stream. */
          threadRootId: z.string().optional(),
          body: z.string(),
          at: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  },
  'spaces:cancelScheduled': {
    req: z.object({ id: z.string() }),
    res: z.object({ success: z.literal(true) }),
  },
  // Do-not-disturb: one global until-instant gating the mention watcher.
  'spaces:getDnd': {
    req: z.null(),
    res: z.object({ until: z.string().nullable() }),
  },
  'spaces:setDnd': {
    req: z.object({ until: z.string().nullable() }),
    res: z.object({ success: z.literal(true) }),
  },
  // Ephemeral presence from the human surface (viewing / typing / idle), scoped
  // to a thread when set. agent_working is only ever sent by the thread agent.
  // Client wake signal: sleep leaves spaces WebSockets half-open; the desktop
  // calls this on powerMonitor resume so the server bounces every stream.
  'spaces:bounceLive': {
    req: z.null(),
    res: z.object({ success: z.literal(true) }),
  },
  'spaces:presence': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      state: z.enum(['viewing', 'typing', 'idle']),
      threadRootId: z.string().optional(),
    }),
    res: z.object({ success: z.literal(true) }),
  },
  // Ephemeral whiteboard traffic (scene diffs, cursors, idle) — fire-and-forget
  // like presence: a frame sent while the org socket is down is silently
  // dropped, and the collab loop's periodic full-scene rebroadcast heals the
  // gap. The payload is opaque to the org (contract amendment 2026-08-31);
  // its app-side vocabulary lives in shared/spaces.ts. Incoming whiteboard
  // frames arrive on 'spaces:events' like every other live frame.
  'spaces:whiteboard': {
    req: z.object({
      orgId: z.string(),
      spaceId: z.string(),
      /** The board's asset path — a board IS an asset (whiteboards/<name>.excalidraw). */
      boardId: z.string(),
      payload: z.custom<SpacesTypes.SpacesWhiteboardPayload>(),
    }),
    res: z.object({ success: z.literal(true) }),
  },
  'spaces:events': {
    req: z.custom<SpacesBusEvent>(),
    res: z.null(),
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

/**
 * Push channels (res schema is z.null()) flow server→client and map to the
 * WebSocket event feed; invoke channels map to POST /rpc/{channel}.
 */
export function isPushChannel(channel: keyof IPCChannels): boolean {
  return ipcSchemas[channel].res instanceof z.ZodNull;
}
