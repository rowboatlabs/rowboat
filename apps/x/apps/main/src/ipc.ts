import { ipcMain, BrowserWindow, shell, dialog, systemPreferences, desktopCapturer, app } from 'electron';
import { ipc } from '@x/shared';
import path from 'node:path';
import os from 'node:os';
import {
  connectProvider,
  disconnectProvider,
  listProviders,
} from './oauth-handler.js';
import { watcher as watcherCore, workspace } from '@x/core';
import { WorkDir } from '@x/core/dist/config/config.js';
import { workspace as workspaceShared } from '@x/shared';
import * as mcpCore from '@x/core/dist/mcp/mcp.js';
import * as runsCore from '@x/core/dist/runs/runs.js';
import { bus } from '@x/core/dist/runs/bus.js';
import { serviceBus } from '@x/core/dist/services/service_bus.js';
import type { FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import z from 'zod';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import { RunEvent } from '@x/shared/dist/runs.js';
import { ServiceEvent } from '@x/shared/dist/service-events.js';
import container from '@x/core/dist/di/container.js';
import { listOnboardingModels } from '@x/core/dist/models/models-dev.js';
import { testModelConnection } from '@x/core/dist/models/models.js';
import { isSignedIn } from '@x/core/dist/account/account.js';
import { listGatewayModels } from '@x/core/dist/models/gateway.js';
import type { IModelConfigRepo } from '@x/core/dist/models/repo.js';
import type { IOAuthRepo } from '@x/core/dist/auth/repo.js';
import { IGranolaConfigRepo } from '@x/core/dist/knowledge/granola/repo.js';
import { ICodeModeConfigRepo } from '@x/core/dist/code-mode/repo.js';
import { CodePermissionRegistry } from '@x/core/dist/code-mode/acp/permission-registry.js';
import { checkCodeModeAgentStatus } from '@x/core/dist/code-mode/status.js';
import { invalidateCopilotInstructionsCache } from '@x/core/dist/application/assistant/instructions.js';
import { triggerSync as triggerGranolaSync } from '@x/core/dist/knowledge/granola/sync.js';
import { ISlackConfigRepo } from '@x/core/dist/slack/repo.js';
import { knowledgeSourcesRepo } from '@x/core/dist/knowledge/sources/repo.js';
import { rankSlackHomeMessages } from '@x/core/dist/knowledge/sources/rank_slack_home.js';
import { syncSlackKnowledgeSources, triggerSync as triggerSlackKnowledgeSync } from '@x/core/dist/knowledge/sources/sync_slack.js';
import { isOnboardingComplete, markOnboardingComplete } from '@x/core/dist/config/note_creation_config.js';
import { loadNotificationSettings, saveNotificationSettings } from '@x/core/dist/config/notification_config.js';
import * as composioHandler from './composio-handler.js';
import { consumePendingDeepLink } from './deeplink.js';
import { qualifyAndDisconnectComposioGoogle } from '@x/core/dist/migrations/composio-google-migration.js';
import { IAgentScheduleRepo } from '@x/core/dist/agent-schedule/repo.js';
import { IAgentScheduleStateRepo } from '@x/core/dist/agent-schedule/state-repo.js';
import { triggerRun as triggerAgentScheduleRun } from '@x/core/dist/agent-schedule/runner.js';
import { search } from '@x/core/dist/search/search.js';
import { versionHistory, voice } from '@x/core';
import { classifySchedule, processRowboatInstruction } from '@x/core/dist/knowledge/inline_tasks.js';
import { getBillingInfo } from '@x/core/dist/billing/billing.js';
import { summarizeMeeting } from '@x/core/dist/knowledge/summarize_meeting.js';
import { getAccessToken } from '@x/core/dist/auth/tokens.js';
import { getRowboatConfig } from '@x/core/dist/config/rowboat.js';
import { runLiveNoteAgent } from '@x/core/dist/knowledge/live-note/runner.js';
import { listImportantThreads, listEverythingElseThreads, saveMessageBodyHeight, triggerSync as triggerGmailSync, sendThreadReply, archiveThread, trashThread, markThreadRead, getAccountEmail, getConnectionStatus as getGmailConnectionStatus } from '@x/core/dist/knowledge/sync_gmail.js';
import { searchContacts as searchGmailContacts, warmContactIndex } from '@x/core/dist/knowledge/gmail_contacts.js';
import { searchSentContacts, warmSentContacts } from '@x/core/dist/knowledge/gmail_sent_contacts.js';
import { liveNoteBus } from '@x/core/dist/knowledge/live-note/bus.js';
import { getInstallationId } from '@x/core/dist/analytics/installation.js';
import { API_URL } from '@x/core/dist/config/env.js';
import {
  fetchLiveNote,
  setLiveNote,
  setLiveNoteActive,
  deleteLiveNote,
  listLiveNotes,
} from '@x/core/dist/knowledge/live-note/fileops.js';
import { runBackgroundTask } from '@x/core/dist/background-tasks/runner.js';
import { backgroundTaskBus } from '@x/core/dist/background-tasks/bus.js';
import {
  fetchTask,
  patchTask,
  createTask,
  deleteTask,
  listTasks,
  readRunIds as readTaskRunIds,
} from '@x/core/dist/background-tasks/fileops.js';

type SlackHomeChannel = {
  id: string;
  name: string;
  workspaceUrl?: string;
  workspaceName?: string;
};

type SlackHomeMessage = {
  id: string;
  workspaceName?: string;
  workspaceUrl?: string;
  channelId?: string;
  channelName?: string;
  author?: string;
  text: string;
  ts: string;
  url?: string;
};

function parseJsonArrayPayload(stdout: string): unknown[] {
  const parsed = JSON.parse(stdout || '[]');
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['messages', 'channels', 'items', 'results', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function slackMessageText(message: Record<string, unknown>): string {
  const value = message.text ?? message.body ?? message.content;
  return typeof value === 'string' ? value.trim() : '';
}

function slackMessageAuthor(message: Record<string, unknown>): string | undefined {
  const value = message.username ?? message.user ?? message.author;
  return typeof value === 'string' ? value : undefined;
}

function extractSlackUserName(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const profile = obj.profile && typeof obj.profile === 'object' ? obj.profile as Record<string, unknown> : undefined;
  const user = obj.user && typeof obj.user === 'object' ? obj.user as Record<string, unknown> : undefined;
  const userProfile = user?.profile && typeof user.profile === 'object' ? user.profile as Record<string, unknown> : undefined;

  const candidates = [
    profile?.display_name,
    profile?.real_name,
    userProfile?.display_name,
    userProfile?.real_name,
    obj.display_name,
    obj.displayName,
    obj.real_name,
    obj.realName,
    user?.display_name,
    user?.displayName,
    user?.real_name,
    user?.realName,
    obj.name,
    user?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function resolveSlackUserName(
  userId: string,
  workspaceUrl: string | undefined,
  cache: Map<string, string>,
): Promise<string | null> {
  const key = `${workspaceUrl ?? ''}:${userId}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const args = ['user', 'get', userId];
  if (workspaceUrl) {
    args.push('--workspace', workspaceUrl);
  }

  try {
    const { stdout } = await execFileAsync('agent-slack', args, { timeout: 10000, maxBuffer: 512 * 1024 });
    const parsed = JSON.parse(stdout || '{}');
    const name = extractSlackUserName(parsed);
    if (name) {
      cache.set(key, name);
      return name;
    }
  } catch (error) {
    console.warn(`[Slack] Failed to resolve user ${userId}:`, error);
  }

  cache.set(key, userId);
  return null;
}

async function resolveSlackMessageText(
  text: string,
  workspaceUrl: string | undefined,
  cache: Map<string, string>,
): Promise<string> {
  const matches = Array.from(text.matchAll(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>|@([UW][A-Z0-9]{6,})\b/g));
  if (matches.length === 0) return text;

  let resolved = text;
  for (const match of matches) {
    const userId = match[1] ?? match[3];
    if (!userId) continue;
    const fallback = match[2] ?? match[0];
    const name = await resolveSlackUserName(userId, workspaceUrl, cache);
    resolved = resolved.replaceAll(match[0], name ?? fallback);
  }
  return resolved;
}

async function resolveSlackAuthor(
  author: string | undefined,
  workspaceUrl: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!author) return undefined;
  if (!/^[UW][A-Z0-9]{6,}$/.test(author)) return author;
  return await resolveSlackUserName(author, workspaceUrl, cache) ?? author;
}

function slackMessageUrl(message: Record<string, unknown>, workspaceUrl: string | undefined, channelId: string | undefined, ts: string): string | undefined {
  const direct = message.permalink ?? message.url;
  if (typeof direct === 'string' && direct) return direct;
  if (!workspaceUrl || !channelId) return undefined;
  return `${workspaceUrl.replace(/\/$/, '')}/archives/${channelId}/p${ts.replace('.', '')}`;
}
import { browserIpcHandlers } from './browser/ipc.js';

/**
 * Convert markdown to a styled HTML document for PDF/DOCX export.
 */
function markdownToHtml(markdown: string, title: string): string {
  // Simple markdown to HTML conversion for export purposes
  let html = markdown
    // Resolve wiki links [[Folder/Note Name]] or [[Folder/Note Name|Display]] to plain text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, _path, display) => display.trim())
    .replace(/\[\[([^\]]+)\]\]/g, (_match, linkPath: string) => {
      // Use the last segment (filename) as the display name
      const segments = linkPath.trim().split('/')
      return segments[segments.length - 1]
    })
    // Escape HTML entities (but preserve markdown syntax)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Headings (must come before other processing)
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>')

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')

  // Paragraphs: wrap remaining lines that aren't already wrapped in HTML tags
  html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, '<p>$1</p>')

  // Clean up consecutive list items into lists
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; font-size: 14px; }
  h1 { font-size: 1.8em; margin-top: 1em; } h2 { font-size: 1.4em; margin-top: 1em; } h3 { font-size: 1.2em; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  blockquote { border-left: 3px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  ul { padding-left: 1.5em; }
  a { color: #0066cc; }
</style></head><body>${html}</body></html>`
}

function resolveShellPath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return workspace.resolveWorkspacePath(filePath);
}

type InvokeChannels = ipc.InvokeChannels;
type IPCChannels = ipc.IPCChannels;

/**
 * Type-safe handler function for invoke channels
 */
type InvokeHandler<K extends InvokeChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]['req']
) => IPCChannels[K]['res'] | Promise<IPCChannels[K]['res']>;

/**
 * Type-safe handler registration map
 * Ensures all invoke channels have handlers
 */
type InvokeHandlers = {
  [K in InvokeChannels]: InvokeHandler<K>;
};

/**
 * Register all IPC handlers with type safety and runtime validation
 * 
 * This function ensures:
 * 1. All invoke channels have handlers (exhaustiveness checking)
 * 2. Handler signatures match channel definitions
 * 3. Request/response payloads are validated at runtime
 */
export function registerIpcHandlers(handlers: InvokeHandlers) {
  // Register each handler with runtime validation
  for (const [channel, handler] of Object.entries(handlers) as [
    InvokeChannels,
    InvokeHandler<InvokeChannels>
  ][]) {
    ipcMain.handle(channel, async (event, rawArgs) => {
      // Validate request payload
      const args = ipc.validateRequest(channel, rawArgs);

      // Call handler
      const result = await handler(event, args);

      // Validate response payload
      return ipc.validateResponse(channel, result);
    });
  }
}

// ============================================================================
// Electron-Specific Utilities
// ============================================================================

/**
 * Get application versions (Electron-specific)
 */
function getVersions(): {
  chrome: string;
  node: string;
  electron: string;
} {
  return {
    chrome: process.versions.chrome,
    node: process.versions.node,
    electron: process.versions.electron,
  };
}

// ============================================================================
// Workspace Watcher (with debouncing and lifecycle management)
// ============================================================================

let watcher: FSWatcher | null = null;
const changeQueue = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Emit knowledge commit event to all renderer windows
 */
function emitKnowledgeCommitEvent(): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send('knowledge:didCommit', {});
    }
  }
}

