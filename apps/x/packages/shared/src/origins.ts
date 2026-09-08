import { z } from "zod";

// Where an input came from: the thing OUTSIDE the runtime that caused a user
// message to be sent (a space mention today; a todo item, a channel message,
// ... later). Stamped on turn_created for the turn's first input, on
// input_added when a queued message is steered into a live turn, and carried
// by pending-queue entries until delivery. The runtime records it and never
// reads it. Consumers (the spaces agent-activity feed) match on it to answer
// "is the agent working on the thing I did?" from bus events alone, without
// inspecting sessions or turns.
//
// A discriminated union so each kind carries typed fields instead of a
// joined key readers would have to split back apart. Closed by design: a
// build that does not know a kind cannot read a turn file that uses it —
// the same posture as the UseCase enum.
export const SpaceMentionOrigin = z.object({
    kind: z.literal("space_mention"),
    orgId: z.string(),
    spaceId: z.string(),
    // The thread the mention lives in: the message's root (its own id when
    // it IS a root). Activity is keyed per thread.
    threadRootId: z.string(),
    // The @rowboat feed message itself — the invocation's provenance.
    messageId: z.string(),
});
export type SpaceMentionOrigin = z.infer<typeof SpaceMentionOrigin>;

export const InputOrigin = z.discriminatedUnion("kind", [SpaceMentionOrigin]);
export type InputOrigin = z.infer<typeof InputOrigin>;
