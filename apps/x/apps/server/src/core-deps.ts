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
import { getCreditsState } from '@x/core/dist/billing/credits.js';
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
