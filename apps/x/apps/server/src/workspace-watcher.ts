import fs from 'node:fs/promises';
import { z } from 'zod';
import { watcher as watcherCore, workspace, versionHistory } from '@x/core';
import { workspace as workspaceShared } from '@x/shared';
import { invalidateKnowledgeIndex } from '@x/core/dist/knowledge/knowledge_index.js';

// Server-side workspace watcher (Phase 8): the debounced change feed that
// lived in apps/main/src/ipc.ts, now hosted where core runs. In child and
// remote modes the Electron client no longer watches the filesystem — it
// relays `workspace:didChange` / `knowledge:didCommit` from the server's WS
// feed, so a remote client sees the server machine's workspace, not its own.
// Logic is a verbatim lift of main's debounce/queue semantics.

type WorkspaceChangeEvent = z.infer<typeof workspaceShared.WorkspaceChangeEvent>;

const workspaceListeners = new Set<(e: WorkspaceChangeEvent) => void>();
const knowledgeListeners = new Set<() => void>();

const changeQueue = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function emitWorkspaceChangeEvent(event: WorkspaceChangeEvent): void {
  for (const listener of workspaceListeners) listener(event);
}

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

function touchesKnowledge(event: WorkspaceChangeEvent): boolean {
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

function handleWorkspaceChange(event: WorkspaceChangeEvent): void {
  // Any knowledge-base change drops the cached index so the next read rebuilds.
  if (touchesKnowledge(event)) invalidateKnowledgeIndex();
  // Debounce 'changed' events, emit others immediately
  if (event.type === 'changed' && event.path) {
    queueChange(event.path);
  } else {
    emitWorkspaceChangeEvent(event);
  }
}

/** Starts the chokidar watcher and the knowledge-commit feed. Idempotent. */
export async function startWorkspaceWatcher(): Promise<void> {
  if (started) return;
  started = true;
  versionHistory.onCommit(() => {
    for (const listener of knowledgeListeners) listener();
  });
  await watcherCore.createWorkspaceWatcher(handleWorkspaceChange);
}

export function subscribeWorkspaceEvents(listener: (e: WorkspaceChangeEvent) => void): () => void {
  workspaceListeners.add(listener);
  return () => workspaceListeners.delete(listener);
}

export function subscribeKnowledgeEvents(listener: () => void): () => void {
  knowledgeListeners.add(listener);
  return () => knowledgeListeners.delete(listener);
}
