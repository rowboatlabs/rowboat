import type {
  ChangeSet,
  Member,
  Membership,
  Message,
  Space,
  Topic,
} from '@rowboat/spaces-protocol';
import type { AssetRecord, AssetVersionData, Store, StoredEvent, StoredInvite, StoredPollVote, StoredReaction, StoredSpaceBlob } from './store.js';

interface SpaceState {
  space: Space;
  memberships: Map<string, Membership>;
  assets: Map<string, AssetRecord>; // assetId → record (inode model; path is a property)
  assetVersions: Map<string, AssetVersionData>; // `${assetId}@${version}`
  redirects: Map<string, { assetId: string; movedAt: string }>; // old path → asset
  changeSetAsset: Map<string, string>; // changeSetId → assetId (internal lineage key)
  blobs: Map<string, StoredSpaceBlob>; // hash → registration (first write wins)
  changeSets: ChangeSet[]; // append order == offset order
  changeSetsById: Map<string, ChangeSet>;
  topics: Map<string, Topic>; // annotation rows (id → row); messages never reference them
  messages: Message[]; // the one stream, roots and replies interleaved, oldest first
  messagesById: Map<string, Message>;
  reactions: Map<string, StoredReaction[]>; // messageId → oldest first
  pollVotes: Map<string, StoredPollVote[]>; // messageId → oldest first
  events: StoredEvent[]; // offsets start at 1; events[i].offset === i + 1
  lock: Promise<void>;
}

export class MemoryStore implements Store {
  private members = new Map<string, Member>();
  private identities = new Map<string, string>(); // `${iss}\n${sub}` → memberId
  private spaces = new Map<string, SpaceState>();
  private invites = new Map<string, StoredInvite>();

  private state(spaceId: string): SpaceState | undefined {
    return this.spaces.get(spaceId);
  }

  private must(spaceId: string): SpaceState {
    const s = this.spaces.get(spaceId);
    if (!s) throw new Error(`unknown space ${spaceId}`);
    return s;
  }

  async getMember(id: string): Promise<Member | undefined> {
    return this.members.get(id);
  }

  async putMember(member: Member): Promise<void> {
    this.members.set(member.id, member);
  }

  async getMemberByIdentity(iss: string, sub: string): Promise<Member | undefined> {
    const memberId = this.identities.get(`${iss}\n${sub}`);
    return memberId === undefined ? undefined : this.members.get(memberId);
  }

  async putIdentity(iss: string, sub: string, memberId: string): Promise<void> {
    this.identities.set(`${iss}\n${sub}`, memberId);
  }

  async putSpace(space: Space): Promise<void> {
    const existing = this.spaces.get(space.id);
    if (existing) {
      existing.space = space;
      return;
    }
    this.spaces.set(space.id, {
      space,
      memberships: new Map(),
      assets: new Map(),
      assetVersions: new Map(),
      redirects: new Map(),
      changeSetAsset: new Map(),
      blobs: new Map(),
      changeSets: [],
      changeSetsById: new Map(),
      topics: new Map(),
      messages: [],
      messagesById: new Map(),
      reactions: new Map(),
      pollVotes: new Map(),
      events: [],
      lock: Promise.resolve(),
    });
  }

  async getSpace(id: string): Promise<Space | undefined> {
    return this.state(id)?.space;
  }

