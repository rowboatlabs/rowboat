import { mentionsAsText, mentionToken, type Invocation, type Member, type Message, type ServerFrame } from '@rowboat/spaces-protocol';
import { AGENT_HOP_LIMIT } from '../../policy.js';
import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { TypeSafeError, type JevApi } from './api.js';
import { buildQuestions, decideTags, MAX_NOTES, MAX_THREAD_MESSAGES, selectCandidates, type Note } from './questions.js';

// The Jev connector (spec §8 Jev, 2026-10-07): the agent Harbor itself is, on
// the deployment's OpenRouter key. Unlike every other agent it is not invoked
// by a mention: it reads every message in the spaces people add it to, asks
// Jev who the message needs, and posts the tags in the message's thread
// ("cc @Hermes @Sam"). The tags are an ordinary message, so they notify people
// and invoke agents like anyone's mentions, which is how agents that name
// each other in plain text reach each other. Jev decides and never writes:
// the reply is only the tags.
//
// Each space is drained from a cursor (its own record, kept under the empty
// thread root): a live frame wakes the space, and a sweep every minute is the
// guarantee, so a restart catches up on what was posted while it was down.
// A message older than CATCH_UP_MS is skipped rather than tagged late.
//
// A message that tags Jev is feedback on its tags (2026-10-07, Arjun in
// Spaces): it is kept in the space's record, word for word with the thread it
// was said in, given back to Jev with every question in that space and no
// other, and acknowledged with a 👍. Deleting the message withdraws it.

const SWEEP_EVERY_MS = 60_000;
const CATCH_UP_MS = 10 * 60_000;
/** Its record per space, in agent_connection_threads under the empty thread root: one cursor, not a thread. */
const SPACE_RECORD = '';
const LIVE_STATES = new Set<Invocation['state']>(['queued', 'pending', 'working', 'waiting']);
/** How much of the thread a note keeps: enough to see the message and Jev's tags it is about. */
const NOTE_THREAD_MESSAGES = 5;
const NOTED = '👍';

interface SpaceRecord {
  /** The offset of the last event Jev has read in the space. */
  offset: number;
  /** The space's feedback to Jev, oldest first, at most MAX_NOTES. */
  notes?: Note[];
}

export class JevConnector implements RunningConnector {
  private readonly watching = new Map<string, () => void>();
  /** One drain per space at a time, chained. */
  private readonly draining = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;
  private stopped = false;

  constructor(
    private readonly env: ConnectorEnv,
    private readonly api: () => JevApi | undefined,
  ) {}

  start(): this {
    this.unsubscribe = this.env.subscribe((frame) => this.onAgentFrame(frame));
    void this.sweep();
    this.timers.push(setInterval(() => void this.sweep(), SWEEP_EVERY_MS));
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    for (const off of this.watching.values()) off();
    this.watching.clear();
    await Promise.allSettled([...this.draining.values()]);
  }

  // --- intake -------------------------------------------------------------------------

  private onAgentFrame(frame: ServerFrame): void {
    if (frame.kind === 'space_added' && frame.spaceKind === 'shared') this.watch(frame.spaceId);
    else if (frame.kind === 'space_removed') this.unwatch(frame.spaceId);
    else if (frame.kind === 'invocation') void this.settle(frame.invocation);
  }

