import { createHash } from 'node:crypto';
import { Message, type SlackImportPreview, type SlackImportSelection, type SlackImportJob } from '@rowboat/spaces-protocol';
import { previewSlackExport, SlackExportError, type SlackPreview, type SlackChannel } from '../imports/slack.js';
import { HarborError } from '../errors.js';
import { canAppendSlackImport, canLinkSlackProfile, canManageSlackImport, enforce } from '../policy.js';
import type { StoredSlackJob } from '../store.js';
import type { ActorCtx, Kernel } from './kernel.js';

const date = (timestamp: string) => new Date(Number(timestamp) * 1000).toISOString();
export class Imports {
  private active = 0;
  // 2026-11-26: expose work inside the channel transaction without persisting uncommitted progress.
  private currentChannel?: { jobId: string; id: string; processed: number };

  private progress(job: SlackImportJob): SlackImportJob {
    const current = this.currentChannel;
    if (current?.jobId === job.id && job.channels.some(c => c.id === current.id && c.status === 'pending') && job.status !== 'failed') {
      return { ...job, status: 'running', currentChannel: { id: current.id, processed: current.processed } };
    }
    return job;
  }
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = true;
  constructor(private readonly k: Kernel) {}

  async getProfile(ctx: ActorCtx, spaceId: string, messageId: string) {
    await this.k.requireMember(ctx, spaceId);
    const source = (await this.k.store.getMessage(spaceId, messageId))?.author.slack;
    if (!source) throw new HarborError('not_found', 'No imported Slack profile for this message');
    const memberId = await this.k.store.getSlackProfileLink(spaceId, source.workspace, source.userId);
    return { workspace: source.workspace, userId: source.userId, name: source.name, memberId: memberId ?? null };
  }
  async linkProfile(ctx: ActorCtx, spaceId: string, messageId: string, memberId: string | null) {
    this.k.guardWrite();
    return this.k.lockedAs(ctx, spaceId, async () => {
      const { membership } = await this.k.requireMembership(ctx, spaceId);
      enforce(canLinkSlackProfile(membership));
      const profile = await this.getProfile(ctx, spaceId, messageId);
      if (memberId !== null) {
        const member = await this.k.store.getMember(memberId);
        const seat = await this.k.store.getMembership(spaceId, memberId);
        if (!seat || !member || member.kind !== 'human' || member.deactivatedAt || member.removedAt) throw new HarborError('invalid_request', 'Choose an active person who belongs to this space');
      }
      if (profile.memberId === memberId) return profile;
      await this.k.store.putSlackProfileLink(spaceId, profile.workspace, profile.userId, memberId);
      await this.k.appendNext(spaceId, this.k.now(), { type: 'slack_profile_linked', workspace: profile.workspace, userId: profile.userId, memberId, by: this.k.attributionOf(ctx, { actingMode: 'direct' }) });
      return { ...profile, memberId };
    });
  }
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
    const key = createHash('sha256').update(JSON.stringify([ctx.memberId, input.workspace, [...ids].sort(), input.existingChannels ?? 'skip'])).update(bytes).digest('hex');
    const job = await this.k.store.withSpaceLock(`slack-owner:${ctx.memberId}`, async () => {
      await this.k.requireActiveMember(ctx);
      const jobs = await this.k.store.listSlackJobs(ctx.memberId);
      const existing = await this.k.store.getSlackJobByKey(key);
      if (existing) return existing.job;
      if (jobs.some(j => j.job.status === 'queued' || j.job.status === 'running')) throw new HarborError('rate_limited', 'An import is already active. Wait for it to finish.');
      const now = this.k.now();
      const job: SlackImportJob = { id: this.k.ulid(), existingChannels: input.existingChannels ?? 'skip', workspace: input.workspace, createdAt: now, updatedAt: now, status: 'queued', warnings: payload.warnings,
        channels: payload.channels.map(c => ({ id: c.id, name: c.name, spaceId: this.k.ulid(), messages: c.messages.length, source: { private: c.private, archived: c.archived, topic: c.topic, purpose: c.purpose, memberIds: c.memberIds }, status: 'pending' })) };
      if (input.existingChannels === 'append') for (const channel of job.channels) {
        const existing = await this.k.store.getSlackSource(ctx.memberId, input.workspace, channel.id);
        if (existing) {
          const { membership } = await this.k.requireMembership(ctx, existing);
          enforce(canAppendSlackImport(membership));
          channel.spaceId = existing; channel.existing = true;
        }
      }
      await this.k.store.putSlackJob({ ownerId: ctx.memberId, key, job, payload });
      return job;
    });
    this.kick();
    return job;
  }
  async list(ctx: ActorCtx) {
    await this.k.requireActiveMember(ctx);
    return { jobs: (await this.k.store.listSlackJobs(ctx.memberId)).map(r => this.progress(r.job)) };
  }
  private async owned(ctx: ActorCtx, id: string) {
    await this.k.requireActiveMember(ctx);
    const record = await this.k.store.getSlackJob(id);
    enforce(canManageSlackImport(ctx.memberId, record?.ownerId));
    return record!;
  }
  async get(ctx: ActorCtx, id: string) { return this.progress((await this.owned(ctx, id)).job); }
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
            if (target.existing && !existing) throw new HarborError('not_found', 'The previous import destination no longer exists');
            if (existing && r.job.existingChannels !== 'append') { target.spaceId = existing; target.status = 'skipped'; }
            else {
              const source = r.payload?.channels.find(c => c.id === target.id);
              if (!source) throw new Error('Missing import payload');
              if (existing && existing !== target.spaceId) throw new HarborError('invalid_request', 'Import destination changed. Start a new import.');
              if (existing) {
                const { membership } = await this.k.requireMembership({ memberId: r.ownerId }, existing);
                enforce(canAppendSlackImport(membership));
              }
              const progress = { jobId: r.job.id, id: target.id, processed: 0 };
              this.currentChannel = progress;
              await this.importChannel(r, source, target.spaceId, !!existing, progress);
              if (!existing) await this.k.store.putSlackSource(r.ownerId, r.job.workspace, source.id, target.spaceId);
              target.status = 'imported';
            }
            // 2026-11-16: completed history must not survive deletion in a second, hidden copy.
            if (r.payload) r.payload.channels = r.payload.channels.filter(c => c.id !== target.id);
            r.job.status = r.job.channels.every(c => c.status !== 'pending') ? 'completed' : 'running';
            if (r.job.status === 'completed') r.payload = null;
            r.job.updatedAt = this.k.now();
            await this.k.store.putSlackJob(r);
          });
          this.currentChannel = undefined;
        }
      } catch (error) {
        this.currentChannel = undefined;
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
  private async importChannel(r: StoredSlackJob, channel: SlackChannel, spaceId: string, append: boolean, progress: { processed: number }) {
    const now = this.k.now();
    if (!channel.name || channel.name.length > 128) throw new HarborError('invalid_request', 'Channel name must contain 1–128 characters');
    if (!append) {
      await this.k.store.putSpace({ id: spaceId, name: channel.name, kind: 'shared', createdAt: now, archived: channel.archived, graph: false });
      const membership = { spaceId, memberId: r.ownerId, joinedAt: now, role: 'admin' as const };
      await this.k.store.putMembership(membership);
      await this.k.appendNext(spaceId, now, { type: 'membership', membership, action: 'joined' });
    }
    const previous = append ? (await this.k.store.listMessagesBySpace(spaceId)).filter(m => m.author.slack?.workspace === r.job.workspace && m.author.slack?.channelId === channel.id) : [];
    const names = new Map(r.payload!.identities.map(i => [i.id, i.name]));
    const ids = new Map(channel.messages.map(m => [m.id, this.k.ulid()]));
    const imported = new Set(previous.map(m => m.author.slack!.timestamp));
    for (const message of previous) ids.set(message.author.slack!.timestamp, message.id);
    const roots = new Set<string>();
    const write = async (source: typeof channel.messages[number], placeholder = false) => {
      const author = { memberId: r.ownerId, actingMode: 'direct' as const, slack: { workspace: r.job.workspace, channelId: channel.id, userId: source.authorId, name: names.get(source.authorId) ?? source.authorId, timestamp: source.timestamp, reactions: source.reactions.map(reaction => ({ ...reaction, users: reaction.users.map(id => ({ id, name: names.get(id) ?? id })) })) } };
      // 2026-11-16: retain Slack text as inert text, never Rowboat mention stamps or agent triggers.
      const text = source.text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, i) => i % 2 ? part : part.replace(/<@([A-Z0-9]+)>/g, (token, id: string) => names.has(id) ? `<@${id}|${names.get(id)!.replace(/[<>|]/g, '')}>` : token)).join('');
      const body = source.deleted ? '' : [text,
        ...source.files.map(f => f.url ? `File: <${f.url}|${f.name.replace(/[<>|]/g, '')}>` : `File: ${f.name}`),
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
    for (const m of [...channel.messages].sort((a,b) => Number(a.timestamp)-Number(b.timestamp))) {
      if (!imported.has(m.timestamp)) {
        await write(m);
        if (m.parentId) roots.add(ids.get(m.parentId)!);
      }
      progress.processed++;
    }
    for (const id of roots) await this.k.store.refreshReplyStats(spaceId, id);
  }
}
