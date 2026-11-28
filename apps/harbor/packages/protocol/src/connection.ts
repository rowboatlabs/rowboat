import { z } from 'zod';
import { MemberId, MessageId, SpaceId, Ulid } from './ids.js';

// Space connections (spec §8 Space connections, 2026-11-28, "channel has
// direct connections" in the rowboat space): an admin connects an app to a
// shared space, and what happens there is posted in the space by the
// connection itself, a member of its own. The app is reached through Composio
// on the deployment's control plane, which holds the app's authorisation and
// receives its events; Harbor holds what the space chose and decides what is
// worth a post.

export const ConnectionId = Ulid;
export type ConnectionId = z.infer<typeof ConnectionId>;

/** An app's slug as Composio names it (`linear`, `github`): lowercase, digits, `_` and `-`. */
export const ConnectionAppSlug = z.string().regex(/^[a-z0-9_-]{1,64}$/, 'expected an app slug');
/** A trigger type's slug as Composio names it (`LINEAR_ISSUE_CREATED_TRIGGER`). */
export const ConnectionTriggerSlug = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'expected a trigger slug');

/** An app a space can connect: one whose events the control plane can deliver. */
export const ConnectionApp = z.object({
  slug: ConnectionAppSlug,
  name: z.string().min(1).max(128),
  logo: z.string().url().optional(),
  description: z.string().max(2000).optional(),
  /** How many kinds of event it can send. */
  triggersCount: z.number().int().nonnegative(),
});
export type ConnectionApp = z.infer<typeof ConnectionApp>;

/**
 * One kind of event an app can send. `config` is the JSON Schema of what the
 * trigger needs to be set up (a team, a repository), passed through from
 * Composio so a client can draw the form; `{}` or no properties = nothing to fill.
 */
export const ConnectionTriggerType = z.object({
  slug: ConnectionTriggerSlug,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).default(''),
  config: z.record(z.string(), z.unknown()).default({}),
  /** Whether the app pushes the event or it is polled for (a polled event lags by its interval). */
  delivery: z.enum(['webhook', 'poll']).optional(),
});
export type ConnectionTriggerType = z.infer<typeof ConnectionTriggerType>;

/** A trigger a connection listens for, with the values its config was given. */
export const ConnectionTrigger = z.object({
  slug: ConnectionTriggerSlug,
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type ConnectionTrigger = z.infer<typeof ConnectionTrigger>;

/** What a client sends to choose a trigger: the server names it from the app's own list. */
export const ConnectionTriggerInput = z.object({
  slug: ConnectionTriggerSlug,
  config: z.record(z.string(), z.unknown()).default({}),
});
export type ConnectionTriggerInput = z.infer<typeof ConnectionTriggerInput>;

/**
 * `pending`: made, waiting for a person to authorise the app at the address
 * `createSpaceConnection` returned. `active`: authorised; it posts what its
 * triggers send. `failed`: the authorisation was refused, or has since expired
 * or been revoked; `problem` says which, and authorising again repairs it.
 */
export const ConnectionStatus = z.enum(['pending', 'active', 'failed']);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const CONNECTION_NAME_MAX = 64;
/** The most triggers one connection listens for. */
export const CONNECTION_TRIGGERS_MAX = 20;

export const SpaceConnection = z.object({
  id: ConnectionId,
  spaceId: SpaceId,
  /** The member that posts its updates: an agent of kind `connection`, in this space only (core.ts CONNECTION_KIND). */
  memberId: MemberId,
  app: z.object({ slug: ConnectionAppSlug, name: z.string().min(1).max(128), logo: z.string().url().optional() }),
  /** What the space calls it ("Linear – Eng"); also its member's display name. */
  name: z.string().min(1).max(CONNECTION_NAME_MAX),
  status: ConnectionStatus,
  /** Why it is `failed`, in a sentence a person can act on. */
  problem: z.string().max(500).optional(),
  triggers: z.array(ConnectionTrigger).max(CONNECTION_TRIGGERS_MAX),
  /**
   * "Only post what matters to this space": each event is put to Jev, and
   * one it scores below the line is kept as skipped instead of posted. Off,
   * or on a server without Jev, every event is posted.
   */
  filter: z.boolean(),
  /** Paused: events that arrive are dropped, neither posted nor kept. */
  paused: z.boolean(),
  /** Who connected it; what it uses bills to their Rowboat account. */
  createdBy: MemberId,
  createdAt: z.string(),
  /** Events posted and skipped over the last seven days, from the events Harbor keeps. */
  posted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  lastEventAt: z.string().optional(),
});
export type SpaceConnection = z.infer<typeof SpaceConnection>;

/**
 * `pending`: taken, not yet decided. `posted`: in the space, as `messageId`.
 * `skipped`: Jev scored it below the line (`score`). `failed`: it could not
 * be posted after several tries.
 */
export const ConnectionEventOutcome = z.enum(['pending', 'posted', 'skipped', 'failed']);
export type ConnectionEventOutcome = z.infer<typeof ConnectionEventOutcome>;

/** One event a connection received, as the space's admins review it: what it was about, never its payload. */
export const ConnectionEvent = z.object({
  id: z.string().min(1).max(256),
  trigger: ConnectionTriggerSlug,
  title: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
  outcome: ConnectionEventOutcome,
  /** Jev's probability that it was worth a post, when the filter was asked. */
  score: z.number().min(0).max(1).optional(),
  messageId: MessageId.optional(),
  receivedAt: z.string(),
});
export type ConnectionEvent = z.infer<typeof ConnectionEvent>;

/**
 * An event as the control plane delivers it to `receiveConnectionEvent`:
 * `ref` is the connection's id, `id` is stable across redeliveries (Harbor
 * takes each once), and `data` is the trigger's own payload.
 */
export const ConnectionDelivery = z.object({
  id: z.string().min(1).max(256),
  ref: ConnectionId,
  triggerId: z.string().min(1).max(256),
  triggerSlug: ConnectionTriggerSlug,
  receivedAt: z.string().optional(),
  data: z.unknown(),
});
export type ConnectionDelivery = z.infer<typeof ConnectionDelivery>;
