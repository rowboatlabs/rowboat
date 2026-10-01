import {
  ConnectorCapabilities,
  type ActingMode,
  type Approval,
  type ApprovalClose,
  type ApprovalDecision,
  type ApprovalRequest,
  type Invocation,
  type InvocationOptionValues,
  type InvocationState,
  type InvocationUpdate,
  type Message,
  type ServerFrame,
  type Space,
} from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import { canCancelQueuedInvocation, canDecideApproval, canStopInvocation, enforce, invocationRefusal } from '../policy.js';
import type { ActorCtx, Kernel } from './kernel.js';

// Invoking agent members (spec §8, 2026-09-30). Harbor decides and a
// connector carries out: a mention of an agent member, when policy allows it,
// becomes a durable invocation; Harbor holds one per (agent, conversation) at
// a time and queues the rest; the agent's connector acknowledges and reports
// state on the agent's own key. Every state change runs under the space lock
// of the invocation's space, so a post, an acknowledgement and a promotion out
// of the queue never interleave, and every frame leaves after the commit.

/** Delivered and not yet finished: at most one per (agent, conversation), plus answers to a waiting one. */
const LIVE: InvocationState[] = ['pending', 'working', 'waiting'];
const TERMINAL = new Set<InvocationState>(['done', 'failed', 'cancelled', 'refused']);

/**
 * A working invocation that has reported nothing for this long counts as
 * failed when its conversation next needs the turn. Connectors report
 * `working` again as a heartbeat. Pending (delivered to a connector that is
 * away) and waiting (on a person) never time out: durability is the point.
 */
const WORKING_TIMEOUT_MS = 30 * 60 * 1000;

/** How many of a space's invocations a listing returns, newest first. */
const LIST_LIMIT = 100;

/**
 * The owner's defaults that still fit what the connector declares (spec §8
 * Invocation options, 2026-10-01): a default for an option it no longer
 * declares, or a choice it no longer offers, is skipped rather than sent.
 */
export function applicableDefaults(capabilities: ConnectorCapabilities, defaults: InvocationOptionValues): InvocationOptionValues {
  const fit: InvocationOptionValues = {};
  for (const option of capabilities.options) {
    const value = defaults[option.key];
    if (value === undefined) continue;
    if (option.type === 'toggle' ? typeof value === 'boolean' : typeof value === 'string' && option.choices.some((c) => c.id === value)) {
      fit[option.key] = value;
    }
  }
  return fit;
}

/** Frames to send once the lock — the transaction — has returned. */
export type InvocationOutbox = Array<
  { to: 'agent'; memberId: string; frame: ServerFrame } | { to: 'space'; spaceId: string; frame: ServerFrame }
>;

export class Invocations {
  constructor(private readonly k: Kernel) {}

  // --- the trigger: Feed.postMessage calls this inside its space lock ------------

