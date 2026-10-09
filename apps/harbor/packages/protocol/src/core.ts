import { z } from 'zod';
import { Approval } from './approval.js';
import { AssetId, ChangeSetId, MemberId, MessageId, SpaceId, StreamOffset, TopicId } from './ids.js';

// Core objects shared by both faces. Every act in a space belongs to a member
// (spec §2, principle 4); attribution carries the acting mode. An agent that
// acts as itself is a member of kind 'agent' (2026-09-29), never a label on
// someone else's attribution.

export const ActingMode = z.enum(['direct', 'agent', 'scheduled']);
export type ActingMode = z.infer<typeof ActingMode>;

export const Attribution = z.object({
  memberId: MemberId,
  actingMode: ActingMode,
  /** Display-only agent label, e.g. "Rowboat", "Claude Code". Never an identity. */
  agentName: z.string().max(64).optional(),
});
export type Attribution = z.infer<typeof Attribution>;

/**
 * The org-level admin bit (spec §4, amended 2026-08-19): admin powers are
 * membership and policy, never content — the content plane is role-flat.
 */
export const MemberRole = z.enum(['admin', 'member']);
export type MemberRole = z.infer<typeof MemberRole>;

/**
 * What a member IS (spec §4 Agent members, 2026-09-29): a person, or an agent
 * that is a member in its own right and acts as itself. Fixed at creation.
 * Distinct from `actingMode: 'agent'`, which is a person's own agent acting
 * as that person.
 */
export const MemberKind = z.enum(['human', 'agent']);
export type MemberKind = z.infer<typeof MemberKind>;

export const Member = z.object({
  id: MemberId,
  /** Display-only, org-scoped, not unique. Attribution keys on `id`, never on names. */
  displayName: z.string().min(1).max(128),
  avatarUrl: z.string().url().optional(),
  role: MemberRole.default('member'),
  /** Absent from servers before 2026-09-29, whose members are all people. */
  kind: MemberKind.default('human'),
  /**
   * An agent's owner (spec §4 Agent members, 2026-09-29): the person who
   * added it and alone holds its keys. Absent for people.
   */
  ownerId: MemberId.optional(),
  /**
   * What an agent is underneath, and the path Harbor takes to reach it (spec
   * §4 Agent members, amended 2026-09-30). Set for every agent, absent for
   * people, fixed at creation. Open strings on the wire: a kind this client
   * doesn't know is drawn as a generic agent. AGENT_PAIRS is what Harbor accepts.
   */
  agentKind: z.string().min(1).max(32).optional(),
  agentConnection: z.string().min(1).max(32).optional(),
  /**
   * The platform instance the agent is, for a connection in
   * INSTANCE_CONNECTIONS (2026-10-05): Agent37's instance id. Not a secret.
   * Fixed at creation like the kind and connection: another instance is
   * another agent. Absent for every other agent and for people.
   */
  agentInstance: z.string().min(1).max(128).optional(),
});
export type Member = z.infer<typeof Member>;

/**
 * The (kind, connection) pairs Harbor accepts when an agent is added (spec §4
 * Agent members, 2026-09-30). What Harbor does for an agent is looked up from
 * its pair, never stored: a pair whose connection is in HARBOR_RUN_CONNECTIONS
 * gets a connector Harbor runs; any other waits for whoever holds the agent's
 * key. A new pair is a line here, never a migration.
 */