/**
 * Emit workspace change event to all renderer windows
 */
function emitWorkspaceChangeEvent(event: z.infer<typeof workspaceShared.WorkspaceChangeEvent>): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send('workspace:didChange', event);
    }
  }
}

/**
 * Process queued changes and emit events (debounced)
 */
function processChangeQueue(): void {
  if (changeQueue.size === 0) {
    return;
  }

  const paths = Array.from(changeQueue);
  changeQueue.clear();

  if (paths.length === 1) {
    // For single path, try to determine kind from file stats
    const relPath = paths[0]!;
    try {
      const absPath = workspace.resolveWorkspacePath(relPath);
      fs.lstat(absPath)
        .then((stats) => {
          const kind = stats.isDirectory() ? 'dir' : 'file';
          emitWorkspaceChangeEvent({ type: 'changed', path: relPath, kind });
        })
        .catch(() => {
          // File no longer exists (edge case), emit without kind
          emitWorkspaceChangeEvent({ type: 'changed', path: relPath });
        });
    } catch {
      // Invalid path, ignore
    }
  } else {
    // Emit bulkChanged for multiple paths
    emitWorkspaceChangeEvent({ type: 'bulkChanged', paths });
  }
}

/**
 * Queue a path change for debounced emission
 */
function queueChange(relPath: string): void {
  changeQueue.add(relPath);

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    processChangeQueue();
    debounceTimer = null;
  }, 150); // 150ms debounce
}