  /**
   * The agents a new message invokes (v1: mentions only). Each mentioned
   * agent member other than the author gets an invocation: refused (no
   * shared space, or past the hop limit), pending (its conversation is free,
   * or its turn is waiting on a person, which this answers), or queued.
   * Edits never invoke.
   */
  async onMessage(
    ctx: ActorCtx,
    space: Space,
    message: Message,
    agentOptions: Record<string, InvocationOptionValues> | undefined,
    out: InvocationOutbox,
  ): Promise<Invocation[]> {
    const created: Invocation[] = [];
    // The agents it mentions, and in a DM with an agent that agent, mention or
    // not (spec §8, amended 2026-09-30). The checks below keep a person's DMs
    // and a self-DM out: only an agent that is not the author is invoked.
    const invoked = new Set(message.mentions);
    if (space.kind === 'direct') for (const id of space.participants ?? []) invoked.add(id);
    for (const agentId of invoked) {
      if (agentId === message.author.memberId) continue;
      const agent = await this.k.store.getMember(agentId);
      if (agent?.kind !== 'agent') continue;
      const threadRootId = message.threadRoot ?? message.id;
      // An agent's post hands work on: one hop deeper than the deepest turn it is running (spec §8).
      const depth = ctx.agent ? 1 + (await this.deepestLive(ctx.memberId)) : 0;
      const shares = space.kind === 'shared' || (await this.k.store.sharesSharedSpace(message.author.memberId, agentId));
      const refusal = invocationRefusal(shares, depth);
      const now = this.k.now();
      // The owner's defaults fill what the invoker did not pick: a mention, a DM, an agent's hand-off alike.
      const options = { ...(await this.defaultsFor(agentId)), ...agentOptions?.[agentId] };
      const invocation: Invocation = {
        id: this.k.ulid(),
        agentId,
        conversation: { spaceId: space.id, threadRootId },
        trigger: { messageId: message.id, authorId: message.author.memberId, body: message.body },
        where: { spaceKind: space.kind, spaceName: space.name },
        depth,
        ...(options && Object.keys(options).length > 0 ? { options } : {}),
        state: 'refused',
        ...(refusal ? { refusal } : {}),
        createdAt: now,
        updatedAt: now,
      };
      if (!refusal) {
        const live = await this.settle(agentId, space.id, threadRootId, out);
        const turn = live.find((i) => !i.answers);
        if (!turn) invocation.state = 'pending';
        // One waiting on an approval is decided on its card: a mention queues (spec §8 part 4).
        else if (turn.state === 'waiting' && !(await this.hasOpenApproval(turn.id))) Object.assign(invocation, { state: 'pending', answers: turn.id });
        else invocation.state = 'queued';
      }
      await this.k.store.insertInvocation(invocation, message.offset);
      this.announce(invocation, out);
      created.push(invocation);
    }
    return created;
  }

  /** Send what the lock held back. */
  flush(out: InvocationOutbox): void {
    for (const item of out) {
      if (item.to === 'agent') this.k.hub.publishToMember(item.memberId, item.frame);
      else this.k.hub.publish(item.spaceId, item.frame);
    }
  }

  // --- the connector's operations: on an agent's own key, about its own invocations ---

  /** The agent's delivered, unfinished invocations: what a reconnecting connector picks up. */
  async listForAgent(ctx: ActorCtx): Promise<Invocation[]> {
    this.requireConnector(ctx);
    return this.k.store.listInvocationsForAgent(ctx.memberId, LIVE);
  }

  /** pending → working. Idempotent for one already acknowledged; a cancelled one must be dropped. */
  async acknowledge(ctx: ActorCtx, id: string): Promise<Invocation> {
    const found = await this.own(ctx, id);
    const out: InvocationOutbox = [];
    const result = await this.k.locked(found.conversation.spaceId, async () => {
      const current = (await this.k.store.getInvocation(id))!;
      if (current.state === 'working' || current.state === 'waiting') return current;
      if (current.state !== 'pending') throw new HarborError('invalid_request', `this invocation is ${current.state}: drop it`);
      const next: Invocation = { ...current, state: 'working', updatedAt: this.k.now() };
      await this.k.store.putInvocation(next);
      this.announce(next, out);
      return next;
    });
    this.flush(out);
    return result;
  }

  /** The connector's report: working (a heartbeat, with an activity line), waiting on a person, or an end state. */
  async update(ctx: ActorCtx, id: string, update: InvocationUpdate): Promise<Invocation> {
    const found = await this.own(ctx, id);
    const out: InvocationOutbox = [];
    const result = await this.k.locked(found.conversation.spaceId, async () => {
      const current = (await this.k.store.getInvocation(id))!;
      if (TERMINAL.has(current.state) || current.state === 'queued') {
        throw new HarborError('invalid_request', `this invocation is ${current.state}: it takes no reports`);
      }
      return this.apply(current, update, out);
    });
    this.flush(out);
    return result;
  }

