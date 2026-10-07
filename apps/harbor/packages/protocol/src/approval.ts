import { z } from 'zod';
import { MemberId, MessageId, SpaceId } from './ids.js';

// Approvals (spec §8 part 4, 2026-10-01). An agent that acts on someone's
// machine or accounts stops to ask before a risky step; every agent protocol
// that asks does it with a structured request of its own (Hermes, OpenClaw,
// Codex, Claude Code, OpenCode, ACP), so an approval is its own record on an
// invocation, not the waiting state. The card is the agent's message in the
// thread, with the approval riding on it as a poll rides on its message. Kept
// apart from invocation.ts so core.ts (Message) can import it without a cycle.

export const ApprovalId = z.string().min(1).max(64);
export type ApprovalId = z.infer<typeof ApprovalId>;

/**
 * One set of choices for every agent: Allow once, Allow in this thread (every
 * connector maps a thread to one session of its agent), Always allow (the
 * agent remembers it beyond the thread), Deny. A connector maps its agent's
 * own choices onto these and offers the subset its agent takes. Ending the
 * whole turn is Stop, not a choice.
 */
export const ApprovalChoice = z.enum(['allow_once', 'allow_session', 'allow_always', 'deny']);
export type ApprovalChoice = z.infer<typeof ApprovalChoice>;

/** What each choice says on the card, and in its text rendering. */
export const APPROVAL_CHOICE_LABELS: Record<ApprovalChoice, string> = {
  allow_once: 'Allow once',
  allow_session: 'Allow in this thread',
  allow_always: 'Always allow',
  deny: 'Deny',
};

/** `open` until a person decides (`allowed`, `denied`) or the connector closes it (`expired`: the agent gave up; `cancelled`). */
export const ApprovalState = z.enum(['open', 'allowed', 'denied', 'expired', 'cancelled']);
export type ApprovalState = z.infer<typeof ApprovalState>;

export const Approval = z.object({
  id: ApprovalId,
  /** The invocation it belongs to (an InvocationId). */
  invocationId: z.string().min(1).max(64),
  agentId: MemberId,
  conversation: z.object({ spaceId: SpaceId, threadRootId: MessageId }),
  /** The agent's card: the message this approval rides on. */
  messageId: MessageId,
  /** The agent's own id for the request: a connector raising it again gets this one back. */
  requestKey: z.string().min(1).max(200),
  /** One line: "Run a command", "Edit 3 files". */
  title: z.string().min(1).max(200),
  /** The exact action, as text: the command and its directory, a diff summary, a tool and its input. */
  detail: z.string().max(8000),
  /** Why the agent asks, when it says. */
  reason: z.string().max(1000).optional(),
  /** The choices this agent offers, in the card's order. */
  choices: z.array(ApprovalChoice).min(1).max(4),
  state: ApprovalState,
  decision: ApprovalChoice.optional(),
  decidedBy: MemberId.optional(),
  decidedAt: z.iso.datetime().optional(),
  /** A note back to the model, with a deny. */
  note: z.string().max(1000).optional(),
  /** When the connector confirmed it passed the decision to its agent. */
  appliedAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Approval = z.infer<typeof Approval>;

/** A connector raising an approval on one of its invocations. */
export const ApprovalRequest = z.object({
  requestKey: Approval.shape.requestKey,
  title: Approval.shape.title,
  detail: Approval.shape.detail,
  reason: Approval.shape.reason,
  choices: z
    .array(ApprovalChoice)
    .min(1)
    .max(4)
    .refine((choices) => new Set(choices).size === choices.length, 'each choice once'),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** A person's decision. Deciding is REST only, never a tool, and never by an agent (spec §8 part 4). */
export const ApprovalDecision = z.object({
  decision: ApprovalChoice,
  /** Only with a deny: what the model is told. */
  note: z.string().max(1000).optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

/** The connector closing one its agent no longer waits on. */
export const ApprovalClose = z.object({ state: z.enum(['expired', 'cancelled']) });
export type ApprovalClose = z.infer<typeof ApprovalClose>;