/**
 * Handle workspace change event from core watcher
 */
function handleWorkspaceChange(event: z.infer<typeof workspaceShared.WorkspaceChangeEvent>): void {
  // Debounce 'changed' events, emit others immediately
  if (event.type === 'changed' && event.path) {
    queueChange(event.path);
  } else {
    emitWorkspaceChangeEvent(event);
  }
}

/**
 * Start workspace watcher
 * Watches the configured workspace root recursively and emits change events to renderer
 * 
 * This should be called once when the app starts (from main.ts).
 * The watcher runs as a main-process service and catches ALL filesystem changes
 * (both from IPC handlers and external changes like terminal/git).
 * 
 * Safe to call multiple times - guards against duplicate watchers.
 */
export async function startWorkspaceWatcher(): Promise<void> {
  if (watcher) {
    // Watcher already running - safe to ignore subsequent calls
    return;
  }

  watcher = await watcherCore.createWorkspaceWatcher(handleWorkspaceChange);
}

/**
 * Stop workspace watcher
 */
export function stopWorkspaceWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  changeQueue.clear();
}

function emitRunEvent(event: z.infer<typeof RunEvent>): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send('runs:events', event);
    }
  }
}

function emitServiceEvent(event: z.infer<typeof ServiceEvent>): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send('services:events', event);
    }
  }
}