  /**
   * The checked half of answering (Feed.postMessage `finishes`, spec §8
   * Connectors, 2026-09-30), run inside the answer's own transaction: the
   * invocation is this agent's, in this thread, and not finished. A replay of
   * an answer finds it done and posts nothing.
   */
  async assertFinishable(ctx: ActorCtx, id: string, spaceId: string, threadRootId: string): Promise<Invocation> {
    const current = await this.own(ctx, id);
    if (current.conversation.spaceId !== spaceId || current.conversation.threadRootId !== threadRootId) {
      throw new HarborError('invalid_request', 'an answer goes in its invocation\'s thread');
    }
    if (current.state !== 'working' && current.state !== 'waiting') {
      throw new HarborError('invalid_request', `this invocation is ${current.state}: it takes no answer`);
    }
    return current;
  }

  /** The other half: done, in the same transaction as the answer. */
  async finishWithin(current: Invocation, out: InvocationOutbox): Promise<Invocation> {
    return this.apply(current, { state: 'done' }, out);
  }

  private async apply(current: Invocation, update: InvocationUpdate, out: InvocationOutbox): Promise<Invocation> {
    // A heartbeat while an approval is open keeps it waiting: it shows waiting while any is (spec §8 part 4).
    if (update.state === 'working' && current.state === 'waiting' && (await this.hasOpenApproval(current.id))) {
      const held: Invocation = { ...current, ...(update.link ? { link: update.link } : {}), updatedAt: this.k.now() };
      await this.k.store.putInvocation(held);
      this.announce(held, out);
      return held;
    }
    const { activity: _activity, error: _error, ...rest } = current;
    const next: Invocation = { ...rest, state: update.state, updatedAt: this.k.now() };
    if (update.state === 'working' || update.state === 'waiting') {
      if (update.activity) next.activity = update.activity;
    }
    if (update.state === 'working' && update.link) next.link = update.link;
    if (update.state === 'failed' && update.error) next.error = update.error;
    await this.k.store.putInvocation(next);
    this.announce(next, out);
    if (TERMINAL.has(next.state)) {
      await this.cancelOpenApprovals(next);
      await this.promote(next.agentId, next.conversation.spaceId, next.conversation.threadRootId, out);
    }
    return next;
  }


  /** What the connector's agent can do: Stop, and the options the composer offers. Declared again whenever it changes. */
  async declareCapabilities(ctx: ActorCtx, capabilities: ConnectorCapabilities): Promise<ConnectorCapabilities> {
    this.requireConnector(ctx);
    await this.k.store.putAgentCapabilities(ctx.memberId, capabilities, this.k.now());
    return capabilities;
  }

  // --- people's side ---------------------------------------------------------------

  /** The owner's defaults that fit the agent's declared options, as an invocation gets them. */
  private async defaultsFor(agentId: string): Promise<InvocationOptionValues> {
    const defaults = await this.k.store.getAgentOptionDefaults(agentId);
    if (!defaults || Object.keys(defaults).length === 0) return {};
    return applicableDefaults((await this.k.store.getAgentCapabilities(agentId)) ?? ConnectorCapabilities.parse({}), defaults);
  }

  /** The defaults the agent's owner set, as set (the composer preselects those that fit). Any org member. */
  async optionDefaults(agentId: string): Promise<InvocationOptionValues> {
    return (await this.k.store.getAgentOptionDefaults(agentId)) ?? {};
  }

  /** Any org member may read an agent's capabilities: the composer shows its options, the thread its Stop. */
  async capabilities(agentId: string): Promise<ConnectorCapabilities> {
    const agent = await this.k.store.getMember(agentId);
    if (agent?.kind !== 'agent') throw new HarborError('not_found', 'no such agent');
    return (await this.k.store.getAgentCapabilities(agentId)) ?? ConnectorCapabilities.parse({});
  }

  async listForSpace(ctx: ActorCtx, spaceId: string, threadRootId?: string): Promise<Invocation[]> {
    await this.k.requireReadableSpace(ctx, spaceId);
    return this.k.store.listSpaceInvocations(spaceId, threadRootId ?? null, LIST_LIMIT);
  }

