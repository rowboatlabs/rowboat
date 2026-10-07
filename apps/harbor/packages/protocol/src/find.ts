import { z } from 'zod';
import { MessageId, StreamOffset } from './ids.js';

// /find on Harbor (2026-10-07, Arjun's call): "take me there, correct me if
// I am wrong", answered by Jev on the deployment's key instead of each
// person's own. Harbor gathers the candidates itself (the space's recent
// roots and topics, plus its word search), within what the caller can read,
// asks Jev which one the words describe, and returns the whole ranking so
// "next match" walks it without a second call. Jev never sees an id. Open to
// every member who can read the space: Ro need not be in it.

export const FindQuery = z.string().trim().min(1).max(500);

/** One ranked candidate, carrying what the app needs to land on it. */
export const FindHit = z.object({
  messageId: MessageId,
  /** Its thread's root: its own id when it IS a root. */
  threadRootId: MessageId,
  /** The topic title annotating the thread, when one exists. */
  title: z.string().nullable(),
  /** Replies under a root: a root with replies opens as a thread. Absent on a reply. */
  replyCount: z.number().int().nonnegative().optional(),
  offset: StreamOffset,
  /** Jev's share of the distribution on this candidate. */
  probability: z.number(),
});
export type FindHit = z.infer<typeof FindHit>;

export const FindResult = z.object({
  /**
   * `unavailable`: this deployment runs no Jev (no key), so nothing was asked.
   * `no-candidates`: the space had nothing to pick from. `ranked`: Jev answered.
   */
  reason: z.enum(['unavailable', 'no-candidates', 'ranked']),
  /** Every candidate that drew any probability, strongest first. */
  ranked: z.array(FindHit),
  /** Jev's probability that what the person wants is among the candidates at all. */
  presence: z.number().optional(),
  /** Jev's confidence in its pick. */
  confidence: z.number().optional(),
  /** Worth landing on: present enough, and the pick is not "none of these". */
  found: z.boolean(),
});
export type FindResult = z.infer<typeof FindResult>;