  /** Every space Jev is in, and the mentions of it: what a missed frame would have brought. */
  private async sweep(): Promise<void> {
    if (this.stopped) return;
    const spaces = await this.safe(() => this.env.service.listSpaces(this.env.ctx), []);
    const ids = new Set(spaces.map((s) => s.id));
    for (const id of [...this.watching.keys()]) if (!ids.has(id)) this.unwatch(id);
    for (const id of ids) this.watch(id);
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) void this.settle(invocation);
  }

  private watch(spaceId: string): void {
    if (this.stopped) return;
    if (!this.watching.has(spaceId)) {
      this.watching.set(spaceId, this.env.subscribeSpace(spaceId, (frame) => {
        if (frame.kind === 'event' && frame.event.type === 'message') this.drain(spaceId);
      }));
    }
    this.drain(spaceId);
  }

  private unwatch(spaceId: string): void {
    this.watching.get(spaceId)?.();
    this.watching.delete(spaceId);
  }

  /**
   * A mention of Jev, or a DM to it, invokes it like any agent (spec §8). It
   * never answers: in a space its tagging pass reads the message anyway, so
   * the turn is done; in a DM there is no one to tag, and it says so.
   */
  private async settle(invocation: Invocation): Promise<void> {
    if (invocation.state !== 'pending') return;
    await this.safe(async () => {
      await this.env.service.acknowledgeInvocation(this.env.ctx, invocation.id);
      await this.env.service.updateInvocation(
        this.env.ctx,
        invocation.id,
        invocation.where.spaceKind === 'direct'
          ? { state: 'failed', error: `${this.env.agent.displayName} does not chat. Add it to a space and it tags whoever a message needs.` }
          : { state: 'done' },
      );
    }, undefined);
  }

  // --- the pass -----------------------------------------------------------------------

  private drain(spaceId: string): void {
    if (this.draining.has(spaceId)) {
      this.again.add(spaceId);
      return;
    }
    const run = (async () => {
      do {
        this.again.delete(spaceId);
        await this.safe(() => this.drainOnce(spaceId), undefined);
      } while (this.again.has(spaceId) && !this.stopped);
    })().finally(() => this.draining.delete(spaceId));
    this.draining.set(spaceId, run);
  }

  private async drainOnce(spaceId: string): Promise<void> {
    const { ctx, service } = this.env;
    const record = (await this.env.thread.get(spaceId, SPACE_RECORD)) as SpaceRecord | undefined;
    if (!record) {
      // First sight of the space: Jev starts from now, never on its history.
      const { head } = await service.replay(ctx, spaceId);
      await this.env.thread.put(spaceId, SPACE_RECORD, { offset: head } satisfies SpaceRecord);
      return;
    }
    const { events } = await service.replay(ctx, spaceId, record.offset);
    let offset = record.offset;
    let notes = record.notes ?? [];
    let dirty = false;
    const save = () => this.env.thread.put(spaceId, SPACE_RECORD, { offset, ...(notes.length > 0 ? { notes } : {}) } satisfies SpaceRecord);
    for (const stored of events) {
      if (this.stopped) break;
      const event = stored.event;
      if (event.type === 'message') {
        const message = event.message;
        const note = message.mentions.includes(this.env.agent.id) ? await this.noteOf(message) : undefined;
        if (note) notes = [...notes, note].slice(-MAX_NOTES);
        else if ((await this.consider(message, notes)) === 'retry') break;
        offset = stored.offset;
        // After each message, so a restart never tags one twice or loses a note.
        await save();
        dirty = false;
        if (note) await this.safe(() => service.reactToMessage(ctx, spaceId, message.id, { emoji: NOTED, action: 'add', actingMode: 'direct' }), undefined);
      } else {
        if (event.type === 'message_deleted' && notes.some((n) => n.messageId === event.deletion.messageId)) {
          notes = notes.filter((n) => n.messageId !== event.deletion.messageId);
        }
        offset = stored.offset;
        dirty = true;
      }
    }
    if (dirty) await save();
  }

  /**
   * A message that tags Jev, as a note for the space; none for its own posts,
   * a deleted message, or outside a shared space. In a thread, the note keeps
   * the messages before it, Jev's tags among them, which "wrong" points at.
   */
  private async noteOf(message: Message): Promise<Note | undefined> {
    const { ctx, service, agent } = this.env;
    if (message.author.memberId === agent.id || message.deletedAt) return undefined;
    const space = (await service.listSpaces(ctx)).find((s) => s.id === message.spaceId);
    if (!space || space.kind !== 'shared') return undefined;
    const members = await service.listMembers(ctx, message.spaceId);
    const names = new Map(members.map((m) => [m.id, m.displayName]));
    const who = (id: string) => names.get(id) ?? 'someone who left';
    const note: Note = { messageId: message.id, from: who(message.author.memberId), said: mentionsAsText(message.body, names) };
    if (message.threadRoot) {
      const page = await service.listThread(ctx, message.spaceId, message.threadRoot, { beforeOffset: message.offset, limit: NOTE_THREAD_MESSAGES });
      note.about = [page.root, ...page.messages]
        .filter((m) => !m.deletedAt)
        .slice(-NOTE_THREAD_MESSAGES)
        .map((m) => ({ author: who(m.author.memberId), text: mentionsAsText(m.body, names) }));
    }
    return note;
  }

  /** One message: ask Jev who it needs, and tag them. 'retry' leaves it for the next sweep. */
  private async consider(message: Message, notes: readonly Note[]): Promise<'done' | 'retry'> {
    const { ctx, service, agent } = this.env;
    if (message.author.memberId === agent.id || message.deletedAt) return 'done';
    if (Date.now() - Date.parse(message.postedAt) > CATCH_UP_MS) return 'done';
    const api = this.api();
    if (!api) return 'done';
    const spaceId = message.spaceId;
    const space = (await service.listSpaces(ctx)).find((s) => s.id === spaceId);
    if (!space || space.kind !== 'shared') return 'done';

    const members = await service.listMembers(ctx, spaceId);
    const names = new Map(members.map((m) => [m.id, m.displayName]));
    const threadRootId = message.threadRoot ?? message.id;
    let thread: Message[] = [];
    if (message.threadRoot) {
      const page = await service.listThread(ctx, spaceId, message.threadRoot, { beforeOffset: message.offset, limit: MAX_THREAD_MESSAGES });
      thread = [page.root, ...page.messages].filter((m) => !m.deletedAt);
    }
    const busyAgents = new Set(
      (await service.listInvocations(ctx, spaceId, threadRootId)).filter((i) => LIVE_STATES.has(i.state)).map((i) => i.agentId),
    );
    const depth = await service.messageHandOffDepth(ctx, spaceId, message.id);
    const input = {
      spaceName: space.name,
      message: { authorId: message.author.memberId, text: mentionsAsText(message.body, names) },
      thread: thread.map((m) => ({ authorId: m.author.memberId, text: mentionsAsText(m.body, names), mentions: m.mentions })),
      members,
      jevId: agent.id,
      mentioned: message.mentions,
      here: message.mentionsHere,
      busyAgents,
      agentsAllowed: depth <= AGENT_HOP_LIMIT,
      notes,
    };
    const candidates = selectCandidates(input);
    if (candidates.length === 0) return 'done';

    const { state, questions } = buildQuestions(input, candidates);
    let answers: Record<string, number>;
    try {
      answers = await api.ask(state, questions);
    } catch (err) {
      this.env.log(`Jev could not judge message ${message.id}: ${(err as Error).message}`);
      return err instanceof TypeSafeError && err.transient ? 'retry' : 'done';
    }
    const tags = decideTags(answers, candidates);
    if (tags.length === 0) return 'done';
    await service.relayMentions(ctx, spaceId, message.id, `cc ${tags.map(token).join(' ')}`);
    return 'done';
  }

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!this.stopped) this.env.log('call failed', (err as Error).message);
      return fallback;
    }
  }
}

const token = (m: Member) => mentionToken({ kind: 'member', id: m.id, label: m.displayName });