  /**
   * Cancel one still waiting to run (queued, or delivered and not yet
   * acknowledged): its invoker's act, done by Harbor alone. Stop one running
   * (working or waiting): its invoker or an admin, when the connector
   * declared it can stop — Harbor asks, and the connector reports cancelled.
   * A finished invocation is returned as it is.
   */
  async cancel(ctx: ActorCtx, id: string): Promise<Invocation> {
    const found = await this.k.store.getInvocation(id);
    if (!found) throw new HarborError('not_found', 'no such invocation');
    await this.k.requireReadableSpace(ctx, found.conversation.spaceId);
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this org');
    const { stop } = await this.capabilities(found.agentId);
    const out: InvocationOutbox = [];
    const result = await this.k.locked(found.conversation.spaceId, async () => {
      const current = (await this.k.store.getInvocation(id))!;
      if (TERMINAL.has(current.state)) return current;
      if (current.state === 'queued' || current.state === 'pending') {
        enforce(canCancelQueuedInvocation(ctx, current));
        const { activity: _activity, ...rest } = current;
        const next: Invocation = { ...rest, state: 'cancelled', updatedAt: this.k.now() };
        await this.k.store.putInvocation(next);
        this.announce(next, out);
        if (current.state === 'pending') await this.promote(next.agentId, next.conversation.spaceId, next.conversation.threadRootId, out);
        return next;
      }
      enforce(canStopInvocation(actor, current, stop));
      if (current.stopRequested) return current;
      const next: Invocation = { ...current, stopRequested: true, updatedAt: this.k.now() };
      await this.k.store.putInvocation(next);
      this.announce(next, out);
      out.push({ to: 'agent', memberId: next.agentId, frame: { kind: 'invocation_stop', invocationId: next.id } });
      return next;
    });
    this.flush(out);
    return result;
  }

  // --- approvals (spec §8 part 4, 2026-10-01) -----------------------------------------

  /**
   * The checked half of raising an approval, run inside the card's own
   * transaction (Feed.postMessage `approval`): the agent's invocation, in this
   * thread, working or already waiting.
   */
  async assertCanRaise(ctx: ActorCtx, id: string, spaceId: string, threadRootId: string): Promise<Invocation> {
    const current = await this.own(ctx, id);
    if (current.conversation.spaceId !== spaceId || current.conversation.threadRootId !== threadRootId) {
      throw new HarborError('invalid_request', 'an approval goes in its invocation\'s thread');
    }
    if (current.state !== 'working' && current.state !== 'waiting') {
      throw new HarborError('invalid_request', `this invocation is ${current.state}: it can ask for no approval`);
    }
    return current;
  }

  /** The approval a card carries: open, for the invocation's agent and thread. */
  approvalFor(current: Invocation, messageId: string, request: ApprovalRequest): Approval {
    const now = this.k.now();
    return {
      id: this.k.ulid(),
      invocationId: current.id,
      agentId: current.agentId,
      conversation: current.conversation,
      messageId,
      requestKey: request.requestKey,
      title: request.title,
      detail: request.detail,
      ...(request.reason ? { reason: request.reason } : {}),
      choices: request.choices,
      state: 'open',
      createdAt: now,
      updatedAt: now,
    };
  }

  /** The other half: the approval is stored with its card, and the invocation waits on it. */
  async raiseWithin(current: Invocation, approval: Approval, out: InvocationOutbox): Promise<void> {
    await this.k.store.insertApproval(approval);
    const held: Invocation = { ...current, state: 'waiting', activity: `Waiting for approval: ${approval.title}`.slice(0, 200), updatedAt: this.k.now() };
    await this.k.store.putInvocation(held);
    this.announce(held, out);
  }

  /** The agent's approval for this request key, if it raised one already. */
  findApproval(invocationId: string, requestKey: string): Promise<Approval | undefined> {
    return this.k.store.getApprovalByRequest(invocationId, requestKey);
  }

