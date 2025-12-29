import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import { ensureWorkspaceRoot, absToRelPosix } from './workspace.js';
import { WorkDir } from '../config/config.js';
import { WorkspaceChangeEvent } from 'packages/shared/dist/workspace.js';
import z from 'zod';
import { Stats } from 'node:fs';

export type WorkspaceChangeCallback = (event: z.infer<typeof WorkspaceChangeEvent>) => void;

/**
 * Create a workspace watcher
 * Watches ~/.rowboat recursively and emits change events via callback
 * 
 * Returns a watcher instance that can be closed.
 * The watcher emits events immediately without debouncing.
 * Debouncing and lifecycle management should be handled by the caller.
 */
export async function createWorkspaceWatcher(
  callback: WorkspaceChangeCallback
): Promise<FSWatcher> {
  await ensureWorkspaceRoot();

  const watcher = chokidar.watch(WorkDir, {
    ignoreInitial: true,
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