export function emitOAuthEvent(event: { provider: string; success: boolean; error?: string; userId?: string }): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send('oauth:didConnect', event);
    }
  }
}

let runsWatcher: (() => void) | null = null;
export async function startRunsWatcher(): Promise<void> {
  if (runsWatcher) {
    return;
  }
  runsWatcher = await bus.subscribe('*', async (event) => {
    emitRunEvent(event);
  });
}

let servicesWatcher: (() => void) | null = null;
export async function startServicesWatcher(): Promise<void> {
  if (servicesWatcher) {
    return;
  }
  servicesWatcher = await serviceBus.subscribe(async (event) => {
    emitServiceEvent(event);
  });
}

let liveNoteAgentWatcher: (() => void) | null = null;
export function startLiveNoteAgentWatcher(): void {
  if (liveNoteAgentWatcher) return;
  liveNoteAgentWatcher = liveNoteBus.subscribe((event) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send('live-note-agent:events', event);
      }
    }
  });
}

let backgroundTaskAgentWatcher: (() => void) | null = null;
export function startBackgroundTaskAgentWatcher(): void {
  if (backgroundTaskAgentWatcher) return;
  backgroundTaskAgentWatcher = backgroundTaskBus.subscribe((event) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send('bg-task-agent:events', event);
      }
    }
  });
}

export function stopRunsWatcher(): void {
  if (runsWatcher) {
    runsWatcher();
    runsWatcher = null;
  }
}

export function stopServicesWatcher(): void {
  if (servicesWatcher) {
    servicesWatcher();
    servicesWatcher = null;
  }
}

// ============================================================================
// Handler Implementations
// ============================================================================

/**
 * Register all IPC handlers
 * Add new handlers here as you add channels to IPCChannels
 */
