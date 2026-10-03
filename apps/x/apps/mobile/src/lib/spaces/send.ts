import type { Message } from '@rowboat/spaces-protocol';

import type { SpacesClient } from '@/lib/spaces/client';
import { isNetworkError } from '@/lib/spaces/errors';

// Sending a message when the connection drops mid-request (2026-10-03).
// iOS reports "The network connection was lost" when a kept-alive socket died
// while the app was in the background: the request may or may not have
// reached the org. postMessage has no idempotency key, so before retrying we
// LOOK: if a message of ours with this exact body landed in the last couple
// of minutes, that is the send and we return it; only otherwise post again.
// One retry — a second failure is a real outage and the caller keeps the draft.

const LANDED_WINDOW_MS = 2 * 60 * 1000;

export async function postMessageReliably(
  client: SpacesClient,
  spaceId: string,
  input: { body: string; threadRoot?: string },
  me: string,
): Promise<Message> {
  const post = async () => (await client.postMessage(spaceId, { ...input, actingMode: 'direct' })).message;
  try {
    return await post();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await new Promise((r) => setTimeout(r, 700));
    const landed = await findLanded(client, spaceId, input, me).catch(() => undefined);
    if (landed) return landed;
    return post();
  }
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