  /**
   * A person decides (spec §8 part 4): any person who can see the card, for
   * now, acting directly; never an agent. The first decision wins. The
   * decision goes to the connector, which confirms once its agent has it.
   */
  async decideApproval(ctx: ActorCtx, spaceId: string, id: string, input: ApprovalDecision & { actingMode: ActingMode }): Promise<Approval> {
    enforce(canDecideApproval(ctx, input.actingMode));
    const found = await this.k.store.getApproval(id);
    if (!found || found.conversation.spaceId !== spaceId) throw new HarborError('not_found', 'no such approval');
    if (input.note && input.decision !== 'deny') throw new HarborError('invalid_request', 'a note goes with a deny');
    await this.k.requireMember(ctx, spaceId);
    const out: InvocationOutbox = [];
    const result = await this.k.lockedAs(ctx, spaceId, async () => {
      const current = (await this.k.store.getApproval(id))!;
      if (current.state !== 'open') throw new HarborError('invalid_request', `this approval is already ${current.state}`);
      if (!current.choices.includes(input.decision)) throw new HarborError('invalid_request', 'this agent does not offer that choice');
      const at = this.k.now();
      const next: Approval = {
        ...current,
        state: input.decision === 'deny' ? 'denied' : 'allowed',
        decision: input.decision,
        decidedBy: ctx.memberId,
        decidedAt: at,
        ...(input.note ? { note: input.note } : {}),
        updatedAt: at,
      };
      await this.settleApproval(next, out);
      out.push({ to: 'agent', memberId: next.agentId, frame: { kind: 'approval_decided', approval: next } });
      return next;
    });
    this.flush(out);
    return result;
  }

  /** The connector closes one its agent no longer waits on. A settled one is returned as it is. */
  async closeApproval(ctx: ActorCtx, id: string, close: ApprovalClose): Promise<Approval> {
    const found = await this.ownApproval(ctx, id);
    const out: InvocationOutbox = [];
    const result = await this.k.locked(found.conversation.spaceId, async () => {
      const current = (await this.k.store.getApproval(id))!;
      if (current.state !== 'open') return current;
      const next: Approval = { ...current, state: close.state, updatedAt: this.k.now() };
      await this.settleApproval(next, out);
      return next;
    });
    this.flush(out);
    return result;
  }

  /** The connector passed a decision to its agent: it leaves the listing. Idempotent. */
  async applyApproval(ctx: ActorCtx, id: string): Promise<Approval> {
    const found = await this.ownApproval(ctx, id);
    if (found.state !== 'allowed' && found.state !== 'denied') throw new HarborError('invalid_request', `this approval is ${found.state}: nothing to apply`);
    if (found.appliedAt) return found;
    const next: Approval = { ...found, appliedAt: this.k.now() };
    await this.k.store.putApproval(next);
    return next;
  }

  /** Decisions on the agent's approvals its connector has not confirmed applying: the guarantee behind `approval_decided`. */
  async listDecisionsForAgent(ctx: ActorCtx): Promise<Approval[]> {
    this.requireConnector(ctx);
    return this.k.store.listUnappliedDecisions(ctx.memberId);
  }

  /** Store a settled approval, log it for the card, and let its invocation go on when none is left open. Inside the space lock. */
  private async settleApproval(next: Approval, out: InvocationOutbox): Promise<void> {
    await this.k.store.putApproval(next);
    await this.k.appendNext(next.conversation.spaceId, next.updatedAt, { type: 'approval', approval: next });
    const invocation = await this.k.store.getInvocation(next.invocationId);
    if (invocation?.state === 'waiting' && !(await this.hasOpenApproval(invocation.id))) {
      const { activity: _activity, ...rest } = invocation;
      const resumed: Invocation = { ...rest, state: 'working', updatedAt: this.k.now() };
      await this.k.store.putInvocation(resumed);
      this.announce(resumed, out);
    }
  }