export const REPLICAS_CODING_AGENTS = ['claude-code', 'codex', 'cursor', 'opencode', 'pi', 'muse-code'] as const;
/** Conductor runs Claude Code first; Codex and Cursor once their transcripts are read (2026-10-06). */
export const CONDUCTOR_CODING_AGENTS = ['claude-code'] as const;
/** The general agents Agent37 hosts that Harbor drives through its API (2026-10-01): coding harnesses wait. */
export const AGENT37_AGENTS = ['hermes', 'openclaw'] as const;
export const AGENT_PAIRS: ReadonlyArray<{ kind: string; connection: string }> = [
  { kind: 'custom', connection: 'contract' },
  { kind: 'hermes', connection: 'plugin' },
  ...REPLICAS_CODING_AGENTS.map((kind) => ({ kind, connection: 'replicas' })),
  ...AGENT37_AGENTS.map((kind) => ({ kind, connection: 'agent37' })),
  ...CONDUCTOR_CODING_AGENTS.map((kind) => ({ kind, connection: 'conductor' })),
  // Integrations (2026-10-03): the service's own API, called on a command, its kind and connection one name.
  { kind: 'posthog', connection: 'posthog' },
  { kind: 'cal', connection: 'cal' },
];
/** Connections whose connector Harbor runs, calling the platform with a credential it holds (spec §8 Connectors). */
export const HARBOR_RUN_CONNECTIONS: readonly string[] = ['replicas', 'agent37', 'conductor', 'posthog', 'cal'];
/**
 * Connections whose agent is one instance on the platform (2026-10-05): the
 * agent is added with it, and Harbor checks the instance runs the agent's kind.
 * An Agent37 instance keeps its own memory and files, so it is the agent.
 */
export const INSTANCE_CONNECTIONS: readonly string[] = ['agent37'];
/**
 * An agent Harbor itself is (2026-10-07, Jev): built into the org, on the
 * deployment's own key, so no person adds it, owns it or holds a key for it.
 * Never in AGENT_PAIRS: people add it to spaces like any agent, but never
 * create one. Jev is TypeSafe's decision model; it reads every message in
 * its spaces and tags whoever a message needs (spec §8 Jev).
 */
export const BUILT_IN_CONNECTION = 'builtin';
export const JEV_KIND = 'jev';

export function isAgentPair(kind: string, connection: string): boolean {
  return AGENT_PAIRS.some((pair) => pair.kind === kind && pair.connection === connection);
}

/**
 * A credential an agent member presents as itself (spec §4, 2026-09-29): a
 * bearer secret the org stores only as a hash. The secret is shown once, at
 * creation (AgentKeySecret); every other read is this metadata.
 */
export const AgentKey = z.object({
  id: z.string().min(1).max(64),
  agentId: MemberId,
  createdBy: MemberId,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().optional(),
  revokedAt: z.iso.datetime().optional(),
});
export type AgentKey = z.infer<typeof AgentKey>;

/** A key at the one moment its secret exists outside the agent: the response that created it. */
export const AgentKeySecret = AgentKey.extend({ secret: z.string().startsWith('rbk_') });
export type AgentKeySecret = z.infer<typeof AgentKeySecret>;

/**
 * The platform credential Harbor holds for an agent it reaches through that
 * platform (spec §8 Connectors, 2026-09-30), as its owner sees it: only its
 * last characters. The secret is sealed and never read back. `rejectedAt` is
 * set when the platform refused it, and cleared when it is replaced.
 */
export const AgentCredential = z.object({
  hint: z.string().max(16),
  setBy: MemberId,
  setAt: z.iso.datetime(),
  rejectedAt: z.iso.datetime().optional(),
  rejectedReason: z.string().max(280).optional(),
});
export type AgentCredential = z.infer<typeof AgentCredential>;

/**
 * Where a platform agent's alerts land (spec §8 Alerts, 2026-10-03): the
 * service posts to a secret address, and the agent posts what it says into
 * this space. The address is shown once, when it is set; the org keeps its hash.
 */
export const AgentHook = z.object({
  spaceId: SpaceId,
  setBy: MemberId,
  setAt: z.iso.datetime(),
});
export type AgentHook = z.infer<typeof AgentHook>;

/** An agent with its keys, as the Agents screen lists them, and its platform credential and alert hook when Harbor runs its connector. */
export const AgentListing = z.object({ agent: Member, keys: z.array(AgentKey), credential: AgentCredential.optional(), hook: AgentHook.optional() });
export type AgentListing = z.infer<typeof AgentListing>;

