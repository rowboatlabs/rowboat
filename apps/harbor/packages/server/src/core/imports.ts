import { createHash } from 'node:crypto';
import { Message, type SlackImportPreview, type SlackImportSelection, type SlackImportJob } from '@rowboat/spaces-protocol';
import { previewSlackExport, SlackExportError, type SlackPreview, type SlackChannel } from '../imports/slack.js';
import { HarborError } from '../errors.js';
import { canManageSlackImport, enforce } from '../policy.js';
import type { StoredSlackJob } from '../store.js';
import type { ActorCtx, Kernel } from './kernel.js';

const date = (timestamp: string) => new Date(Number(timestamp) * 1000).toISOString();
export class Imports {
  private active = 0;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = true;
  constructor(private readonly k: Kernel) {}

  private async parse(ctx: ActorCtx, bytes: Uint8Array): Promise<SlackPreview> {
    await this.k.requireActiveMember(ctx);
    if (this.active >= 2) throw new HarborError('rate_limited', 'Two archives are already being parsed. Try again shortly.');
    this.active++;
    try { return await previewSlackExport(Buffer.from(bytes)); }
    catch (error) {
      if (error instanceof SlackExportError) throw new HarborError(error.code === 'limit_exceeded' ? 'payload_too_large' : 'invalid_request', error.message);
      throw error;
    } finally { this.active--; }
  }
  async previewSlack(ctx: ActorCtx, bytes: Uint8Array): Promise<SlackImportPreview> {
    const result = await this.parse(ctx, bytes);
    return { channels: result.channels.map(c => ({ id: c.id, name: c.name, private: c.private, archived: c.archived, ...c.preview })), warnings: result.warnings, records: result.records };
  }
  async start(ctx: ActorCtx, bytes: Uint8Array, input: SlackImportSelection): Promise<SlackImportJob> {
    this.k.guardWrite();
    const payload = await this.parse(ctx, bytes);
    const ids = new Set(input.channelIds);
    payload.channels = payload.channels.filter(c => ids.has(c.id));
    if (payload.channels.length !== ids.size) throw new HarborError('invalid_request', 'A selected channel is missing from the archive');
    const key = createHash('sha256').update(JSON.stringify([ctx.memberId, input.workspace, [...ids].sort()])).update(bytes).digest('hex');
    const job = await this.k.store.withSpaceLock(`slack-owner:${ctx.memberId}`, async () => {
      await this.k.requireActiveMember(ctx);
      const jobs = await this.k.store.listSlackJobs(ctx.memberId);
      const existing = await this.k.store.getSlackJobByKey(key);
      if (existing) return existing.job;
      if (jobs.some(j => j.job.status === 'queued' || j.job.status === 'running')) throw new HarborError('rate_limited', 'An import is already active. Wait for it to finish.');
      const now = this.k.now();
      const job: SlackImportJob = { id: this.k.ulid(), workspace: input.workspace, createdAt: now, updatedAt: now, status: 'queued', warnings: payload.warnings,
        channels: payload.channels.map(c => ({ id: c.id, name: c.name, spaceId: this.k.ulid(), messages: c.messages.length, source: { private: c.private, archived: c.archived, topic: c.topic, purpose: c.purpose, memberIds: c.memberIds }, status: 'pending' })) };
      await this.k.store.putSlackJob({ ownerId: ctx.memberId, key, job, payload });
      return job;
    });
    this.kick();
    return job;
  }
  async list(ctx: ActorCtx) {
    await this.k.requireActiveMember(ctx);
    return { jobs: (await this.k.store.listSlackJobs(ctx.memberId)).map(r => r.job) };
  }
  private async owned(ctx: ActorCtx, id: string) {
    await this.k.requireActiveMember(ctx);
    const record = await this.k.store.getSlackJob(id);
    enforce(canManageSlackImport(ctx.memberId, record?.ownerId));
    return record!;
  }
  async get(ctx: ActorCtx, id: string) { return (await this.owned(ctx, id)).job; }
  async retry(ctx: ActorCtx, id: string) {
    this.k.guardWrite();
    const job = await this.k.store.withSpaceLock(`slack-owner:${ctx.memberId}`, async () => {
      const r = await this.owned(ctx, id);
      if (r.job.status !== 'failed') return r.job;
      if ((await this.k.store.listSlackJobs(ctx.memberId)).some(j => ['queued','running'].includes(j.job.status))) throw new HarborError('rate_limited', 'An import is already active');
      r.job.status = 'queued'; delete r.job.error; r.job.updatedAt = this.k.now();
      await this.k.store.putSlackJob(r); return r.job;
    });
    this.kick(); return job;
  }
  startWorker() { this.stopped = false; this.timer ??= setInterval(() => this.kick(), 1000); this.timer.unref(); this.kick(); }
  async stopWorker() { this.stopped = true; clearInterval(this.timer); this.timer = undefined; await this.running; }
  private kick() {
    if (this.stopped || this.running) return;
    this.running = this.drain().catch(error => { console.error('Slack import worker failed', error instanceof Error ? error.name : 'unknown'); }).finally(() => { this.running = undefined; });
  }
  private async drain() {
    for (const entry of await this.k.store.listSlackJobs()) {
      if (this.stopped) return;
      try {
        for (const channel of entry.job.channels) {
          if (this.stopped) return;
          if (channel.status !== 'pending') continue;
          await this.k.locked(channel.spaceId, async () => {
            const r = await this.k.store.getSlackJob(entry.job.id);
            if (!r || !['queued', 'running'].includes(r.job.status)) return;
            const target = r.job.channels.find(c => c.id === channel.id)!;
            if (target.status !== 'pending') return;
            this.k.guardWrite();
            await this.k.requireActiveMember({ memberId: r.ownerId });
            const existing = await this.k.store.getSlackSource(r.ownerId, r.job.workspace, target.id);
            if (existing) { target.spaceId = existing; target.status = 'skipped'; }
            else {
              const source = r.payload?.channels.find(c => c.id === target.id);
              if (!source) throw new Error('Missing import payload');
              await this.importChannel(r, source, target.spaceId);
              await this.k.store.putSlackSource(r.ownerId, r.job.workspace, source.id, target.spaceId);
              target.status = 'imported';
            }
            // 2026-11-16: completed history must not survive deletion in a second, hidden copy.
            if (r.payload) r.payload.channels = r.payload.channels.filter(c => c.id !== target.id);
            r.job.status = r.job.channels.every(c => c.status !== 'pending') ? 'completed' : 'running';
            if (r.job.status === 'completed') r.payload = null;
            r.job.updatedAt = this.k.now();
            await this.k.store.putSlackJob(r);
          });
        }
      } catch (error) {
        await this.k.store.withSpaceLock(`slack-owner:${entry.ownerId}`, async () => {
          const r = await this.k.store.getSlackJob(entry.job.id);
          if (!r || r.job.status === 'completed') return;
          r.job.status = 'failed'; r.job.updatedAt = this.k.now();
          r.job.error = error instanceof HarborError ? error.message : 'Import interrupted. Retry to resume remaining channels.';
          await this.k.store.putSlackJob(r);
        });
      }
    }
  }
  private async importChannel(r: StoredSlackJob, channel: SlackChannel, spaceId: string) {
    const now = this.k.now();
    if (!channel.name || channel.name.length > 128) throw new HarborError('invalid_request', 'Channel name must contain 1–128 characters');
    await this.k.store.putSpace({ id: spaceId, name: channel.name, kind: 'shared', createdAt: now, archived: channel.archived, graph: false });
    const membership = { spaceId, memberId: r.ownerId, joinedAt: now, role: 'admin' as const };
    await this.k.store.putMembership(membership);
    await this.k.appendNext(spaceId, now, { type: 'membership', membership, action: 'joined' });
    const names = new Map(r.payload!.identities.map(i => [i.id, i.name]));
    const ids = new Map(channel.messages.map(m => [m.id, this.k.ulid()]));
    const roots = new Set<string>();
    const write = async (source: typeof channel.messages[number], placeholder = false) => {
      const author = { memberId: r.ownerId, actingMode: 'direct' as const, slack: { workspace: r.job.workspace, channelId: channel.id, userId: source.authorId, name: names.get(source.authorId) ?? source.authorId, timestamp: source.timestamp } };
      // 2026-11-16: retain Slack text as inert text, never Rowboat mention stamps or agent triggers.
      const body = source.deleted ? '' : [source.text,
        ...source.files.map(f => `File: ${f.name}${f.url ? ` (${f.url})` : ''}`),
        ...source.reactions.map(x => `Slack reaction: :${x.name}: × ${x.count}`),
      ].filter(Boolean).join('\n\n');
      if (body.length > 65536) throw new HarborError('invalid_request', 'A message plus attachment/reaction descriptions exceeds 65536 characters');
      const offset = await this.k.nextOffset(spaceId);
      const message = Message.parse({ id: ids.get(source.id), spaceId, author, body, postedAt: date(source.timestamp), offset,
        ...(source.parentId ? { threadRoot: ids.get(source.parentId) } : {}),
        ...(source.deleted ? { deletedAt: now } : {}), ...(source.editedAt ? { editedAt: date(source.editedAt) } : {}) });
      await this.k.store.appendMessage(message);
      await this.k.append(spaceId, offset, now, { type: 'message', message });
      if (!source.parentId && !placeholder) roots.add(message.id);
    };
    for (const m of channel.messages) if (m.parentId && !ids.has(m.parentId)) {
      const id = this.k.ulid(); ids.set(m.parentId, id); roots.add(id);
      await write({ id: m.parentId, timestamp: m.parentId, authorId: 'unknown', text: 'Earlier Slack message unavailable in this export.', textFormat: 'slack', deleted: false, files: [], reactions: [] }, true);
    }
    for (const m of [...channel.messages].sort((a,b) => Number(a.timestamp)-Number(b.timestamp))) await write(m);
    for (const id of roots) await this.k.store.refreshReplyStats(spaceId, id);
  }
}
