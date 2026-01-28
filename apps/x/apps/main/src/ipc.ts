import { ipcMain, BrowserWindow } from 'electron';
import { ipc } from '@x/shared';
import {
  connectProvider,
  disconnectProvider,
  isConnected,
  getConnectedProviders,
  listProviders,
} from './oauth-handler.js';
import { watcher as watcherCore, workspace } from '@x/core';
import { workspace as workspaceShared } from '@x/shared';
import * as mcpCore from '@x/core/dist/mcp/mcp.js';
import * as runsCore from '@x/core/dist/runs/runs.js';
import { bus } from '@x/core/dist/runs/bus.js';
import type { FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import z from 'zod';
import { RunEvent } from 'packages/shared/dist/runs.js';
import container from '@x/core/dist/di/container.js';
import { IGranolaConfigRepo } from '@x/core/dist/knowledge/granola/repo.js';
import { triggerSync as triggerGranolaSync } from '@x/core/dist/knowledge/granola/sync.js';
import { isOnboardingComplete, markOnboardingComplete } from '@x/core/dist/config/note_creation_config.js';

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
 * Watches ~/.rowboat recursively and emits change events to renderer
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

export function emitOAuthEvent(event: { provider: string; success: boolean; error?: string }): void {
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

// ============================================================================
// Handler Implementations
// ============================================================================

/**
 * Register all IPC handlers
 * Add new handlers here as you add channels to IPCChannels
 */
export function setupIpcHandlers() {
  registerIpcHandlers({
    'app:getVersions': async () => {
      // args is null for this channel (no request payload)
      return getVersions();
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
      return { messageId: await runsCore.createMessage(args.runId, args.message) };
    },
    'runs:authorizePermission': async (_event, args) => {
      await runsCore.authorizePermission(args.runId, args.authorization);
      return { success: true };
    },
    'runs:provideHumanInput': async (_event, args) => {
      await runsCore.replyToHumanInputRequest(args.runId, args.reply);
      return { success: true };
    },
    'runs:stop': async (_event, args) => {
      await runsCore.stop(args.runId);
      return { success: true };
    },
    'runs:fetch': async (_event, args) => {
      return runsCore.fetchRun(args.runId);
    },
    'runs:list': async (_event, args) => {
      return runsCore.listRuns(args.cursor);
    },
    'oauth:connect': async (_event, args) => {
      return await connectProvider(args.provider);
    },
    'oauth:disconnect': async (_event, args) => {
      return await disconnectProvider(args.provider);
    },
    'oauth:is-connected': async (_event, args) => {
      return await isConnected(args.provider);
    },
    'oauth:list-providers': async () => {
      return listProviders();
    },
    'oauth:get-connected-providers': async () => {
      return await getConnectedProviders();
    },
    'granola:getConfig': async () => {
      const repo = container.resolve<IGranolaConfigRepo>('granolaConfigRepo');
      const config = await repo.getConfig();
      return { enabled: config.enabled };
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
    'onboarding:getStatus': async () => {
      // Show onboarding if it hasn't been completed yet
      const complete = isOnboardingComplete();
      return { showOnboarding: !complete };
    },
    'onboarding:markComplete': async () => {
      markOnboardingComplete();
      return { success: true };
    },
  });
}