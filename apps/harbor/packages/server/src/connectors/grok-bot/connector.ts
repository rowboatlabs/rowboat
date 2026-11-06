import { messageUrl, type Invocation, type InvocationUpdate, type ServerFrame } from '@rowboat/spaces-protocol';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { quietly, requestPrompt, sleep } from '../common/request.js';
import { parseWebhook, resolvesPublic } from './webhook.js';

// The Grok Bot connector (spec §8 Grok Bot, 2026-11-05): one per agent whose
// connection is `grok-bot`, run by Harbor (connectors/host.ts), on its agent's
// own frames and the one-minute list like every connector.
//
// A turn is one POST to the owner's webhook routine in Grok Bot, with the
// prompt and where to answer. Grok Bot then reads and posts in Spaces through
// our MCP server on the agent's key: nothing comes back on the webhook, so the
// turn is done when the agent's own reply lands in the thread after the
// request, and failed when none has after REPLY_WITHIN_MS.
//
// A webhook has no idempotency key. The per-thread record marks the send just
// before it is made, and after a restart a turn with a mark is watched, never
// sent again: a lost mention is better than Grok Bot answering twice.
//
// Grok Bot can't be stopped from outside, so the connector declares no Stop.

const LIST_EVERY_MS = 60_000;
const WATCH_EVERY_MS = 5_000;
/** Report working at least this often: Harbor fails a silent turn after 30 minutes. */
const HEARTBEAT_MS = 4 * 60_000;
/** How long Grok Bot has to reply before the turn fails. */
const REPLY_WITHIN_MS = 25 * 60_000;
/** How long webhook trouble (a network error, a 5xx, a 429) is retried before the turn fails. */
const RETRY_FOR_MS = 2 * 60_000;
const SEND_TIMEOUT_MS = 30_000;

/** The connector's record for one thread (agent_connection_threads.data). */
export interface ThreadRecord {
  turn?: {
    invocationId: string;
    /** The trigger's offset: the reply is the agent's first message after it. */
    afterOffset: number;
    /** When the send began. Set before the POST, so a restart watches instead of sending again. */
    sentAt: string;
  };
}

/** What a routine's webhook receives (spec §8 Grok Bot): the prompt, and the ids to answer with. */
export interface MentionPayload {
  type: 'rowboat.mention';
  /** Everything the agent needs, as one text: a routine's instructions can just say "do what it says". */
  prompt: string;
  invocationId: string;
  agentId: string;
  spaceId: string;
  threadRootId: string;
  messageId: string;
  threadUrl: string;
  /** The Spaces MCP server, on the agent's key. */
  mcpUrl: string;
}

export class GrokBotConnector implements RunningConnector {
  private readonly running = new Map<string, Promise<void>>();
  private readonly takenOn = new Set<string>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly shutdown = new AbortController();
  private unsubscribe: (() => void) | undefined;
  private stopped = false;

  constructor(
    private readonly env: ConnectorEnv,
    private readonly options: { allowHttp?: boolean; replyWithinMs?: number; watchEveryMs?: number } = {},
  ) {}

  start(): this {
    this.unsubscribe = this.env.subscribe((frame) => this.onFrame(frame));
    void this.boot();
    this.timers.push(setInterval(() => void this.list(), LIST_EVERY_MS));
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.shutdown.abort();
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    await Promise.allSettled([...this.running.values()]);
  }

  // --- intake -------------------------------------------------------------------------