export function setupIpcHandlers() {
  // Forward knowledge commit events to renderer for panel refresh
  versionHistory.onCommit(() => emitKnowledgeCommitEvent());

  // Pre-warm the Gmail contact indices so the first compose-box keystroke is instant.
  // - warmContactIndex(): synchronous local-snapshot fallback (instant, narrow coverage).
  // - warmSentContacts(): kicks off a background Gmail API sync of the SENT label
  //   for full historical coverage of people you've actually emailed.
  warmContactIndex();
  warmSentContacts();

  registerIpcHandlers({
    'app:getVersions': async () => {
      // args is null for this channel (no request payload)
      return getVersions();
    },
    'app:consumePendingDeepLink': async () => {
      return { url: consumePendingDeepLink() };
    },
    'analytics:bootstrap': async () => {
      return {
        installationId: getInstallationId(),
        apiUrl: API_URL,
        appVersion: app.getVersion(),
      };
    },
    'workspace:getRoot': async () => {
      return workspace.getRoot();
    },
    'workspace:exists': async (_, args) => {
      return workspace.exists(args.path);
    },
    'workspace:stat': async (_event, args) => {
      return workspace.stat(args.path);
    },
    'workspace:readdir': async (_event, args) => {
      return workspace.readdir(args.path, args.opts);
    },
    'workspace:readFile': async (_event, args) => {
      return workspace.readFile(args.path, args.encoding);
    },
    'workspace:writeFile': async (_event, args) => {
      return workspace.writeFile(args.path, args.data, args.opts);
    },
    'workspace:mkdir': async (_event, args) => {
      return workspace.mkdir(args.path, args.recursive);
    },
    'workspace:rename': async (_event, args) => {
      return workspace.rename(args.from, args.to, args.overwrite);
    },
    'workspace:copy': async (_event, args) => {
      return workspace.copy(args.from, args.to, args.overwrite);
    },
    'workspace:remove': async (_event, args) => {
      return workspace.remove(args.path, args.opts);
    },
    'gmail:getImportant': async (_event, args) => {
      return listImportantThreads({ cursor: args.cursor, limit: args.limit });
    },
    'gmail:getEverythingElse': async (_event, args) => {
      return listEverythingElseThreads({ cursor: args.cursor, limit: args.limit });
    },
    'gmail:triggerSync': async () => {
      triggerGmailSync();
      return {};
    },
    'gmail:sendReply': async (_event, args) => {
      return sendThreadReply(args);
    },
    'gmail:getConnectionStatus': async () => {
      return getGmailConnectionStatus();
    },
    'gmail:getAccountEmail': async () => {
      return { email: await getAccountEmail() };
    },
    'gmail:archiveThread': async (_event, args) => {
      return archiveThread(args.threadId);
    },
    'gmail:trashThread': async (_event, args) => {
      return trashThread(args.threadId);
    },
    'gmail:markThreadRead': async (_event, args) => {
      return markThreadRead(args.threadId);
    },
    'gmail:saveMessageHeight': async (_event, args) => {
      saveMessageBodyHeight(args.threadId, args.messageId, args.height);
      return {};
    },
    'gmail:searchContacts': async (_event, args) => {
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
    'mcp:listTools': async (_event, args) => {
      return mcpCore.listTools(args.serverName, args.cursor);
    },
    'mcp:executeTool': async (_event, args) => {
      return { result: await mcpCore.executeTool(args.serverName, args.toolName, args.input) };
    },
    'runs:create': async (_event, args) => {
      return runsCore.createRun(args);
    },
    'runs:createMessage': async (_event, args) => {
      return { messageId: await runsCore.createMessage(args.runId, args.message, args.voiceInput, args.voiceOutput, args.searchEnabled, args.middlePaneContext, args.codeMode) };
    },
    'runs:authorizePermission': async (_event, args) => {
      await runsCore.authorizePermission(args.runId, args.authorization);
      return { success: true };
    },
    'codeRun:resolvePermission': async (_event, args) => {
      const registry = container.resolve<CodePermissionRegistry>('codePermissionRegistry');
      registry.resolve(args.requestId, args.decision);
      return { success: true };
    },
    'runs:provideHumanInput': async (_event, args) => {
      await runsCore.replyToHumanInputRequest(args.runId, args.reply);
      return { success: true };
    },
    'runs:stop': async (_event, args) => {
      await runsCore.stop(args.runId, args.force);
      return { success: true };
    },
    'runs:fetch': async (_event, args) => {
      return runsCore.fetchRun(args.runId);
    },
    'runs:list': async (_event, args) => {
      return runsCore.listRuns(args.cursor);
    },
    'runs:delete': async (_event, args) => {
      await runsCore.deleteRun(args.runId);
      return { success: true };
    },
    'runs:downloadLog': async (event, args) => {
      const runFileName = `${args.runId}.jsonl`;
      if (path.basename(runFileName) !== runFileName) {
        return { success: false, error: 'Invalid run id' };
      }

      const sourcePath = path.join(WorkDir, 'runs', runFileName);
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${runFileName}.log`,
        filters: [
          { name: 'Chat Log', extensions: ['log'] },
          { name: 'JSONL', extensions: ['jsonl'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      try {
        await fs.copyFile(sourcePath, result.filePath);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to download chat log';
        return { success: false, error: message };
      }
    },
    'models:list': async () => {
      if (await isSignedIn()) {
        return await listGatewayModels();
      }
      return await listOnboardingModels();
    },
    'models:test': async (_event, args) => {
      return await testModelConnection(args.provider, args.model);
    },
    'models:saveConfig': async (_event, args) => {
      const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
      await repo.setConfig(args);
      return { success: true };
    },
    'oauth:connect': async (_event, args) => {
      const credentials = args.clientId && args.clientSecret
        ? { clientId: args.clientId.trim(), clientSecret: args.clientSecret.trim() }
        : undefined;
      return await connectProvider(args.provider, credentials);
    },
    'oauth:disconnect': async (_event, args) => {
      return await disconnectProvider(args.provider);
    },
    'oauth:list-providers': async () => {
      return listProviders();
    },
    'oauth:getState': async () => {
      const repo = container.resolve<IOAuthRepo>('oauthRepo');
      const config = await repo.getClientFacingConfig();
      return { config };
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
    'granola:getConfig': async () => {
      const repo = container.resolve<IGranolaConfigRepo>('granolaConfigRepo');
      const config = await repo.getConfig();
      return { enabled: config.enabled };
    },
    'codeMode:getConfig': async () => {
      const repo = container.resolve<ICodeModeConfigRepo>('codeModeConfigRepo');
      const config = await repo.getConfig();
      return { enabled: config.enabled, approvalPolicy: config.approvalPolicy };
    },
    'codeMode:setConfig': async (_event, args) => {
      const repo = container.resolve<ICodeModeConfigRepo>('codeModeConfigRepo');
      await repo.setConfig({ enabled: args.enabled, approvalPolicy: args.approvalPolicy });
      invalidateCopilotInstructionsCache();
      return { success: true };
    },
    'codeMode:checkAgentStatus': async () => {
      return await checkCodeModeAgentStatus();
    },
    'granola:setConfig': async (_event, args) => {
      const repo = container.resolve<IGranolaConfigRepo>('granolaConfigRepo');
      await repo.setConfig({ enabled: args.enabled });

      // Trigger sync immediately when enabled
      if (args.enabled) {
        triggerGranolaSync();
      }

      return { success: true };
    },
    'slack:getConfig': async () => {
      const repo = container.resolve<ISlackConfigRepo>('slackConfigRepo');
      const config = await repo.getConfig();
      return { enabled: config.enabled, workspaces: config.workspaces };
    },
    'slack:setConfig': async (_event, args) => {
      const repo = container.resolve<ISlackConfigRepo>('slackConfigRepo');
      await repo.setConfig({ enabled: args.enabled, workspaces: args.workspaces });
      return { success: true };
    },
    'slack:listWorkspaces': async () => {
      try {
        const { stdout } = await execAsync('agent-slack auth whoami', { timeout: 10000 });
        const parsed = JSON.parse(stdout);
        const workspaces = (parsed.workspaces || []).map((w: { workspace_url?: string; workspace_name?: string }) => ({
          url: w.workspace_url || '',
          name: w.workspace_name || '',
        }));
        return { workspaces };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to list Slack workspaces';
        return { workspaces: [], error: message };
      }
    },
    'slack:listChannels': async (_event, args) => {
      try {
        const { stdout } = await execFileAsync('agent-slack', ['channel', 'list', '--all', '--workspace', args.workspaceUrl, '--limit', '200'], { timeout: 15000 });
        const parsed = JSON.parse(stdout);
        const rawChannels = Array.isArray(parsed) ? parsed : (parsed.channels || parsed.items || parsed.results || []);
        const channels = rawChannels.map((ch: {
          id?: string;
          name?: string;
          is_private?: boolean;
          isPrivate?: boolean;
          is_member?: boolean;
          isMember?: boolean;
        }) => ({
          id: ch.id || ch.name || '',
          name: ch.name || ch.id || '',
          isPrivate: ch.is_private ?? ch.isPrivate,
          isMember: ch.is_member ?? ch.isMember,
        })).filter((ch: { id: string; name: string }) => ch.id && ch.name);
        return { channels };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to list Slack channels';
        return { channels: [], error: message };
      }
    },
    'slack:getRecentMessages': async (_event, args) => {
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
            const { stdout } = await execFileAsync('agent-slack', ['channel', 'list', '--workspace', workspace.url, '--limit', '12'], { timeout: 15000 });
            const rawChannels = parseJsonArrayPayload(stdout);
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
          try {
            const { stdout } = await execFileAsync('agent-slack', commandArgs, { timeout: 15000, maxBuffer: 1024 * 1024 });
            const rawMessages = parseJsonArrayPayload(stdout);
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
          } catch (error) {
            console.warn(`[Slack] Failed to load messages for ${channel.name}:`, error);
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
        return { enabled: true, messages: [], error: message };
      }
    },
    'knowledgeSources:getConfig': async () => {
      return knowledgeSourcesRepo.getConfig();
    },
    'knowledgeSources:upsert': async (_event, args) => {
      const config = knowledgeSourcesRepo.upsertSource(args);
      if (args.provider === 'slack') {
        triggerSlackKnowledgeSync();
        void syncSlackKnowledgeSources().catch(error => {
          console.error('[SlackKnowledge] Immediate sync after settings update failed:', error);
        });
      }
      return config;
    },
    'onboarding:getStatus': async () => {
      // Show onboarding if it hasn't been completed yet
      const complete = isOnboardingComplete();
      return { showOnboarding: !complete };
    },
    'onboarding:markComplete': async () => {
      markOnboardingComplete();
      return { success: true };
    },
    // Composio integration handlers
    'composio:is-configured': async () => {
      return composioHandler.isConfigured();
    },
    'composio:set-api-key': async (_event, args) => {
      return composioHandler.setApiKey(args.apiKey);
    },
    'composio:initiate-connection': async (_event, args) => {
      return composioHandler.initiateConnection(args.toolkitSlug);
    },
    'composio:get-connection-status': async (_event, args) => {
      return composioHandler.getConnectionStatus(args.toolkitSlug);
    },
    'composio:sync-connection': async (_event, args) => {
      return composioHandler.syncConnection(args.toolkitSlug, args.connectedAccountId);
    },
    'composio:disconnect': async (_event, args) => {
      return composioHandler.disconnect(args.toolkitSlug);
    },
    'composio:list-connected': async () => {
      return composioHandler.listConnected();
    },
    // Composio Tools Library handlers
    'composio:list-toolkits': async () => {
      return composioHandler.listToolkits();
    },
    'migration:check-composio-google': async () => {
      return qualifyAndDisconnectComposioGoogle();
    },
    // Agent schedule handlers
    'agent-schedule:getConfig': async () => {
      const repo = container.resolve<IAgentScheduleRepo>('agentScheduleRepo');
      try {
        return await repo.getConfig();
      } catch {
        // Return empty config if file doesn't exist
        return { agents: {} };
      }
    },
    'agent-schedule:getState': async () => {
      const repo = container.resolve<IAgentScheduleStateRepo>('agentScheduleStateRepo');
      try {
        return await repo.getState();
      } catch {
        // Return empty state if file doesn't exist
        return { agents: {} };
      }
    },
    'agent-schedule:updateAgent': async (_event, args) => {
      const repo = container.resolve<IAgentScheduleRepo>('agentScheduleRepo');
      await repo.upsert(args.agentName, args.entry);
      // Trigger the runner to pick up the change immediately
      triggerAgentScheduleRun();
      return { success: true };
    },
    'agent-schedule:deleteAgent': async (_event, args) => {
      const repo = container.resolve<IAgentScheduleRepo>('agentScheduleRepo');
      const stateRepo = container.resolve<IAgentScheduleStateRepo>('agentScheduleStateRepo');
      await repo.delete(args.agentName);
      await stateRepo.deleteAgentState(args.agentName);
      return { success: true };
    },
    // Shell integration handlers
    'shell:openPath': async (_event, args) => {
      const filePath = resolveShellPath(args.path);
      const error = await shell.openPath(filePath);
      return { error: error || undefined };
    },
    'shell:showItemInFolder': async (_event, args) => {
      const filePath = resolveShellPath(args.path);
      shell.showItemInFolder(filePath);
      return { success: true };
    },
    'shell:readFileBase64': async (_event, args) => {
      const filePath = resolveShellPath(args.path);
      const stat = await fs.stat(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        throw new Error('File too large (>10MB)');
      }
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp', '.ico': 'image/x-icon',
        '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac',
        '.pdf': 'application/pdf', '.json': 'application/json',
        '.txt': 'text/plain', '.md': 'text/markdown',
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      return { data: buffer.toString('base64'), mimeType, size: stat.size };
    },
    'dialog:openDirectory': async (event, args) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const defaultPath = args.defaultPath ? resolveShellPath(args.defaultPath) : os.homedir();
      const result = await dialog.showOpenDialog(win!, {
        title: args.title ?? 'Choose work directory',
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { path: null };
      }
      return { path: result.filePaths[0] ?? null };
    },
    // Knowledge version history handlers
    'knowledge:history': async (_event, args) => {
      const commits = await versionHistory.getFileHistory(args.path);
      return { commits };
    },
    'knowledge:fileAtCommit': async (_event, args) => {
      const content = await versionHistory.getFileAtCommit(args.path, args.oid);
      return { content };
    },
    'knowledge:restore': async (_event, args) => {
      await versionHistory.restoreFile(args.path, args.oid);
      return { ok: true };
    },
    // Search handler
    'search:query': async (_event, args) => {
      return search(args.query, args.limit, args.types);
    },
    // Inline task schedule classification
    'export:note': async (event, args) => {
      const { markdown, format, title } = args;
      const sanitizedTitle = title.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Untitled';

      const filterMap: Record<string, Electron.FileFilter[]> = {
        md: [{ name: 'Markdown', extensions: ['md'] }],
        pdf: [{ name: 'PDF', extensions: ['pdf'] }],
        docx: [{ name: 'Word Document', extensions: ['docx'] }],
      };

      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${sanitizedTitle}.${format}`,
        filters: filterMap[format],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      const filePath = result.filePath;

      if (format === 'md') {
        await fs.writeFile(filePath, markdown, 'utf8');
        return { success: true };
      }

      if (format === 'pdf') {
        // Render markdown as HTML in a hidden window, then print to PDF
        const htmlContent = markdownToHtml(markdown, sanitizedTitle);
        const hiddenWin = new BrowserWindow({
          show: false,
          width: 800,
          height: 600,
          webPreferences: { offscreen: true },
        });
        await hiddenWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        // Small delay to ensure CSS/fonts render
        await new Promise(resolve => setTimeout(resolve, 300));
        const pdfBuffer = await hiddenWin.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
        });
        hiddenWin.destroy();
        await fs.writeFile(filePath, pdfBuffer);
        return { success: true };
      }

      if (format === 'docx') {
        const htmlContent = markdownToHtml(markdown, sanitizedTitle);
        const { default: htmlToDocx } = await import('html-to-docx');
        const docxBuffer = await htmlToDocx(htmlContent, undefined, {
          table: { row: { cantSplit: true } },
          footer: false,
          header: false,
        });
        await fs.writeFile(filePath, Buffer.from(docxBuffer as ArrayBuffer));
        return { success: true };
      }

      return { success: false, error: 'Unknown format' };
    },
    'meeting:checkScreenPermission': async () => {
      if (process.platform !== 'darwin') return { granted: true };
      const status = systemPreferences.getMediaAccessStatus('screen');
      console.log('[meeting] Screen recording permission status:', status);
      if (status === 'granted') return { granted: true };
      // Not granted — call desktopCapturer.getSources() to register the app
      // in the macOS Screen Recording list. On first call this shows the
      // native permission prompt (signed apps are remembered across restarts).
      try { await desktopCapturer.getSources({ types: ['screen'] }); } catch { /* ignore */ }
      // Re-check after the native prompt was dismissed
      const statusAfter = systemPreferences.getMediaAccessStatus('screen');
      console.log('[meeting] Screen recording permission status after prompt:', statusAfter);
      return { granted: statusAfter === 'granted' };
    },
    'meeting:openScreenRecordingSettings': async () => {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      return { success: true };
    },
    'meeting:summarize': async (_event, args) => {
      const notes = await summarizeMeeting(args.transcript, args.meetingStartTime, args.calendarEventJson);
      return { notes };
    },
    'inline-task:classifySchedule': async (_event, args) => {
      const schedule = await classifySchedule(args.instruction);
      return { schedule };
    },
    'inline-task:process': async (_event, args) => {
      return await processRowboatInstruction(args.instruction, args.noteContent, args.notePath);
    },
    'voice:getConfig': async () => {
      return voice.getVoiceConfig();
    },
    'voice:synthesize': async (_event, args) => {
      return voice.synthesizeSpeech(args.text);
    },
    'voice:ensureMicAccess': async () => {
      if (process.platform !== 'darwin') return { granted: true };
      const status = systemPreferences.getMediaAccessStatus('microphone');
      console.log('[voice] Microphone permission status:', status);
      if (status === 'granted') return { granted: true };
      // 'not-determined' shows the native TCC prompt and resolves once the
      // user responds; 'denied'/'restricted' resolve false without prompting.
      // Awaiting this here means the triggering mic click proceeds to
      // getUserMedia only after permission is settled — fixing the first
      // click silently failing while the prompt was still up.
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        console.log('[voice] Microphone permission after prompt:', granted);
        return { granted };
      } catch {
        return { granted: false };
      }
    },
    // Live-note handlers
    'live-note:run': async (_event, args) => {
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
    'live-note:get': async (_event, args) => {
      try {
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:set': async (_event, args) => {
      try {
        await setLiveNote(args.filePath, args.live);
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:setActive': async (_event, args) => {
      try {
        await setLiveNoteActive(args.filePath, args.active);
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:delete': async (_event, args) => {
      try {
        await deleteLiveNote(args.filePath);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'live-note:stop': async (_event, args) => {
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
    'live-note:listNotes': async () => {
      const notes = await listLiveNotes();
      return { notes };
    },
    // Bg-task handlers
    'bg-task:run': async (_event, args) => {
      const result = await runBackgroundTask(args.slug, 'manual', args.context);
      return {
        success: !result.error,
        runId: result.runId,
        summary: result.summary,
        error: result.error,
      };
    },
    'bg-task:get': async (_event, args) => {
      try {
        const task = await fetchTask(args.slug);
        return { success: true, task };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:patch': async (_event, args) => {
      try {
        const task = await patchTask(args.slug, args.partial);
        return { success: true, task };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:create': async (_event, args) => {
      try {
        const { slug } = await createTask({
          name: args.name,
          instructions: args.instructions,
          ...(args.triggers ? { triggers: args.triggers } : {}),
          ...(args.model ? { model: args.model } : {}),
          ...(args.provider ? { provider: args.provider } : {}),
        });
        return { success: true, slug };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:delete': async (_event, args) => {
      try {
        await deleteTask(args.slug);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'bg-task:stop': async (_event, args) => {
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
    'bg-task:list': async (_event, args) => {
      return listTasks(args);
    },
    'bg-task:listRunIds': async (_event, args) => {
      const runIds = await readTaskRunIds(args.slug, args.limit);
      return { runIds };
    },
    // Billing handler
    'billing:getInfo': async () => {
      return await getBillingInfo();
    },
    'notifications:getSettings': async () => {
      return loadNotificationSettings();
    },
    'notifications:setSettings': async (_event, args) => {
      saveNotificationSettings(args);
      return { success: true };
    },
    // Embedded browser handlers (WebContentsView + navigation)
    ...browserIpcHandlers,
  });
}
