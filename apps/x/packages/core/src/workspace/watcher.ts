import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspaceRoot, absToRelPosix } from './workspace.js';
import { WorkDir } from '../config/config.js';
import { WorkspaceChangeEvent } from 'packages/shared/dist/workspace.js';
import z from 'zod';
import { Stats } from 'node:fs';

export type WorkspaceChangeCallback = (event: z.infer<typeof WorkspaceChangeEvent>) => void;

// The only WorkDir paths whose change events have a consumer (knowledge index
// invalidation in main, and the tree/editor, live-notes, email, sidebar and
// meetings views in the renderer). Everything else under WorkDir — runs-archive,
// storage/turns, engines, logs, code-mode, ... — is internal state that grows
// unboundedly with usage; chokidar v4 holds one OS watch handle per file, so
// watching all of WorkDir exhausts the process fd limit (EMFILE crash) once
// the workdir gets big enough.
const WATCHED_ROOTS = [
  'knowledge',
  'bases',
  'inbox_lists',
  'gmail_sync',
  'calendar_sync',
  'bg-tasks',
  'config/agent-schedule.json',
];

/**
 * Create a workspace watcher
 * Watches the user-facing workspace roots (WATCHED_ROOTS) recursively and
 * emits WorkDir-relative change events via callback.
 *
 * Returns a watcher instance that can be closed.
 * The watcher emits events immediately without debouncing.
 * Debouncing and lifecycle management should be handled by the caller.
 */
export async function createWorkspaceWatcher(
  callback: WorkspaceChangeCallback
): Promise<FSWatcher> {
  await ensureWorkspaceRoot();

  const roots = WATCHED_ROOTS.map((rel) => path.join(WorkDir, rel));
  const watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    // knowledge/ is a git repo (version history) — its .git object store is
    // thousands of files nothing renders, so keep it out of the watch set.
    ignored: (watchedPath: string) =>
      path.relative(WorkDir, watchedPath).split(path.sep).includes('.git'),
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
