import container from '@x/core/dist/di/container.js';
import { deliverLoopbackCallback } from './loopback-relay.js';
import type { ISessions, EmitterSessionBus } from '@x/core/dist/runtime/sessions/index.js';
import type { ITurnEventBus } from '@x/core/dist/runtime/turns/event-hub.js';
import * as workspaceCore from '@x/core/dist/workspace/workspace.js';
import { isSignedIn } from '@x/core/dist/account/account.js';
import { getRowboatConfig } from '@x/core/dist/config/rowboat.js';
import { getAccessToken } from '@x/core/dist/auth/tokens.js';
import * as mcpCore from '@x/core/dist/mcp/mcp.js';
import * as runsCore from '@x/core/dist/runtime/legacy/runs.js';
import { getModelCatalog } from '@x/core/dist/models/catalog.js';
import { listModelsForProvider } from '@x/core/dist/models/models.js';
import type { IModelConfigRepo } from '@x/core/dist/models/repo.js';
import { getDefaultModelAndProvider } from '@x/core/dist/models/defaults.js';
import type { IGranolaConfigRepo } from '@x/core/dist/knowledge/granola/repo.js';
import { knowledgeSourcesRepo } from '@x/core/dist/knowledge/sources/repo.js';
import { isOnboardingComplete } from '@x/core/dist/config/note_creation_config.js';
import { loadNotificationSettings } from '@x/core/dist/config/notification_config.js';
import { loadTurnLimitsSettings } from '@x/core/dist/config/turn_limits.js';
import { loadRetentionSettings } from '@x/core/dist/config/retention.js';
import type { IAgentScheduleRepo } from '@x/core/dist/agent-schedule/repo.js';
import type { IAgentScheduleStateRepo } from '@x/core/dist/agent-schedule/state-repo.js';
import * as voice from '@x/core/dist/voice/voice.js';
import { publishTtsChunk, subscribeTtsChunks } from '@x/core/dist/voice/tts-bus.js';
import { fetchLiveNote, listLiveNotes, setLiveNote, setLiveNoteActive, deleteLiveNote } from '@x/core/dist/knowledge/live-note/fileops.js';
import { runningItemKeys } from '@x/core/dist/todo/runner.js';
import { getSessionIndex as getTodoSessionIndex } from '@x/core/dist/todo/session-index.js';
import { getConversation as getTodoConversation, deriveConversation as deriveSessionConversation } from '@x/core/dist/todo/conversation.js';
import { listSuggestions as listTodoSuggestions } from '@x/core/dist/todo/planner-memory.js';
import { getPlannerConfig } from '@x/core/dist/todo/planner-task.js';
import { readTodo, listArchived as listTodoArchived } from '@x/core/dist/todo/fileops.js';
import type { HomeThreadsTracker } from '@x/core/dist/home/threads.js';
import { fetchTask, listTasks, readRunIds as readTaskRunIds, createTask, patchTask, deleteTask } from '@x/core/dist/background-tasks/fileops.js';
import { getBillingInfo } from '@x/core/dist/billing/billing.js';
import * as versionHistory from '@x/core/dist/knowledge/version_history.js';
import { editSlide, generateDeckOutline, generateSlide } from '@x/core/dist/knowledge/deck_outline.js';
import { invalidateCopilotInstructionsCache } from '@x/core/dist/runtime/assembly/copilot/instructions.js';
import { syncSlackKnowledgeSources, triggerSync as triggerSlackKnowledgeSync } from '@x/core/dist/knowledge/sources/sync_slack.js';
import { markOnboardingComplete } from '@x/core/dist/config/note_creation_config.js';
import { saveNotificationSettings } from '@x/core/dist/config/notification_config.js';
import { saveTurnLimitsSettings } from '@x/core/dist/config/turn_limits.js';
import { saveRetentionSettings } from '@x/core/dist/config/retention.js';
import { setPlannerConfig } from '@x/core/dist/todo/planner-task.js';
import { recordPlannerSignal, addYourRule as addPlannerRule, takeSuggestion as takeTodoSuggestion } from '@x/core/dist/todo/planner-memory.js';
import {
  saveTodo,
  addItem as addTodoItem,
  addSubItem as addTodoSubItem,
  clearCompleted as clearTodoCompleted,
  dismissItem as dismissTodoItem,
  restoreItem as restoreTodoItem,
  deleteArchived as deleteTodoArchived,
  importTodoAttachments,
  linksToText as todoLinksToText,
  findItem as findTodoItem,
} from '@x/core/dist/todo/fileops.js';
import { todoBus } from '@x/core/dist/todo/bus.js';
import { runTodoItem, stopTodoRun, commentOnTodoItem, startHomeChat, replyHomeChat } from '@x/core/dist/todo/runner.js';
import { triggerEmailSync, sendThreadReply, saveThreadDraft, deleteThreadDraft, listDraftThreads, searchThreads, archiveThread, archiveCategoryThreads, trashThread, markThreadRead, downloadAttachment, getAccountEmail, getAccountName, getConnectionStatus as getEmailConnectionStatus, searchSentContacts } from '@x/core/dist/knowledge/email/dispatcher.js';
import { listImportantThreads, listEverythingElseThreads, saveMessageBodyHeight, setThreadImportance, setThreadCategory } from '@x/core/dist/knowledge/email/store.js';
import { loadEmailInstructions, saveEmailInstructions } from '@x/core/dist/knowledge/email_instructions.js';
import { getEmailLabels, syncCustomLabelsFromInstructions } from '@x/core/dist/knowledge/email_labels.js';
import { getChatGPTStatus } from '@x/core/dist/auth/chatgpt-auth.js';
import type { IChannelsConfigRepo } from '@x/core/dist/channels/repo.js';
import { applyChannelsConfig, getChannelsStatus, logoutWhatsApp } from '@x/core/dist/channels/service.js';
import type { ISlackConfigRepo } from '@x/core/dist/slack/repo.js';
import { runAgentSlack, getAgentSlackCliStatus, AgentSlackRunError } from '@x/core/dist/slack/agent-slack-exec.js';
import { getSlackKnowledgeSyncStatus } from '@x/core/dist/knowledge/sources/sync_slack.js';
import { rankSlackHomeMessages } from '@x/core/dist/knowledge/sources/rank_slack_home.js';
import {
  parseWhoamiWorkspaces,
  extractArrayPayload,
  slackMessageText,
  slackMessageAuthor,
  resolveSlackMessageText,
  resolveSlackAuthor,
  slackMessageUrl,
  type SlackHomeChannel,
  type SlackHomeMessage,
} from '@x/core/dist/slack/home-parse.js';
import { searchContacts as searchGmailContacts } from '@x/core/dist/knowledge/gmail_contacts.js';
import { maybeActivateCredit, getCreditsState } from '@x/core/dist/billing/credits.js';
import { getGoogleDocsConnectionStatus, importGoogleDoc, syncGoogleDocDown, syncGoogleDocUp, getGoogleDocLink } from '@x/core/dist/knowledge/google_docs.js';
import * as githubAuthCore from '@x/core/dist/apps/github-auth.js';
import { qualifyAndDisconnectComposioGoogle } from '@x/core/dist/migrations/composio-google-migration.js';
import { connectProvider, disconnectProvider, listProviders } from '@x/core/dist/auth/oauth-flows.js';
import type { IOAuthRepo } from '@x/core/dist/auth/repo.js';
import * as composioFlows from '@x/core/dist/composio/flows.js';
import { signInWithChatGPT, cancelChatGPTSignIn } from '@x/core/dist/auth/chatgpt-signin.js';
import { signOutChatGPT } from '@x/core/dist/auth/chatgpt-auth.js';
import { chatgptStatusBus, oauthConnectBus, composioConnectBus } from '@x/core/dist/auth/connector-events.js';
import { captureProviderConnected, captureProviderDisconnected } from '@x/core/dist/analytics/model-providers.js';
import { openExternalUrl } from '@x/core/dist/auth/url-opener.js';
import { startManagedGooglePick } from '@x/core/dist/knowledge/google-picker-managed.js';
import { testModelConnection, generateOneShot } from '@x/core/dist/models/models.js';
import { triggerSync as triggerGranolaSync } from '@x/core/dist/knowledge/granola/sync.js';
import * as appsIndexer from '@x/core/dist/apps/indexer.js';
import * as appsServer from '@x/core/dist/apps/server.js';
import * as appsAgents from '@x/core/dist/apps/agents.js';
import * as appsStars from '@x/core/dist/apps/stars.js';
import * as appsInstaller from '@x/core/dist/apps/installer.js';
import * as appsPublisher from '@x/core/dist/apps/publisher.js';
import { registryClient } from '@x/core/dist/apps/registry.js';
import { capture } from '@x/core/dist/analytics/posthog.js';
import { triggerRun as triggerAgentScheduleRun } from '@x/core/dist/agent-schedule/runner.js';
import { search } from '@x/core/dist/search/search.js';
import { classifySchedule, processRowboatInstruction } from '@x/core/dist/knowledge/inline_tasks.js';
import { summarizeMeeting } from '@x/core/dist/knowledge/summarize_meeting.js';
import { runLiveNoteAgent } from '@x/core/dist/knowledge/live-note/runner.js';
import { runBackgroundTask } from '@x/core/dist/background-tasks/runner.js';
import type { ICodeModeConfigRepo } from '@x/core/dist/code-mode/repo.js';
import type { CodePermissionRegistry } from '@x/core/dist/code-mode/acp/permission-registry.js';
import { checkCodeModeAgentStatus } from '@x/core/dist/code-mode/status.js';
import type { ICodeProjectsRepo } from '@x/core/dist/code-mode/projects/repo.js';
import type { ICodeSessionsRepo } from '@x/core/dist/code-mode/sessions/repo.js';
import type { CodeSessionService } from '@x/core/dist/code-mode/sessions/service.js';
import type { CodeSessionStatusTracker } from '@x/core/dist/code-mode/sessions/status-tracker.js';
import type { CodeModeManager } from '@x/core/dist/code-mode/acp/manager.js';
import * as codeGit from '@x/core/dist/code-mode/git/service.js';
import { readProjectDir, readProjectFile } from '@x/core/dist/code-mode/projects/fs.js';
import type { CodeSession } from '@x/shared/dist/code-sessions.js';
import { ensureTerminal, writeTerminal, resizeTerminal, disposeTerminal, subscribeTerminalEvents } from '@x/core/dist/terminal/terminal.js';