  private async boot(): Promise<void> {
    for (const invocation of await quietly(this.env, () => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'working' && !this.takenOn.has(invocation.id)) this.track(invocation.id, () => this.recover(invocation));
      else if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private onFrame(frame: ServerFrame): void {
    if (frame.kind === 'invocation') this.intake(frame.invocation);
  }

  private async list(): Promise<void> {
    for (const invocation of await quietly(this.env, () => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private intake(invocation: Invocation): void {
    if (this.stopped || invocation.state !== 'pending' || this.running.has(invocation.id)) return;
    this.takenOn.add(invocation.id);
    this.track(invocation.id, async () => {
      try {
        await this.env.service.acknowledgeInvocation(this.env.ctx, invocation.id);
      } catch {
        return; // cancelled on its way: drop it
      }
      await quietly(
        this.env,
        () => this.env.service.reactToMessage(this.env.ctx, invocation.conversation.spaceId, invocation.trigger.messageId, { emoji: '👀', action: 'add', actingMode: 'direct' }),
        undefined,
      );
      await this.run(invocation);
    });
  }

  private track(id: string, work: () => Promise<void>): void {
    const done = work()
      .catch((err) => this.env.log('invocation failed unexpectedly', { id, error: (err as Error).message }))
      .finally(() => this.running.delete(id));
    this.running.set(id, done);
  }

  // --- one invocation --------------------------------------------------------------------

  /** A turn from before a restart: watched if it was sent, sent if it never was. */
  private async recover(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const turn = (await this.record(spaceId, threadRootId)).turn;
    if (turn?.invocationId === invocation.id) return this.watch(invocation, turn);
    return this.run(invocation);
  }

  private async run(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const webhook = parseWebhook(await this.env.credential(), this.options);
    if ('error' in webhook) return this.fail(invocation, `This Grok Bot agent's webhook is not usable: ${webhook.error}. Its owner can replace it on the agent's page.`);
    const trigger = await quietly(this.env, () => this.env.service.getMessage(this.env.ctx, spaceId, invocation.trigger.messageId), undefined);
    if (!trigger) return this.fail(invocation, 'The message that asked Grok Bot is gone.');
    const payload: MentionPayload = {
      type: 'rowboat.mention',
      prompt: await requestPrompt(this.env, invocation, undefined, true),
      invocationId: invocation.id,
      agentId: this.env.agent.id,
      spaceId,
      threadRootId,
      messageId: invocation.trigger.messageId,
      threadUrl: messageUrl(this.env.service.org.address, spaceId, threadRootId),
      mcpUrl: `${this.env.orgUrl}/mcp`,
    };
    const turn = { invocationId: invocation.id, afterOffset: trigger.offset, sentAt: new Date().toISOString() };
    await this.save(spaceId, threadRootId, { turn });
    const refused = await this.send(webhook, payload);
    if (refused) return this.fail(invocation, refused);
    await this.report(invocation, { state: 'working', activity: 'Sent to Grok Bot' });
    await this.watch(invocation, turn);
  }

  /** POST the mention to the routine. Undefined once Grok Bot took it, else why the turn fails. */
  private async send(webhook: { url: string; key?: string }, payload: MentionPayload): Promise<string | undefined> {
    if (!this.options.allowHttp && !(await resolvesPublic(webhook.url))) return 'The routine’s POST to address does not resolve to a public host.';
    const giveUpAt = Date.now() + RETRY_FOR_MS;
    let backoff = 1_000;
    for (;;) {
      let trouble: string;
      try {
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(webhook.key ? { authorization: `Bearer ${webhook.key}` } : {}) },
          body: JSON.stringify(payload),
          // An owner-typed address: never followed elsewhere, and nothing it answers is read back (2026-11-05).
          redirect: 'manual',
          signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]),
        });
        await res.body?.cancel();
        if (res.ok) return undefined;
        if (res.status === 401 || res.status === 403) {
          const reason = `Grok Bot refused the webhook key (HTTP ${res.status})`;
          await quietly(this.env, () => this.env.rejectCredential(reason), false);
          return `${reason}. Its owner can paste the routine’s POST to address and key again on the agent's page.`;
        }
        if (res.status === 404 || res.status === 410) return `Grok Bot has no routine at that address (HTTP ${res.status}). Its owner can paste the routine’s POST to address and key again on the agent's page.`;
        if (res.status < 500 && res.status !== 429) return `Grok Bot refused the request (HTTP ${res.status}).`;
        trouble = `HTTP ${res.status}`;
      } catch (err) {
        if (this.stopped) return 'Harbor stopped before Grok Bot took the request.';
        trouble = (err as Error).message;
      }
      if (Date.now() + backoff > giveUpAt) return `Could not reach Grok Bot's webhook (${trouble}).`;
      await sleep(backoff, this.shutdown.signal);
      backoff = Math.min(backoff * 2, 15_000);
    }
  }

  /** Wait for the agent's reply in the thread after the request; heartbeat meanwhile. */
  private async watch(invocation: Invocation, turn: NonNullable<ThreadRecord['turn']>): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    const within = this.options.replyWithinMs ?? REPLY_WITHIN_MS;
    const deadline = Date.parse(turn.sentAt) + within;
    let beatAt = Date.now();
    while (!this.stopped) {
      const page = await quietly(this.env, () => this.env.service.listThread(this.env.ctx, spaceId, threadRootId, { afterOffset: turn.afterOffset, limit: 100 }), undefined);
      const replied = page?.messages.some((m) => m.offset > turn.afterOffset && m.author.memberId === this.env.agent.id && !m.deletedAt);
      if (replied) {
        await this.report(invocation, { state: 'done' });
        return this.clear(invocation);
      }
      if (Date.now() > deadline) {
        return this.fail(invocation, `Grok Bot did not reply within ${Math.round(within / 60_000)} minutes. Its owner can check the routine's Run history in Grok Bot.`);
      }
      if (Date.now() - beatAt > HEARTBEAT_MS) {
        // Ended from outside (an admin stopped it, or Harbor failed it): stop watching.
        const live = await quietly(this.env, () => this.env.service.listAgentInvocations(this.env.ctx), undefined);
        if (live && !live.some((i) => i.id === invocation.id)) return this.clear(invocation);
        await this.report(invocation, { state: 'working', activity: 'Grok Bot is working' });
        beatAt = Date.now();
      }
      await sleep(this.options.watchEveryMs ?? WATCH_EVERY_MS, this.shutdown.signal);
    }
  }

  private async report(invocation: Invocation, update: InvocationUpdate): Promise<void> {
    await quietly(this.env, () => this.env.service.updateInvocation(this.env.ctx, invocation.id, update), undefined);
  }

  private async fail(invocation: Invocation, error: string): Promise<void> {
    await this.report(invocation, { state: 'failed', error: error.slice(0, 1000) });
    await this.clear(invocation);
  }

  private async clear(invocation: Invocation): Promise<void> {
    const { spaceId, threadRootId } = invocation.conversation;
    if ((await this.record(spaceId, threadRootId)).turn?.invocationId === invocation.id) await this.save(spaceId, threadRootId, {});
  }

  private async record(spaceId: string, threadRootId: string): Promise<ThreadRecord> {
    return ((await this.env.thread.get(spaceId, threadRootId)) as ThreadRecord | undefined) ?? {};
  }

  private async save(spaceId: string, threadRootId: string, record: ThreadRecord): Promise<void> {
    await this.env.thread.put(spaceId, threadRootId, record);
  }
}
