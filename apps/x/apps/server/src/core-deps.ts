import container from '@x/core/dist/di/container.js';
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
import { fetchLiveNote, listLiveNotes } from '@x/core/dist/knowledge/live-note/fileops.js';
import { runningItemKeys } from '@x/core/dist/todo/runner.js';
import { getSessionIndex as getTodoSessionIndex } from '@x/core/dist/todo/session-index.js';
import { getConversation as getTodoConversation, deriveConversation as deriveSessionConversation } from '@x/core/dist/todo/conversation.js';
import { listSuggestions as listTodoSuggestions } from '@x/core/dist/todo/planner-memory.js';
import { getPlannerConfig } from '@x/core/dist/todo/planner-task.js';
import { readTodo, listArchived as listTodoArchived } from '@x/core/dist/todo/fileops.js';
import type { HomeThreadsTracker } from '@x/core/dist/home/threads.js';
import { fetchTask, listTasks, readRunIds as readTaskRunIds } from '@x/core/dist/background-tasks/fileops.js';
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
  };
}

export const resolveWorkspacePath = workspaceCore.resolveWorkspacePath;
