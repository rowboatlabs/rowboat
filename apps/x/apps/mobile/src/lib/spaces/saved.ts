import { useEffect, useSyncExternalStore } from 'react';
import type { Message } from '@rowboat/spaces-protocol';

import { loadValue, peekValue, saveValue } from '@/lib/spaces/cache';

// Saved for later (2026-11-13, the desktop's lib/spaces-saved.ts): personal
// bookmarks, kept on this phone only. The desktop keeps them in its own
// localStorage and the server has no saved list, so the two don't sync. The
// body is snapshotted at save time so the list paints without a fetch;
// tapping a row opens the live message. Stored in the spaces cache, so
// signing out wipes it with the other message bodies.

export interface SavedMessage {
  messageId: string;
  /** The thread the message lives in (a root stands for its own thread). */
  threadRootId: string;
  authorId: string;
  body: string;
  postedAt: string;
  savedAt: string;
}

const EMPTY: SavedMessage[] = [];
const listeners = new Set<() => void>();
const name = (org: string, space: string) => `saved:${org}:${space}`;

function emit(): void {
  for (const l of listeners) l();
}

function current(org: string, space: string): SavedMessage[] {
  return peekValue<SavedMessage[]>(name(org, space)) ?? EMPTY;
}

/** The list as stored — loaded first, so a change never overwrites a list not read yet. */
async function stored(org: string, space: string): Promise<SavedMessage[]> {
  return (await loadValue<SavedMessage[]>(name(org, space))) ?? EMPTY;
}

/** Add when absent, remove when present. Resolves to the new saved state. */
export async function toggleSaved(org: string, space: string, message: Message): Promise<boolean> {
  const list = await stored(org, space);
  if (list.some((s) => s.messageId === message.id)) {
    saveValue(name(org, space), list.filter((s) => s.messageId !== message.id));
    emit();
    return false;
  }
  const entry: SavedMessage = {
    messageId: message.id,
    threadRootId: message.threadRoot ?? message.id,
    authorId: message.author.memberId,
    body: message.body,
    postedAt: message.postedAt,
    savedAt: new Date().toISOString(),
  };
  saveValue(name(org, space), [entry, ...list]);
  emit();
  return true;
}

export async function removeSaved(org: string, space: string, messageId: string): Promise<void> {
  const list = await stored(org, space);
  if (!list.some((s) => s.messageId === messageId)) return;
  saveValue(name(org, space), list.filter((s) => s.messageId !== messageId));
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The saved list for one space, live; read from disk on first use after a launch. */
export function useSaved(org: string, space: string): SavedMessage[] {
  useEffect(() => {
    if (peekValue(name(org, space)) !== undefined) return;
    void loadValue<SavedMessage[]>(name(org, space)).then(emit);
  }, [org, space]);
  return useSyncExternalStore(subscribe, () => current(org, space));
}
