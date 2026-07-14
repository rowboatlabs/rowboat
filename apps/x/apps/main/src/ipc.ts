import { ipcMain, BrowserWindow, shell, dialog, systemPreferences, desktopCapturer, app, screen, powerSaveBlocker } from 'electron';
import { ipc } from '@x/shared';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  connectProvider,
  disconnectProvider,
  listProviders,
} from './oauth-handler.js';
import { watcher as watcherCore, workspace } from '@x/core';
import { WorkDir } from '@x/core/dist/config/config.js';
import { workspace as workspaceShared } from '@x/shared';
import * as mcpCore from '@x/core/dist/mcp/mcp.js';
import * as runsCore from '@x/core/dist/runtime/legacy/runs.js';
import { bus } from '@x/core/dist/runtime/legacy/bus.js';
import { serviceBus } from '@x/core/dist/services/service_bus.js';
import type { FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import z from 'zod';

const execFileAsync = promisify(execFile);

// Active powerSaveBlocker id while Caffeinate is toggled on; null when off.
let caffeinateBlockerId: number | null = null;

import { RunEvent } from '@x/shared/dist/runs.js';
import { ServiceEvent } from '@x/shared/dist/service-events.js';
import type { SessionBusEvent } from '@x/shared/dist/sessions.js';
import { isDurableTurnEvent } from '@x/shared/dist/turns.js';
import type { ISessions, EmitterSessionBus } from '@x/core/dist/runtime/sessions/index.js';
import type { ITurnEventBus } from '@x/core/dist/runtime/turns/event-hub.js';
import container from '@x/core/dist/di/container.js';
import { listOnboardingModels } from '@x/core/dist/models/models-dev.js';
import { testModelConnection, listModelsForProvider, generateOneShot } from '@x/core/dist/models/models.js';
import { getDefaultModelAndProvider } from '@x/core/dist/models/defaults.js';
import { isSignedIn } from '@x/core/dist/account/account.js';
import { listGatewayModels } from '@x/core/dist/models/gateway.js';
import type { IModelConfigRepo } from '@x/core/dist/models/repo.js';
import type { IOAuthRepo } from '@x/core/dist/auth/repo.js';
import { IGranolaConfigRepo } from '@x/core/dist/knowledge/granola/repo.js';
import { ICodeModeConfigRepo } from '@x/core/dist/code-mode/repo.js';
import { CodePermissionRegistry } from '@x/core/dist/code-mode/acp/permission-registry.js';
import type { CodeRunFeed } from '@x/core/dist/code-mode/feed.js';
import { checkCodeModeAgentStatus } from '@x/core/dist/code-mode/status.js';
import { ensureEngine } from '@x/core/dist/code-mode/acp/engine-provisioner.js';
import type { ICodeProjectsRepo } from '@x/core/dist/code-mode/projects/repo.js';
import type { ICodeSessionsRepo } from '@x/core/dist/code-mode/sessions/repo.js';
import { CodeSessionService } from '@x/core/dist/code-mode/sessions/service.js';
import { CodeSessionStatusTracker } from '@x/core/dist/code-mode/sessions/status-tracker.js';
import type { CodeModeManager } from '@x/core/dist/code-mode/acp/manager.js';
import * as codeGit from '@x/core/dist/code-mode/git/service.js';
import { readProjectDir, readProjectFile } from '@x/core/dist/code-mode/projects/fs.js';
import { ensureTerminal, writeTerminal, resizeTerminal, disposeTerminal } from './terminal.js';
import type { CodeSession } from '@x/shared/dist/code-sessions.js';
import { invalidateCopilotInstructionsCache } from '@x/core/dist/runtime/assembly/copilot/instructions.js';
import { triggerSync as triggerGranolaSync } from '@x/core/dist/knowledge/granola/sync.js';
import { ISlackConfigRepo } from '@x/core/dist/slack/repo.js';
import { IChannelsConfigRepo } from '@x/core/dist/channels/repo.js';
import { applyChannelsConfig, getChannelsStatus, logoutWhatsApp, subscribeChannelsStatus } from '@x/core/dist/channels/service.js';
import { runAgentSlack, getAgentSlackCliStatus, AgentSlackRunError } from '@x/core/dist/slack/agent-slack-exec.js';
import { knowledgeSourcesRepo } from '@x/core/dist/knowledge/sources/repo.js';
import { rankSlackHomeMessages } from '@x/core/dist/knowledge/sources/rank_slack_home.js';
import { syncSlackKnowledgeSources, triggerSync as triggerSlackKnowledgeSync, getSlackKnowledgeSyncStatus } from '@x/core/dist/knowledge/sources/sync_slack.js';
import { isOnboardingComplete, markOnboardingComplete } from '@x/core/dist/config/note_creation_config.js';
import { loadNotificationSettings, saveNotificationSettings } from '@x/core/dist/config/notification_config.js';
import * as composioHandler from './composio-handler.js';
import * as appsIndexer from '@x/core/dist/apps/indexer.js';
import * as appsServer from '@x/core/dist/apps/server.js';
import * as appsAgents from '@x/core/dist/apps/agents.js';
import { capture } from '@x/core/dist/analytics/posthog.js';
import * as githubAuth from '@x/core/dist/apps/github-auth.js';
import * as appsStars from '@x/core/dist/apps/stars.js';
import * as appsInstaller from '@x/core/dist/apps/installer.js';
import { registryClient } from '@x/core/dist/apps/registry.js';
import * as appsPublisher from '@x/core/dist/apps/publisher.js';

// D18 install previews awaiting confirmation, keyed by app name.
const appInstallPreviews = new Map<string, Awaited<ReturnType<typeof appsInstaller.previewInstall>>>();
// Last-seen app-set fingerprint; a change invalidates the copilot
// instructions cache (they embed the installed-apps list).
let lastAppsFingerprint: string | null = null;
import { consumePendingDeepLink } from './deeplink.js';
import { qualifyAndDisconnectComposioGoogle } from '@x/core/dist/migrations/composio-google-migration.js';
import { IAgentScheduleRepo } from '@x/core/dist/agent-schedule/repo.js';
import { IAgentScheduleStateRepo } from '@x/core/dist/agent-schedule/state-repo.js';
import { triggerRun as triggerAgentScheduleRun } from '@x/core/dist/agent-schedule/runner.js';
import { search } from '@x/core/dist/search/search.js';
import { resolveMeetingPrep } from '@x/core/dist/knowledge/meeting_prep.js';
import { readPrepNoteForEvent } from '@x/core/dist/knowledge/meeting_prep_brief.js';
import { invalidateKnowledgeIndex } from '@x/core/dist/knowledge/knowledge_index.js';
import { versionHistory, voice } from '@x/core';
import { classifySchedule, processRowboatInstruction } from '@x/core/dist/knowledge/inline_tasks.js';
import { getBillingInfo } from '@x/core/dist/billing/billing.js';
import { summarizeMeeting } from '@x/core/dist/knowledge/summarize_meeting.js';
import { getAccessToken } from '@x/core/dist/auth/tokens.js';
import { getRowboatConfig } from '@x/core/dist/config/rowboat.js';
import { runLiveNoteAgent } from '@x/core/dist/knowledge/live-note/runner.js';
import { listImportantThreads, listEverythingElseThreads, saveMessageBodyHeight, triggerSync as triggerGmailSync, sendThreadReply, saveThreadDraft, deleteThreadDraft, listDraftThreads, searchThreads, archiveThread, archiveCategoryThreads, trashThread, markThreadRead, downloadAttachment, getAccountEmail, getAccountName, getConnectionStatus as getGmailConnectionStatus, setThreadImportance, setThreadCategory } from '@x/core/dist/knowledge/sync_gmail.js';
import { loadEmailInstructions, saveEmailInstructions } from '@x/core/dist/knowledge/email_instructions.js';
import { getEmailLabels, syncCustomLabelsFromInstructions } from '@x/core/dist/knowledge/email_labels.js';
import { searchContacts as searchGmailContacts, warmContactIndex } from '@x/core/dist/knowledge/gmail_contacts.js';
import { searchSentContacts, warmSentContacts } from '@x/core/dist/knowledge/gmail_sent_contacts.js';
import { getGoogleDocsConnectionStatus, importGoogleDoc, syncGoogleDocDown, syncGoogleDocUp, getGoogleDocLink } from '@x/core/dist/knowledge/google_docs.js';
import { importObsidianVault, importNotionExport } from '@x/core/dist/knowledge/import_notes.js';
import { startManagedGooglePick } from './google-picker-managed.js';
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

function parseWhoamiWorkspaces(data: unknown): Array<{ url: string; name: string }> {
  const parsed = (data ?? {}) as { workspaces?: Array<{ workspace_url?: string; workspace_name?: string }> };
  return (parsed.workspaces || []).map((w) => ({
    url: w.workspace_url || '',
    name: w.workspace_name || '',
  }));
}

type SlackAuthResult = {
  ok: boolean;
  workspaces: Array<{ url: string; name: string }>;
  error?: string;
  errorKind?: 'not_installed' | 'timeout' | 'parse_error' | 'not_authed' | 'rate_limited' | 'network' | 'bad_channel' | 'unknown';
};

// Run `auth import-desktop`, then read back the workspaces via `auth whoami`.
// Shared by the plain and the quit-Slack-first import handlers.
async function importDesktopAndReadWorkspaces(): Promise<SlackAuthResult> {
  const imported = await runAgentSlack(['auth', 'import-desktop'], { timeoutMs: 20000, parseJson: false });
  if (!imported.ok) {
    return { ok: false, workspaces: [], error: imported.message, errorKind: imported.kind };
  }
  const whoami = await runAgentSlack(['auth', 'whoami'], { timeoutMs: 10000 });
  if (!whoami.ok) {
    return { ok: false, workspaces: [], error: whoami.message, errorKind: whoami.kind };
  }
  const workspaces = parseWhoamiWorkspaces(whoami.data);
  if (workspaces.length === 0) {
    return { ok: false, workspaces: [], error: 'No signed-in Slack workspaces found in the desktop app.', errorKind: 'not_authed' };
  }
  return { ok: true, workspaces };
}

// Windows force-quits Slack so its exclusive Cookies-DB lock releases before
// desktop import (the EBUSY cause). No-op on mac/Linux, where import works with
// Slack open. taskkill exits non-zero when nothing matches — that's fine.
async function quitSlackIfWindows(): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    await execFileAsync('taskkill', ['/F', '/IM', 'Slack.exe'], { timeout: 10000, windowsHide: true });
  } catch {
    // No running Slack process to kill — nothing to do.
  }
  // Give Windows a moment to release the file handles before we copy them.
  await new Promise(resolve => setTimeout(resolve, 800));
}

