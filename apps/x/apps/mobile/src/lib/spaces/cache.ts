import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Member, Message } from '@rowboat/spaces-protocol';

// Stale-while-revalidate cache for threads and space rosters: a screen
// paints what it saw last time, then the server's answer replaces it. Memory
// first (instant on a second open this session), AsyncStorage behind it
// (instant after a relaunch). Bounded: the last MAX_THREADS threads persist.
// Wiped on sign-out — it holds message bodies.

const PREFIX = 'rowboat.spaces.cache.v1:';
const INDEX_KEY = `${PREFIX}index`;
const MAX_THREADS = 50;

export interface CachedThread {
  root: Message;
  /** null = only the root is known (seeded from the stream, never opened). */
  messages: Message[] | null;
  following: boolean | null;
}

const threads = new Map<string, CachedThread>();
const rosters = new Map<string, Member[]>();

const threadKey = (org: string, space: string, root: string) => `${PREFIX}t:${org}:${space}:${root}`;
const rosterKey = (org: string, space: string) => `${PREFIX}m:${org}:${space}`;

/** Synchronous — what's already in memory. */
export function peekThread(org: string, space: string, root: string): CachedThread | undefined {
  return threads.get(threadKey(org, space, root));
}

export async function loadThread(org: string, space: string, root: string): Promise<CachedThread | undefined> {
  const key = threadKey(org, space, root);
  const hit = threads.get(key);
  if (hit?.messages) return hit;
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (!raw) return hit;
  try {
    const stored = JSON.parse(raw) as CachedThread;
    threads.set(key, stored);
    return stored;
  } catch {
    return hit;
  }
}

/** The stream already holds the root — tapping a message paints it instantly. */
export function seedThreadRoot(org: string, space: string, root: Message): void {
  const key = threadKey(org, space, root.id);
  const hit = threads.get(key);
  threads.set(key, hit ? { ...hit, root } : { root, messages: null, following: null });
}

let indexQueue: Promise<void> = Promise.resolve();

export function saveThread(org: string, space: string, thread: CachedThread): void {
  if (!thread.messages) return;
  const key = threadKey(org, space, thread.root.id);
  threads.set(key, thread);
  void AsyncStorage.setItem(key, JSON.stringify(thread)).catch(() => {});
  // Most-recent-first index; evict past the cap. Serialized so concurrent
  // saves don't clobber each other's read-modify-write.
  indexQueue = indexQueue.then(async () => {
    const raw = await AsyncStorage.getItem(INDEX_KEY).catch(() => null);
    const index: string[] = raw ? JSON.parse(raw) : [];
    const next = [key, ...index.filter((k) => k !== key)];
    const evicted = next.splice(MAX_THREADS);
    if (evicted.length) await AsyncStorage.multiRemove(evicted).catch(() => {});
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next)).catch(() => {});
  }).catch(() => {});
}

export function peekRoster(org: string, space: string): Member[] | undefined {
  return rosters.get(rosterKey(org, space));
}

export async function loadRoster(org: string, space: string): Promise<Member[] | undefined> {
  const key = rosterKey(org, space);
  const hit = rosters.get(key);
  if (hit) return hit;
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (!raw) return undefined;
  try {
    const stored = JSON.parse(raw) as Member[];
    rosters.set(key, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export function saveRoster(org: string, space: string, members: Member[]): void {
  const key = rosterKey(org, space);
  rosters.set(key, members);
  void AsyncStorage.setItem(key, JSON.stringify(members)).catch(() => {});
}


// --- generic small values (a space's stream tail, an org's space list) -------

const values = new Map<string, unknown>();
const valueKey = (name: string) => `${PREFIX}v:${name}`;

export function peekValue<T>(name: string): T | undefined {
  return values.get(valueKey(name)) as T | undefined;
}

export async function loadValue<T>(name: string): Promise<T | undefined> {
  const key = valueKey(name);
  if (values.has(key)) return values.get(key) as T;
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (!raw) return undefined;
  try {
    const stored = JSON.parse(raw) as T;
    values.set(key, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export function saveValue<T>(name: string, value: T): void {
  const key = valueKey(name);
  values.set(key, value);
  void AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

/** How much of a stream is kept for the instant/offline paint. */
export const STREAM_CACHE_LIMIT = 100;

export async function clearSpacesCache(): Promise<void> {
  threads.clear();
  rosters.clear();
  values.clear();
  const keys = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  const ours = keys.filter((k) => k.startsWith(PREFIX));
  if (ours.length) await AsyncStorage.multiRemove(ours).catch(() => {});
}
