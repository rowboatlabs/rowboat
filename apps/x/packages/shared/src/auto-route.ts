import { z } from 'zod';

// Auto-routing for the Spaces stream composer (2026-09-22). With the Auto
// toggle on, Jev (TypeSafe's System One model) decides at send time whether a
// draft is a new stream message or a reply to one of the space's open
// threads. The renderer gathers the candidates it already holds (topics plus
// roots with replies); core owns the questions, the thresholds, and the key.

/** A root message or open thread the draft could continue, as the renderer already knows it. */
export const RouteCandidate = z.object({
  rootMessageId: z.string(),
  /** The topic title when the thread is annotated; null for a plain thread. */
  title: z.string().nullable(),
  /** The root message with mentions resolved to names and embeds stripped. */
  rootText: z.string(),
  rootAuthor: z.string().optional(),
  /**
   * The author's member id for direct (human) posts; absent for agent posts,
   * so a person is only ever suggested as a tag for what they wrote themselves.
   */
  rootAuthorId: z.string().optional(),
  replyCount: z.number().int().nonnegative(),
  lastActivityAt: z.string(),
});
export type RouteCandidate = z.infer<typeof RouteCandidate>;

export const AutoRouteRequest = z.object({
  spaceName: z.string(),
  draft: z.string(),
  authorName: z.string().optional(),
  candidates: z.array(RouteCandidate),
  // Tag suggestions (2026-09-24): who the draft might need, judged from the
  // same recent roots. The people come from the candidates' authors and from
  // names in the draft; the sender is never one of them.
  /** The space's members, for name matches in the draft and to drop anyone who left. */
  members: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  senderId: z.string().optional(),
  /** False skips the tag questions: the per-install switch, or a direct space. */
  suggestTags: z.boolean().optional(),
});
export type AutoRouteRequest = z.infer<typeof AutoRouteRequest>;

export const TagSuggestion = z.object({
  memberId: z.string(),
  name: z.string(),
  probability: z.number(),
});
export type TagSuggestion = z.infer<typeof TagSuggestion>;

/** Why the decision landed where it did; the composer's feedback keys off it. */
export const AutoRouteReason = z.enum([
  /** No TypeSafe key configured: the stream, as if Auto were off. */
  'no-key',
  /** Nothing to route into: the stream, without asking. */
  'no-candidates',
  /** Jev picked "new message". */
  'new-message',
  /** Jev leaned to a thread but below the thresholds. */
  'uncertain',
  /** Jev picked a thread above the thresholds. */
  'thread',
]);
export type AutoRouteReason = z.infer<typeof AutoRouteReason>;

export const AutoRouteDecision = z.object({
  destination: z.enum(['stream', 'thread']),
  /** Set when destination is 'thread'. */
  threadRootId: z.string().optional(),
  reason: AutoRouteReason,
  /** Jev's probability for the option it picked, when it was asked. */
  probability: z.number().optional(),
  /** Jev's confidence on the destination choice, when it was asked. */
  confidence: z.number().optional(),
  /** People the draft seems to need, strongest first, already thresholded; only on a stream verdict. */
  tags: z.array(TagSuggestion).optional(),
  /** Present when the draft reads as something everyone should see: the @here probability. */
  here: z.number().optional(),
});
export type AutoRouteDecision = z.infer<typeof AutoRouteDecision>;
