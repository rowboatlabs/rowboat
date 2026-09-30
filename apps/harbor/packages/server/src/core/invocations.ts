import {
  ConnectorCapabilities,
  type Invocation,
  type InvocationOptionValues,
  type InvocationState,
  type InvocationUpdate,
  type Message,
  type ServerFrame,
  type Space,
} from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import { canCancelQueuedInvocation, canStopInvocation, enforce, invocationRefusal } from '../policy.js';
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
    for (const agentId of new Set(message.mentions)) {
      if (agentId === message.author.memberId) continue;
      const agent = await this.k.store.getMember(agentId);
      if (agent?.kind !== 'agent') continue;
      const threadRootId = message.threadRoot ?? message.id;
      // An agent's post hands work on: one hop deeper than the deepest turn it is running (spec §8).
      const depth = ctx.agent ? 1 + (await this.deepestLive(ctx.memberId)) : 0;
      const shares = space.kind === 'shared' || (await this.k.store.sharesSharedSpace(message.author.memberId, agentId));
      const refusal = invocationRefusal(shares, depth);
      const now = this.k.now();
      const options = agentOptions?.[agentId];
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
        else if (turn.state === 'waiting') Object.assign(invocation, { state: 'pending', answers: turn.id });
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
      const { activity: _activity, error: _error, ...rest } = current;
      const next: Invocation = { ...rest, state: update.state, updatedAt: this.k.now() };
      if (update.state === 'working' || update.state === 'waiting') {
        if (update.activity) next.activity = update.activity;
      }
      if (update.state === 'working' && update.link) next.link = update.link;
      if (update.state === 'failed' && update.error) next.error = update.error;
      await this.k.store.putInvocation(next);
      this.announce(next, out);
      if (TERMINAL.has(next.state)) await this.promote(next.agentId, next.conversation.spaceId, next.conversation.threadRootId, out);
      return next;
    });
    this.flush(out);
    return result;
  }

  /** What the connector's agent can do: Stop, and the options the composer offers. Declared again whenever it changes. */
  async declareCapabilities(ctx: ActorCtx, capabilities: ConnectorCapabilities): Promise<ConnectorCapabilities> {
    this.requireConnector(ctx);
    await this.k.store.putAgentCapabilities(ctx.memberId, capabilities, this.k.now());
    return capabilities;
  }

  // --- people's side ---------------------------------------------------------------

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