  async listSpacesFor(memberId: string): Promise<Space[]> {
    return [...this.spaces.values()]
      .filter((s) => s.memberships.has(memberId))
      .map((s) => s.space)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getMembership(spaceId: string, memberId: string): Promise<Membership | undefined> {
    return this.state(spaceId)?.memberships.get(memberId);
  }

  async listMemberships(spaceId: string): Promise<Membership[]> {
    return [...this.must(spaceId).memberships.values()].sort((a, b) =>
      a.joinedAt.localeCompare(b.joinedAt),
    );
  }

  async putMembership(membership: Membership): Promise<void> {
    this.must(membership.spaceId).memberships.set(membership.memberId, membership);
  }

  async deleteMembership(spaceId: string, memberId: string): Promise<void> {
    this.must(spaceId).memberships.delete(memberId);
  }

  async listAssets(spaceId: string, includeDeleted: boolean): Promise<AssetRecord[]> {
    return [...this.must(spaceId).assets.values()]
      .filter((a) => includeDeleted || a.state === 'live')
      .map((a) => ({ ...a }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async getLiveAssetByPath(spaceId: string, path: string): Promise<AssetRecord | undefined> {
    const found = [...this.must(spaceId).assets.values()].find((a) => a.state === 'live' && a.path === path);
    return found ? { ...found } : undefined;
  }

  async getLatestDeletedByPath(spaceId: string, path: string): Promise<AssetRecord | undefined> {
    const dead = [...this.must(spaceId).assets.values()]
      .filter((a) => a.state === 'deleted' && a.path === path)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return dead[0] ? { ...dead[0] } : undefined;
  }

  async getAssetById(spaceId: string, assetId: string): Promise<AssetRecord | undefined> {
    const found = this.state(spaceId)?.assets.get(assetId);
    return found ? { ...found } : undefined;
  }

  async createAsset(spaceId: string, record: AssetRecord): Promise<void> {
    this.must(spaceId).assets.set(record.id, { ...record });
  }

  async getAssetVersion(spaceId: string, assetId: string, version: number): Promise<AssetVersionData | undefined> {
    if (version === 0) return { content: '', blob: null };
    return this.state(spaceId)?.assetVersions.get(`${assetId}@${version}`);
  }

  async putAssetVersion(
    spaceId: string,
    assetId: string,
    version: number,
    data: AssetVersionData,
    updatedAt: string,
  ): Promise<void> {
    const s = this.must(spaceId);
    const asset = s.assets.get(assetId);
    if (!asset) throw new Error(`unknown asset ${assetId}`);
    s.assets.set(assetId, {
      ...asset,
      version,
      updatedAt,
      ...(data.blob ? { blob: data.blob } : { blob: undefined }),
    });
    s.assetVersions.set(`${assetId}@${version}`, data);
  }

  async setAssetPath(spaceId: string, assetId: string, path: string, updatedAt: string): Promise<void> {
    const s = this.must(spaceId);
    const asset = s.assets.get(assetId);
    if (!asset) throw new Error(`unknown asset ${assetId}`);
    s.assets.set(assetId, { ...asset, path, updatedAt });
  }

  async setAssetState(spaceId: string, assetId: string, state: 'live' | 'deleted', updatedAt: string): Promise<void> {
    const s = this.must(spaceId);
    const asset = s.assets.get(assetId);
    if (!asset) throw new Error(`unknown asset ${assetId}`);
    s.assets.set(assetId, { ...asset, state, updatedAt });
  }

  async putRedirect(spaceId: string, path: string, assetId: string, movedAt: string): Promise<void> {
    this.must(spaceId).redirects.set(path, { assetId, movedAt });
  }

  async getRedirect(spaceId: string, path: string): Promise<string | undefined> {
    return this.state(spaceId)?.redirects.get(path)?.assetId;
  }

  async deleteRedirect(spaceId: string, path: string): Promise<void> {
    this.must(spaceId).redirects.delete(path);
  }

  async putSpaceBlob(blob: StoredSpaceBlob): Promise<void> {
    const s = this.must(blob.spaceId);
    if (!s.blobs.has(blob.hash)) s.blobs.set(blob.hash, blob);
  }

  async getSpaceBlob(spaceId: string, hash: string): Promise<StoredSpaceBlob | undefined> {
    return this.state(spaceId)?.blobs.get(hash);
  }

  async appendChangeSet(changeSet: ChangeSet, assetId: string): Promise<void> {
    const s = this.must(changeSet.spaceId);
    s.changeSets.push(changeSet);
    s.changeSetsById.set(changeSet.id, changeSet);
    s.changeSetAsset.set(changeSet.id, assetId);
  }

  async getChangeSet(spaceId: string, id: string): Promise<ChangeSet | undefined> {
    return this.state(spaceId)?.changeSetsById.get(id);
  }

  async listChangeSets(
    spaceId: string,
    opts: { assetId?: string; beforeOffset?: number; limit: number },
  ): Promise<ChangeSet[]> {
    const out: ChangeSet[] = [];
    const s = this.must(spaceId);
    for (let i = s.changeSets.length - 1; i >= 0 && out.length < opts.limit; i--) {
      const cs = s.changeSets[i]!;
      if (opts.assetId !== undefined && s.changeSetAsset.get(cs.id) !== opts.assetId) continue;
      if (opts.beforeOffset !== undefined && cs.offset >= opts.beforeOffset) continue;
      out.push(cs);
    }
    return out;
  }

  async getTopic(spaceId: string, topicId: string): Promise<Topic | undefined> {
    return this.state(spaceId)?.topics.get(topicId);
  }

  async putTopic(topic: Topic): Promise<void> {
    this.must(topic.spaceId).topics.set(topic.id, topic);
  }

  async deleteTopic(spaceId: string, topicId: string): Promise<void> {
    this.must(spaceId).topics.delete(topicId);
  }

  async listTopics(spaceId: string, includeArchived: boolean): Promise<Topic[]> {
    return [...this.must(spaceId).topics.values()].filter((t) => includeArchived || !t.archived);
  }

  async getTopicByRoot(spaceId: string, rootMessageId: string): Promise<Topic | undefined> {
    return [...this.must(spaceId).topics.values()].find((t) => t.rootMessageId === rootMessageId);
  }

  async getMessage(spaceId: string, messageId: string): Promise<Message | undefined> {
    return this.must(spaceId).messagesById.get(messageId);
  }

  private window(list: Message[], opts?: { beforeOffset?: number; limit?: number }): Message[] {
    if (opts?.beforeOffset !== undefined) list = list.filter((m) => m.offset < opts.beforeOffset!);
    if (opts?.limit !== undefined) list = list.slice(-opts.limit);
    return [...list];
  }

  async listStream(spaceId: string, opts?: { beforeOffset?: number; limit?: number }): Promise<Message[]> {
    return this.window(this.must(spaceId).messages.filter((m) => m.threadRoot === undefined), opts);
  }

  async listThread(spaceId: string, rootMessageId: string, opts?: { beforeOffset?: number; limit?: number }): Promise<Message[]> {
    return this.window(this.must(spaceId).messages.filter((m) => m.threadRoot === rootMessageId), opts);
  }

  async listMessagesBySpace(spaceId: string): Promise<Message[]> {
    return [...this.must(spaceId).messages];
  }

  async appendMessage(message: Message): Promise<void> {
    const s = this.must(message.spaceId);
    s.messages.push(message);
    s.messagesById.set(message.id, message);
  }

  async refreshReplyStats(spaceId: string, rootMessageId: string): Promise<void> {
    const s = this.must(spaceId);
    const root = s.messagesById.get(rootMessageId);
    if (!root) return;
    const replies = s.messages.filter((m) => m.threadRoot === rootMessageId);
    const live = replies.filter((m) => !m.deletedAt);
    const last = replies[replies.length - 1];
    this.replace(s, {
      ...root,
      replyCount: live.length,
      ...(last ? { lastReplyAt: last.postedAt } : {}),
    });
  }

  /** Swap a message everywhere it lives (array + id index), keeping order. */
  private replace(s: SpaceState, message: Message): void {
    const idx = s.messages.findIndex((m) => m.id === message.id);
    if (idx !== -1) s.messages[idx] = message;
    s.messagesById.set(message.id, message);
  }

  async markMessageEdited(spaceId: string, messageId: string, body: string, editedAt: string): Promise<void> {
    const s = this.must(spaceId);
    const existing = s.messagesById.get(messageId);
    if (existing) this.replace(s, { ...existing, body, editedAt });
    // Rewrite the stored message event too — replay must serve the edit.
    for (let i = 0; i < s.events.length; i++) {
      const e = s.events[i]!;
      if (e.event.type === 'message' && e.event.message.id === messageId) {
        s.events[i] = { ...e, event: { type: 'message', message: { ...e.event.message, body, editedAt } } };
        break;
      }
    }
  }

  async markMessageDeleted(spaceId: string, messageId: string, deletedAt: string): Promise<void> {
    const s = this.must(spaceId);
    const existing = s.messagesById.get(messageId);
    if (existing) {
      // A poll is content the way a body is: deletion redacts both.
      const { poll: _poll, ...rest } = existing;
      this.replace(s, { ...rest, body: '', deletedAt });
    }
    // Votes are content too: they were cast on a poll that no longer exists,
    // and a member-attributed row must not outlive what it attributed.
    s.pollVotes.delete(messageId);
    // Redact the stored message event too — replay must never resurrect the
    // body (nor a poll, which is content the same way).
    for (let i = 0; i < s.events.length; i++) {
      const e = s.events[i]!;
      if (e.event.type === 'message' && e.event.message.id === messageId) {
        const { poll: _poll, ...rest } = e.event.message;
        s.events[i] = { ...e, event: { type: 'message', message: { ...rest, body: '', deletedAt } } };
        break;
      }
    }
  }

  async getReaction(
    spaceId: string,
    messageId: string,
    emoji: string,
    memberId: string,
  ): Promise<StoredReaction | undefined> {
    return this.state(spaceId)?.reactions
      .get(messageId)
      ?.find((r) => r.emoji === emoji && r.by.memberId === memberId);
  }

  async putReaction(reaction: StoredReaction): Promise<void> {
    const s = this.must(reaction.spaceId);
    const list = (s.reactions.get(reaction.messageId) ?? []).filter(
      (r) => !(r.emoji === reaction.emoji && r.by.memberId === reaction.by.memberId),
    );
    list.push(reaction);
    s.reactions.set(reaction.messageId, list);
  }

  async deleteReaction(spaceId: string, messageId: string, emoji: string, memberId: string): Promise<void> {
    const s = this.must(spaceId);
    const list = (s.reactions.get(messageId) ?? []).filter(
      (r) => !(r.emoji === emoji && r.by.memberId === memberId),
    );
    if (list.length === 0) s.reactions.delete(messageId);
    else s.reactions.set(messageId, list);
  }

  async listReactionsByMessage(spaceId: string, messageId: string): Promise<StoredReaction[]> {
    return [...(this.must(spaceId).reactions.get(messageId) ?? [])].sort(
      (a, b) => a.at.localeCompare(b.at) || a.by.memberId.localeCompare(b.by.memberId),
    );
  }

  async listReactionsForMessages(spaceId: string, messageIds: string[]): Promise<StoredReaction[]> {
    const s = this.must(spaceId);
    return messageIds
      .flatMap((id) => s.reactions.get(id) ?? [])
      .sort((a, b) => a.at.localeCompare(b.at) || a.by.memberId.localeCompare(b.by.memberId));
  }

  async getPollVote(
    spaceId: string,
    messageId: string,
    answerId: number,
    memberId: string,
  ): Promise<StoredPollVote | undefined> {
    return this.state(spaceId)?.pollVotes
      .get(messageId)
      ?.find((v) => v.answerId === answerId && v.by.memberId === memberId);
  }

  async putPollVote(vote: StoredPollVote): Promise<void> {
    const s = this.must(vote.spaceId);
    const list = (s.pollVotes.get(vote.messageId) ?? []).filter(
      (v) => !(v.answerId === vote.answerId && v.by.memberId === vote.by.memberId),
    );
    list.push(vote);
    s.pollVotes.set(vote.messageId, list);
  }

  async deletePollVote(spaceId: string, messageId: string, answerId: number, memberId: string): Promise<void> {
    const s = this.must(spaceId);
    const list = (s.pollVotes.get(messageId) ?? []).filter(
      (v) => !(v.answerId === answerId && v.by.memberId === memberId),
    );
    if (list.length === 0) s.pollVotes.delete(messageId);
    else s.pollVotes.set(messageId, list);
  }

  async listPollVotesByMessage(spaceId: string, messageId: string): Promise<StoredPollVote[]> {
    return [...(this.must(spaceId).pollVotes.get(messageId) ?? [])].sort(
      (a, b) => a.at.localeCompare(b.at) || a.by.memberId.localeCompare(b.by.memberId),
    );
  }

  async listPollVotesForMessages(spaceId: string, messageIds: string[]): Promise<StoredPollVote[]> {
    const s = this.must(spaceId);
    return messageIds
      .flatMap((id) => s.pollVotes.get(id) ?? [])
      .sort((a, b) => a.at.localeCompare(b.at) || a.by.memberId.localeCompare(b.by.memberId));
  }

  async markPollEnded(spaceId: string, messageId: string, endedAt: string): Promise<void> {
    const s = this.must(spaceId);
    const message = s.messagesById.get(messageId);
    if (!message?.poll) return;
    this.replace(s, { ...message, poll: { ...message.poll, endedAt } });
  }

  async putInvite(invite: StoredInvite): Promise<void> {
    this.invites.set(invite.token, invite);
  }

  async getInvite(token: string): Promise<StoredInvite | undefined> {
    return this.invites.get(token);
  }

  async head(spaceId: string): Promise<number> {
    return this.must(spaceId).events.length;
  }

  async appendEvent(spaceId: string, stored: StoredEvent): Promise<void> {
    const s = this.must(spaceId);
    if (stored.offset !== s.events.length + 1) {
      throw new Error(`offset gap: got ${stored.offset}, head is ${s.events.length}`);
    }
    s.events.push(stored);
  }

  async listEventsAfter(spaceId: string, afterOffset: number): Promise<StoredEvent[]> {
    return this.must(spaceId).events.slice(afterOffset);
  }

  async withSpaceLock<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    const s = this.must(spaceId);
    const run = s.lock.then(fn);
    s.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