function extractArrayPayload(parsed: unknown): unknown[] {
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

  const result = await runAgentSlack(args, { timeoutMs: 10000, maxBuffer: 512 * 1024 });
  if (result.ok) {
    const name = extractSlackUserName(result.data ?? {});
    if (name) {
      cache.set(key, name);
      return name;
    }
  } else {
    console.warn(`[Slack] Failed to resolve user ${userId}: ${result.message}`);
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

// In-flight streaming TTS requests, keyed by renderer-chosen requestId.
const activeTtsStreams = new Map<string, AbortController>();

// Video-mode popout window (shown for the whole duration of a screen share,
// floating over every app including Rowboat itself) and the last call state
// pushed by the main window — replayed to the popout when it finishes loading.
let videoPopoutWin: BrowserWindow | null = null;
let lastVideoPopoutState: {
  ttsState: 'idle' | 'synthesizing' | 'speaking';
  status: 'listening' | 'thinking' | 'speaking' | null;
  cameraOn: boolean;
  micMuted: boolean;
  screenSharing: boolean;
  interimText: string | null;
} | null = null;

// Match only real app windows — getAllWindows() can also contain the popout
// itself and hidden utility windows (e.g. PDF-export renderers), which must
// not be shown, focused, or sent app events.
function findMainAppWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => {
    if (w === videoPopoutWin || w.isDestroyed()) return false;
    const url = w.webContents.getURL();
    const isAppWindow = url.startsWith('app://') || url.startsWith('http://localhost');
    return isAppWindow && !url.includes('#video-popout');
  });
}

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
  broadcastToWindows('knowledge:didCommit', {});
}

