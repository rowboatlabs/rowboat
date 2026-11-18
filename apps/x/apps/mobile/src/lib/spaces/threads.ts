import type { Message, ThreadListing, ThreadStatus, Topic, TopicListing } from '@rowboat/spaces-protocol';

import { loadValue, saveValue } from '@/lib/spaces/cache';

// The threads lists' rules (2026-11-13, the web's Threads tab and Your
// threads page, space-threads-view.tsx / my-threads-view.tsx): which threads
// a filter shows, what a row is called, and who is in it. Reimplemented here
// rather than shared: the web's copies live in renderer files this app can't
// import, and each is a few lines.

/** All / Named / Sessions / By me, on both lists. */
export type ThreadsKind = 'all' | 'named' | 'sessions' | 'mine';
export const THREAD_KINDS: { key: ThreadsKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'named', label: 'Named' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'mine', label: 'By me' },
];

/** A thread's name when nobody gave it one: the root's first line, without markdown leaders or images. */
export function threadLabelOf(rootBody: string, max = 80): string {
  const firstLine = rootBody
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return 'Thread';
  const stripped = firstLine.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  const label = stripped.length > 0 ? stripped : 'Thread';
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Who is in a thread: who started it, then who replied. */
export function participantsOf(root: Message | undefined | null): string[] {
  if (!root) return [];
  return [...new Set([root.author.memberId, ...(root.replyAuthors ?? [])])];
}

/** A plain thread's archive action: a session ends and reopens; any other thread archives. */
export function archiveLabel(root: Message): string {
  if (root.session) return root.archived ? 'Reopen session' : 'End session';
  return root.archived ? 'Unarchive' : 'Archive';
}

/** A root with its plain-thread archive flag set or cleared. */
export function withArchived(root: Message, archived: boolean): Message {
  const { archived: _was, ...rest } = root;
  return archived ? { ...rest, archived: true } : rest;
}

/** A root with its session mark set, retitled or cleared. */
export function withSession(root: Message, session: { title: string } | null): Message {
  const next = { ...root };
  delete next.session;
  return session ? { ...next, session } : next;
}

/** What a thread's status says (web lib/spaces-my-threads.ts). */
export function threadStatusLabel(status: ThreadStatus): string {
  return status === 'needs_you' ? 'Needs you' : status === 'working' ? 'Working' : 'Idle';
}

/** One row of either list. */
export interface ThreadItem {
  spaceId: string;
  rootMessageId: string;
  root?: Message;
  topic?: Topic;
  title: string;
  activityAt: string;
  people: string[];
  unread: number;
  forYou: number;
  /** Your threads only: the space it lives in, and where it stands for you. */
  spaceName?: string;
  status?: ThreadStatus;
}

/**
 * One space's threads under a filter (web threadRows): discussions from the
 * topic list; unnamed threads from the stream's loaded roots that have
 * replies, or are sessions; archived unnamed ones from their own list. A
 * discussion archives on its topic row, a plain thread on its root.
 */
export function spaceThreadRows(
  topics: readonly TopicListing[],
  roots: readonly Message[],
  archivedPlain: readonly Message[],
  kind: ThreadsKind,
  archived: boolean,
  me: string,
): { rootMessageId: string; topic?: TopicListing; root?: Message; activityAt: string }[] {
  const rows = new Map<string, { rootMessageId: string; topic?: TopicListing; root?: Message; activityAt: string }>();
  for (const topic of topics) {
    if (!!topic.archived !== archived) continue;
    rows.set(topic.rootMessageId, { rootMessageId: topic.rootMessageId, topic, root: topic.rootMessage ?? undefined, activityAt: topic.lastActivityAt });
  }
  const archivedRoots = new Set(topics.filter((t) => t.archived).map((t) => t.rootMessageId));
  // Naming a thread unarchives its root on the server; a stale copy must not outlive that.
  const namedRoots = new Set(topics.map((t) => t.rootMessageId));
  if (kind === 'sessions') rows.clear(); // discussions are never sessions
  if (kind !== 'named' && archived) {
    for (const root of archivedPlain) {
      if (!namedRoots.has(root.id) && (kind !== 'sessions' || root.session)) rows.set(root.id, { rootMessageId: root.id, root, activityAt: root.lastReplyAt ?? root.postedAt });
    }
  }
  if (kind !== 'named' && !archived) {
    for (const root of roots) {
      // A session is a thread from its first message, replies or not.
      if (root.threadRoot !== undefined || (root.replyCount === 0 && !root.session) || archivedRoots.has(root.id) || root.archived) continue;
      if (kind === 'sessions' && !root.session) continue;
      const row = rows.get(root.id);
      if (row) row.root = root;
      else rows.set(root.id, { rootMessageId: root.id, root, activityAt: root.lastReplyAt ?? root.postedAt });
    }
  }
  return [...rows.values()]
    .filter((row) => kind !== 'mine' || row.root?.author.memberId === me)
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt) || a.rootMessageId.localeCompare(b.rootMessageId));
}

/** Your threads under a filter (web my-threads-view matches). */
export function myThreadMatches(thread: ThreadListing, kind: ThreadsKind, me: string): boolean {
  if (kind === 'sessions') return !!thread.root.session && !thread.topic;
  if (kind === 'named') return !!thread.topic;
  if (kind === 'mine') return thread.root.author.memberId === me;
  return true;
}

/** A list's filters, kept per space (or per server) on this phone, as the web keeps them in browser storage. */
export interface ThreadsFilters {
  kind: ThreadsKind;
  archived: boolean;
  people: string[];
  spaces: string[];
}

export const DEFAULT_FILTERS: ThreadsFilters = { kind: 'all', archived: false, people: [], spaces: [] };

export async function loadFilters(key: string): Promise<ThreadsFilters> {
  const saved = await loadValue<Partial<ThreadsFilters>>(`threads-filters:${key}`);
  return { ...DEFAULT_FILTERS, ...saved };
}

export function saveFilters(key: string, filters: ThreadsFilters): void {
  saveValue(`threads-filters:${key}`, filters);
}
