import type { Message, ReplicasConfigInput, ReplicasConfigView, ReplicasTask, ReplicasThreadAction } from '@rowboat/spaces-protocol';
import { mentionsAsText } from '@rowboat/spaces-protocol';
import type { Kernel, ActorCtx } from '../core/kernel.js';
import type { Feed, NewMessage } from '../core/feed.js';
import { HarborError } from '../errors.js';
import { canConfigureReplicas, enforce } from '../policy.js';
import type { BlobStore } from '../blobs.js';
import { RemoteError, replicasApi, type ReplicasImage, type ReplicasApi } from './api.js';
import { seal, unseal } from './credentials.js';
import type { ReplicasConnection, ReplicasTaskRecord } from './types.js';

export class Replicas {
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopped = false;
  constructor(private readonly k: Kernel, private readonly feed: Feed, private readonly apiFactory: (key: string) => ReplicasApi = replicasApi, private readonly blobs?: BlobStore) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick().catch(() => console.error('[replicas] background scan failed')); }, 3000);
    this.timer.unref();
    void this.tick().catch(() => console.error('[replicas] recovery scan failed'));
  }
  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  private api(spaceId: string, connection: ReplicasConnection): ReplicasApi {
    return this.apiFactory(unseal(connection.sealedKey, connection.sourceSpaceId ?? spaceId));
  }
  private async connection(spaceId: string): Promise<ReplicasConnection | undefined> {
    const own = await this.k.store.getReplicasConnection(spaceId);
    if (own) return own;
    const space = await this.k.store.getSpace(spaceId);
    if (space?.kind !== 'direct') return undefined;
    for (const participant of space.participants ?? []) {
      const source = await this.k.store.findReplicasConnection(participant);
      if (!source) continue;
      // A bot DM inherits its Space connection only for members who can already use it (2026-09-28).
      for (const memberId of space.participants ?? []) {
        if (!await this.k.store.getMembership(source.spaceId, memberId)) return undefined;
      }
      return { ...source.connection, sourceSpaceId: source.spaceId };
    }
    return undefined;
  }
  private view(task: ReplicasTaskRecord): ReplicasTask {
    const { queue, active, deliveredOffset: _offset, forkContext: _context, notice: _notice, ...view } = task;
    return { ...view, pending: queue.length + (active ? 1 : 0) };
  }
  private fresh(spaceId: string, root: string, env: string | null): ReplicasTaskRecord {
    return { spaceId, threadRootId: root, workspaceId: null, chatId: null, url: null, environmentId: env,
      status: 'queued', error: null, queue: [], active: null, deliveredOffset: 0, notice: null, updatedAt: this.k.now() };
  }
  async config(ctx: ActorCtx, spaceId: string): Promise<ReplicasConfigView> {
    await this.k.requireMember(ctx, spaceId);
    const c = await this.connection(spaceId);
    const canConfigure = (await this.k.store.getSpace(spaceId))?.kind === 'shared' && canConfigureReplicas(await this.k.store.getMember(ctx.memberId)) === null;
    let environments: Array<{ id: string; name: string }> = [];
    let error: string | null = null;
    if (c?.enabled) {
      try { environments = await this.api(spaceId, c).environments(); }
      catch { error = 'Replicas could not be reached. An admin can check or replace the connection below.'; }
    }
    return { direct: !!c?.sourceSpaceId, error, enabled: c?.enabled ?? false, configured: !!c?.sealedKey, canConfigure, botMemberId: c?.botMemberId ?? null,
      environmentId: c?.environmentId ?? null, codingAgent: c?.codingAgent ?? 'claude',
      environments };
  }
  async configure(ctx: ActorCtx, spaceId: string, input: ReplicasConfigInput): Promise<ReplicasConfigView> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canConfigureReplicas(await this.k.store.getMember(ctx.memberId)));
    this.k.guardWrite();
    if (space.kind !== 'shared') throw new HarborError('invalid_request', 'Connect Replicas in a shared Space.');
    const previous = await this.k.store.getReplicasConnection(spaceId);
    const sealedKey = input.apiKey ? seal(input.apiKey, spaceId) : previous?.sealedKey;
    if (!sealedKey) throw new HarborError('invalid_request', 'A Replicas API key is required.');
    const environments = input.enabled ? await this.apiFactory(unseal(sealedKey, spaceId)).environments() : [];
    if (input.enabled && input.environmentId && !environments.some(e => e.id === input.environmentId)) throw new HarborError('invalid_request', 'That environment is not available to this connection.');
    await this.k.lockedAs(ctx, spaceId, async () => {
      enforce(canConfigureReplicas(await this.k.store.getMember(ctx.memberId)));
      const current = await this.k.store.getReplicasConnection(spaceId);
      const botMemberId = current?.botMemberId ?? this.k.ulid();
      if (!current) {
        await this.k.store.putMember({ id: botMemberId, displayName: 'Replicas', role: 'member' });
        const membership = { spaceId, memberId: botMemberId, joinedAt: this.k.now() };
        await this.k.store.putMembership(membership);
        await this.k.appendNext(spaceId, membership.joinedAt, { type: 'membership', membership, action: 'joined' });
      }
      await this.k.store.putReplicasConnection(spaceId, {
        enabled: input.enabled, sealedKey, botMemberId, configuredBy: ctx.memberId,
        environmentId: input.environmentId !== undefined ? input.environmentId : current?.environmentId ?? null,
        codingAgent: input.codingAgent ?? current?.codingAgent ?? 'claude',
      });
    });
    return this.config(ctx, spaceId);
  }
  async get(ctx: ActorCtx, spaceId: string, rootId: string): Promise<{ task: ReplicasTask | null }> {
    await this.k.requireMember(ctx, spaceId);
    const root = await this.feed.resolveRoot(spaceId, rootId);
    const task = await this.k.store.getReplicasTask(spaceId, root.id);
    return { task: task ? this.view(task) : null };
  }

  // Called only inside Feed's transaction; users posting together serialize on the same binding.
  async enqueue(message: Message, input: NewMessage): Promise<void> {
    const connection = await this.connection(message.spaceId);
    if (!connection) {
      if (input.replicas) throw new HarborError('invalid_request', 'Connect Replicas to this Space before starting cloud work.');
      return;
    }
    if (message.author.memberId === connection.botMemberId) return;
    const direct = (await this.k.store.getSpace(message.spaceId))?.kind === 'direct';
    const addressed = direct || message.mentions.includes(connection.botMemberId) || !!input.replicas;
    if (!addressed) return;
    if (!connection.enabled) throw new HarborError('invalid_request', 'Replicas is disconnected in this Space.');
    const rootId = message.threadRoot ?? message.id;
    const task = await this.k.store.getReplicasTask(message.spaceId, rootId) ?? this.fresh(message.spaceId, rootId, input.replicas?.environmentId ?? connection.environmentId);
    if (task.queue.some(q => q.messageId === message.id) || task.active?.messageId === message.id) return;
    if (input.replicas?.environmentId && !task.workspaceId) task.environmentId = input.replicas.environmentId;
    task.queue.push({ messageId: message.id, memberId: message.author.memberId, offset: message.offset, planMode: input.replicas?.planMode === true || /(?:^|\s)\/plan\b/.test(message.body) });
    if (task.status === 'idle') task.status = 'queued';
    task.updatedAt = this.k.now();
    await this.k.store.putReplicasTask(task);
  }

  async act(ctx: ActorCtx, spaceId: string, rootId: string, action: ReplicasThreadAction): Promise<{ task: ReplicasTask }> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const root = await this.feed.resolveRoot(spaceId, rootId);
    const connection = await this.connection(spaceId);
    if (!connection?.enabled) throw new HarborError('invalid_request', 'Replicas is not connected.');
    const api = this.api(spaceId, connection);
    if (action.action === 'fork') {
      const source = await this.k.store.getReplicasTask(spaceId, root.id);
      if (!source) throw new HarborError('not_found', 'No Replicas task in this thread.');
      const selected = await this.feed.getMessage(ctx, spaceId, action.messageId);
      if ((selected.threadRoot ?? selected.id) !== root.id) throw new HarborError('invalid_request', 'The selected message is not in this thread.');
      const context = await this.context(spaceId, root.id, 0, Number.MAX_SAFE_INTEGER);
      let fork!: ReplicasTaskRecord;
      await this.feed.postMessage(ctx, spaceId, {
        body: action.body, actingMode: 'direct', replicas: { ...(source.environmentId ? { environmentId: source.environmentId } : {}) },
      }, async message => {
        fork = (await this.k.store.getReplicasTask(spaceId, message.id))!;
        fork.forkContext = context;
        await this.k.store.putReplicasTask(fork);
      });
      return { task: this.view(fork) };
    }
    let attached: Awaited<ReturnType<ReplicasApi['workspace']>> | null = null;
    if (action.action === 'select_environment') {
      if (!(await api.environments()).some(e => e.id === action.environmentId)) throw new HarborError('invalid_request', 'Unknown Replicas environment.');
    } else if (action.action === 'attach') {
      attached = await api.workspace(action.workspaceId, connection.codingAgent);
      const existing = await this.k.store.getReplicasTask(spaceId, root.id);
      const marker = existing?.active?.messageId;
      if (!marker) throw new HarborError('invalid_request', 'Attach is for recovering an interrupted request. Fork to start a different task.');
      const history = await api.history(action.workspaceId, action.chatId, marker);
      if (!history.requestSeen) throw new HarborError('invalid_request', 'This chat does not contain the interrupted Spaces request. Check the workspace and chat ids.');
    }
    const task = await this.k.lockedAs(ctx, spaceId, async () => {
      const current = await this.k.store.getReplicasTask(spaceId, root.id);
      if (!current) throw new HarborError('not_found', 'No Replicas task in this thread.');
      if (current.status === 'running' || current.status === 'sending') throw new HarborError('invalid_request', 'Wait for the active request before changing its destination.');
      if (action.action === 'retry') {
        if (current.status !== 'error') throw new HarborError('invalid_request', 'Only a definitively rejected request can be retried. Reconcile uncertain delivery first.');
        if (current.active) { current.queue.unshift(current.active); current.active = null; }
      } else if (action.action === 'select_environment') {
        if (current.workspaceId) throw new HarborError('invalid_request', 'Fork the thread to use a different environment.');
        current.environmentId = action.environmentId;
        current.queue = current.queue.map(q => ({ ...q, environmentSelected: true }));
      } else if (action.action === 'attach') {
        current.workspaceId = attached!.id; current.url = attached!.url; current.chatId = action.chatId;
        // An uncertain write must be reconciled, never replayed blindly (2026-09-28).
        if (current.active) { current.status = 'running'; }
      }
      if (current.status !== 'running') current.status = 'queued';
      current.error = null; current.notice = null; current.updatedAt = this.k.now();
      await this.k.store.putReplicasTask(current);
      return current;
    });
    return { task: this.view(task) };
  }

  async tick(): Promise<void> {
    if (this.stopped || this.k.readOnly) return;
    if (this.running) return this.running;
    this.running = this.scan().finally(() => { this.running = null; });
    return this.running;
  }
  private async scan(): Promise<void> {
    const tasks = await this.k.store.listReplicasTasks();
    // Five feature threads progress independently; one slow workspace cannot block its neighbors.
    for (let i = 0; i < tasks.length && !this.stopped; i += 8) {
      await Promise.all(tasks.slice(i, i + 8).map(t => this.advance(t).catch(async () => {
        if (t.status === 'queued' || t.status === 'select_environment') {
          await this.update(t, current => { current.status = 'error'; current.error = 'The request could not be prepared. Check the connection and attachments, then retry.'; });
        } else console.error('[replicas] task scan failed');
      })));
    }
  }
  private async update(task: ReplicasTaskRecord, edit: (fresh: ReplicasTaskRecord) => void): Promise<void> {
    await this.k.locked(task.spaceId, async () => {
      const current = await this.k.store.getReplicasTask(task.spaceId, task.threadRootId);
      if (!current) return;
      edit(current); current.updatedAt = this.k.now();
      await this.k.store.putReplicasTask(current);
    });
  }
  private async notice(task: ReplicasTaskRecord, c: ReplicasConnection, body: string, finish = false): Promise<void> {
    if (task.notice === body && !finish) return;
    await this.feed.postMessage({ memberId: c.botMemberId }, task.spaceId,
      { threadRoot: task.threadRootId, body: body.slice(0, 65000), actingMode: 'agent', agentName: 'Replicas' },
      async () => {
        const current = (await this.k.store.getReplicasTask(task.spaceId, task.threadRootId))!;
        current.notice = body;
        if (finish) {
          current.deliveredOffset = current.active!.offset;
          current.active = null; current.status = current.queue.length ? 'queued' : 'idle'; current.error = null;
        }
        current.updatedAt = this.k.now();
        await this.k.store.putReplicasTask(current);
      });
  }
  private async context(spaceId: string, rootId: string, after: number, through: number): Promise<string> {
    const all = await this.k.store.listMessagesBySpace(spaceId);
    const members = await this.k.store.listMemberships(spaceId);
    const names = new Map<string, string>();
    for (const m of members) names.set(m.memberId, (await this.k.store.getMember(m.memberId))?.displayName ?? m.memberId);
    return all.filter(m => (m.id === rootId || m.threadRoot === rootId) && m.offset > after && m.offset <= through && !m.deletedAt)
      .sort((a, b) => a.offset - b.offset)
      .map(m => `${names.get(m.author.memberId) ?? m.author.memberId}: ${mentionsAsText(m.body, names)}`).join('\n\n');
  }
  private async images(spaceId: string, text: string): Promise<ReplicasImage[]> {
    const images: ReplicasImage[] = [];
    const hashes = new Set<string>();
    let total = 0;
    for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) {
      const url = new URL(match[1]!);
      if (url.host !== this.k.org.address) continue;
      const parts = url.pathname.split('/');
      if (parts[1] !== 's' || parts[2] !== spaceId || parts[3] !== 'b' || !/^[a-f0-9]{64}$/.test(parts[4] ?? '')) continue;
      const hash = parts[4]!;
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      const blob = await this.k.store.getSpaceBlob(spaceId, hash);
      if (!blob || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.mime)) continue;
      total += blob.size;
      if (total > 20 * 1024 * 1024 || images.length >= 10) throw new HarborError('payload_too_large', 'Replicas accepts up to 10 images totaling 20 MB per request.');
      const bytes = await this.blobs?.get(hash);
      if (!bytes) throw new HarborError('not_found', 'A thread image could not be read.');
      images.push({ type: 'image', source: { type: 'base64', media_type: blob.mime, data: Buffer.from(bytes).toString('base64') } });
    }
    return images;
  }
  private async advance(task: ReplicasTaskRecord): Promise<void> {
    if (task.status === 'idle' && !task.queue.length) return;
    const c = await this.connection(task.spaceId);
    if (!c?.enabled || !await this.k.store.getMembership(task.spaceId, c.botMemberId)) return;
    const api = this.api(task.spaceId, c);
    if (task.status === 'sending') {
      // No documented upstream idempotency key: a crash after POST is ambiguous, not permission to spend twice.
      await this.update(task, t => { t.status = 'uncertain'; t.error = 'Delivery was interrupted. Check Replicas and attach the existing workspace and chat before continuing.'; });
      return;
    }
    if (task.status === 'uncertain' || task.status === 'error') {
      if (task.error) await this.notice(task, c, task.error);
      return;
    }
    if (task.status === 'running' && task.active) {
      try {
        if (!task.workspaceId) throw new Error('Missing workspace');
        if (!task.chatId) {
          const workspace = await api.workspace(task.workspaceId, c.codingAgent);
          if (!workspace.chatId) return;
          task.chatId = workspace.chatId;
          await this.update(task, t => { t.chatId = workspace.chatId; });
        }
        const result = await api.history(task.workspaceId, task.chatId, task.active.messageId);
        if (!result.requestSeen || !result.finished) return;
        await this.notice(task, c, `${result.text ?? 'The agent finished without a text response.'}\n\n[${task.url ? 'Open workspace' : 'Open Replicas'}](${task.url ?? 'https://app.replicas.dev'})`, true);
        try {
          await this.feed.reactToMessage({ memberId: c.botMemberId }, task.spaceId, task.active.messageId, { emoji: '👀', action: 'remove', actingMode: 'agent', agentName: 'Replicas' });
          await this.feed.reactToMessage({ memberId: c.botMemberId }, task.spaceId, task.active.messageId, { emoji: result.failed ? '❗' : '✅', action: 'add', actingMode: 'agent', agentName: 'Replicas' });
        } catch { console.error('[replicas] completion reaction failed'); }
      } catch (error) {
        await this.update(task, current => {
          if (error instanceof RemoteError && error.status === 404) {
            current.workspaceId = null; current.chatId = null; current.url = null; current.status = 'error';
            current.error = 'This workspace was deleted. Retry to create a replacement for this request.';
          } else {
            current.error = 'Waiting to reconnect to Replicas. The coding task may still be running.';
          }
        });
      }
      return;
    }
    if (!task.queue.length) return;
    const next = task.queue[0]!;
    const message = await this.k.store.getMessage(task.spaceId, next.messageId);
    if (!message || message.deletedAt || !await this.k.store.getMembership(task.spaceId, next.memberId)) {
      await this.update(task, t => { t.queue = t.queue.filter(q => q.messageId !== next.messageId); });
      return;
    }
    if (!task.workspaceId && (!task.environmentId || /\[env:[^\]]+\]/.test(message.body))) {
      const envs = await api.environments();
      const inline = next.environmentSelected ? undefined : /\[env:([^\]]+)\]/.exec(message.body)?.[1]?.toLowerCase();
      const matches = inline ? envs.filter(e => e.name.toLowerCase() === inline || e.id.toLowerCase() === inline) : task.environmentId ? envs.filter(e => e.id === task.environmentId) : envs.length === 1 ? envs : [];
      if (matches.length === 1) {
        task.environmentId = matches[0]!.id;
        await this.update(task, t => { t.environmentId = task.environmentId; });
      } else {
        await this.update(task, t => { t.status = 'select_environment'; });
        await this.notice(task, c, 'Choose a Replicas environment above the reply box to start this task.');
        return;
      }
    }
    const space = await this.k.store.getSpace(task.spaceId);
    const context = await this.context(task.spaceId, task.threadRootId, task.deliveredOffset, next.offset);
    const text = `[Spaces request ${next.messageId}]\nSpace: ${space?.name}\n\n${task.forkContext ?? ''}\n${context}\n\nRespond to the latest request. Questions asking for explanation do not authorize code changes. Reply concisely for the shared thread, including verification and PR links when relevant. Do not post to Slack.`;
    const images = await this.images(task.spaceId, text);
    const active = { ...next, text };
    await this.k.lockedAs({ memberId: next.memberId }, task.spaceId, async () => {
      this.k.guardWrite();
      if (!(await this.connection(task.spaceId))?.enabled) throw new HarborError('invalid_request', 'Replicas was disconnected.');
      const current = (await this.k.store.getReplicasTask(task.spaceId, task.threadRootId))!;
      current.active = active; current.queue = current.queue.filter(q => q.messageId !== next.messageId); current.status = 'sending'; current.notice = null;
      current.updatedAt = this.k.now();
      await this.k.store.putReplicasTask(current);
    });
    await this.feed.reactToMessage({ memberId: c.botMemberId }, task.spaceId, next.messageId, { emoji: '👀', action: 'add', actingMode: 'agent', agentName: 'Replicas' });
    try {
      if (!task.workspaceId) {
        const workspace = await api.create({ name: `spaces-${task.threadRootId}`, environmentId: task.environmentId!, codingAgent: c.codingAgent, message: text, planMode: next.planMode, images });
        await this.update(task, t => { t.workspaceId = workspace.id; t.chatId = workspace.chatId; t.url = workspace.url; t.status = 'running'; });
        await this.notice(task, c, `Started work on this thread. Workspace \`${workspace.id}\`. [${workspace.url ? 'Open workspace' : 'Open Replicas'}](${workspace.url ?? 'https://app.replicas.dev'})`).catch(() => console.error('[replicas] acknowledgement delivery failed'));
      } else {
        if (!task.chatId) throw new Error('No shared chat selected');
        await api.send(task.workspaceId, task.chatId, text, next.planMode, images);
        await this.update(task, t => { t.status = 'running'; });
      }
    } catch (error) {
      const rejected = error instanceof RemoteError && error.status >= 400 && error.status < 500 && error.status !== 408;
      await this.update(task, t => {
        t.status = rejected ? 'error' : 'uncertain';
        t.error = rejected ? `${error.message}. Correct the connection or request, then retry.` : 'Replicas delivery could not be confirmed. Check the workspace before sending again; attach its workspace and chat here to resume tracking.';
      });
    }
  }
}
