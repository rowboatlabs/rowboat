import { randomBytes } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { monotonicFactory } from 'ulid';
import {
  inviteUrl,
  type ActingMode,
  type AcceptInviteResult,
  type Attribution,
  type ChangeSet,
  type CreateInviteResult,
  type Member,
  type Membership,
  type Message,
  type ProposeChange,
  type ProposeChangeResult,
  type ReadAssetResult,
  type ResolveInviteResult,
  type Routes,
  type Space,
  type SpaceEvent,
  type Topic,
} from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import { HarborError } from './errors.js';
import { SpaceHub } from './hub.js';
import { merge3 } from './merge.js';
import type { Store, StoredEvent } from './store.js';

// The one service core (spec §9: one core, two faces). REST (http.ts) and MCP
// (mcp.ts) are thin projections over this class; neither has a privileged path.

export interface ActorCtx {
  memberId: string;
}

type NewTopicMessage = z.infer<Routes['postMessage']['request']>;
type ManageTopicAction = z.infer<Routes['manageTopic']['request']>;

export interface OrgInfo {
  name: string;
  /** host[:port] — the org address links are minted on. Set once the listener knows its port. */
  address: string;
}

const RECENT_HISTORY = 10;
const DEFAULT_INVITE_HOURS = 24 * 7;

export class HarborService {
  readonly org: OrgInfo;
  /** Over-limit means read-only, never lockout (spec §4). Flip via the control plane; here a knob for tests. */
  readOnly = false;

  private readonly ulid = monotonicFactory();

  constructor(
    private readonly store: Store,
    private readonly hub: SpaceHub,
    org: OrgInfo,
  ) {
    this.org = org;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private guardWrite(): void {
    if (this.readOnly) {
      throw new HarborError('read_only_limit', 'org is over its plan limit: writes are paused, reads still work');
    }
  }

  private async requireSpace(spaceId: string): Promise<Space> {
    const space = await this.store.getSpace(spaceId);
    if (!space) throw new HarborError('not_found', `no such space`);
    return space;
  }

  async requireMember(ctx: ActorCtx, spaceId: string): Promise<Space> {
    const space = await this.requireSpace(spaceId);
    const membership = await this.store.getMembership(spaceId, ctx.memberId);
    if (!membership) throw new HarborError('forbidden', 'you are not a member of this space');
    return space;
  }

  /** Append a durable event at `offset` (allocated by the caller inside the space lock) and fan it out. */
  private async append(spaceId: string, offset: number, at: string, event: SpaceEvent): Promise<void> {
    const stored: StoredEvent = { offset, at, event };
    await this.store.appendEvent(spaceId, stored);
    this.hub.publish(spaceId, { kind: 'event', spaceId, offset, at, event });
  }

  // --- spaces & membership ---------------------------------------------------

  async listSpaces(ctx: ActorCtx): Promise<Space[]> {
    return this.store.listSpacesFor(ctx.memberId);
  }

  async createSpace(ctx: ActorCtx, name: string): Promise<Space> {
    this.guardWrite();
    const now = this.now();
    const space: Space = { id: this.ulid(), name, createdAt: now };
    await this.store.putSpace(space);
    return this.store.withSpaceLock(space.id, async () => {
      const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: now };
      await this.store.putMembership(membership);
      const offset = (await this.store.head(space.id)) + 1;
      await this.append(space.id, offset, now, { type: 'membership', membership, action: 'joined' });
      return space;
    });
  }

  async listMembers(ctx: ActorCtx, spaceId: string): Promise<Member[]> {
    await this.requireMember(ctx, spaceId);
    const memberships = await this.store.listMemberships(spaceId);
    const members: Member[] = [];
    for (const m of memberships) {
      const member = await this.store.getMember(m.memberId);
      if (member) members.push(member);
    }
    return members;
  }

