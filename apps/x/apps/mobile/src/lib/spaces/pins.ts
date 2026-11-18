import type { Message } from '@rowboat/spaces-protocol';

import type { SpacesClient } from '@/lib/spaces/client';

// Pins (2026-11-13, as the desktop's lib/spaces-corpus.ts): a pin is the 📌
// reaction, so it is shared with the whole space and needs no server change.
// Pinned = anyone's 📌 on the message; unpinning removes only YOUR 📌. The
// chip is hidden on messages — the Pinned list is the pin's only surface.

export const PIN_EMOJI = '📌';

export function pinnedByMe(message: Message, me: string): boolean {
  return message.reactions.some((g) => g.emoji === PIN_EMOJI && g.memberIds.includes(me));
}

/** The desktop's reach: the stream page plus the 30 most active discussions. */
const TOPIC_CAP = 30;

/**
 * Pinned messages in a space, newest first. The server has no pinned query,
 * so this reads what the desktop's list reads: the stream's newest page and
 * the newest page of the most active discussions.
 */
export async function loadPinned(client: SpacesClient, space: string): Promise<Message[]> {
  const topics = await client.listTopics(space).catch(() => []);
  const busiest = [...topics].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, TOPIC_CAP);
  const pages = await Promise.all([
    client.listStream(space).then((p) => p.messages).catch(() => [] as Message[]),
    ...busiest.map((t) => client.listThread(space, t.rootMessageId).then((p) => [p.root, ...p.messages]).catch(() => [] as Message[])),
  ]);
  const byId = new Map<string, Message>();
  for (const m of pages.flat()) {
    if (!m.deletedAt && m.reactions.some((g) => g.emoji === PIN_EMOJI && g.memberIds.length > 0)) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}