async function requireCodeSession(sessionId: string): Promise<CodeSession> {
  const repo = container.resolve<ICodeSessionsRepo>('codeSessionsRepo');
  const session = await repo.get(sessionId);
  if (!session) {
    throw new Error(`Unknown code session: ${sessionId}`);
  }
  return session;
}

// Process-local caches mirrored from apps/main/src/ipc.ts — memoization only,
// no cross-process invariants (each host keeps its own).
const activeTtsStreams = new Map<string, AbortController>();
const appInstallPreviews = new Map<string, Awaited<ReturnType<typeof appsInstaller.previewInstall>>>();
let lastAppsFingerprint: string | null = null;
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
      const { dequeued } = await sessions().stopTurn(args.turnId, args.reason);
      return { success: true, dequeued };
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
    // ── Phase 1: read-only queries (verbatim lifts from apps/main/src/ipc.ts) ──
    'mcp:listTools': async (args) => mcpCore.listTools(args.serverName, args.cursor),
    'runs:list': async (args) => runsCore.listRuns(args.cursor),
    'runs:listByWorkDir': async (args) => runsCore.listRunsByWorkDir(args.dir),
    'sessions:listQueued': async (args) => ({ queue: sessions().listQueued(args.sessionId) }),
    'models:list': async (args) => getModelCatalog({ refreshProvider: args?.refreshProvider }),
    'models:listForProvider': async (args) => {
      try {
        const models = await listModelsForProvider(args.provider);
        return { success: true, models };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list models';
        return { success: false, error: message };
      }
    },
    'models:getConfig': async () => {
      const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
      const cfg = await repo.getConfig().catch(() => null);
      const tasks = cfg?.taskModels ?? {};
      return {
        providers: Object.entries(cfg?.providers ?? {}).map(([id, entry]) => ({
          id,
          flavor: entry.flavor,
          ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
          hasApiKey: Boolean(entry.apiKey),
        })),
        assistantModel: cfg?.assistantModel ?? null,
        taskModels: {
          knowledgeGraph: tasks.knowledgeGraph ?? null,
          meetingNotes: tasks.meetingNotes ?? null,
          liveNoteAgent: tasks.liveNoteAgent ?? null,
          autoPermissionDecision: tasks.autoPermissionDecision ?? null,
          chatTitle: tasks.chatTitle ?? null,
          backgroundTask: tasks.backgroundTask ?? null,
          subagent: tasks.subagent ?? null,
        },
        deferBackgroundTasks: cfg?.deferBackgroundTasks === true,
      };
    },
    'llm:getDefaultModel': async () => getDefaultModelAndProvider(),
    'rowboat:getConfig': async () => getRowboatConfig().catch(() => null),
    'granola:getConfig': async () => {
      const repo = container.resolve<IGranolaConfigRepo>('granolaConfigRepo');
      const config = await repo.getConfig();
      return { enabled: config.enabled };
    },
    'knowledgeSources:getConfig': async () => knowledgeSourcesRepo.getConfig(),
    'onboarding:getStatus': async () => ({ showOnboarding: !isOnboardingComplete() }),
    'agent-schedule:getConfig': async () => {
      const repo = container.resolve<IAgentScheduleRepo>('agentScheduleRepo');
      try {
        return await repo.getConfig();
      } catch {
        return { agents: {} };
      }
    },
    'agent-schedule:getState': async () => {
      const repo = container.resolve<IAgentScheduleStateRepo>('agentScheduleStateRepo');
      try {
        return await repo.getState();
      } catch {
        return { agents: {} };
      }
    },
    'voice:getConfig': async () => voice.getVoiceConfig(),
    'live-note:get': async (args) => {
      try {
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:listNotes': async () => ({ notes: await listLiveNotes() }),
    'todo:get': async () => {
      const list = await readTodo();
      return {
        list,
        running: runningItemKeys(),
        sessions: await getTodoSessionIndex(),
        suggestions: await listTodoSuggestions(),
      };
    },
    'todo:getPlanner': async () => getPlannerConfig(),
    'todo:getSessionConversation': async (args) => {
      const { bubbles } = await deriveSessionConversation(sessions(), args.sessionId);
      return { bubbles };
    },
    'todo:getConversation': async (args) => getTodoConversation(sessions(), args.key),
    'todo:listArchived': async () => ({ items: await listTodoArchived() }),
    'home:threads': async () => {
      const tracker = container.resolve<HomeThreadsTracker>('homeThreadsTracker');
      return { threads: await tracker.snapshot() };
    },
    'bg-task:get': async (args) => {
      try {
        const task = await fetchTask(args.slug);
        return { success: true, task };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:list': async (args) => listTasks(args),
    'bg-task:listRunIds': async (args) => {
      const runIds = await readTaskRunIds(args.slug, args.limit);
      return { runIds };
    },
    'billing:getInfo': async () => getBillingInfo(),
    'credits:getState': async () => getCreditsState(),
    'notifications:getSettings': async () => loadNotificationSettings(),
    'turnLimits:getSettings': async () => loadTurnLimitsSettings(),
    'retention:getSettings': async () => loadRetentionSettings(),
    // ── Phase 2: workspace & knowledge writes, todo/home/deck, settings setters ──
    'workspace:writeFile': async (args) => workspaceCore.writeFile(args.path, args.data, args.opts),
    'workspace:mkdir': async (args) => workspaceCore.mkdir(args.path, args.recursive),
    'workspace:rename': async (args) => workspaceCore.rename(args.from, args.to, args.overwrite),
    'workspace:copy': async (args) => workspaceCore.copy(args.from, args.to, args.overwrite),
    'workspace:remove': async (args) => workspaceCore.remove(args.path, args.opts),
    'deck:generateOutline': async (args) => {
      try {
        const outline = await generateDeckOutline(args);
        return { outline };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to generate the deck outline' };
      }
    },
    'deck:generateSlide': async (args) => {
      try {
        const slide = await generateSlide(args);
        return { slide };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to generate the slide' };
      }
    },
    'deck:editSlide': async (args) => {
      try {
        const slide = await editSlide(args);
        return { slide };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to edit the slide' };
      }
    },
    'knowledgeSources:upsert': async (args) => {
      const config = knowledgeSourcesRepo.upsertSource(args);
      if (args.provider === 'slack') {
        invalidateCopilotInstructionsCache();
        triggerSlackKnowledgeSync();
        void syncSlackKnowledgeSources().catch((error: unknown) => {
          console.error('[SlackKnowledge] Immediate sync after settings update failed:', error);
        });
      }
      return config;
    },
    'onboarding:markComplete': async () => {
      markOnboardingComplete();
      return { success: true };
    },
    'knowledge:history': async (args) => {
      const commits = await versionHistory.getFileHistory(args.path);
      return { commits };
    },
    'knowledge:fileAtCommit': async (args) => {
      const content = await versionHistory.getFileAtCommit(args.path, args.oid);
      return { content };
    },
    'knowledge:restore': async (args) => {
      await versionHistory.restoreFile(args.path, args.oid);
      return { ok: true };
    },
    'todo:acceptSuggestion': async (args) => {
      try {
        const taken = await takeTodoSuggestion(args.text);
        if (!taken) return { success: false, error: 'Suggestion no longer exists' };
        await addTodoItem(taken, { proposed: true });
        void recordPlannerSignal('kept', taken).catch(() => {});
        todoBus.publish({ type: 'list_changed' });
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:declineSuggestion': async (args) => {
      try {
        const taken = await takeTodoSuggestion(args.text);
        if (!taken) return { success: false, error: 'Suggestion no longer exists' };
        void recordPlannerSignal('dismissed', taken).catch(() => {});
        todoBus.publish({ type: 'list_changed' });
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:setPlanner': async (args) => setPlannerConfig(args),
    'todo:save': async (args) => {
      try {
        const list = await saveTodo(args.list);
        return { success: true, list };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:addItem': async (args) => {
      try {
        const links = await importTodoAttachments(args.attachments ?? []);
        const text = links.length > 0 ? `${args.text} ${todoLinksToText(links)}` : args.text;
        const item = await addTodoItem(text);
        if (args.run || item.delegated) {
          void runTodoItem(item.key, undefined, { model: args.model, autoPermission: args.permissionMode !== 'manual', code: args.code }).catch(() => {});
        }
        todoBus.publish({ type: 'list_changed' });
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:addSubItem': async (args) => {
      try {
        const links = await importTodoAttachments(args.attachments ?? []);
        const text = links.length > 0 ? `${args.text} ${todoLinksToText(links)}` : args.text;
        const child = await addTodoSubItem(args.parentKey, text);
        if (!child) return { success: false, error: 'Parent not found' };
        if (args.run || child.delegated) {
          void runTodoItem(child.key, undefined, { model: args.model, autoPermission: args.permissionMode !== 'manual' }).catch(() => {});
        }
        todoBus.publish({ type: 'list_changed' });
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:runItem': async (args) => {
      try {
        void runTodoItem(args.key, args.context, { model: args.model, autoPermission: args.permissionMode !== 'manual' }).catch(() => {});
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:stopRun': async (args) => {
      try {
        const stopped = await stopTodoRun(args.key);
        return stopped ? { success: true } : { success: false, error: 'No live run to stop' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:startChat': async (args) => {
      try {
        const result = await startHomeChat(args.text);
        return result.sessionId
          ? { success: true, sessionId: result.sessionId }
          : { success: false, error: result.error ?? 'Failed to start chat' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:chatReply': async (args) => {
      try {
        const links = await importTodoAttachments(args.attachments ?? []);
        const message = links.length > 0 ? `${args.message}\n\nAttached: ${todoLinksToText(links)}` : args.message;
        void replyHomeChat(args.sessionId, message, { model: args.model, autoPermission: args.permissionMode !== 'manual' }).catch(() => {});
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:comment': async (args) => {
      try {
        const links = await importTodoAttachments(args.attachments ?? []);
        const message = links.length > 0 ? `${args.message}\n\nAttached: ${todoLinksToText(links)}` : args.message;
        void commentOnTodoItem(args.key, message, { model: args.model, autoPermission: args.permissionMode !== 'manual' }).catch(() => {});
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:clearCompleted': async () => {
      try {
        const archived = await clearTodoCompleted();
        todoBus.publish({ type: 'list_changed' });
        return { success: true, archived };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:dismiss': async (args) => {
      try {
        const found = await findTodoItem(args.key).catch(() => null);
        const ok = await dismissTodoItem(args.key);
        if (ok && found?.item.proposed) {
          void recordPlannerSignal('dismissed', found.item.text).catch(() => {});
        }
        todoBus.publish({ type: 'list_changed' });
        return ok ? { success: true, wasProposed: !!found?.item.proposed } : { success: false, error: 'Item not found' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:teach': async (args) => {
      try {
        await addPlannerRule(`Don't suggest items like: "${args.text}"`);
        void recordPlannerSignal('taught', args.text).catch(() => {});
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:deleteArchived': async (args) => {
      try {
        const ok = await deleteTodoArchived(args.month, args.blockIndex, args.key);
        todoBus.publish({ type: 'list_changed' });
        return ok ? { success: true } : { success: false, error: 'Item moved — refresh and retry' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'todo:restore': async (args) => {
      try {
        const ok = await restoreTodoItem(args.month, args.blockIndex, args.key);
        todoBus.publish({ type: 'list_changed' });
        return ok ? { success: true } : { success: false, error: 'Item moved — refresh and retry' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'home:markSeen': async (args) => {
      try {
        await container.resolve<HomeThreadsTracker>('homeThreadsTracker').markSeen(args.sessionId);
        return { success: true };
      } catch {
        return { success: false };
      }
    },
    'home:setPinned': async (args) => {
      try {
        await container.resolve<HomeThreadsTracker>('homeThreadsTracker').setPinned(args.sessionId, args.pinned);
        return { success: true };
      } catch {
        return { success: false };
      }
    },
    'home:snooze': async (args) => {
      try {
        await container.resolve<HomeThreadsTracker>('homeThreadsTracker').snooze(args.sessionId, args.hours);
        return { success: true };
      } catch {
        return { success: false };
      }
    },
    'home:dismiss': async (args) => {
      try {
        await container.resolve<HomeThreadsTracker>('homeThreadsTracker').dismiss(args.sessionId);
        return { success: true };
      } catch {
        return { success: false };
      }
    },
    'home:commandCenter': async () => {
      const { ensureCommandCenterSession } = await import('@x/core/dist/home/command-center.js');
      const sessionId = await ensureCommandCenterSession(sessions());
      return { sessionId };
    },
    'notifications:setSettings': async (args) => {
      saveNotificationSettings(args);
      return { success: true };
    },
    'turnLimits:setSettings': async (args) => {
      await saveTurnLimitsSettings(args);
      return { success: true };
    },
    'retention:setSettings': async (args) => {
      await saveRetentionSettings(args);
      return { success: true };
    },
    'retention:consumeFirstRunNotice': async () => {
      const settings = await loadRetentionSettings();
      if (settings.enabled && !settings.noticeShown) {
        await saveRetentionSettings({ noticeShown: true });
        return { show: true, chatDays: settings.chatDays };
      }
      return { show: false, chatDays: settings.chatDays };
    },
    // ── Phase 3a: connector data channels (verbatim lifts) ──
    'gmail:getImportant': async (args) => {
      return listImportantThreads({ cursor: args.cursor, limit: args.limit });
    },
    'gmail:getEverythingElse': async (args) => {
      return listEverythingElseThreads({ cursor: args.cursor, limit: args.limit, category: args.category });
    },
    'gmail:triggerSync': async () => {
      await triggerEmailSync();
      return {};
    },
    'gmail:sendReply': async (args) => {
      const result = await sendThreadReply(args);
      if (!result.error) {
        void maybeActivateCredit('first_email_sent');
      }
      return result;
    },
    'gmail:saveDraft': async (args) => {
      return saveThreadDraft(args);
    },
    'gmail:deleteDraft': async (args) => {
      return deleteThreadDraft(args.draftId);
    },
    'gmail:getDrafts': async () => {
      return listDraftThreads();
    },
    'gmail:search': async (args) => {
      return searchThreads(args.query, { limit: args.limit });
    },
    'gmail:getConnectionStatus': async () => {
      return getEmailConnectionStatus();
    },
    'gmail:getAccountEmail': async () => {
      return { email: await getAccountEmail() };
    },
    'gmail:getAccountName': async () => {
      return { name: await getAccountName() };
    },
    'gmail:setImportance': async (args) => {
      const result = setThreadImportance(args.threadId, args.importance);
      return { ok: result.success, previous: result.previous, error: result.error };
    },
    'gmail:setCategory': async (args) => {
      const result = setThreadCategory(args.threadId, args.category);
      return { ok: result.success, error: result.error };
    },
    'gmail:archiveCategory': async (args) => {
      return archiveCategoryThreads(args.category);
    },
    'gmail:getEmailInstructions': async () => {
      return { instructions: loadEmailInstructions() };
    },
    'gmail:setEmailInstructions': async (args) => {
      const saved = saveEmailInstructions(args.instructions);
      if (!saved.ok) return saved;
      // Extract any custom labels the instructions define so they become
      // valid classifier outputs immediately. Extraction failure shouldn't
      // fail the save — the instructions themselves are already persisted
      // and still steer classification as free text.
      try {
        await syncCustomLabelsFromInstructions(args.instructions);
      } catch (err) {
        console.warn('[EmailLabels] custom label extraction failed:', err);
      }
      return saved;
    },
    'gmail:getEmailLabels': async () => {
      return { labels: getEmailLabels().map(({ id, name, kind }) => ({ id, name, kind })) };
    },
    'gmail:archiveThread': async (args) => {
      return archiveThread(args.threadId);
    },
    'gmail:trashThread': async (args) => {
      return trashThread(args.threadId);
    },
    'gmail:markThreadRead': async (args) => {
      return markThreadRead(args.threadId, args.read);
    },
    'gmail:downloadAttachment': async (args) => {
      return downloadAttachment(args);
    },
    'gmail:saveMessageHeight': async (args) => {
      saveMessageBodyHeight(args.threadId, args.messageId, args.height);
      return {};
    },
    'gmail:searchContacts': async (args) => {
      const query = args?.query ?? '';
      const limit = args?.limit;
      const excludeEmails = args?.excludeEmails;

      // Primary source: people you've actually sent mail to (Gmail SENT label,
      // cached + refreshed via the Gmail API). Fallback: local-snapshot index
      // — used only when the SENT index hasn't been populated yet (very first
      // launch, before the background sync finishes).
      const sent = await searchSentContacts(query, { limit, excludeEmails }).catch(() => []);
      if (sent.length > 0) {
        return { contacts: sent };
      }
      const fallback = await searchGmailContacts(query, { limit, excludeEmails });
      return { contacts: fallback };
    },
    'chatgpt:getStatus': async () => {
      return await getChatGPTStatus();
    },

    'channels:getConfig': async () => {
      return container.resolve<IChannelsConfigRepo>('channelsConfigRepo').getConfig();
    },
    'channels:setConfig': async (args) => {
      await container.resolve<IChannelsConfigRepo>('channelsConfigRepo').setConfig(args);
      await applyChannelsConfig(args);
      return { success: true };
    },
    'channels:getStatus': async () => {
      return getChannelsStatus();
    },
    'channels:whatsappLogout': async () => {
      await logoutWhatsApp();
      return { success: true };
    },
    'slack:getConfig': async () => {
      const repo = container.resolve<ISlackConfigRepo>('slackConfigRepo');
      const config = await repo.getConfig();
      return { enabled: config.enabled, workspaces: config.workspaces };
    },
    'slack:setConfig': async (args) => {
      const repo = container.resolve<ISlackConfigRepo>('slackConfigRepo');
      await repo.setConfig({ enabled: args.enabled, workspaces: args.workspaces });
      // Connecting/disconnecting Slack changes the Copilot's routing (native
      // `slack` skill vs. Composio), so rebuild its cached instructions.
      invalidateCopilotInstructionsCache();
      return { success: true };
    },
    'slack:cliStatus': async () => {
      return await getAgentSlackCliStatus();
    },
    'slack:knowledgeStatus': async () => {
      return {
        cli: await getAgentSlackCliStatus(),
        sources: getSlackKnowledgeSyncStatus(),
      };
    },
    'slack:listWorkspaces': async () => {
      const result = await runAgentSlack(['auth', 'whoami'], { timeoutMs: 10000 });
      if (!result.ok) {
        return { workspaces: [], error: result.message, errorKind: result.kind };
      }
      const workspaces = parseWhoamiWorkspaces(result.data);
      return { workspaces };
    },
    'slack:parseCurlAuth': async (args) => {
      // Cross-OS fallback to desktop import: the user pastes a "Copy as cURL"
      // request from a signed-in Slack web tab; parse-curl reads it from stdin
      // and extracts the xoxc token + xoxd cookie. No leveldb, no OS keychain.
      const curl = (args.curl ?? '').trim();
      if (!curl) {
        return { ok: false, workspaces: [], error: 'Paste the copied cURL command first.', errorKind: 'unknown' as const };
      }
      const imported = await runAgentSlack(['auth', 'parse-curl'], { timeoutMs: 15000, parseJson: false, input: curl });
      if (!imported.ok) {
        return { ok: false, workspaces: [], error: imported.message, errorKind: imported.kind };
      }
      const whoami = await runAgentSlack(['auth', 'whoami'], { timeoutMs: 10000 });
      if (!whoami.ok) {
        return { ok: false, workspaces: [], error: whoami.message, errorKind: whoami.kind };
      }
      const workspaces = parseWhoamiWorkspaces(whoami.data);
      if (workspaces.length === 0) {
        return { ok: false, workspaces: [], error: 'Tokens were saved but no workspace was found. Double-check the copied request.', errorKind: 'not_authed' as const };
      }
      return { ok: true, workspaces };
    },
    'slack:listChannels': async (args) => {
      const result = await runAgentSlack(['channel', 'list', '--all', '--workspace', args.workspaceUrl, '--limit', '200'], { timeoutMs: 15000 });
      if (!result.ok) {
        return { channels: [], error: result.message };
      }
      const rawChannels = extractArrayPayload(result.data) as Array<{
        id?: string;
        name?: string;
        is_private?: boolean;
        isPrivate?: boolean;
        is_member?: boolean;
        isMember?: boolean;
      }>;
      const channels = rawChannels.map((ch) => ({
        id: ch.id || ch.name || '',
        name: ch.name || ch.id || '',
        isPrivate: ch.is_private ?? ch.isPrivate,
        isMember: ch.is_member ?? ch.isMember,
      })).filter((ch) => ch.id && ch.name);
      return { channels };
    },
    'slack:getRecentMessages': async (args) => {
      const repo = container.resolve<ISlackConfigRepo>('slackConfigRepo');
      const config = await repo.getConfig();
      if (!config.enabled || config.workspaces.length === 0) {
        return { enabled: false, messages: [] };
      }

      const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
      const messages: SlackHomeMessage[] = [];
      const userNameCache = new Map<string, string>();

      try {
        const knowledgeConfig = knowledgeSourcesRepo.getConfig();
        const slackSource = knowledgeConfig.sources.find(source => source.id === 'slack' && source.provider === 'slack' && source.enabled);
        let channels: SlackHomeChannel[] = (slackSource?.scopes ?? [])
          .filter(scope => scope.type === 'channel')
          .map(scope => ({
            id: scope.id,
            name: scope.name ?? scope.id,
            workspaceUrl: scope.workspaceUrl,
            workspaceName: config.workspaces.find(workspace => workspace.url === scope.workspaceUrl)?.name,
          }));

        if (channels.length === 0) {
          for (const workspace of config.workspaces) {
            const channelList = await runAgentSlack(['channel', 'list', '--workspace', workspace.url, '--limit', '12'], { timeoutMs: 15000 });
            if (!channelList.ok) {
              throw new AgentSlackRunError(channelList.kind, channelList.message);
            }
            const rawChannels = extractArrayPayload(channelList.data);
            for (const raw of rawChannels) {
              if (!raw || typeof raw !== 'object') continue;
              const channel = raw as Record<string, unknown>;
              const id = typeof channel.id === 'string' ? channel.id : undefined;
              const name = typeof channel.name === 'string' ? channel.name : id;
              const isMember = channel.is_member ?? channel.isMember;
              if (!id || !name || isMember === false) continue;
              channels.push({ id, name, workspaceUrl: workspace.url, workspaceName: workspace.name });
            }
          }
        }

        channels = channels.slice(0, 8);

        for (const channel of channels) {
          const commandArgs = ['message', 'list', channel.id, '--limit', '5', '--max-body-chars', '500'];
          if (channel.workspaceUrl) {
            commandArgs.push('--workspace', channel.workspaceUrl);
          }
          const messageList = await runAgentSlack(commandArgs, { timeoutMs: 15000, maxBuffer: 1024 * 1024 });
          if (!messageList.ok) {
            console.warn(`[Slack] Failed to load messages for ${channel.name}: ${messageList.message}`);
            continue;
          }
          const rawMessages = extractArrayPayload(messageList.data);
          for (const raw of rawMessages) {
            if (!raw || typeof raw !== 'object') continue;
            const message = raw as Record<string, unknown>;
            const ts = typeof message.ts === 'string' ? message.ts : undefined;
            const text = slackMessageText(message);
            if (!ts || !text) continue;
            const channelId = typeof message.channel_id === 'string'
              ? message.channel_id
              : typeof message.channel === 'string'
                ? message.channel
                : channel.id;
            const resolvedAuthor = await resolveSlackAuthor(slackMessageAuthor(message), channel.workspaceUrl, userNameCache);
            const resolvedText = await resolveSlackMessageText(text, channel.workspaceUrl, userNameCache);
            messages.push({
              id: `${channel.workspaceUrl ?? 'workspace'}:${channelId}:${ts}`,
              workspaceName: channel.workspaceName,
              workspaceUrl: channel.workspaceUrl,
              channelId,
              channelName: channel.name,
              author: resolvedAuthor,
              text: resolvedText,
              ts,
              url: slackMessageUrl(message, channel.workspaceUrl, channelId, ts),
            });
          }
        }

        const rankedIds = await rankSlackHomeMessages(messages, limit);
        const byId = new Map(messages.map(message => [message.id, message]));
        const rankedMessages = rankedIds
          .map(id => byId.get(id))
          .filter((message): message is SlackHomeMessage => Boolean(message));
        return { enabled: true, messages: rankedMessages };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load Slack messages';
        const errorKind = err instanceof AgentSlackRunError ? err.kind : undefined;
        return { enabled: true, messages: [], error: message, errorKind };
      }
    },
    'google-docs:getStatus': async () => {
      return getGoogleDocsConnectionStatus();
    },
    'google-docs:import': async (args) => {
      console.log(`[GoogleDocs] import fileId=${args.fileId} -> ${args.targetFolder}`);
      try {
        const result = await importGoogleDoc(args.fileId, args.targetFolder);
        console.log(`[GoogleDocs] import OK -> ${result.path}`);
        return result;
      } catch (err) {
        console.error('[GoogleDocs] import FAILED:', err instanceof Error ? err.message : err);
        throw err;
      }
    },
    // Managed (rowboat-mode) OAuth-redirect Picker: the Rowboat backend runs the
    // pick with the company Google client; the desktop opens the start URL,
    // waits for the deep link, and imports the picked doc with the existing
    // managed token. No API key, appId, or local credentials.
    'google-docs:refreshSnapshot': async (args) => {
      return syncGoogleDocDown(args.path);
    },
    'google-docs:sync': async (args) => {
      return syncGoogleDocUp(args.path, { force: args.force });
    },
    'google-docs:getLink': async (args) => {
      return { link: await getGoogleDocLink(args.path) };
    },
    // Search handler
    'githubAuth:poll': async () => {
      const result = await githubAuthCore.pollDeviceFlow();
      console.log(`[GitHubAuth] poll result → ${result.status}`);
      return result;
    },
    'githubAuth:status': async () => {
      return githubAuthCore.getAuthStatus();
    },
    'githubAuth:signOut': async () => {
      await githubAuthCore.clearAuth();
      return { ok: true as const };
    },
    // Agent schedule handlers
    'migration:check-composio-google': async () => {
      return qualifyAndDisconnectComposioGoogle();
    },
    // ── Phase 3b: OAuth/connector flows (core-relocated) ──
    'oauth:connect': async (args) => {
      const credentials = args.clientId && args.clientSecret
        ? { clientId: args.clientId.trim(), clientSecret: args.clientSecret.trim() }
        : undefined;
      return await connectProvider(args.provider, credentials);
    },
    'oauth:disconnect': async (args) => disconnectProvider(args.provider),
    'oauth:list-providers': async () => listProviders(),
    'oauth:getState': async () => {
      const repo = container.resolve<IOAuthRepo>('oauthRepo');
      const config = await repo.getClientFacingConfig();
      return { config };
    },
    'composio:is-configured': async () => composioFlows.isConfigured(),
    'composio:set-api-key': async (args) => composioFlows.setApiKey(args.apiKey),
    'composio:initiate-connection': async (args) => composioFlows.initiateConnection(args.toolkitSlug),
    'composio:get-connection-status': async (args) => composioFlows.getConnectionStatus(args.toolkitSlug),
    'composio:sync-connection': async (args) => composioFlows.syncConnection(args.toolkitSlug, args.connectedAccountId),
    'composio:disconnect': async (args) => composioFlows.disconnect(args.toolkitSlug),
    'composio:list-connected': async () => composioFlows.listConnected(),
    'composio:list-toolkits': async () => composioFlows.listToolkits(),
    'composio:execute-tool': async (args) => composioFlows.executeTool(args.toolkitSlug, args.toolSlug, args.arguments),
    'composio:search-tools': async (args) => composioFlows.searchToolsInToolkit(args.toolkitSlug, args.query),
    'chatgpt:signIn': async () => {
      const result = await signInWithChatGPT();
      if (result.signedIn) {
        chatgptStatusBus.publish({ signedIn: true });
        captureProviderConnected('codex');
      }
      return result;
    },
    'chatgpt:cancelSignIn': async () => {
      await cancelChatGPTSignIn();
      return { success: true };
    },
    'chatgpt:signOut': async () => {
      try {
        await signOutChatGPT();
        chatgptStatusBus.publish({ signedIn: false });
        captureProviderDisconnected('codex');
        return { success: true };
      } catch (error) {
        console.error('[ChatGPTAuth] Sign-out failed:', error);
        return { success: false };
      }
    },
    'githubAuth:start': async () => {
      const result = await githubAuthCore.startDeviceFlow();
      void openExternalUrl(result.verificationUri);
      return result;
    },
    'google-docs:pickViaManaged': async (args) => {
      const result = await startManagedGooglePick(args.targetFolder);
      if (!result) return null;
      return result;
    },
    // ── Phase 4: feature channels (verbatim lifts) ──



    'mcp:executeTool': async (args) => {
      return { result: await mcpCore.executeTool(args.serverName, args.toolName, args.input) };
    },
    'runs:create': async (args) => {
      return runsCore.createRun(args);
    },
    'runs:createMessage': async (args) => {
      return { messageId: await runsCore.createMessage(args.runId, args.message, args.voiceInput, args.voiceOutput, args.searchEnabled, args.middlePaneContext, args.codeMode, args.codeCwd, args.codePolicy) };
    },
    'runs:authorizePermission': async (args) => {
      await runsCore.authorizePermission(args.runId, args.authorization);
      return { success: true };
    },
    'runs:provideHumanInput': async (args) => {
      await runsCore.replyToHumanInputRequest(args.runId, args.reply);
      return { success: true };
    },
    'runs:stop': async (args) => {
      await runsCore.stop(args.runId, args.force);
      return { success: true };
    },
    'runs:fetch': async (args) => {
      return runsCore.fetchRun(args.runId);
    },
    'runs:delete': async (args) => {
      await runsCore.deleteRun(args.runId);
      return { success: true };
    },
    // ── New runtime: sessions + turns ─────────────────────────
    // Thin pass-throughs to the sessions service. sendMessage returns the
    // turnId immediately; the turn advances in the background and the
    // renderer reconciles via the sessions:events feed. Input-routing calls
    // settle with that advance's outcome (the renderer fire-and-forgets).
    'sessions:sendOrQueueMessage': async (args) => {
      return container.resolve<ISessions>('sessions').sendOrQueueMessage(args.sessionId, args.input, args.config);
    },
    'sessions:editQueued': async (args) => {
      container.resolve<ISessions>('sessions').editQueued(args.sessionId, args.queueId, args.message);
      return { success: true };
    },
    'sessions:removeQueued': async (args) => {
      const removed = container.resolve<ISessions>('sessions').removeQueued(args.sessionId, args.queueId);
      return { removed: removed ?? null };
    },
    'models:test': async (args) => {
      return await testModelConnection(args.provider, args.model);
    },
    'llm:generate': async (args) => {
      console.log(`[llm:generate] requested provider=${args.provider ?? '(default)'} model=${args.model ?? '(default)'}`);
      const result = await generateOneShot(args);
      console.log(`[llm:generate] -> provider=${result.provider ?? '?'} model=${result.model ?? '?'} chars=${result.text?.length ?? 0}${result.error ? ` error=${result.error}` : ''}`);
      return result;
    },
    'models:setProvider': async (args) => {
      const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
      await repo.setProvider(args.id, args.provider);
      return { success: true };
    },
    'models:removeProvider': async (args) => {
      const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
      await repo.removeProvider(args.id);
      return { success: true };
    },
    'models:updateConfig': async (args) => {
      const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
      await repo.updateConfig(args);
      return { success: true };
    },
    'granola:setConfig': async (args) => {
      const repo = container.resolve<IGranolaConfigRepo>('granolaConfigRepo');
      await repo.setConfig({ enabled: args.enabled });

      // Trigger sync immediately when enabled
      if (args.enabled) {
        triggerGranolaSync();
      }

      return { success: true };
    },
    // ── Caffeinate (keep system awake, like macOS `caffeinate`) ──
    'apps:serverStatus': async () => {
      return appsServer.getServerStatus();
    },
    'apps:list': async () => {
      const status = appsServer.getServerStatus();
      const apps = await appsIndexer.listApps();
      // Keep bundled agents materialized (idempotent; disabled by default).
      for (const app of apps) {
        if (app.agentSlugs.length) await appsAgents.syncAppAgents(app);
      }
      // The copilot instructions embed the installed-apps list. This handler
      // is the one place that sees every change to the app set (installs,
      // deletes, copilot-created folders — the renderer polls it), so refresh
      // the instructions cache when the set actually changes.
      const fingerprint = JSON.stringify(apps.map((a) => [a.folder, a.manifest?.name, a.manifest?.description, a.hasDist]));
      if (fingerprint !== lastAppsFingerprint) {
        lastAppsFingerprint = fingerprint;
        invalidateCopilotInstructionsCache();
      }
      // The copilot builds apps by writing the folder directly — apps:create is
      // never on that path — so the first-app reward triggers off observed
      // state instead: a valid non-installed app means the user built one.
      // Cheap on repeat polls (maybeActivateCredit short-circuits once claimed).
      if (apps.some((a) => a.kind === 'local' && a.status === 'ok')) {
        void maybeActivateCredit('first_app_built');
      }
      return {
        serverRunning: status.running,
        ...(status.error ? { serverError: status.error } : {}),
        apps,
      };
    },
    'apps:get': async (args) => {
      const app = await appsIndexer.getApp(args.folder);
      if (!app) throw new Error(`no such app: ${args.folder}`);
      const readme = await appsIndexer.readAppReadme(args.folder);
      return {
        app,
        ...(readme ? { readme } : {}),
        rollbackAvailable: await appsIndexer.rollbackAvailable(args.folder),
      };
    },
    'apps:create': async (args) => {
      const app = await appsIndexer.createApp(args);
      capture('app_created', { folder: app.folder });
      void maybeActivateCredit('first_app_built');
      return { app };
    },
    'apps:delete': async (args) => {
      await appsIndexer.deleteApp(args.folder);
      // Remove app-owned bg-tasks too — orphaned app--<folder>-- tasks firing
      // against a deleted app was a painful prototype failure mode.
      await appsAgents.deleteAppAgents(args.folder);
      capture('app_deleted', { folder: args.folder });
      return { ok: true as const };
    },
    'apps:setTheme': async (args) => {
      appsServer.setAppsTheme(args.theme);
      return { ok: true as const };
    },
    // GitHub auth (device flow) — publishing only
    // Catalog + install/update (spec §12–13)
    'apps:catalogIndex': async (args) => {
      return registryClient.refreshIndex(args.force);
    },
    'apps:catalogSearch': async (args) => {
      return { records: await registryClient.search(args.query) };
    },
    'apps:catalogStars': async (args) => {
      const [stars, starred] = await Promise.all([
        appsStars.repoStars(args.repos),
        appsStars.starredStatus(args.repos),
      ]);
      return { stars, starred };
    },
    'apps:star': async (args) => {
      const result = await appsStars.setStar(args.repo, args.star);
      capture('app_starred', { repo: args.repo, star: args.star });
      return result;
    },
    'apps:catalogDetail': async (args) => {
      const record = await registryClient.resolve(args.name);
      if (!record) throw new Error(`no such app in the catalog: ${args.name}`);
      let manifest;
      try { manifest = await registryClient.latestManifest(record); } catch { /* best effort */ }
      let readme: string | undefined;
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${record.repo}/HEAD/README.md`);
        if (res.ok) readme = await res.text();
      } catch { /* best effort */ }
      const installed = (await appsIndexer.listApps()).find((a) => a.install?.name === args.name);
      return {
        record,
        ...(manifest ? { manifest } : {}),
        ...(readme ? { readme } : {}),
        ...(installed ? { installedFolder: installed.folder } : {}),
      };
    },
    'apps:install': async (args) => {
      const record = await registryClient.resolve(args.name);
      if (!record) throw new Error(`no such app in the catalog: ${args.name}`);
      if (!args.confirmed) {
        const preview = await appsInstaller.previewInstall(record);
        appInstallPreviews.set(args.name, preview);
        return preview;
      }
      // D18: the confirmed phase checks the bundle against what was previewed.
      const preview = appInstallPreviews.get(args.name) ?? await appsInstaller.previewInstall(record);
      const result = await appsInstaller.installFromRegistry(record, preview);
      appInstallPreviews.delete(args.name);
      // Materialize bundled agents NOW, not on the next apps:list poll — the
      // renderer's post-install enable dialog patches these tasks immediately.
      if (result.app) await appsAgents.syncAppAgents(result.app);
      capture('app_installed', { name: args.name });
      return result;
    },
    'apps:installFromUrl': async (args) => {
      if (!args.confirmed) {
        return appsInstaller.previewUrlInstall(args.url);
      }
      const result = await appsInstaller.confirmUrlInstall(args.url);
      if (result.app) await appsAgents.syncAppAgents(result.app);
      capture('app_installed', { name: result.app.manifest?.name ?? result.app.folder });
      return result;
    },
    'apps:uninstall': async (args) => {
      await appsInstaller.uninstallApp(args.folder);
      capture('app_uninstalled', { folder: args.folder });
      return { ok: true as const };
    },
    'apps:checkUpdate': async (args) => {
      return appsInstaller.checkUpdate(args.folder);
    },
    'apps:update': async (args) => {
      const before = (await appsIndexer.getApp(args.folder))?.manifest?.version;
      const app = await appsInstaller.updateApp(args.folder, {
        confirmOverwriteModified: args.confirmOverwriteModified,
        confirmNewCapabilities: args.confirmNewCapabilities,
      });
      capture('app_updated', { from: before, to: app.manifest?.version });
      return { app };
    },
    'apps:rollback': async (args) => {
      const app = await appsInstaller.rollbackApp(args.folder);
      capture('app_rolled_back', { folder: args.folder });
      return { app };
    },
    'apps:publishUpdate': async (args) => {
      const result = await appsPublisher.publishUpdate(args.folder, args.increment);
      capture('app_published', { version: result.version, firstPublish: false });
      return result;
    },
    'apps:registerExisting': async (args) => {
      return appsPublisher.registerExisting(args.name, args.repo);
    },
    'agent-schedule:updateAgent': async (args) => {
      const repo = container.resolve<IAgentScheduleRepo>('agentScheduleRepo');
      await repo.upsert(args.agentName, args.entry);
      // Trigger the runner to pick up the change immediately
      triggerAgentScheduleRun();
      return { success: true };
    },
    'agent-schedule:deleteAgent': async (args) => {
      const repo = container.resolve<IAgentScheduleRepo>('agentScheduleRepo');
      const stateRepo = container.resolve<IAgentScheduleStateRepo>('agentScheduleStateRepo');
      await repo.delete(args.agentName);
      await stateRepo.deleteAgentState(args.agentName);
      return { success: true };
    },
    // Shell integration handlers
    'search:query': async (args) => {
      await opts?.sessionsIndexReady;
      const sessions = container.resolve<ISessions>('sessions').listSessions()
        .map((s) => ({ sessionId: s.sessionId, title: s.title }));
      return search(args.query, args.limit, args.types, sessions);
    },
    // Inline task schedule classification
    'meeting:summarize': async (args) => {
      const notes = await summarizeMeeting(args.transcript, args.meetingStartTime, args.calendarEventJson);
      if (notes && notes.trim()) {
        void maybeActivateCredit('first_meeting_note');
      }
      return { notes };
    },
    'inline-task:classifySchedule': async (args) => {
      const schedule = await classifySchedule(args.instruction);
      return { schedule };
    },
    'inline-task:process': async (args) => {
      return await processRowboatInstruction(args.instruction, args.noteContent, args.notePath);
    },
    'voice:synthesizeStreamStart': async (args) => {
      const { requestId, text } = args;
      const controller = new AbortController();
      activeTtsStreams.set(requestId, controller);
      void voice
        .synthesizeSpeechStream(
          text,
          (chunk: Buffer) => publishTtsChunk({ requestId, chunkBase64: chunk.toString('base64'), done: false }),
          controller.signal,
        )
        .then(() => publishTtsChunk({ requestId, done: true }))
        .catch((err: unknown) => {
          publishTtsChunk({ requestId, done: true, error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => activeTtsStreams.delete(requestId));
      return { ok: true };
    },
    'voice:synthesizeStreamCancel': async (args) => {
      activeTtsStreams.get(args.requestId)?.abort();
      activeTtsStreams.delete(args.requestId);
      return {};
    },
    'voice:synthesize': async (args) => {
      return voice.synthesizeSpeech(args.text);
    },
    'live-note:run': async (args) => {
      const result = await runLiveNoteAgent(args.filePath, 'manual', args.context);
      return {
        success: !result.error,
        runId: result.runId,
        action: result.action,
        summary: result.summary,
        contentAfter: result.contentAfter,
        error: result.error,
      };
    },
    'live-note:set': async (args) => {
      try {
        await setLiveNote(args.filePath, args.live);
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:setActive': async (args) => {
      try {
        await setLiveNoteActive(args.filePath, args.active);
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:delete': async (args) => {
      try {
        await deleteLiveNote(args.filePath);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:stop': async (args) => {
      try {
        const live = await fetchLiveNote(args.filePath);
        if (!live?.lastRunId) {
          return { success: false, error: 'No active run for this note' };
        }
        await runsCore.stop(live.lastRunId, false);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:run': async (args) => {
      const result = await runBackgroundTask(args.slug, 'manual', args.context);
      return {
        success: !result.error,
        runId: result.runId,
        summary: result.summary,
        error: result.error,
      };
    },
    'bg-task:patch': async (args) => {
      try {
        const task = await patchTask(args.slug, args.partial);
        return { success: true, task };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:create': async (args) => {
      try {
        const { slug } = await createTask({
          name: args.name,
          instructions: args.instructions,
          ...(args.triggers ? { triggers: args.triggers } : {}),
          ...(args.projectId ? { projectId: args.projectId } : {}),
          ...(args.model ? { model: args.model } : {}),
          ...(args.provider ? { provider: args.provider } : {}),
        });
        void maybeActivateCredit('first_bg_agent');
        return { success: true, slug };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:delete': async (args) => {
      try {
        await deleteTask(args.slug);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:stop': async (args) => {
      try {
        const task = await fetchTask(args.slug);
        if (!task?.lastRunId) {
          return { success: false, error: 'No active run for this task' };
        }
        await runsCore.stop(task.lastRunId, false);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    // ── Phase 5: code-mode & terminal (verbatim lifts) ──
    'codeRun:resolvePermission': async (args) => {
      const registry = container.resolve<CodePermissionRegistry>('codePermissionRegistry');
      registry.resolve(args.requestId, args.decision);
      return { success: true };
    },
    'codeMode:getConfig': async () => {
      const repo = container.resolve<ICodeModeConfigRepo>('codeModeConfigRepo');
      const config = await repo.getConfig();
      return { enabled: config.enabled, approvalPolicy: config.approvalPolicy, defaultProjectId: config.defaultProjectId };
    },
    'codeMode:setConfig': async (args) => {
      const repo = container.resolve<ICodeModeConfigRepo>('codeModeConfigRepo');
      await repo.setConfig({ enabled: args.enabled, approvalPolicy: args.approvalPolicy, defaultProjectId: args.defaultProjectId });
      invalidateCopilotInstructionsCache();
      return { success: true };
    },
    'codeMode:checkAgentStatus': async () => {
      return await checkCodeModeAgentStatus();
    },
    'codeMode:listModelOptions': async (args) => {
      const manager = container.resolve<CodeModeManager>('codeModeManager');
      return manager.listModelOptions(args.agent);
    },
    'codeProject:add': async (args) => {
      const repo = container.resolve<ICodeProjectsRepo>('codeProjectsRepo');
      const project = await repo.add(args.path);
      const git = await codeGit.repoInfo(project.path);
      return { project, git };
    },
    'codeProject:remove': async (args) => {
      const repo = container.resolve<ICodeProjectsRepo>('codeProjectsRepo');
      await repo.remove(args.projectId);
      return { success: true };
    },
    'codeProject:list': async () => {
      const repo = container.resolve<ICodeProjectsRepo>('codeProjectsRepo');
      const projects = await repo.list();
      return {
        projects: await Promise.all(projects.map(async (project) => ({
          project,
          git: await codeGit.repoInfo(project.path),
        }))),
      };
    },
    'codeSession:create': async (args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      const session = await service.create(args);
      capture('code_session_created', { agent: session.agent });
      return { session };
    },
    'codeSession:list': async () => {
      const repo = container.resolve<ICodeSessionsRepo>('codeSessionsRepo');
      const tracker = container.resolve<CodeSessionStatusTracker>('codeSessionStatusTracker');
      return { sessions: await repo.list(), statuses: tracker.getStatuses() };
    },
    'codeSession:update': async (args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      return { session: await service.update(args.sessionId, args.patch) };
    },
    'codeSession:delete': async (args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      disposeTerminal(args.sessionId);
      await service.delete(args.sessionId, {
        removeWorktree: args.removeWorktree,
        deleteBranch: args.deleteBranch,
      });
      return { success: true };
    },
    'codeSession:stop': async (args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      await service.stop(args.sessionId);
      return { success: true };
    },
    'codeSession:gitStatus': async (args) => {
      const session = await requireCodeSession(args.sessionId);
      const info = await codeGit.repoInfo(session.cwd);
      if (!info.isGitRepo) {
        return { isRepo: false, branch: null, hasCommits: false, files: [] };
      }
      let files = await codeGit.status(session.cwd);
      if (session.worktree && !session.worktree.removedAt && session.worktree.baseBranch) {
        const branchFiles = await codeGit.changedSinceBase(session.cwd, session.worktree.baseBranch);
        const byPath = new Map(branchFiles.map((file) => [file.path, file]));
        for (const file of files) {
          if (!byPath.has(file.path)) byPath.set(file.path, file);
        }
        files = [...byPath.values()];
      }
      return { isRepo: true, branch: info.branch, hasCommits: info.hasCommits, files };
    },
    'codeSession:fileDiff': async (args) => {
      const session = await requireCodeSession(args.sessionId);
      return codeGit.fileDiff(session.cwd, args.path, {
        baseRef: session.worktree && !session.worktree.removedAt ? session.worktree.baseBranch : null,
      });
    },
    'codeSession:readdir': async (args) => {
      const session = await requireCodeSession(args.sessionId);
      return { entries: await readProjectDir(session.cwd, args.relPath) };
    },
    'codeSession:readFile': async (args) => {
      const session = await requireCodeSession(args.sessionId);
      return readProjectFile(session.cwd, args.relPath);
    },
    'codeSession:mergeBack': async (args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      return service.mergeBack(args.sessionId);
    },
    'codeSession:cleanupWorktree': async (args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      try {
        await service.cleanupWorktree(args.sessionId, args.deleteBranch);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to clean up worktree';
        return { success: false, error: message };
      }
    },
    'terminal:ensure': async (args) => {
      return ensureTerminal(args.id, args.cwd, args.cols, args.rows);
    },
    'terminal:input': async (args) => {
      writeTerminal(args.id, args.data);
      return { success: true };
    },
    'terminal:resize': async (args) => {
      resizeTerminal(args.id, args.cols, args.rows);
      return { success: true };
    },
    'terminal:dispose': async (args) => {
      disposeTerminal(args.id);
      return { success: true };
    },

    // Phase 8b: OAuth loopback relay — the loopback-capable client posts
    // every callback hit here; the relay settles the owning flow and answers
    // with the page to render.
    'oauth:deliverLoopbackCallback': async (args) => deliverLoopbackCallback(args),


    // Rowboat Apps handlers (spec §13)

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
    subscribeOAuthEvents: (listener) => oauthConnectBus.subscribe(listener),
    subscribeComposioEvents: (listener) => composioConnectBus.subscribe(listener),
    subscribeChatgptEvents: (listener) => chatgptStatusBus.subscribe(listener),
    subscribeTerminalEvents: (listener) => subscribeTerminalEvents(listener),
    subscribeTtsChunks: (listener) => subscribeTtsChunks(listener),
  };
}

export const resolveWorkspacePath = workspaceCore.resolveWorkspacePath;