/**
 * Emit workspace change event to all renderer windows
 */
function emitWorkspaceChangeEvent(event: z.infer<typeof workspaceShared.WorkspaceChangeEvent>): void {
  broadcastToWindows('workspace:didChange', event);
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
function touchesKnowledge(event: z.infer<typeof workspaceShared.WorkspaceChangeEvent>): boolean {
  const hit = (p: string | undefined) => typeof p === 'string' && p.startsWith('knowledge/');
  switch (event.type) {
    case 'created':
    case 'changed':
    case 'deleted':
      return hit(event.path);
    case 'moved':
      return hit(event.from) || hit(event.to);
    case 'bulkChanged':
      return !event.paths || event.paths.some(hit);
    default:
      return false;
  }
}

function handleWorkspaceChange(event: z.infer<typeof workspaceShared.WorkspaceChangeEvent>): void {
  // Any knowledge-base change drops the cached index so the next read rebuilds.
  if (touchesKnowledge(event)) invalidateKnowledgeIndex();
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

// The one renderer fan-out: send a payload to every live window on a channel.
// All broadcast feeds (runs, services, sessions, turns, code runs, agent
// status) go through here.
function broadcastToWindows(channel: string, payload: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  }
}

function emitRunEvent(event: z.infer<typeof RunEvent>): void {
  broadcastToWindows('runs:events', event);
}

function emitServiceEvent(event: z.infer<typeof ServiceEvent>): void {
  broadcastToWindows('services:events', event);
}

export function emitOAuthEvent(event: { provider: string; success: boolean; error?: string; userId?: string }): void {
  // Native connection status (e.g. Google) is baked into the Copilot system
  // prompt, so any OAuth state change must rebuild it.
  invalidateCopilotInstructionsCache();
  broadcastToWindows('oauth:didConnect', event);
}

async function requireCodeSession(sessionId: string): Promise<CodeSession> {
  const repo = container.resolve<ICodeSessionsRepo>('codeSessionsRepo');
  const session = await repo.get(sessionId);
  if (!session) {
    throw new Error(`Unknown code session: ${sessionId}`);
  }
  return session;
}

let codeSessionStatusWatcher: (() => void) | null = null;
export async function startCodeSessionStatusWatcher(): Promise<void> {
  if (codeSessionStatusWatcher) {
    return;
  }
  const tracker = container.resolve<CodeSessionStatusTracker>('codeSessionStatusTracker');
  await tracker.start();
  codeSessionStatusWatcher = tracker.onTransition((sessionId, status) => {
    broadcastToWindows('codeSession:status', { sessionId, status });
  });
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

// New runtime: session bus → renderer windows (session-design.md §10).
function emitSessionEvent(event: SessionBusEvent): void {
  broadcastToWindows('sessions:events', event);
}

// Mobile channels: status changes (QR pairing, connect/disconnect) → renderer.
let channelsWatcher: (() => void) | null = null;
export function startChannelsWatcher(): void {
  if (channelsWatcher) return;
  channelsWatcher = subscribeChannelsStatus((status) => {
    broadcastToWindows('channels:status', status);
  });
}

let sessionsWatcher: (() => void) | null = null;
export function startSessionsWatcher(): void {
  if (sessionsWatcher) {
    return;
  }
  const sessionBus = container.resolve<EmitterSessionBus>('sessionBus');
  sessionsWatcher = sessionBus.subscribe((event) => emitSessionEvent(event));
}

// Turn event spine → renderer windows: durable events of every turn the
// runtime executes (session chat, headless background/knowledge runners,
// spawned sub-agents), tagged with sessionId and the event's file offset so
// consumers can join a live turn against a sessions:getTurn snapshot without
// gaps or duplicates. Durable events are broadcast to every window;
// text/reasoning deltas are high-volume and ephemeral, so they are sent only
// to windows that subscribed to that turn via turns:subscribe.
const turnDeltaSubs = new Map<Electron.WebContents, Set<string>>();

export function subscribeTurnDeltas(sender: Electron.WebContents, turnId: string): void {
  let turnIds = turnDeltaSubs.get(sender);
  if (!turnIds) {
    turnIds = new Set();
    turnDeltaSubs.set(sender, turnIds);
    sender.once('destroyed', () => turnDeltaSubs.delete(sender));
  }
  turnIds.add(turnId);
}

export function unsubscribeTurnDeltas(sender: Electron.WebContents, turnId: string): void {
  const turnIds = turnDeltaSubs.get(sender);
  if (!turnIds) {
    return;
  }
  turnIds.delete(turnId);
  if (turnIds.size === 0) {
    turnDeltaSubs.delete(sender);
  }
}

let turnEventsWatcher: (() => void) | null = null;
export function startTurnEventsWatcher(): void {
  if (turnEventsWatcher) {
    return;
  }
  const hub = container.resolve<ITurnEventBus>('turnEventBus');
  turnEventsWatcher = hub.subscribeAll((event) => {
    if (isDurableTurnEvent(event.event)) {
      broadcastToWindows('turns:events', event);
      return;
    }
    for (const [sender, turnIds] of turnDeltaSubs) {
      if (turnIds.has(event.turnId) && !sender.isDestroyed()) {
        sender.send('turns:events', event);
      }
    }
  });
}

// Ephemeral code-run stream: CodeRunFeed → all renderer windows. A direct
// tool→renderer side-channel that bypasses the turn runtime; the durable
// record is the settle-time code-run-events-batch tool progress.
let codeRunFeedWatcher: (() => void) | null = null;
export function startCodeRunFeedWatcher(): void {
  if (codeRunFeedWatcher) {
    return;
  }
  const feed = container.resolve<CodeRunFeed>('codeRunFeed');
  codeRunFeedWatcher = feed.subscribe((event) => {
    broadcastToWindows('codeRun:events', event);
  });
}

// The renderer window is created before the session-index startup scan
// finishes, so an early sessions:list could observe a partially built index
// (the scan runs oldest-first — exactly the newest chats would be missing).
// sessions:list awaits this deferred; main.ts resolves it when the scan
// settles (success or failure, so the list never hangs).
let resolveSessionsIndexReady: () => void;
const sessionsIndexReady = new Promise<void>((resolve) => {
  resolveSessionsIndexReady = resolve;
});
export function markSessionsIndexReady(): void {
  resolveSessionsIndexReady();
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
    broadcastToWindows('live-note-agent:events', event);
  });
}