  async leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    await this.requireMember(ctx, spaceId);
    await this.store.withSpaceLock(spaceId, async () => {
      const membership = await this.store.getMembership(spaceId, ctx.memberId);
      if (!membership) return;
      await this.store.deleteMembership(spaceId, ctx.memberId);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, this.now(), { type: 'membership', membership, action: 'left' });
    });
  }

  // --- invites ---------------------------------------------------------------

  async createInvite(ctx: ActorCtx, spaceId: string, expiresInHours?: number): Promise<CreateInviteResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const token = randomBytes(24).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(Date.now() + (expiresInHours ?? DEFAULT_INVITE_HOURS) * 3_600_000).toISOString();
    await this.store.putInvite({ token, spaceId, createdBy: ctx.memberId, createdAt: now, expiresAt, revoked: false });
    return { token, link: inviteUrl(this.org.address, token), expiresAt };
  }

  /** Pre-auth on purpose: the app shows what's being joined before the OAuth dance. */
  async resolveInvite(token: string): Promise<ResolveInviteResult> {
    const invite = await this.store.getInvite(token);
    if (!invite) throw new HarborError('not_found', 'unknown invite');
    if (invite.revoked) return { state: 'revoked' };
    if (invite.expiresAt && invite.expiresAt < this.now()) return { state: 'expired' };
    const space = await this.requireSpace(invite.spaceId);
    const inviter = await this.store.getMember(invite.createdBy);
    return {
      state: 'ok',
      org: { address: this.org.address, name: this.org.name },
      space: { id: space.id, name: space.name },
      invitedBy: inviter?.displayName,
    };
  }

  async acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    const resolved = await this.resolveInvite(token);
    if (resolved.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${resolved.state}`);
    }
    this.guardWrite();
    const spaceId = resolved.space.id;
    const space = await this.requireSpace(spaceId);
    return this.store.withSpaceLock(spaceId, async () => {
      const existing = await this.store.getMembership(spaceId, ctx.memberId);
      if (existing) return { membership: existing, space }; // idempotent join
      const membership: Membership = { spaceId, memberId: ctx.memberId, joinedAt: this.now() };
      await this.store.putMembership(membership);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, membership.joinedAt, { type: 'membership', membership, action: 'joined' });
      return { membership, space };
    });
  }

  // --- assets ----------------------------------------------------------------

  async listAssets(ctx: ActorCtx, spaceId: string) {
    await this.requireMember(ctx, spaceId);
    return this.store.listAssets(spaceId);
  }

  private async recentHistory(spaceId: string, path: string, upToVersion?: number): Promise<ChangeSet[]> {
    const all = await this.store.listChangeSets(spaceId, { path, limit: 1_000 });
    const filtered = upToVersion === undefined ? all : all.filter((cs) => cs.resultVersion <= upToVersion);
    return filtered.slice(0, RECENT_HISTORY);
  }

  async readAsset(ctx: ActorCtx, spaceId: string, path: string, version?: number): Promise<ReadAssetResult> {
    await this.requireMember(ctx, spaceId);
    const head = await this.store.getAssetHead(spaceId, path);
    if (!head) throw new HarborError('not_found', 'no such asset');
    const v = version ?? head.version;
    const content = await this.store.getAssetContent(spaceId, path, v);
    if (content === undefined) throw new HarborError('not_found', `no version ${v} of ${path}`);
    return { path, content, version: v, recentHistory: await this.recentHistory(spaceId, path, v) };
  }

  async proposeChange(ctx: ActorCtx, spaceId: string, input: ProposeChange): Promise<ProposeChangeResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const head = await this.store.getAssetHead(spaceId, input.assetPath);

      if (!head) {
        if (input.baseVersion !== 0) {
          throw new HarborError('not_found', 'asset does not exist; propose with baseVersion 0 to create it');
        }
        const changeSet = await this.commit(spaceId, input, attribution, 1, input.newContent);
        return { outcome: 'applied' as const, changeSet, version: 1 };
      }

      if (input.baseVersion > head.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${head.version})`);
      }

      if (input.baseVersion === head.version) {
        const version = head.version + 1;
        const changeSet = await this.commit(spaceId, input, attribution, version, input.newContent);
        return { outcome: 'applied' as const, changeSet, version };
      }

      // Stale base: three-way merge (CONTRACT.md decision 1).
      const base = await this.store.getAssetContent(spaceId, input.assetPath, input.baseVersion);
      const current = await this.store.getAssetContent(spaceId, input.assetPath, head.version);
      if (base === undefined || current === undefined) {
        throw new HarborError('internal', 'asset version content missing');
      }
      const result = merge3(base, current, input.newContent);

      if (result.outcome === 'conflict') {
        // Nothing written. Decision 6: everything needed to retry, one round trip.
        return {
          outcome: 'conflict' as const,
          currentVersion: head.version,
          currentContent: current,
          regions: result.regions,
          recentHistory: await this.recentHistory(spaceId, input.assetPath),
        };
      }

      // Clean merge — stored even when it lands identical content, so the
      // second standup-pusher's change-set exists, attributed, in history
      // (principle 4; fixture 06's product beat).
      const version = head.version + 1;
      const changeSet = await this.commit(spaceId, input, attribution, version, result.content);
      return { outcome: 'merged' as const, changeSet, version, mergedContent: result.content };
    });
  }

  /** Inside the space lock only: writes the version, the change-set, and the event as one fact. */
  private async commit(
    spaceId: string,
    input: ProposeChange,
    attribution: Attribution,
    version: number,
    content: string,
  ): Promise<ChangeSet> {
    const at = this.now();
    const offset = (await this.store.head(spaceId)) + 1;
    const changeSet: ChangeSet = {
      id: this.ulid(),
      spaceId,
      assetPath: input.assetPath,
      baseVersion: input.baseVersion,
      resultVersion: version,
      attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      committedAt: at,
      offset,
    };
    await this.store.putAssetVersion(spaceId, input.assetPath, version, content, at);
    await this.store.appendChangeSet(changeSet);
    await this.append(spaceId, offset, at, { type: 'change', changeSet });
    return changeSet;
  }

  async assetHistory(
    ctx: ActorCtx,
    spaceId: string,
    opts: { path?: string; beforeOffset?: number; limit?: number },
  ): Promise<ChangeSet[]> {
    await this.requireMember(ctx, spaceId);
    return this.store.listChangeSets(spaceId, {
      ...(opts.path !== undefined ? { path: opts.path } : {}),
      ...(opts.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: opts.limit ?? 50,
    });
  }

  async diff(ctx: ActorCtx, spaceId: string, path: string, from: number, to: number): Promise<string> {
    await this.requireMember(ctx, spaceId);
    const head = await this.store.getAssetHead(spaceId, path);
    if (!head) throw new HarborError('not_found', 'no such asset');
    const fromContent = await this.store.getAssetContent(spaceId, path, from);
    const toContent = await this.store.getAssetContent(spaceId, path, to);
    if (fromContent === undefined || toContent === undefined) {
      throw new HarborError('not_found', 'no such version');
    }
    return createTwoFilesPatch(`${path}@v${from}`, `${path}@v${to}`, fromContent, toContent, undefined, undefined, {
      context: 3,
    });
  }

  // --- feed ------------------------------------------------------------------

  async listTopics(ctx: ActorCtx, spaceId: string, includeArchived = false): Promise<Topic[]> {
    await this.requireMember(ctx, spaceId);
    return this.store.listTopics(spaceId, includeArchived);
  }

  async listMessages(ctx: ActorCtx, spaceId: string, topicId: string): Promise<{ topic: Topic; messages: Message[] }> {
    await this.requireMember(ctx, spaceId);
    const topic = await this.store.getTopic(spaceId, topicId);
    if (!topic) throw new HarborError('not_found', 'no such topic');
    return { topic, messages: await this.store.listMessages(spaceId, topicId) };
  }

  async postMessage(
    ctx: ActorCtx,
    spaceId: string,
    input: NewTopicMessage,
  ): Promise<{ topic: Topic; message: Message }> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const author: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.store.withSpaceLock(spaceId, async () => {
      const at = this.now();

      if (input.topicId) {
        const topic = await this.store.getTopic(spaceId, input.topicId);
        if (!topic) throw new HarborError('not_found', 'no such topic');
        const offset = (await this.store.head(spaceId)) + 1;
        const message: Message = {
          id: this.ulid(),
          topicId: topic.id,
          spaceId,
          author,
          body: input.body,
          postedAt: at,
          offset,
        };
        await this.store.appendMessage(message);
        // Replying revives an archived topic; counts/lastActivity update without
        // a topic event (clients derive those from message events).
        const updated: Topic = {
          ...topic,
          archived: false,
          lastActivityAt: at,
          messageCount: topic.messageCount + 1,
        };
        await this.store.putTopic(updated);
        await this.append(spaceId, offset, at, { type: 'message', message });
        if (topic.archived) {
          await this.append(spaceId, offset + 1, at, { type: 'topic', topic: updated });
        }
        return { topic: updated, message };
      }

      // First message becomes the title (spec §7); agents recover structure later.
      if (input.anchorChangeSetId) {
        const anchor = await this.store.getChangeSet(spaceId, input.anchorChangeSetId);
        if (!anchor) throw new HarborError('invalid_request', 'anchorChangeSetId does not exist in this space');
      }
      const topicOffset = (await this.store.head(spaceId)) + 1;
      const topic: Topic = {
        id: this.ulid(),
        spaceId,
        title: deriveTitle(input.body),
        createdBy: author,
        createdAt: at,
        archived: false,
        ...(input.anchorChangeSetId ? { anchorChangeSetId: input.anchorChangeSetId } : {}),
        lastActivityAt: at,
        messageCount: 1,
      };
      const message: Message = {
        id: this.ulid(),
        topicId: topic.id,
        spaceId,
        author,
        body: input.body,
        postedAt: at,
        offset: topicOffset + 1,
      };
      await this.store.putTopic(topic);
      await this.store.appendMessage(message);
      await this.append(spaceId, topicOffset, at, { type: 'topic', topic });
      await this.append(spaceId, topicOffset + 1, at, { type: 'message', message });
      return { topic, message };
    });
  }

  async manageTopic(ctx: ActorCtx, spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();

    return this.store.withSpaceLock(spaceId, async () => {
      const topic = await this.store.getTopic(spaceId, topicId);
      if (!topic) throw new HarborError('not_found', 'no such topic');
      const at = this.now();

      switch (action.action) {
        case 'retitle': {
          const updated: Topic = { ...topic, title: action.title };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated });
          return updated;
        }
        case 'archive':
        case 'unarchive': {
          const archived = action.action === 'archive';
          if (topic.archived === archived) return topic; // idempotent, no event
          const updated: Topic = { ...topic, archived };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated });
          return updated;
        }
        case 'merge_into': {
          if (action.targetTopicId === topicId) {
            throw new HarborError('invalid_request', 'cannot merge a topic into itself');
          }
          const target = await this.store.getTopic(spaceId, action.targetTopicId);
          if (!target) throw new HarborError('not_found', 'no such target topic');
          const moved = await this.store.reassignMessages(spaceId, topicId, target.id);
          const source: Topic = { ...topic, archived: true };
          const updatedTarget: Topic = {
            ...target,
            messageCount: target.messageCount + moved,
            lastActivityAt: target.lastActivityAt > topic.lastActivityAt ? target.lastActivityAt : topic.lastActivityAt,
            archived: false,
          };
          await this.store.putTopic(source);
          await this.store.putTopic(updatedTarget);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: source });
          await this.append(spaceId, offset + 1, at, { type: 'topic', topic: updatedTarget });
          // The surviving topic is what the caller works with next.
          return updatedTarget;
        }
      }
    });
  }

  async searchFeed(
    ctx: ActorCtx,
    spaceId: string,
    query: string,
    limit = 20,
  ): Promise<Array<{ topicId: string; title: string; snippet: string; lastActivityAt: string }>> {
    await this.requireMember(ctx, spaceId);
    const q = query.toLowerCase();
    const topics = await this.store.listTopics(spaceId, true);
    const messages = await this.store.listMessagesBySpace(spaceId);
    const byTopic = new Map<string, Message[]>();
    for (const m of messages) {
      const list = byTopic.get(m.topicId) ?? [];
      list.push(m);
      byTopic.set(m.topicId, list);
    }

    const results: Array<{ topicId: string; title: string; snippet: string; lastActivityAt: string }> = [];
    for (const topic of topics) {
      if (topic.title.toLowerCase().includes(q)) {
        results.push({ topicId: topic.id, title: topic.title, snippet: topic.title, lastActivityAt: topic.lastActivityAt });
        continue;
      }
      const hit = (byTopic.get(topic.id) ?? []).find((m) => m.body.toLowerCase().includes(q));
      if (hit) {
        results.push({
          topicId: topic.id,
          title: topic.title,
          snippet: excerpt(hit.body, q),
          lastActivityAt: topic.lastActivityAt,
        });
      }
    }
    return results.slice(0, limit); // topics come sorted by lastActivityAt desc
  }

  // --- live ------------------------------------------------------------------

  async publishPresence(
    ctx: ActorCtx,
    spaceId: string,
    state: 'viewing' | 'typing' | 'agent_working' | 'idle',
    topicId?: string,
  ): Promise<void> {
    await this.requireMember(ctx, spaceId);
    this.hub.publish(spaceId, {
      kind: 'presence',
      spaceId,
      memberId: ctx.memberId,
      state,
      ...(topicId !== undefined ? { topicId } : {}),
      at: this.now(),
    });
  }

  async eventsAfter(spaceId: string, afterOffset: number): Promise<StoredEvent[]> {
    return this.store.listEventsAfter(spaceId, afterOffset);
  }

  async headOffset(spaceId: string): Promise<number> {
    return this.store.head(spaceId);
  }
}

function deriveTitle(body: string): string {
  const firstLine = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return 'Untitled';
  const stripped = firstLine.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').trim();
  const title = stripped.length > 0 ? stripped : firstLine;
  return title.length > 256 ? `${title.slice(0, 255)}…` : title;
}

function excerpt(body: string, lowerQuery: string): string {
  const idx = body.toLowerCase().indexOf(lowerQuery);
  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + lowerQuery.length + 100);
  const slice = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${end < body.length ? '…' : ''}`;
}

export type { ActingMode };