/**
 * What a space IS at the org level (direct messages, 2026-09-07). `shared` =
 * the ordinary space: invites, leave, files, feed. `direct` = a DM: the SAME
 * container on the same substrate (stream, threads, files, offsets, agent
 * sessions all unchanged), with a FIXED membership — exactly `participants`,
 * no invites, no leave — and private forever: any later access path that
 * opens spaces to non-members (browse, self-join) MUST require `shared`.
 * Defaulted so payloads from pre-DM servers still parse as shared spaces.
 */
export const SpaceKind = z.enum(['shared', 'direct']);
export type SpaceKind = z.infer<typeof SpaceKind>;

export const SpaceVisibility = z.enum(['private', 'open']);
export type SpaceVisibility = z.infer<typeof SpaceVisibility>;

export const Space = z.object({
  id: SpaceId,
  /**
   * Display name of a shared space. A direct space carries a constant
   * placeholder — nothing is stored to go stale; clients label a DM by its
   * other participant's CURRENT display name (listMembers on the space).
   */
  name: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  kind: SpaceKind.default('shared'),
  /** Old payloads and existing spaces stay private (spec §5, 2026-09-22). */
  visibility: SpaceVisibility.default('private'),
  /**
   * Direct spaces only: the fixed member set, sorted — the DM's identity.
   * Absent on shared spaces. ONE element = the member's self-DM (notes to
   * self, 2026-09-08): the same private space, reachable from every device
   * and by the member's own agent.
   */
  participants: z.array(MemberId).min(1).optional(),
});
export type Space = z.infer<typeof Space>;

export const Membership = z.object({
  spaceId: SpaceId,
  memberId: MemberId,
  joinedAt: z.iso.datetime(),
});
export type Membership = z.infer<typeof Membership>;

/**
 * The deliberate conversation object (spec §7, annotation model 2026-09-01):
 * one row POINTING AT a thread's root message, carrying the stated goal
 * (title) and the archived flag. It contains no messages — deleting it
 * ("convert back to thread") loses nothing, archiving it hides nothing.
 * At most one topic per root; durable identity (agent sessions, presence,
 * unread) keys on the root message, never on this row. "Topic" is the wire
 * and storage name on purpose — the UI label ("Discussions" today) may drift
 * without a contract round. A plain reply chain with no row is a "thread".
 */
export const Topic = z.object({
  id: TopicId,
  spaceId: SpaceId,
  /** The thread this annotates: a stream root message (never a reply). */
  rootMessageId: MessageId,
  /** The stated goal, required at creation — the one deliberate ceremony. */
  title: z.string().min(1).max(256),
  createdBy: Attribution,
  createdAt: z.iso.datetime(),
  /** Off the rail. Nothing else anywhere changes; a new reply revives (un-archives). */
  archived: z.boolean(),
  /**
   * The one file this discussion is about (2026-09-11): a space asset the
   * UI opens beside the thread, by id — a rename never touches the link, and
   * a trashed file is simply an id the live listing does not know until it
   * is restored. Set via createTopic.documentAssetId or manageTopic
   * attach_document/detach_document.
   */
  documentAssetId: AssetId.optional(),
});
export type Topic = z.infer<typeof Topic>;

/** The payload of `topic_removed`: the row is gone, the thread is untouched. */
export const TopicRemoval = z.object({
  spaceId: SpaceId,
  topicId: TopicId,
  rootMessageId: MessageId,
  by: Attribution,
  at: z.iso.datetime(),
});
export type TopicRemoval = z.infer<typeof TopicRemoval>;

/** The emoji itself ("👍", ZWJ sequences included), rendered verbatim — never a :name:. */
export const ReactionEmoji = z
  .string()
  .min(1)
  .max(32)
  .refine((e) => !/\s/.test(e), 'an emoji has no whitespace');
export type ReactionEmoji = z.infer<typeof ReactionEmoji>;

