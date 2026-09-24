import { z } from 'zod';

// /find in the Spaces composer (2026-09-24): "take me there, correct me if
// I am wrong". Code gathers candidates (the recent roots the composer already
// holds, plus the org's word-search hits, which reach further back and into
// replies), Jev picks the one the person means, and the renderer lands there
// with a banner whose "next" walks the ranking locally. Jev never sees an id.

export const FindCandidate = z.object({
  /** The message to land on. */
  messageId: z.string(),
  /** Its thread's root: its own id when it IS a root. */
  threadRootId: z.string(),
  /** The topic title annotating the thread, when one exists. */
  title: z.string().nullable(),
  /** The message text: a root's gist, or a hit's excerpt; mentions resolved to names. */
  text: z.string(),
  author: z.string().optional(),
  /** When it was posted, or the thread's last activity for a recent root. */
  at: z.string(),
  /** Replies under a root, when known: a thread with replies opens as a thread. */
  replyCount: z.number().int().nonnegative().optional(),
  /** The row's position in the space's log, when known: a jump lands without a lookup. */
  offset: z.number().optional(),
  source: z.enum(['recent', 'search']),
});
export type FindCandidate = z.infer<typeof FindCandidate>;

export const FindRequest = z.object({
  spaceName: z.string(),
  query: z.string(),
  candidates: z.array(FindCandidate),
});
export type FindRequest = z.infer<typeof FindRequest>;

export const FindResult = z.object({
  reason: z.enum(['no-key', 'no-candidates', 'ranked']),
  /** Every candidate that drew any probability, strongest first. */
  ranked: z.array(z.object({ messageId: z.string(), probability: z.number() })),
  /** Jev's probability that what the person wants is among the candidates at all. */
  presence: z.number().optional(),
  /** Jev's confidence on the pick. */
  confidence: z.number().optional(),
  /** Worth landing on: present enough, and the pick is not "none of these". */
  found: z.boolean(),
});
export type FindResult = z.infer<typeof FindResult>;
