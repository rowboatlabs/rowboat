import type { Message } from '@rowboat/spaces-protocol';
import type { spaces } from '@x/shared';

import type { SpacesClient } from '@/lib/spaces/client';
import { isNetworkError } from '@/lib/spaces/errors';

// Sending a message when the connection drops mid-request (2026-10-03).
// iOS reports "The network connection was lost" when a kept-alive socket died
// while the app was in the background: the request may or may not have
// reached the server. postMessage has no idempotency key, so before retrying we
// LOOK: if a message of ours with this exact body landed in the last couple
// of minutes, that is the send and we return it; only otherwise post again.
// One retry — a second failure is a real outage and the caller keeps the draft.

const LANDED_WINDOW_MS = 2 * 60 * 1000;

type Posted = Awaited<ReturnType<SpacesClient['postMessage']>>;

export async function postMessageReliably(
  client: SpacesClient,
  spaceId: string,
  // A poll rides the same post (2026-11-13); its body is the markdown fallback, so the landed check still matches on it.
  input: { body: string; threadRoot?: string; peopleOnly?: boolean; poll?: spaces.SpacesNewPollInput },
  me: string,
): Promise<Posted> {
  const post = () => client.postMessage(spaceId, { ...input, actingMode: 'direct' });
  try {
    return await post();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await new Promise((r) => setTimeout(r, 700));
    const landed = await findLanded(client, spaceId, input, me).catch(() => undefined);
    // A send found after the fact has no invocations to hand back; the
    // thread's invocation list catches up from the server.
    if (landed) return { message: landed, invocations: [] };
    return post();
  }
}

// Your message shows the moment you send it (2026-11-13): the screens add a
// pending copy before the POST and swap in the server's message when it
// returns (or drop it on failure; the composer's "Not sent" keeps the text).
// A pending row has no real id or offset, so it must never become a read
// mark, a live replay offset, or a cached row, and has no actions.
const PENDING_PREFIX = 'pending:';
/** Above any real stream offset, so a pending row always sorts last. */
const PENDING_OFFSET = Number.MAX_SAFE_INTEGER;

export function isPending(message: Pick<Message, 'id'>): boolean {
  return message.id.startsWith(PENDING_PREFIX);
}

export function pendingMessage(spaceId: string, me: string, body: string, threadRoot?: string): Message {
  return {
    id: `${PENDING_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    spaceId,
    ...(threadRoot ? { threadRoot } : {}),
    author: { memberId: me, actingMode: 'direct' },
    body,
    postedAt: new Date().toISOString(),
    offset: PENDING_OFFSET,
    replyCount: 0,
    replyAuthors: [],
    reactions: [],
    mentions: [],
    mentionsHere: false,
    mentionsRowboat: false,
  };
}

/** The list without pending rows, for caches. */
export function withoutPending(list: Message[]): Message[] {
  return list.some(isPending) ? list.filter((m) => !isPending(m)) : list;
}

/** The newest confirmed offset: read marks and live replay never see a pending one. */
export function lastConfirmedOffset(list: readonly Message[] | null | undefined): number | undefined {
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) if (!isPending(list[i]!)) return list[i]!.offset;
  return undefined;
}

/**
 * Settle a pending row with the server's message: replace it in place, or
 * just drop it when the live socket already delivered that id. Never two copies.
 */
export function settlePending(list: Message[], pendingId: string, real: Message): Message[] {
  if (list.some((m) => m.id === real.id)) return list.filter((m) => m.id !== pendingId);
  if (!list.some((m) => m.id === pendingId)) return [...list, real];
  return list.map((m) => (m.id === pendingId ? real : m));
}

/**
 * A live message of yours that arrives before the POST returns takes the
 * place of its pending copy (same author and body), so the row isn't shown
 * twice in the meantime. settlePending then finds the real id and drops nothing more.
 */
export function foldLive(list: Message[], incoming: Message): Message[] {
  if (list.some((m) => m.id === incoming.id)) return list;
  if (incoming.author.actingMode === 'direct') {
    const i = list.findIndex((m) => isPending(m) && m.author.memberId === incoming.author.memberId && m.body === incoming.body && m.threadRoot === incoming.threadRoot);
    if (i >= 0) return list.map((m, j) => (j === i ? incoming : m));
  }
  return [...list, incoming];
}

async function findLanded(
  client: SpacesClient,
  spaceId: string,
  input: { body: string; threadRoot?: string },
  me: string,
): Promise<Message | undefined> {
  const recent = input.threadRoot
    ? (await client.listThread(spaceId, input.threadRoot, { limit: 20 })).messages
    : (await client.listStream(spaceId, { limit: 20 })).messages;
  const since = Date.now() - LANDED_WINDOW_MS;
  return [...recent]
    .reverse()
    .find((m) => m.author.memberId === me && m.author.actingMode === 'direct' && m.body === input.body && !m.deletedAt && Date.parse(m.postedAt) >= since);
}