/**
 * One member's reaction to one message — a per-(member, emoji) toggle, Slack
 * semantics. Attribution follows the contract's one rule (principle 4): the
 * act belongs to a member, `by.actingMode` says how it happened. `threadRoot`
 * mirrors the message's (absent = a stream root) so live clients route the
 * event without a lookup.
 */
export const Reaction = z.object({
  spaceId: SpaceId,
  messageId: MessageId,
  threadRoot: MessageId.optional(),
  emoji: ReactionEmoji,
  by: Attribution,
  at: z.iso.datetime(),
});
export type Reaction = z.infer<typeof Reaction>;

/** Display aggregate: who reacted with one emoji, in first-reacted order. */
export const ReactionGroup = z.object({
  emoji: ReactionEmoji,
  memberIds: z.array(MemberId).min(1),
  /** Latest reaction event represented by this group; absent on older servers. */
  lastOffset: StreamOffset.optional(),
});
export type ReactionGroup = z.infer<typeof ReactionGroup>;

/**
 * One poll answer, immutable once posted. `id` is server-assigned (1..n in
 * creation order) — votes and events key on it, never on array position.
 */
export const PollAnswer = z.object({
  id: z.number().int().min(1),
  text: z.string().min(1).max(55),
  emoji: ReactionEmoji.optional(),
});
export type PollAnswer = z.infer<typeof PollAnswer>;

/** Display aggregate: who voted for one answer. Votes are visible by design (the Discord posture). */
export const PollVoteGroup = z.object({
  answerId: z.number().int().min(1),
  memberIds: z.array(MemberId).min(1),
});
export type PollVoteGroup = z.infer<typeof PollVoteGroup>;

/**
 * A poll riding on a message (the Discord model: a field, not a message
 * kind). The definition — question, answers, expiry, multiselect — is
 * immutable once posted; only `endedAt` (early close) and the folded `votes`
 * move. A poll is closed when `endedAt` is set OR `expiresAt` has passed —
 * expiry is lazy, no server job fires; clients and the vote route both
 * compute it from data already on the wire. Like `reactions`, `votes` is
 * folded live state on reads; the copy inside a stored `message` event is
 * the at-post snapshot (empty).
 */
export const Poll = z.object({
  question: z.string().min(1).max(300),
  answers: z.array(PollAnswer).min(2).max(10),
  allowMultiselect: z.boolean().default(false),
  expiresAt: z.iso.datetime(),
  /** Set when the author ended the poll early; natural expiry never sets it. */
  endedAt: z.iso.datetime().optional(),
  votes: z.array(PollVoteGroup).default([]),
});
export type Poll = z.infer<typeof Poll>;

/**
 * One member's vote toggle on one poll answer — the payload of `poll_vote`.
 * Per-(member, answer), reaction semantics; on single-select polls the org
 * moves a vote by emitting a `removed` then an `added` under one lock.
 */
export const PollVote = z.object({
  spaceId: SpaceId,
  threadRoot: MessageId.optional(),
  messageId: MessageId,
  answerId: z.number().int().min(1),
  by: Attribution,
  at: z.iso.datetime(),
});
export type PollVote = z.infer<typeof PollVote>;

/** The author closing their poll early — the payload of `poll_ended`. */
export const PollEnd = z.object({
  spaceId: SpaceId,
  threadRoot: MessageId.optional(),
  messageId: MessageId,
  by: Attribution,
  at: z.iso.datetime(),
});
export type PollEnd = z.infer<typeof PollEnd>;

/**
 * The author tombstoning their own message — the one act the content plane
 * restricts to a single member (deleter == author always; admin powers are
 * membership/policy, never content — spec §4). Like Reaction, `threadRoot`
 * mirrors the message's, for event routing.
 */
export const MessageDeletion = z.object({
  spaceId: SpaceId,
  messageId: MessageId,
  threadRoot: MessageId.optional(),
  by: Attribution,
  at: z.iso.datetime(),
});
export type MessageDeletion = z.infer<typeof MessageDeletion>;