let backgroundTaskAgentWatcher: (() => void) | null = null;
export function startBackgroundTaskAgentWatcher(): void {
  if (backgroundTaskAgentWatcher) return;
  backgroundTaskAgentWatcher = backgroundTaskBus.subscribe((event) => {
    broadcastToWindows('bg-task-agent:events', event);
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
      return listEverythingElseThreads({ cursor: args.cursor, limit: args.limit, category: args.category });
    },
    'gmail:triggerSync': async () => {
      triggerGmailSync();
      return {};
    },
    'gmail:sendReply': async (_event, args) => {
      return sendThreadReply(args);
    },
    'gmail:saveDraft': async (_event, args) => {
      return saveThreadDraft(args);
    },
    'gmail:deleteDraft': async (_event, args) => {
      return deleteThreadDraft(args.draftId);
    },
    'gmail:getDrafts': async () => {
      return listDraftThreads();
    },
    'gmail:search': async (_event, args) => {
      return searchThreads(args.query, { limit: args.limit });
    },
    'gmail:getConnectionStatus': async () => {
      return getGmailConnectionStatus();
    },
    'gmail:getAccountEmail': async () => {
      return { email: await getAccountEmail() };
    },
    'gmail:getAccountName': async () => {
      return { name: await getAccountName() };
    },
    'gmail:setImportance': async (_event, args) => {
      const result = setThreadImportance(args.threadId, args.importance);
      return { ok: result.success, previous: result.previous, error: result.error };
    },
    'gmail:setCategory': async (_event, args) => {
      const result = setThreadCategory(args.threadId, args.category);
      return { ok: result.success, error: result.error };
    },
    'gmail:archiveCategory': async (_event, args) => {
      return archiveCategoryThreads(args.category);
    },
    'gmail:getEmailInstructions': async () => {
      return { instructions: loadEmailInstructions() };
    },
    'gmail:setEmailInstructions': async (_event, args) => {
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
    'gmail:archiveThread': async (_event, args) => {
      return archiveThread(args.threadId);
    },
    'gmail:trashThread': async (_event, args) => {
      return trashThread(args.threadId);
    },
    'gmail:markThreadRead': async (_event, args) => {
      return markThreadRead(args.threadId, args.read);
    },
    'gmail:downloadAttachment': async (_event, args) => {
      return downloadAttachment(args);
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
      return { messageId: await runsCore.createMessage(args.runId, args.message, args.voiceInput, args.voiceOutput, args.searchEnabled, args.middlePaneContext, args.codeMode, args.codeCwd, args.codePolicy) };
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
    'runs:listByWorkDir': async (_event, args) => {
      return runsCore.listRunsByWorkDir(args.dir);
    },
    'runs:delete': async (_event, args) => {
      await runsCore.deleteRun(args.runId);
      return { success: true };
    },
    // ── New runtime: sessions + turns ─────────────────────────
    // Thin pass-throughs to the sessions service. sendMessage returns the
    // turnId immediately; the turn advances in the background and the
    // renderer reconciles via the sessions:events feed. Input-routing calls
    // settle with that advance's outcome (the renderer fire-and-forgets).
    'sessions:create': async (_event, args) => {
      const sessionId = await container.resolve<ISessions>('sessions').createSession(args);
      return { sessionId };
    },
    'sessions:list': async () => {
      await sessionsIndexReady;
      return { sessions: container.resolve<ISessions>('sessions').listSessions() };
    },
    'sessions:get': async (_event, args) => {
      return container.resolve<ISessions>('sessions').getSession(args.sessionId);
    },
    'sessions:getTurn': async (_event, args) => {
      return container.resolve<ISessions>('sessions').getTurn(args.turnId);
    },
    'sessions:sendMessage': async (_event, args) => {
      return container.resolve<ISessions>('sessions').sendMessage(args.sessionId, args.input, args.config);
    },
    'sessions:respondToPermission': async (_event, args) => {
      await container.resolve<ISessions>('sessions').respondToPermission(args.turnId, args.toolCallId, args.decision, args.metadata);
      return { success: true };
    },
    'sessions:respondToAskHuman': async (_event, args) => {
      await container.resolve<ISessions>('sessions').respondToAskHuman(args.turnId, args.toolCallId, args.answer);
      return { success: true };
    },
    'sessions:stopTurn': async (_event, args) => {
      await container.resolve<ISessions>('sessions').stopTurn(args.turnId, args.reason);
      return { success: true };
    },
    'sessions:resumeTurn': async (_event, args) => {
      await container.resolve<ISessions>('sessions').resumeTurn(args.sessionId);
      return { success: true };
    },
    'sessions:setTitle': async (_event, args) => {
      await container.resolve<ISessions>('sessions').setTitle(args.sessionId, args.title);
      return { success: true };
    },
    'sessions:delete': async (_event, args) => {
      await container.resolve<ISessions>('sessions').deleteSession(args.sessionId);
      return { success: true };
    },
    'turns:subscribe': async (event, args) => {
      subscribeTurnDeltas(event.sender, args.turnId);
      return { success: true };
    },
    'turns:unsubscribe': async (event, args) => {
      unsubscribeTurnDeltas(event.sender, args.turnId);
      return { success: true };
    },
    'sessions:downloadLog': async (event, args) => {
      // Concatenate the session's turn logs into one JSONL for debugging.
      const sessions = container.resolve<ISessions>('sessions');
      const state = await sessions.getSession(args.sessionId);
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${args.sessionId}.jsonl.log`,
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
        const lines: string[] = [];
        for (const ref of state.turns) {
          const turn = await sessions.getTurn(ref.turnId);
          for (const turnEvent of turn.events) {
            lines.push(JSON.stringify(turnEvent));
          }
        }
        await fs.writeFile(result.filePath, lines.join('\n') + '\n');
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to download chat log';
        return { success: false, error: message };
      }
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
    'models:listForProvider': async (_event, args) => {
      try {
        const models = await listModelsForProvider(args.provider);
        return { success: true, models };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list models';
        return { success: false, error: message };
      }
    },
    'llm:getDefaultModel': async () => {
      return await getDefaultModelAndProvider();
    },
    'llm:generate': async (_event, args) => {
      console.log(`[llm:generate] requested provider=${args.provider ?? '(default)'} model=${args.model ?? '(default)'}`);
      const result = await generateOneShot(args);
      console.log(`[llm:generate] -> provider=${result.provider ?? '?'} model=${result.model ?? '?'} chars=${result.text?.length ?? 0}${result.error ? ` error=${result.error}` : ''}`);
      return result;
    },
    'models:saveConfig': async (_event, args) => {
      const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
      await repo.setConfig(args);
      return { success: true };
    },
    'models:updateConfig': async (_event, args) => {
      const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
      await repo.updateConfig(args);
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
    'codeMode:provisionEngine': async (_event, args) => {
      // Download + install the agent's engine, streaming progress back to the
      // requesting window so Settings can show a live bar. 'check' is instant — skip it.
      try {
        await ensureEngine(args.agent, {
          onProgress: (p) => {
            if (p.phase === 'check') return;
            _event.sender.send('codeMode:engineProgress', {
              agent: args.agent,
              phase: p.phase,
              receivedBytes: p.receivedBytes,
              totalBytes: p.totalBytes,
            });
          },
        });
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    'codeProject:add': async (_event, args) => {
      const repo = container.resolve<ICodeProjectsRepo>('codeProjectsRepo');
      const project = await repo.add(args.path);
      const git = await codeGit.repoInfo(project.path);
      return { project, git };
    },
    'codeProject:remove': async (_event, args) => {
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
    'codeSession:create': async (_event, args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      const session = await service.create(args);
      return { session };
    },
    'codeSession:list': async () => {
      const repo = container.resolve<ICodeSessionsRepo>('codeSessionsRepo');
      const tracker = container.resolve<CodeSessionStatusTracker>('codeSessionStatusTracker');
      return { sessions: await repo.list(), statuses: tracker.getStatuses() };
    },
    'codeSession:update': async (_event, args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      return { session: await service.update(args.sessionId, args.patch) };
    },
    'codeMode:listModelOptions': async (_event, args) => {
      const manager = container.resolve<CodeModeManager>('codeModeManager');
      return manager.listModelOptions(args.agent);
    },
    'codeSession:delete': async (_event, args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      disposeTerminal(args.sessionId);
      await service.delete(args.sessionId, {
        removeWorktree: args.removeWorktree,
        deleteBranch: args.deleteBranch,
      });
      return { success: true };
    },
    'codeSession:sendMessage': async (_event, args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      // Intentionally not awaited: the turn can run for minutes and streams over
      // runs:events. sendMessage validates synchronously enough that busy/unknown
      // errors are reported via the run's error events instead.
      const resultPromise = service.sendMessage(args.sessionId, args.text);
      // Surface immediate rejections (busy session, unknown id) to the caller.
      const result = await Promise.race([
        resultPromise,
        new Promise<{ accepted: true }>((resolve) => setTimeout(() => resolve({ accepted: true }), 300)),
      ]);
      resultPromise.catch((err) => console.error('codeSession:sendMessage failed', err));
      return result;
    },
    'codeSession:stop': async (_event, args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      await service.stop(args.sessionId);
      return { success: true };
    },
    'codeSession:gitStatus': async (_event, args) => {
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
    'codeSession:fileDiff': async (_event, args) => {
      const session = await requireCodeSession(args.sessionId);
      return codeGit.fileDiff(session.cwd, args.path, {
        baseRef: session.worktree && !session.worktree.removedAt ? session.worktree.baseBranch : null,
      });
    },
    'codeSession:readdir': async (_event, args) => {
      const session = await requireCodeSession(args.sessionId);
      return { entries: await readProjectDir(session.cwd, args.relPath) };
    },
    'codeSession:readFile': async (_event, args) => {
      const session = await requireCodeSession(args.sessionId);
      return readProjectFile(session.cwd, args.relPath);
    },
    'codeSession:mergeBack': async (_event, args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      return service.mergeBack(args.sessionId);
    },
    'codeSession:cleanupWorktree': async (_event, args) => {
      const service = container.resolve<CodeSessionService>('codeSessionService');
      try {
        await service.cleanupWorktree(args.sessionId, args.deleteBranch);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to clean up worktree';
        return { success: false, error: message };
      }
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
    // ── Caffeinate (keep system awake, like macOS `caffeinate`) ──
    'power:getCaffeinate': async () => {
      return { enabled: caffeinateBlockerId !== null && powerSaveBlocker.isStarted(caffeinateBlockerId) };
    },
    'power:setCaffeinate': async (_event, args) => {
      if (args.enabled) {
        if (caffeinateBlockerId === null || !powerSaveBlocker.isStarted(caffeinateBlockerId)) {
          caffeinateBlockerId = powerSaveBlocker.start('prevent-app-suspension');
        }
      } else if (caffeinateBlockerId !== null) {
        if (powerSaveBlocker.isStarted(caffeinateBlockerId)) {
          powerSaveBlocker.stop(caffeinateBlockerId);
        }
        caffeinateBlockerId = null;
      }
      const enabled = caffeinateBlockerId !== null;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('power:caffeinateChanged', { enabled });
        }
      }
      return { enabled };
    },
    // ── Mobile channels (WhatsApp / Telegram bridge) ─────────────
    'channels:getConfig': async () => {
      return container.resolve<IChannelsConfigRepo>('channelsConfigRepo').getConfig();
    },
    'channels:setConfig': async (_event, args) => {
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
    'slack:setConfig': async (_event, args) => {
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
    'slack:importDesktopAuth': async () => {
      // Pull xoxc token(s) + cookie from the running/installed Slack desktop
      // app into agent-slack's credential store, then read back the workspaces.
      return await importDesktopAndReadWorkspaces();
    },
    'slack:quitAndImportDesktop': async () => {
      // Windows-only convenience: kill Slack (which locks its Cookies DB) then
      // run the normal desktop import in one click.
      await quitSlackIfWindows();
      return await importDesktopAndReadWorkspaces();
    },
    'slack:parseCurlAuth': async (_event, args) => {
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
    'slack:listChannels': async (_event, args) => {
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
    'knowledgeSources:getConfig': async () => {
      return knowledgeSourcesRepo.getConfig();
    },
    'knowledgeSources:upsert': async (_event, args) => {
      const config = knowledgeSourcesRepo.upsertSource(args);
      if (args.provider === 'slack') {
        // The Copilot prompt lists the selected Slack channels, so refresh it
        // whenever the channel selection changes.
        invalidateCopilotInstructionsCache();
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
    'composio:execute-tool': async (_event, args) => {
      return composioHandler.executeTool(args.toolkitSlug, args.toolSlug, args.arguments);
    },
    'composio:search-tools': async (_event, args) => {
      return composioHandler.searchToolsInToolkit(args.toolkitSlug, args.query);
    },
    'migration:check-composio-google': async () => {
      return qualifyAndDisconnectComposioGoogle();
    },
    // Rowboat Apps handlers (spec §13)
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
      return {
        serverRunning: status.running,
        ...(status.error ? { serverError: status.error } : {}),
        apps,
      };
    },
    'apps:get': async (_event, args) => {
      const app = await appsIndexer.getApp(args.folder);
      if (!app) throw new Error(`no such app: ${args.folder}`);
      const readme = await appsIndexer.readAppReadme(args.folder);
      return {
        app,
        ...(readme ? { readme } : {}),
        rollbackAvailable: await appsIndexer.rollbackAvailable(args.folder),
      };
    },
    'apps:create': async (_event, args) => {
      const app = await appsIndexer.createApp(args);
      capture('app_created', { folder: app.folder });
      return { app };
    },
    'apps:delete': async (_event, args) => {
      await appsIndexer.deleteApp(args.folder);
      // Remove app-owned bg-tasks too — orphaned app--<folder>-- tasks firing
      // against a deleted app was a painful prototype failure mode.
      await appsAgents.deleteAppAgents(args.folder);
      capture('app_deleted', { folder: args.folder });
      return { ok: true as const };
    },
    'apps:setTheme': async (_event, args) => {
      appsServer.setAppsTheme(args.theme);
      return { ok: true as const };
    },
    // GitHub auth (device flow) — publishing only
    // Catalog + install/update (spec §12–13)
    'apps:catalogIndex': async (_event, args) => {
      return registryClient.refreshIndex(args.force);
    },
    'apps:catalogSearch': async (_event, args) => {
      return { records: await registryClient.search(args.query) };
    },
    'apps:catalogStars': async (_event, args) => {
      const [stars, starred] = await Promise.all([
        appsStars.repoStars(args.repos),
        appsStars.starredStatus(args.repos),
      ]);
      return { stars, starred };
    },
    'apps:star': async (_event, args) => {
      const result = await appsStars.setStar(args.repo, args.star);
      capture('app_starred', { repo: args.repo, star: args.star });
      return result;
    },
    'apps:catalogDetail': async (_event, args) => {
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
    'apps:install': async (_event, args) => {
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
    'apps:installFromUrl': async (_event, args) => {
      if (!args.confirmed) {
        return appsInstaller.previewUrlInstall(args.url);
      }
      const result = await appsInstaller.confirmUrlInstall(args.url);
      if (result.app) await appsAgents.syncAppAgents(result.app);
      capture('app_installed', { name: result.app.manifest?.name ?? result.app.folder });
      return result;
    },
    'apps:uninstall': async (_event, args) => {
      await appsInstaller.uninstallApp(args.folder);
      capture('app_uninstalled', { folder: args.folder });
      return { ok: true as const };
    },
    'apps:checkUpdate': async (_event, args) => {
      return appsInstaller.checkUpdate(args.folder);
    },
    'apps:update': async (_event, args) => {
      const before = (await appsIndexer.getApp(args.folder))?.manifest?.version;
      const app = await appsInstaller.updateApp(args.folder, {
        confirmOverwriteModified: args.confirmOverwriteModified,
        confirmNewCapabilities: args.confirmNewCapabilities,
      });
      capture('app_updated', { from: before, to: app.manifest?.version });
      return { app };
    },
    'apps:rollback': async (_event, args) => {
      return { app: await appsInstaller.rollbackApp(args.folder) };
    },
    'apps:publish': async (event, args) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await appsPublisher.publishApp(args.folder, (step, detail) => {
        win?.webContents.send('apps:progress', { folder: args.folder, step, detail });
      });
      capture('app_published', { firstPublish: true });
      return result;
    },
    'apps:publishUpdate': async (_event, args) => {
      const result = await appsPublisher.publishUpdate(args.folder, args.increment);
      capture('app_published', { version: result.version, firstPublish: false });
      return result;
    },
    'apps:registerExisting': async (_event, args) => {
      return appsPublisher.registerExisting(args.name, args.repo);
    },
    'githubAuth:start': async () => {
      const result = await githubAuth.startDeviceFlow();
      // Surface the code and open GitHub's verification page externally (§10).
      void shell.openExternal(result.verificationUri);
      return result;
    },
    'githubAuth:poll': async () => {
      const result = await githubAuth.pollDeviceFlow();
      console.log(`[GitHubAuth] poll result → ${result.status}`);
      return result;
    },
    'githubAuth:status': async () => {
      return githubAuth.getAuthStatus();
    },
    'githubAuth:signOut': async () => {
      await githubAuth.clearAuth();
      return { ok: true as const };
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
    'terminal:ensure': async (_event, args) => {
      return ensureTerminal(args.id, args.cwd, args.cols, args.rows);
    },
    'terminal:input': async (_event, args) => {
      writeTerminal(args.id, args.data);
      return { success: true };
    },
    'terminal:resize': async (_event, args) => {
      resizeTerminal(args.id, args.cols, args.rows);
      return { success: true };
    },
    'terminal:dispose': async (_event, args) => {
      disposeTerminal(args.id);
      return { success: true };
    },
    'dialog:openFiles': async (event, args) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win!, {
        title: args.title ?? 'Attach files',
        ...(args.defaultPath ? { defaultPath: resolveShellPath(args.defaultPath) } : {}),
        properties: ['openFile', 'multiSelections'],
      });
      return { paths: result.canceled ? [] : result.filePaths };
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
    'knowledge:importNotes': async (_event, args) => {
      console.log(`[ImportNotes] ${args.source} import ${args.sourcePath} -> ${args.targetFolder}`);
      try {
        const result = args.source === 'obsidian'
          ? await importObsidianVault(args.sourcePath, args.targetFolder)
          : await importNotionExport(args.sourcePath, args.targetFolder);
        console.log(`[ImportNotes] OK -> ${result.root} (${result.notes} notes, ${result.attachments} attachments, ${result.skipped} skipped)`);
        return result;
      } catch (err) {
        console.error('[ImportNotes] FAILED:', err instanceof Error ? err.message : err);
        throw err;
      }
    },
    'google-docs:getStatus': async () => {
      return getGoogleDocsConnectionStatus();
    },
    'google-docs:import': async (_event, args) => {
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
    'google-docs:pickViaManaged': async (_event, args) => {
      console.log(`[GoogleDocs] managed pick -> ${args.targetFolder}`);
      const result = await startManagedGooglePick(args.targetFolder);
      if (!result) return null;
      console.log(`[GoogleDocs] managed pick import OK -> ${result.path}`);
      return result;
    },
    'google-docs:refreshSnapshot': async (_event, args) => {
      return syncGoogleDocDown(args.path);
    },
    'google-docs:sync': async (_event, args) => {
      return syncGoogleDocUp(args.path, { force: args.force });
    },
    'google-docs:getLink': async (_event, args) => {
      return { link: await getGoogleDocLink(args.path) };
    },
    // Search handler
    'search:query': async (_event, args) => {
      await sessionsIndexReady;
      const sessions = container.resolve<ISessions>('sessions').listSessions()
        .map((s) => ({ sessionId: s.sessionId, title: s.title }));
      return search(args.query, args.limit, args.types, sessions);
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
    'meeting-prep:resolve': async (_event, args) => {
      const result = await resolveMeetingPrep(args.attendees);
      const prepNote = args.eventId ? await readPrepNoteForEvent(args.eventId) : null;
      return { ...result, prepNote };
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
    'voice:synthesizeStreamStart': async (event, args) => {
      const { requestId, text } = args;
      const sender = event.sender;
      const controller = new AbortController();
      activeTtsStreams.set(requestId, controller);
      // Fire-and-forget: chunks are pushed to the renderer as they arrive so
      // playback can begin immediately; the invoke returns once started.
      void voice
        .synthesizeSpeechStream(
          text,
          (chunk) => {
            if (!sender.isDestroyed()) {
              sender.send('voice:tts-chunk', {
                requestId,
                chunkBase64: chunk.toString('base64'),
                done: false,
              });
            }
          },
          controller.signal,
        )
        .then(() => {
          if (!sender.isDestroyed()) {
            sender.send('voice:tts-chunk', { requestId, done: true });
          }
        })
        .catch((err: unknown) => {
          if (!sender.isDestroyed() && !controller.signal.aborted) {
            sender.send('voice:tts-chunk', {
              requestId,
              done: true,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
        .finally(() => {
          activeTtsStreams.delete(requestId);
        });
      return { ok: true };
    },
    'voice:synthesizeStreamCancel': async (_event, args) => {
      activeTtsStreams.get(args.requestId)?.abort();
      activeTtsStreams.delete(args.requestId);
      return {};
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
    'voice:ensureCameraAccess': async () => {
      if (process.platform !== 'darwin') return { granted: true };
      const status = systemPreferences.getMediaAccessStatus('camera');
      console.log('[video] Camera permission status:', status);
      if (status === 'granted') return { granted: true };
      // Same flow as the microphone: settle the native TCC prompt before the
      // renderer's getUserMedia so the first video click doesn't silently fail.
      try {
        const granted = await systemPreferences.askForMediaAccess('camera');
        console.log('[video] Camera permission after prompt:', granted);
        return { granted };
      } catch {
        return { granted: false };
      }
    },
    'video:setPopout': async (_event, args) => {
      if (!args.show) {
        if (videoPopoutWin && !videoPopoutWin.isDestroyed()) videoPopoutWin.destroy();
        videoPopoutWin = null;
        return {};
      }
      if (videoPopoutWin && !videoPopoutWin.isDestroyed()) return {};

      const workArea = screen.getPrimaryDisplay().workArea;
      const width = 340;
      const height = 184;
      const ipcDir = path.dirname(fileURLToPath(import.meta.url));
      const preloadPath = app.isPackaged
        ? path.join(ipcDir, '../preload/dist/preload.js')
        : path.join(ipcDir, '../../../preload/dist/preload.js');
      const win = new BrowserWindow({
        width,
        height,
        x: workArea.x + workArea.width - width - 24,
        y: workArea.y + 24,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        hasShadow: true,
        backgroundColor: '#171717',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: preloadPath,
        },
      });
      // Float above other apps on every workspace. Deliberately NOT
      // `visibleOnFullScreen: true`: on macOS that flag hides the app's Dock
      // icon for as long as such a window exists (the app becomes an
      // "agent" app), which reads as Rowboat having vanished. The trade-off
      // is the popout won't hover over other apps' fullscreen Spaces.
      win.setAlwaysOnTop(true, 'floating');
      win.setVisibleOnAllWorkspaces(true);
      win.webContents.once('did-finish-load', () => {
        if (lastVideoPopoutState) {
          win.webContents.send('video:popout-state', lastVideoPopoutState);
        }
        // showInactive: appearing must not steal focus from the app the user
        // switched to — that would immediately re-hide the popout.
        if (!win.isDestroyed()) win.showInactive();
      });
      win.on('closed', () => {
        if (videoPopoutWin === win) videoPopoutWin = null;
      });
      videoPopoutWin = win;
      if (app.isPackaged) {
        win.loadURL('app://-/index.html#video-popout');
      } else {
        win.loadURL('http://localhost:5173/#video-popout');
      }
      return {};
    },
    'video:popoutState': async (_event, args) => {
      lastVideoPopoutState = args;
      if (videoPopoutWin && !videoPopoutWin.isDestroyed()) {
        videoPopoutWin.webContents.send('video:popout-state', args);
      }
      return {};
    },
    'app:focusMainWindow': async () => {
      const main = findMainAppWindow();
      if (main) {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
      }
      return {};
    },
    'video:getPopoutState': async () => {
      return { state: lastVideoPopoutState };
    },
    'video:popoutAction': async (_event, args) => {
      // Relay a popout control-bar action to the app window, which owns the
      // call (mic, camera, screen capture) and executes it there. 'expand'
      // additionally brings the app window back to the foreground.
      const main = findMainAppWindow();
      if (args.action === 'expand' && main) {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
      }
      main?.webContents.send('video:popout-action', args);
      return {};
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
          ...(args.projectId ? { projectId: args.projectId } : {}),
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
