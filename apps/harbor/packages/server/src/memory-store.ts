import type {
  ChangeSet,
  Member,
  Membership,
  Message,
  Space,
  Topic,
} from '@rowboat/spaces-protocol';
import type { AssetHead, Store, StoredEvent, StoredInvite } from './store.js';

interface SpaceState {
  space: Space;
  memberships: Map<string, Membership>;
  assetHeads: Map<string, AssetHead>;
  assetContents: Map<string, string>; // `${path}@${version}`
  changeSets: ChangeSet[]; // append order == offset order
  changeSetsById: Map<string, ChangeSet>;
  topics: Map<string, Topic>;
  messages: Map<string, Message[]>; // topicId → oldest first
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
      assetHeads: new Map(),
      assetContents: new Map(),
      changeSets: [],
      changeSetsById: new Map(),
      topics: new Map(),
      messages: new Map(),
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

  async listAssets(spaceId: string): Promise<AssetHead[]> {
    return [...this.must(spaceId).assetHeads.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async getAssetHead(spaceId: string, path: string): Promise<AssetHead | undefined> {
    return this.state(spaceId)?.assetHeads.get(path);
  }

  async getAssetContent(spaceId: string, path: string, version: number): Promise<string | undefined> {
    if (version === 0) return '';
    return this.state(spaceId)?.assetContents.get(`${path}@${version}`);
  }

  async putAssetVersion(
    spaceId: string,
    path: string,
    version: number,
    content: string,
    updatedAt: string,
  ): Promise<void> {
    const s = this.must(spaceId);
    s.assetHeads.set(path, { path, version, updatedAt });
    s.assetContents.set(`${path}@${version}`, content);
  }

  async appendChangeSet(changeSet: ChangeSet): Promise<void> {
    const s = this.must(changeSet.spaceId);
    s.changeSets.push(changeSet);
    s.changeSetsById.set(changeSet.id, changeSet);
  }

  async getChangeSet(spaceId: string, id: string): Promise<ChangeSet | undefined> {
    return this.state(spaceId)?.changeSetsById.get(id);
  }

  async listChangeSets(
    spaceId: string,
    opts: { path?: string; beforeOffset?: number; limit: number },
  ): Promise<ChangeSet[]> {
    const out: ChangeSet[] = [];
    const all = this.must(spaceId).changeSets;
    for (let i = all.length - 1; i >= 0 && out.length < opts.limit; i--) {
      const cs = all[i]!;
      if (opts.path !== undefined && cs.assetPath !== opts.path) continue;
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

  async listTopics(spaceId: string, includeArchived: boolean): Promise<Topic[]> {
    return [...this.must(spaceId).topics.values()]
      .filter((t) => includeArchived || !t.archived)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  async getTopicByAnchor(spaceId: string, anchorMessageId: string): Promise<Topic | undefined> {
    return [...this.must(spaceId).topics.values()].find((t) => t.anchorMessageId === anchorMessageId);
  }

  async getMessage(spaceId: string, messageId: string): Promise<Message | undefined> {
    return [...this.must(spaceId).messages.values()].flat().find((m) => m.id === messageId);
  }

  async listMessages(spaceId: string, topicId: string): Promise<Message[]> {
    return [...(this.must(spaceId).messages.get(topicId) ?? [])];
  }

  async listMessagesBySpace(spaceId: string): Promise<Message[]> {
    return [...this.must(spaceId).messages.values()].flat().sort((a, b) => a.offset - b.offset);
  }

  async appendMessage(message: Message): Promise<void> {
    const s = this.must(message.spaceId);
    const list = s.messages.get(message.topicId) ?? [];
    list.push(message);
    s.messages.set(message.topicId, list);
  }

  async reassignMessages(spaceId: string, fromTopicId: string, toTopicId: string): Promise<number> {
    const s = this.must(spaceId);
    const moving = (s.messages.get(fromTopicId) ?? []).map((m) => ({ ...m, topicId: toTopicId }));
    if (moving.length === 0) return 0;
    const target = s.messages.get(toTopicId) ?? [];
    const combined = [...target, ...moving].sort((a, b) => a.offset - b.offset);
    s.messages.set(toTopicId, combined);
    s.messages.delete(fromTopicId);
    return moving.length;
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