/** An author's in-place rewrite of a message body — the payload of `message_edited`. */
export const MessageEdit = z.object({
  spaceId: SpaceId,
  messageId: MessageId,
  threadRoot: MessageId.optional(),
  body: z.string().min(1).max(65_536),
  by: Attribution,
  at: z.iso.datetime(),
  /** The re-stamped addresses (mentions.ts) — folding clients update them with the body. */
  mentions: z.array(MemberId).default([]),
  mentionsHere: z.boolean().default(false),
  mentionsRowboat: z.boolean().default(false),
});
export type MessageEdit = z.infer<typeof MessageEdit>;

export const Message = z.object({
  id: MessageId,
  spaceId: SpaceId,
  /**
   * The write-once reply pointer (annotation model): absent = a root message
   * in the space's one stream; present = a reply in the flat thread under
   * that root. Always a ROOT's id — never a reply's (the org normalizes), so
   * threads are flat by shape, not convention. Set at post time, immutable.
   */
  threadRoot: MessageId.optional(),
  author: Attribution,
  /**
   * Markdown. The link grammar (ids.ts) is valid inside message bodies.
   * Empty exactly when the message is deleted (post routes keep min 1 on
   * their request shapes) — a tombstone keeps its id and offset but carries
   * no content, anywhere, ever again.
   */
  body: z.string().max(65_536),
  postedAt: z.iso.datetime(),
  offset: StreamOffset,
  /**
   * Reply denorm on ROOT messages: live (non-tombstoned) replies in this
   * message's thread, so every listing can render the reply chip without a
   * reverse lookup. Maintained by the org; 0 on replies and on stored
   * message events (reads carry the current truth, like reactions).
   */
  replyCount: z.number().int().nonnegative().default(0),
  /** When the newest reply landed (roots with replies only) — chip recency + rail sorting. */
  lastReplyAt: z.iso.datetime().optional(),
  /**
   * Offset of the newest LIVE reply (roots with replies only; tombstoned
   * replies excluded, unlike lastReplyAt). Read marks compare against it: a
   * followed thread is unread when this exceeds the member's mark.
   */
  lastReplyOffset: StreamOffset.optional(),
  /** Provenance when this root was posted in reply to an activity row (a change-set). */
  anchorChangeSetId: ChangeSetId.optional(),
  /** Set when the author deleted the message (deleter == author, so no separate attribution). */
  deletedAt: z.iso.datetime().optional(),
  /** Set when the author last edited the body (editor == author, like deletion). */
  editedAt: z.iso.datetime().optional(),
  /**
   * Folded reactions, groups in first-reacted order. The default keeps pre-
   * reaction payloads (older servers, stored message events) parseable; reads
   * fold live state in, so the field is current wherever messages are listed.
   */
  reactions: z.array(ReactionGroup).default([]),
  /**
   * Present on poll messages. `body` still carries a plain-markdown fallback
   * rendering of the poll (clients that predate the field show something
   * sensible; body semantics — min 1, tombstone = empty — stay untouched);
   * poll-aware clients render the card instead of the body. Deletion redacts
   * the poll along with the body.
   */
  poll: Poll.optional(),
  /**
   * Present on an agent's approval card (spec §8 part 4, 2026-10-01), folded
   * to its current state wherever messages are read; `approval` space events
   * carry each change. `body` keeps a text rendering for clients that cannot
   * show the card.
   */
  approval: Approval.optional(),
  /**
   * Who this message addresses — STAMPED by the org at post and edit from the
   * body's mention tokens (mentions.ts), never from names, and only ids that
   * are members of the space. Unread counts, Activity, and push read these;
   * nothing anywhere re-parses text. Defaults keep pre-stamp payloads parsing.
   */
  mentions: z.array(MemberId).default([]),
  mentionsHere: z.boolean().default(false),
  mentionsRowboat: z.boolean().default(false),
});
export type Message = z.infer<typeof Message>;