  /** An invocation that ends cancels its open approvals. Inside the space lock. */
  private async cancelOpenApprovals(invocation: Invocation): Promise<void> {
    for (const open of await this.k.store.listInvocationApprovals(invocation.id, ['open'])) {
      const next: Approval = { ...open, state: 'cancelled', updatedAt: this.k.now() };
      await this.k.store.putApproval(next);
      await this.k.appendNext(next.conversation.spaceId, next.updatedAt, { type: 'approval', approval: next });
    }
  }

  private async hasOpenApproval(invocationId: string): Promise<boolean> {
    return (await this.k.store.listInvocationApprovals(invocationId, ['open'])).length > 0;
  }

  private async ownApproval(ctx: ActorCtx, id: string): Promise<Approval> {
    this.requireConnector(ctx);
    const found = await this.k.store.getApproval(id);
    if (!found || found.agentId !== ctx.memberId) throw new HarborError('not_found', 'no such approval for this agent');
    return found;
  }

  // --- the queue ---------------------------------------------------------------------

  /** Fail a timed-out turn and let the next queued one run; returns the conversation's live invocations. */
  private async settle(agentId: string, spaceId: string, threadRootId: string, out: InvocationOutbox): Promise<Invocation[]> {
    const now = Date.parse(this.k.now());
    for (const i of await this.k.store.listConversationInvocations(agentId, spaceId, threadRootId)) {
      if (i.state !== 'working' || now - Date.parse(i.updatedAt) <= WORKING_TIMEOUT_MS) continue;
      const { activity: _activity, ...rest } = i;
      const failed: Invocation = { ...rest, state: 'failed', error: 'No word from the agent for 30 minutes.', updatedAt: this.k.now() };
      await this.k.store.putInvocation(failed);
      this.announce(failed, out);
    }
    await this.promote(agentId, spaceId, threadRootId, out);
    return (await this.k.store.listConversationInvocations(agentId, spaceId, threadRootId)).filter((i) => LIVE.includes(i.state));
  }

  /** When no turn is live in the conversation, the first-posted queued invocation becomes pending and is delivered. */
  private async promote(agentId: string, spaceId: string, threadRootId: string, out: InvocationOutbox): Promise<void> {
    const all = await this.k.store.listConversationInvocations(agentId, spaceId, threadRootId);
    if (all.some((i) => LIVE.includes(i.state) && !i.answers)) return;
    const next = all.find((i) => i.state === 'queued');
    if (!next) return;
    const pending: Invocation = { ...next, state: 'pending', updatedAt: this.k.now() };
    await this.k.store.putInvocation(pending);
    this.announce(pending, out);
  }

  /** Tell the space every change; tell the agent when one is ready for it. */
  private announce(invocation: Invocation, out: InvocationOutbox): void {
    const spaceId = invocation.conversation.spaceId;
    out.push({ to: 'space', spaceId, frame: { kind: 'invocation_state', spaceId, invocation } });
    if (invocation.state === 'pending') out.push({ to: 'agent', memberId: invocation.agentId, frame: { kind: 'invocation', invocation } });
  }

  private async deepestLive(agentId: string): Promise<number> {
    const live = await this.k.store.listInvocationsForAgent(agentId, LIVE);
    return live.reduce((max, i) => Math.max(max, i.depth), 0);
  }

  /** One of the calling agent's own invocations, as it stands. */
  ownInvocation(ctx: ActorCtx, id: string): Promise<Invocation> {
    return this.own(ctx, id);
  }

  private requireConnector(ctx: ActorCtx): void {
    if (!ctx.agent) throw new HarborError('forbidden', 'only an agent, on its own key, can do this');
  }

  private async own(ctx: ActorCtx, id: string): Promise<Invocation> {
    this.requireConnector(ctx);
    const found = await this.k.store.getInvocation(id);
    if (!found || found.agentId !== ctx.memberId) throw new HarborError('not_found', 'no such invocation for this agent');
    return found;
  }
}
