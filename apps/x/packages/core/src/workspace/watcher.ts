import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspaceRoot, absToRelPosix } from './workspace.js';
import { WorkDir } from '../config/config.js';
import { WorkspaceChangeEvent } from 'packages/shared/dist/workspace.js';
import z from 'zod';
import { Stats } from 'node:fs';

export type WorkspaceChangeCallback = (event: z.infer<typeof WorkspaceChangeEvent>) => void;

export function shouldIgnoreWorkspacePath(absPath: string): boolean {
  const relPath = absToRelPosix(absPath);
  return relPath === 'db' || relPath?.startsWith('db/') === true;
}

/**
 * Create a workspace watcher
 * Watches the configured workspace root recursively and emits change events via callback
 * 
 * Returns a watcher instance that can be closed.
 * The watcher emits events immediately without debouncing.
 * Debouncing and lifecycle management should be handled by the caller.
 */
export async function createWorkspaceWatcher(
  callback: WorkspaceChangeCallback
): Promise<FSWatcher> {
  await ensureWorkspaceRoot();

  // Code-section session worktrees are full repo checkouts (thousands of files,
  // possibly node_modules) living under WorkDir — watching them would flood the
  // event stream and burn file handles, and nothing in the app renders them
  // from workspace events.
  const codeModeDir = path.join(WorkDir, 'code-mode');
  const watcher = chokidar.watch(WorkDir, {
    ignoreInitial: true,
    // Ignore the SQLite db dir (storage) AND code-section worktrees (full repo
    // checkouts that would flood the event stream).
    ignored: (watchedPath: string) =>
      shouldIgnoreWorkspacePath(watchedPath) ||
      watchedPath === codeModeDir ||
      watchedPath.startsWith(codeModeDir + path.sep),
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
  });

  watcher
    .on('add', (absPath: string) => {
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        fs.lstat(absPath)
          .then((stats: Stats) => {
            const kind = stats.isDirectory() ? 'dir' : 'file';
            callback({ type: 'created', path: relPath, kind });
          })
          .catch(() => {
            // Ignore errors
          });
      }
    })
    .on('addDir', (absPath: string) => {
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        callback({ type: 'created', path: relPath, kind: 'dir' });
      }
    })
    .on('change', (absPath: string) => {
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        // Emit change event immediately - debouncing handled by caller
        callback({ type: 'changed', path: relPath });
      }
    })
    .on('unlink', (absPath: string) => {
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        callback({ type: 'deleted', path: relPath, kind: 'file' });
      }
    })
    .on('unlinkDir', (absPath: string) => {
      const relPath = absToRelPosix(absPath);
      if (relPath) {
        callback({ type: 'deleted', path: relPath, kind: 'dir' });
      }
    })
    .on('error', (error: unknown) => {
      console.error('Workspace watcher error:', error);
    });

  return watcher;
}
