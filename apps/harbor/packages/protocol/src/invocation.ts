import { z } from 'zod';
import { SpaceKind } from './core.js';
import { MemberId, MessageId, SpaceId } from './ids.js';

// The agent contracts (spec §8 Invoking agent members, 2026-09-30). Every
// agent member — whatever runs it: a Hermes or OpenClaw gateway, Claude Code,
// Codex, Replicas — is reached through these objects. Harbor decides when an
// agent is invoked and holds the queue; a connector, the adapter for one kind
// of agent, only carries an invocation out and reports back. The operations
// that move these objects land on the wire (api.ts, CONTRACT.md) with the
// Harbor build that serves them.

export const InvocationId = z.string().min(1).max(64);
export type InvocationId = z.infer<typeof InvocationId>;

/**
 * Where an invocation is. `queued` waits in Harbor behind the conversation's
 * running one; `pending` is delivered and not yet acknowledged; `working` is
 * acknowledged; `waiting` needs a person (an approval, an answer) before it
 * can go on; then `done`, `failed` or `cancelled`. `refused` was never
 * delivered (see InvocationRefusal).
 */
export const InvocationState = z.enum(['queued', 'pending', 'working', 'waiting', 'done', 'failed', 'cancelled', 'refused']);
export type InvocationState = z.infer<typeof InvocationState>;

/** Why a mention created no work: the invoker shares no space with the agent, or too many agent hand-offs led here. */
export const InvocationRefusal = z.object({
  reason: z.enum(['not_permitted', 'hop_limit']),
  message: z.string().max(280),
});
export type InvocationRefusal = z.infer<typeof InvocationRefusal>;

/** A connector-declared option's key: what the invocation's `options` record is keyed by. */
export const InvocationOptionKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

/**
 * An option a connector offers on its invocations — a choice list or a
 * toggle, such as Environment, Plan first, or Model. The composer shows the
 * mentioned agent's options; Harbor passes the picked values through without
 * interpreting them. Nothing here is specific to coding: where a coding
 * agent's work runs is its connector's to resolve (spec §8), and an
 * Environment option is just one input to that.
 */
export const InvocationOption = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('select'),
    key: InvocationOptionKey,
    label: z.string().min(1).max(64),
    choices: z.array(z.object({ id: z.string().min(1).max(256), label: z.string().min(1).max(128) })).min(1).max(100),
  }),
  z.object({ type: z.literal('toggle'), key: InvocationOptionKey, label: z.string().min(1).max(64) }),
]);
export type InvocationOption = z.infer<typeof InvocationOption>;

export const Invocation = z.object({
  id: InvocationId,
  /** The agent member invoked. */
  agentId: MemberId,
  /** The conversation: a thread. Each connector maps it to one session of its own. */
  conversation: z.object({ spaceId: SpaceId, threadRootId: MessageId }),
  /** The message that invoked the agent. Its author is the invoker. */
  trigger: z.object({ messageId: MessageId, authorId: MemberId, body: z.string() }),
  /** Where it happened. A DM's name is a placeholder: label it by the other member. */
  where: z.object({ spaceKind: SpaceKind, spaceName: z.string() }),
  /** Agent hand-offs that led here: 0 for a person's mention. Harbor refuses past its limit. */
  depth: z.number().int().nonnegative(),
  /** The values the invoker picked for the connector's declared options: a choice's id, or a toggle's on/off. */
  options: z.record(InvocationOptionKey, z.union([z.string().max(256), z.boolean()])).optional(),
  /** Set when this invocation is a person's answer to one that is waiting in the same conversation. */
  answers: InvocationId.optional(),
  state: InvocationState,
  /** One ephemeral line: what it is doing ("Running tests"), or what it waits for. */
  activity: z.string().max(200).optional(),
  /** The connector's own view of the run ("Open in Replicas"). Harbor keeps no traces. */
  link: z.string().url().optional(),
  error: z.string().max(1000).optional(),
  refusal: InvocationRefusal.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Invocation = z.infer<typeof Invocation>;

/**
 * What a connector reports about an invocation it acknowledged. Every
 * connector reports `working` and an end state; `waiting` says what it needs
 * from a person; activity and link are optional, sent by connectors whose
 * agent has the detail.
 */
export const InvocationUpdate = z.discriminatedUnion('state', [
  z.object({ state: z.literal('working'), activity: z.string().max(200).optional(), link: z.string().url().optional() }),
  z.object({ state: z.literal('waiting'), activity: z.string().max(200) }),
  z.object({ state: z.literal('done') }),
  z.object({ state: z.literal('failed'), error: z.string().max(1000).optional() }),
  z.object({ state: z.literal('cancelled') }),
]);
export type InvocationUpdate = z.infer<typeof InvocationUpdate>;

/**
 * What a connector's agent offers beyond the contract's floor, declared when
 * it connects and again whenever it changes. Absent means no: Harbor offers
 * Stop on a running invocation only to a connector that declared it, and the
 * composer shows only declared options. Steering, when it comes, is another
 * optional field here, and a connector that does not declare it keeps queueing.
 */
export const ConnectorCapabilities = z.object({
  stop: z.boolean().default(false),
  options: z.array(InvocationOption).max(8).default([]),
});
export type ConnectorCapabilities = z.infer<typeof ConnectorCapabilities>;
