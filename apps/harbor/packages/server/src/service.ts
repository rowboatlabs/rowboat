import type { ActivityItem, ActivityKind, ActivityPage, ServerFrame } from '@rowboat/spaces-protocol';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { monotonicFactory } from 'ulid';
import {
  inviteUrl,
  parseMentions,
  stampsEqual,
  threadRootFromReason,
  type ActingMode,
  type AcceptInviteResult,
  type Attribution,
  type BlobInfo,
  type ChangeSet,
  type ConflictRegion,
  type CreateInviteResult,
  type DeleteAssetResult,
  type Member,
  type Membership,
  type MentionStamps,
  type Message,
  type MoveAssetResult,
  type Poll,
  type PresenceState,
  type ProposeChange,
  type ProposeChangeResult,
  type ReactionGroup,
  type ReadAssetResult,
  type ResolveInviteResult,
  type RestoreAssetResult,
  type Routes,
  type SearchKind,
  type SearchResults,
  type Space,
  type SpaceEvent,
  type Topic,
  type TopicListing,
  type TopicRemoval,
} from '@rowboat/spaces-protocol';

/** listMessages window bounds — the default page and the per-request cap. */
const MESSAGES_PAGE_DEFAULT = 100;

/** BlobInfo's optional dimensions from a stored blob record — both or neither. */
function blobDims(stored: { width?: number; height?: number }): { width: number; height: number } | Record<string, never> {
  return stored.width !== undefined && stored.height !== undefined
    ? { width: stored.width, height: stored.height }
    : {};
}
const MESSAGES_PAGE_MAX = 200;
import type { z } from 'zod';
import { blobHash, type BlobStore } from './blobs.js';
import { HarborError } from './errors.js';
import type { Notifier } from './notify.js';
import { SpaceHub } from './hub.js';
import { legacyToTokens } from './mentions-backfill.js';
import { merge3 } from './merge.js';
import { dispositionFor, imageDimensions, resolveMime } from './mime.js';
import { parseSearchQuery } from './search.js';
import { type PushLevel,
  DIRECT_SPACE_NAME,
  directKeyFor,
  type AssetRecord,
  type AssetVersionData,
  type Store,
  type StoredEvent,
  type StoredPollVote,
  type StoredReaction,
} from './store.js';

// The one service core (spec §9: one core, two faces). REST (http.ts) and MCP
// (mcp.ts) are thin projections over this class; neither has a privileged path.

export interface ActorCtx {
  memberId: string;
}

/** What bindInvite needs from an authenticated identity (auth.ts AuthIdentity satisfies this). */
export interface BindIdentity {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
}

function seedDisplayName(identity: BindIdentity): string {
  const name = identity.name?.trim();
  if (name) return name.slice(0, 128);
  const local = identity.email?.split('@')[0];
  if (local) return local.slice(0, 128);
  return identity.sub.slice(0, 24);
}

type NewMessage = z.infer<Routes['postMessage']['request']>;
type RenameSpaceInput = z.infer<Routes['renameSpace']['request']>;
type CreateTopicInput = z.infer<Routes['createTopic']['request']>;
type ManageTopicAction = z.infer<Routes['manageTopic']['request']>;
type ReactInput = z.infer<Routes['reactToMessage']['request']>;
type DeleteMessageInput = z.infer<Routes['deleteMessage']['request']>;
type EditMessageInput = z.infer<Routes['editMessage']['request']>;
type VotePollInput = z.infer<Routes['votePoll']['request']>;
type EndPollInput = z.infer<Routes['endPoll']['request']>;
type MarkReadInput = z.infer<Routes['markRead']['request']>;
type UnreadSnapshot = z.infer<Routes['unread']['response']>;

/** Poll duration when the create request names none — Discord's default. */
const DEFAULT_POLL_HOURS = 24;

/** The stamped addresses as they ride a Message (core.ts). */
function stampFields(stamps: MentionStamps): Pick<Message, 'mentions' | 'mentionsHere' | 'mentionsRowboat'> {
  return { mentions: [...stamps.members], mentionsHere: stamps.here, mentionsRowboat: stamps.rowboat };
}

function stampsOf(message: Message): MentionStamps {
  return { members: message.mentions, here: message.mentionsHere, rowboat: message.mentionsRowboat };
}

export interface OrgInfo {
  name: string;
  /** host[:port] — the org address links are minted on. Set once the listener knows its port. */
  address: string;
  /**
   * Org policy, v1 (spec §4, amended 2026-08-19): restrict membership to
   * these IdP-verified email domains, checked ONLY at invite bind. Empty or
   * absent = no restriction. Org-side by design — never on the wire.
   */
  allowedEmailDomains?: string[];
}

const RECENT_HISTORY = 10;
const DEFAULT_ACTIVITY_PAGE = 30;

// The activity cursor: the last item's instant and id, joined on a character
// neither contains (ISO instants and item ids are both `~`-free).
function encodeActivityCursor(row: { at: string; id: string }): string {
  return `${row.at}~${row.id}`;
}
function decodeActivityCursor(cursor: string): { at: string; id: string } {
  const i = cursor.indexOf('~');
  if (i <= 0 || i === cursor.length - 1) throw new HarborError('invalid_request', 'malformed activity cursor');
  return { at: cursor.slice(0, i), id: cursor.slice(i + 1) };
}
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
    /** Absent = uploads unconfigured on this org (routes refuse loudly, everything else works). */
    private readonly blobs?: BlobStore,
    /** Absent = no notifications on this org (notify.ts: frames + push). */
    private readonly notifier?: Notifier,
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

  /**
   * THE access gate: a membership row, nothing else. Direct spaces pass
   * through it unchanged — their two participants are ordinary members. If
   * this ever grows a non-membership path (open spaces: browse/self-join for
   * any org member), that path MUST require `space.kind === 'shared'`; a DM
   * is private forever (SpaceKind, core.ts).
   */
  async requireMember(ctx: ActorCtx, spaceId: string): Promise<Space> {
    const space = await this.requireSpace(spaceId);
    const membership = await this.store.getMembership(spaceId, ctx.memberId);
    if (!membership) throw new HarborError('forbidden', 'you are not a member of this space');
    return space;
  }

  // --- mentions (protocol mentions.ts, 2026-09-10) -----------------------------
  // The org stamps who a message addresses from its mention TOKENS alone —
  // never from names — and only ids that are members of the space. Every
  // consumer (unread, Activity, push, chips) reads the stamp.

  private async stampsFor(spaceId: string, body: string): Promise<MentionStamps> {
    const parsed = parseMentions(body);
    const members: string[] = [];
    for (const id of parsed.members) {
      if (await this.store.getMembership(spaceId, id)) members.push(id);
    }
    return { members, here: parsed.here, rowboat: parsed.rowboat };
  }

  /** A mention follows you into the thread (the org's rule; @here follows nobody). */
  private async followMentioned(spaceId: string, rootMessageId: string, stamps: MentionStamps, authorId: string, at: string): Promise<void> {
    for (const id of stamps.members) {
      if (id === authorId) continue;
      await this.store.setThreadFollowing(spaceId, rootMessageId, id, true, at);
    }
  }

  /**
   * Publish after commit (2026-09-11). Inside the space lock — which on
   * Postgres IS the transaction — a frame must not reach the hub yet: a
   * subscriber arriving in that window would miss the event live (nobody
   * was listening) AND on replay (its catch-up read cannot see the
   * uncommitted row), and a rollback would leave phantoms on every socket.
   * So `append` parks frames in the lock's outbox and `locked` flushes them
   * once the lock — and the commit — has returned. Outside a lock the
   * outbox is empty and frames go straight out.
   */
  private readonly outbox = new AsyncLocalStorage<Array<{ spaceId: string; frame: ServerFrame }>>();

  /** The space lock, with the hub held back until the commit is durable; a thrown lock publishes nothing. */
  private async locked<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    const pending: Array<{ spaceId: string; frame: ServerFrame }> = [];
    const result = await this.store.withSpaceLock(spaceId, () => this.outbox.run(pending, fn));
    for (const { spaceId: target, frame } of pending) this.hub.publish(target, frame);
    return result;
  }

  /** Append a durable event at `offset` (allocated by the caller inside the space lock) and fan it out after commit. */
  private async append(spaceId: string, offset: number, at: string, event: SpaceEvent): Promise<void> {
    const stored: StoredEvent = { offset, at, event };
    await this.store.appendEvent(spaceId, stored);
    const frame: ServerFrame = { kind: 'event', spaceId, offset, at, event };
    const pending = this.outbox.getStore();
    if (pending) pending.push({ spaceId, frame });
    else this.hub.publish(spaceId, frame);
  }

  // --- spaces & membership ---------------------------------------------------

  async listSpaces(ctx: ActorCtx, opts: { includeDirect?: boolean } = {}): Promise<Space[]> {
    return this.store.listSpacesFor(ctx.memberId, opts);
  }

  async createSpace(ctx: ActorCtx, name: string): Promise<Space> {
    this.guardWrite();
    const now = this.now();
    const space: Space = { id: this.ulid(), name, createdAt: now, kind: 'shared' };
    await this.store.putSpace(space);
    return this.locked(space.id, async () => {
      const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: now };
      await this.store.putMembership(membership);
      const offset = (await this.store.head(space.id)) + 1;
      await this.append(space.id, offset, now, { type: 'membership', membership, action: 'joined' });
      // The stream needs no object (annotation model): it is simply the
      // space's root messages, born empty.
      return space;
    });
  }

  /**
   * Rename a space (api.ts renameSpace): any member, Slack channel
   * semantics. Direct spaces refuse — their label derives from the
   * participants, not the stored name. Identical-name renames are an
   * idempotent no-op with no event; a real rename appends `space_renamed`
   * under the space lock so every follower updates its listing.
   */
  async renameSpace(ctx: ActorCtx, spaceId: string, input: RenameSpaceInput): Promise<Space> {
    const space = await this.requireMember(ctx, spaceId);
    if (space.kind === 'direct') {
      throw new HarborError('invalid_request', 'a direct message cannot be renamed — its name is the other person');
    }
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };
    return this.locked(spaceId, async () => {
      const current = (await this.store.getSpace(spaceId)) ?? space;
      if (current.name === input.name) return current; // idempotent, no event
      const updated: Space = { ...current, name: input.name };
      await this.store.putSpace(updated);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, this.now(), { type: 'space_renamed', space: updated, by });
      return updated;
    });
  }

  /**
   * Direct messages (api.ts openDirect): get-or-create the one DM between
   * the caller and `otherMemberId`. Membership is written for both under the
   * new space's lock — two `joined` events are the whole membership history
   * of a DM, forever (no invites, no leave). The other participant is told
   * by a member-addressed `space_added` frame: the org is the trust
   * boundary, so there is no acceptance step. Two participants opening the
   * same DM at once both pass the lookup; the store's direct-key uniqueness
   * refuses the second row and that caller re-reads the winner's space.
   *
   * Your own id opens your SELF-DM (2026-09-08): one participant, one
   * membership, one `joined` event, nobody to tell. Notes to self that live
   * on the org — every device sees them, and so does your agent, through
   * the same face as any space.
   */
  async openDirect(ctx: ActorCtx, otherMemberId: string): Promise<{ space: Space; created: boolean }> {
    const self = otherMemberId === ctx.memberId;
    if (!self) {
      const other = await this.store.getMember(otherMemberId);
      if (!other) throw new HarborError('not_found', 'no such member on this org');
    }
    const participants = self ? [ctx.memberId] : [ctx.memberId, otherMemberId].sort();
    const key = directKeyFor(participants);
    const existing = await this.store.getDirectSpace(key);
    if (existing) return { space: existing, created: false };

    this.guardWrite();
    const now = this.now();
    const space: Space = { id: this.ulid(), name: DIRECT_SPACE_NAME, createdAt: now, kind: 'direct', participants };
    try {
      await this.store.putSpace(space);
    } catch (err) {
      const raced = await this.store.getDirectSpace(key);
      if (raced) return { space: raced, created: false };
      throw err;
    }
    await this.locked(space.id, async () => {
      let offset = await this.store.head(space.id);
      for (const memberId of participants) {
        const membership: Membership = { spaceId: space.id, memberId, joinedAt: now };
        await this.store.putMembership(membership);
        await this.append(space.id, ++offset, now, { type: 'membership', membership, action: 'joined' });
      }
    });
    if (!self) this.hub.publishToMember(otherMemberId, {
      kind: 'space_added',
      spaceId: space.id,
      spaceKind: 'direct',
      by: ctx.memberId,
      at: now,
    });
    return { space, created: true };
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

  /**
   * The org roster as THIS member may see it (api.ts listOrgMembers,
   * 2026-09-09): the union of every roster the caller belongs to, DMs
   * included, deduped by id and sorted by display name (case-insensitive,
   * id breaks ties). Discovery is bounded by shared membership on purpose —
   * no admin directory, no privacy surface beyond what listMembers already
   * exposes per space. Always contains the caller (a member of no space at
   * all still sees themself).
   */
  async listOrgMembers(ctx: ActorCtx): Promise<Member[]> {
    const spaces = await this.store.listSpacesFor(ctx.memberId, { includeDirect: true });
    const ids = new Set<string>([ctx.memberId]);
    for (const space of spaces) {
      for (const m of await this.store.listMemberships(space.id)) ids.add(m.memberId);
    }
    const members: Member[] = [];
    for (const id of ids) {
      const member = await this.store.getMember(id);
      if (member) members.push(member);
    }
    return members.sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
    );
  }

  async leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    const space = await this.requireMember(ctx, spaceId);
    if (space.kind === 'direct') {
      throw new HarborError('invalid_request', 'a direct message has a fixed membership — it cannot be left');
    }
    await this.locked(spaceId, async () => {
      const membership = await this.store.getMembership(spaceId, ctx.memberId);
      if (!membership) return;
      await this.store.deleteMembership(spaceId, ctx.memberId);
      await this.store.deleteReadMarks(spaceId, ctx.memberId);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, this.now(), { type: 'membership', membership, action: 'left' });
    });
  }

  // --- invites ---------------------------------------------------------------

  async createInvite(ctx: ActorCtx, spaceId: string, expiresInHours?: number): Promise<CreateInviteResult> {
    const space = await this.requireMember(ctx, spaceId);
    if (space.kind === 'direct') {
      throw new HarborError('invalid_request', 'a direct message has a fixed membership — nobody can be invited');
    }
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

  /**
   * The invite-binding ceremony (spec §4, amended 2026-08-19): an
   * authenticated identity + an open bearer invite → member (created on
   * first bind, displayName seeded from IdP profile claims) + membership.
   * Every bind-time condition is org policy, checked HERE and nowhere else —
   * v1 is the email-domain rule. The (iss, sub) → member row written here is
   * what the oidc auth driver resolves on every later request.
   */
  async bindInvite(identity: BindIdentity, token: string): Promise<AcceptInviteResult> {
    const resolved = await this.resolveInvite(token);
    if (resolved.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${resolved.state}`);
    }
    this.guardWrite();
    this.checkBindPolicy(identity);
    let member = await this.store.getMemberByIdentity(identity.iss, identity.sub);
    if (!member) {
      // Minted id, NOT the raw sub: issuer subjects live only in the mapping
      // table, so an org can change AS someday without rewriting history.
      member = { id: this.ulid(), displayName: seedDisplayName(identity), role: 'member' };
      await this.store.putMember(member);
      await this.store.putIdentity(identity.iss, identity.sub, member.id);
    }
    return this.acceptInvite({ memberId: member.id }, token);
  }

  private checkBindPolicy(identity: BindIdentity): void {
    const domains = this.org.allowedEmailDomains;
    if (!domains || domains.length === 0) return;
    const domain = identity.email?.toLowerCase().split('@')[1];
    if (!domain || !domains.some((d) => d.toLowerCase() === domain)) {
      throw new HarborError(
        'policy_refused',
        `this org admits only ${domains.map((d) => `@${d}`).join(', ')} accounts`,
      );
    }
  }

  async acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    const resolved = await this.resolveInvite(token);
    if (resolved.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${resolved.state}`);
    }
    this.guardWrite();
    const spaceId = resolved.space.id;
    const space = await this.requireSpace(spaceId);
    return this.locked(spaceId, async () => {
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
  // The inode model (migration 007): paths are the product identity, the
  // internal asset id is the storage identity. Reads resolve path → asset
  // (following redirects left by moves); history is a lineage filter, never
  // a chain walk; move/delete/restore are property updates that append one
  // op change-set each. Only content edits bump versions.

  async listAssets(ctx: ActorCtx, spaceId: string, includeDeleted = false) {
    await this.requireMember(ctx, spaceId);
    const records = await this.store.listAssets(spaceId, includeDeleted);
    return records.map((a) => ({
      path: a.path,
      version: a.version,
      updatedAt: a.updatedAt,
      ...(a.blob ? { blob: a.blob } : {}),
      ...(a.state === 'deleted' ? { state: 'deleted' as const } : {}),
    }));
  }

  /** Live asset at `path`, or the live target of a redirect there (moved files keep answering to old links). */
  private async resolveAsset(spaceId: string, path: string): Promise<{ asset: AssetRecord; redirected: boolean } | undefined> {
    const live = await this.store.getLiveAssetByPath(spaceId, path);
    if (live) return { asset: live, redirected: false };
    const redirectId = await this.store.getRedirect(spaceId, path);
    if (redirectId) {
      const target = await this.store.getAssetById(spaceId, redirectId);
      if (target && target.state === 'live') return { asset: target, redirected: true };
    }
    return undefined;
  }

  private async recentHistory(spaceId: string, assetId: string, upToVersion?: number): Promise<ChangeSet[]> {
    const all = await this.store.listChangeSets(spaceId, { assetId, limit: 1_000 });
    const filtered = upToVersion === undefined ? all : all.filter((cs) => cs.resultVersion <= upToVersion);
    return filtered.slice(0, RECENT_HISTORY);
  }

  async readAsset(ctx: ActorCtx, spaceId: string, path: string, version?: number): Promise<ReadAssetResult> {
    await this.requireMember(ctx, spaceId);
    const resolved = await this.resolveAsset(spaceId, path);
    if (!resolved) {
      const dead = await this.store.getLatestDeletedByPath(spaceId, path);
      if (dead) throw new HarborError('not_found', `${path} was deleted — it can be restored from Trash`);
      throw new HarborError('not_found', 'no such asset');
    }
    const { asset } = resolved;
    const v = version ?? asset.version;
    const data = await this.store.getAssetVersion(spaceId, asset.id, v);
    if (data === undefined) throw new HarborError('not_found', `no version ${v} of ${path}`);
    return {
      // The asset's CURRENT path — differing from the requested path is the
      // redirect signal (the client re-points its selection).
      path: asset.path,
      content: data.content ?? '',
      ...(data.blob ? { blob: data.blob } : {}),
      version: v,
      recentHistory: await this.recentHistory(spaceId, asset.id, v),
    };
  }

  /** Stale-base retry bundle for namespace ops — the propose conflict, minus merge regions. */
  private async staleAsset(spaceId: string, asset: AssetRecord) {
    const data = await this.store.getAssetVersion(spaceId, asset.id, asset.version);
    return {
      outcome: 'conflict' as const,
      currentVersion: asset.version,
      currentContent: data?.content ?? '',
      ...(data?.blob ? { currentBlob: data.blob } : {}),
      recentHistory: await this.recentHistory(spaceId, asset.id),
    };
  }

  async moveAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['moveAsset']['request']>,
  ): Promise<MoveAssetResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    if (input.threadRootId && !(await this.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };
    return this.locked(spaceId, async () => {
      if (input.toPath === input.fromPath) {
        throw new HarborError('invalid_request', 'destination is the same path');
      }
      const from = await this.store.getLiveAssetByPath(spaceId, input.fromPath);
      if (!from) {
        const resolved = await this.resolveAsset(spaceId, input.fromPath);
        if (resolved) throw new HarborError('invalid_request', `this file already moved to ${resolved.asset.path}`);
        throw new HarborError('not_found', 'no such asset');
      }
      if (input.baseVersion > from.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${from.version})`);
      }
      if (input.baseVersion !== from.version) return this.staleAsset(spaceId, from);
      if (await this.store.getLiveAssetByPath(spaceId, input.toPath)) {
        throw new HarborError('invalid_request', 'a file already exists at the destination — moves never overwrite, pick another name');
      }
      const at = this.now();
      await this.store.setAssetPath(spaceId, from.id, input.toPath, at);
      // The old path forwards to the file; anything previously forwarding
      // from the destination is shadowed by the new occupant.
      await this.store.putRedirect(spaceId, input.fromPath, from.id, at);
      await this.store.deleteRedirect(spaceId, input.toPath);
      const changeSet = await this.appendOpChangeSet(spaceId, from.id, {
        assetPath: input.toPath,
        version: from.version,
        attribution,
        op: 'move',
        movedFrom: input.fromPath,
        reason: input.reason,
        threadRootId: input.threadRootId,
        at,
      });
      return { outcome: 'moved' as const, changeSet, version: from.version };
    });
  }

  async deleteAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['deleteAsset']['request']>,
  ): Promise<DeleteAssetResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    if (input.threadRootId && !(await this.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };
    return this.locked(spaceId, async () => {
      const asset = await this.store.getLiveAssetByPath(spaceId, input.path);
      if (!asset) throw new HarborError('not_found', 'no such asset');
      if (input.baseVersion > asset.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${asset.version})`);
      }
      if (input.baseVersion !== asset.version) return this.staleAsset(spaceId, asset);
      const at = this.now();
      // Freeze in place: rows keep their keys, the path frees (live-unique
      // index only binds the living). Restore is the inverse flip.
      await this.store.setAssetState(spaceId, asset.id, 'deleted', at);
      const changeSet = await this.appendOpChangeSet(spaceId, asset.id, {
        assetPath: input.path,
        version: asset.version,
        attribution,
        op: 'delete',
        reason: input.reason,
        threadRootId: input.threadRootId,
        at,
      });
      return { outcome: 'deleted' as const, changeSet };
    });
  }

  async restoreAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['restoreAsset']['request']>,
  ): Promise<RestoreAssetResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };
    return this.locked(spaceId, async () => {
      const dead = await this.store.getLatestDeletedByPath(spaceId, input.path);
      if (!dead) throw new HarborError('not_found', 'nothing deleted at this path');
      if (await this.store.getLiveAssetByPath(spaceId, input.path)) {
        throw new HarborError('invalid_request', 'a file now exists at this path — move it first, then restore');
      }
      const at = this.now();
      await this.store.deleteRedirect(spaceId, input.path);
      await this.store.setAssetState(spaceId, dead.id, 'live', at);
      const changeSet = await this.appendOpChangeSet(spaceId, dead.id, {
        assetPath: input.path,
        version: dead.version,
        attribution,
        op: 'restore',
        reason: input.reason,
        at,
      });
      return { outcome: 'restored' as const, changeSet, version: dead.version };
    });
  }

  /** Inside the space lock only: one op change-set (no version bump) + its event, as one fact. */
  private async appendOpChangeSet(
    spaceId: string,
    assetId: string,
    input: {
      assetPath: string;
      version: number;
      attribution: Attribution;
      op: 'move' | 'delete' | 'restore';
      movedFrom?: string;
      reason?: string;
      threadRootId?: string;
      at: string;
    },
  ): Promise<ChangeSet> {
    const offset = (await this.store.head(spaceId)) + 1;
    const threadRootId = input.threadRootId ?? threadRootFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.ulid(),
      spaceId,
      assetPath: input.assetPath,
      baseVersion: input.version,
      resultVersion: input.version,
      attribution: input.attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(threadRootId ? { threadRootId } : {}),
      op: input.op,
      ...(input.movedFrom ? { movedFrom: input.movedFrom } : {}),
      committedAt: input.at,
      offset,
    };
    await this.store.appendChangeSet(changeSet, assetId);
    await this.append(spaceId, offset, input.at, { type: 'change', changeSet });
    return changeSet;
  }

  // --- uploaded blobs --------------------------------------------------------

  private requireBlobStore(): BlobStore {
    if (!this.blobs) {
      throw new HarborError('internal', 'file uploads are not configured on this org');
    }
    return this.blobs;
  }

  /**
   * Phase 1 of an upload (spec §6): store the bytes, register the hash for
   * this space. Not a space fact — no event, no feed row; the reference
   * (a message's blob link, proposeChange's blob variant) is what narrates.
   */
  async uploadBlob(
    ctx: ActorCtx,
    spaceId: string,
    bytes: Uint8Array,
    opts: { declaredSha256: string; declaredMime?: string },
  ): Promise<BlobInfo> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const blobs = this.requireBlobStore();
    const hash = blobHash(bytes);
    if (opts.declaredSha256 !== hash) {
      throw new HarborError(
        'invalid_request',
        `x-blob-sha256 mismatch: body hashes to ${hash} — upload was corrupted or truncated`,
      );
    }
    const mime = resolveMime(bytes, opts.declaredMime);
    // Sniffed images get their pixel dimensions parsed from the header bytes —
    // clients reserve the exact box before the image loads (no layout shift).
    const dims = imageDimensions(bytes, mime);
    await blobs.put(bytes);
    await this.store.putSpaceBlob({
      spaceId,
      hash,
      size: bytes.byteLength,
      mime,
      ...(dims ?? {}),
      uploadedBy: ctx.memberId,
      uploadedAt: this.now(),
    });
    // First registration wins (idempotent re-uploads keep the original mime).
    const stored = await this.store.getSpaceBlob(spaceId, hash);
    return {
      hash,
      size: stored?.size ?? bytes.byteLength,
      mime: stored?.mime ?? mime,
      ...(stored?.width !== undefined && stored?.height !== undefined
        ? { width: stored.width, height: stored.height }
        : dims ?? {}),
    };
  }

  /**
   * The bytes back: a presigned URL when the driver can mint one (S3-family —
   * bytes never transit Harbor), the bytes themselves otherwise (disk/memory).
   * Which one an org uses is a driver detail, invisible in the route contract.
   */
  async downloadBlob(
    ctx: ActorCtx,
    spaceId: string,
    hash: string,
    name?: string,
  ): Promise<{ blob: BlobInfo; disposition: string; url?: string; bytes?: Uint8Array }> {
    await this.requireMember(ctx, spaceId);
    const blobs = this.requireBlobStore();
    const stored = await this.store.getSpaceBlob(spaceId, hash);
    if (!stored) throw new HarborError('not_found', 'no such blob in this space');
    const blob: BlobInfo = { hash: stored.hash, size: stored.size, mime: stored.mime, ...blobDims(stored) };
    const disposition = dispositionFor(stored.mime, name);
    if (blobs.downloadUrl) {
      const url = await blobs.downloadUrl(hash, {
        expiresInSeconds: 300,
        responseContentType: stored.mime,
        responseContentDisposition: disposition,
      });
      return { blob, disposition, url };
    }
    const bytes = await blobs.get(hash);
    if (!bytes) throw new HarborError('internal', 'blob registered but bytes are missing from storage');
    return { blob, disposition, bytes };
  }

  async proposeChange(ctx: ActorCtx, spaceId: string, input: ProposeChange): Promise<ProposeChangeResult> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    if (input.threadRootId && !(await this.store.getMessage(spaceId, input.threadRootId))) {
      throw new HarborError('invalid_request', 'threadRootId does not exist in this space');
    }
    // Binary variant: the hash must be phase-1-uploaded to THIS space — a
    // version row can never point at nothing (and never at another space's
    // upload; the registry is the read gate).
    let proposal: AssetVersionData;
    if (input.blob !== undefined) {
      const stored = await this.store.getSpaceBlob(spaceId, input.blob);
      if (!stored) {
        throw new HarborError('invalid_request', 'blob is not uploaded to this space — call uploadBlob first');
      }
      proposal = { content: null, blob: { hash: stored.hash, size: stored.size, mime: stored.mime, ...blobDims(stored) } };
    } else {
      proposal = { content: input.newContent ?? '', blob: null };
    }
    const attribution: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.locked(spaceId, async () => {
      const asset = await this.store.getLiveAssetByPath(spaceId, input.assetPath);

      if (!asset) {
        if (input.baseVersion !== 0) {
          // A stale propose at a moved-away path gets told where the file went
          // instead of a bare 404 (the version it declares is meaningless here).
          const resolved = await this.resolveAsset(spaceId, input.assetPath);
          if (resolved) {
            throw new HarborError('invalid_request', `this file moved to ${resolved.asset.path} — propose there`);
          }
          throw new HarborError('not_found', 'asset does not exist; propose with baseVersion 0 to create it');
        }
        // Create. A redirect at this path is shadowed by the new occupant
        // (vacant-lot rule); a deleted asset here never blocks — it keeps its
        // own record and the newcomer starts a fresh lineage.
        await this.store.deleteRedirect(spaceId, input.assetPath);
        const id = this.ulid();
        await this.store.createAsset(spaceId, { id, path: input.assetPath, version: 1, updatedAt: this.now(), state: 'live' });
        const changeSet = await this.commit(spaceId, id, input, attribution, 1, proposal);
        return { outcome: 'applied' as const, changeSet, version: 1 };
      }

      if (input.baseVersion > asset.version) {
        throw new HarborError('invalid_request', `baseVersion ${input.baseVersion} is ahead of the asset (v${asset.version})`);
      }

      if (input.baseVersion === asset.version) {
        const version = asset.version + 1;
        const changeSet = await this.commit(spaceId, asset.id, input, attribution, version, proposal);
        return { outcome: 'applied' as const, changeSet, version };
      }

      // Stale base: three-way merge (CONTRACT.md decision 1) — but only when
      // proposal, base, and current are ALL text. Binary staleness never
      // merges (spec §6): there is nothing to three-way in a JPEG, so any
      // binary side surfaces as conflict-or-replace with empty regions.
      const base = await this.store.getAssetVersion(spaceId, asset.id, input.baseVersion);
      const current = await this.store.getAssetVersion(spaceId, asset.id, asset.version);
      if (base === undefined || current === undefined) {
        throw new HarborError('internal', 'asset version content missing');
      }

      const conflictOf = async (regions: ConflictRegion[]) => ({
        outcome: 'conflict' as const,
        currentVersion: asset.version,
        currentContent: current.content ?? '',
        ...(current.blob ? { currentBlob: current.blob } : {}),
        regions,
        recentHistory: await this.recentHistory(spaceId, asset.id),
      });

      if (proposal.blob !== null || base.blob !== null || current.blob !== null) {
        return conflictOf([]);
      }

      const result = merge3(base.content ?? '', current.content ?? '', proposal.content ?? '');

      if (result.outcome === 'conflict') {
        // Nothing written. Decision 6: everything needed to retry, one round trip.
        return conflictOf(result.regions);
      }

      // Clean merge — stored even when it lands identical content, so the
      // second standup-pusher's change-set exists, attributed, in history
      // (principle 4; fixture 06's product beat).
      const version = asset.version + 1;
      const changeSet = await this.commit(spaceId, asset.id, input, attribution, version, {
        content: result.content,
        blob: null,
      });
      return { outcome: 'merged' as const, changeSet, version, mergedContent: result.content };
    });
  }

  /** Inside the space lock only: writes the version, the change-set, and the event as one fact. */
  private async commit(
    spaceId: string,
    assetId: string,
    input: ProposeChange,
    attribution: Attribution,
    version: number,
    data: AssetVersionData,
  ): Promise<ChangeSet> {
    const at = this.now();
    const offset = (await this.store.head(spaceId)) + 1;
    // Provenance: an explicit threadRootId wins; otherwise the "· thread:<id>"
    // reason suffix that prompt-driven agents write (best effort — the suffix
    // is a claim, not validated).
    const threadRootId = input.threadRootId ?? threadRootFromReason(input.reason);
    const changeSet: ChangeSet = {
      id: this.ulid(),
      spaceId,
      assetPath: input.assetPath,
      baseVersion: input.baseVersion,
      resultVersion: version,
      attribution,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(threadRootId ? { threadRootId } : {}),
      ...(data.blob ? { blob: data.blob } : {}),
      committedAt: at,
      offset,
    };
    await this.store.putAssetVersion(spaceId, assetId, version, data, at);
    await this.store.appendChangeSet(changeSet, assetId);
    await this.append(spaceId, offset, at, { type: 'change', changeSet });
    return changeSet;
  }

  async assetHistory(
    ctx: ActorCtx,
    spaceId: string,
    opts: { path?: string; beforeOffset?: number; limit?: number },
  ): Promise<ChangeSet[]> {
    await this.requireMember(ctx, spaceId);
    // A path filter means "this file's lineage": resolve to the asset (live,
    // redirected, or most recently deleted here) and filter by its id — the
    // record stays queryable across moves and after deletion.
    let assetId: string | undefined;
    if (opts.path !== undefined) {
      const resolved = await this.resolveAsset(spaceId, opts.path);
      const asset = resolved?.asset ?? (await this.store.getLatestDeletedByPath(spaceId, opts.path));
      if (!asset) return [];
      assetId = asset.id;
    }
    return this.store.listChangeSets(spaceId, {
      ...(assetId !== undefined ? { assetId } : {}),
      ...(opts.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: opts.limit ?? 50,
    });
  }

  async diff(ctx: ActorCtx, spaceId: string, path: string, from: number, to: number): Promise<string> {
    await this.requireMember(ctx, spaceId);
    const resolved = await this.resolveAsset(spaceId, path);
    const asset = resolved?.asset ?? (await this.store.getLatestDeletedByPath(spaceId, path));
    if (!asset) throw new HarborError('not_found', 'no such asset');
    const fromData = await this.store.getAssetVersion(spaceId, asset.id, from);
    const toData = await this.store.getAssetVersion(spaceId, asset.id, to);
    if (fromData === undefined || toData === undefined) {
      throw new HarborError('not_found', 'no such version');
    }
    // Binary on either side: no text diff exists — return a readable stub in
    // the same unified-header shape so diff views degrade gracefully.
    if (fromData.blob !== null || toData.blob !== null) {
      const describe = (d: AssetVersionData) =>
        d.blob ? `(${d.blob.mime}, ${d.blob.size} bytes)` : `(text, ${(d.content ?? '').length} chars)`;
      return (
        `--- ${path}@v${from} ${describe(fromData)}\n` +
        `+++ ${path}@v${to} ${describe(toData)}\n` +
        `Binary change — no text diff.\n`
      );
    }
    return createTwoFilesPatch(
      `${path}@v${from}`,
      `${path}@v${to}`,
      fromData.content ?? '',
      toData.content ?? '',
      undefined,
      undefined,
      { context: 3 },
    );
  }

  // --- feed ------------------------------------------------------------------
  // The annotation model (spec §7, 2026-09-01): one stream of root messages,
  // flat threads behind reply chips (threadRoot, write-once), topics as
  // archivable annotation rows on threads. Posting never creates a container.

  /**
   * Live reaction and poll-vote state folded in — every read path carries
   * current truth. Both fields are at-post snapshots on the stored message
   * event; only reads are authoritative. Poll votes are fetched only when the
   * page actually carries a poll, so the common all-prose page costs nothing.
   */
  private async foldPage(spaceId: string, messages: Message[]): Promise<Message[]> {
    const byMessage = new Map<string, StoredReaction[]>();
    for (const r of await this.store.listReactionsForMessages(spaceId, messages.map((m) => m.id))) {
      byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r]);
    }
    const pollIds = messages.filter((m) => m.poll).map((m) => m.id);
    const votesByMessage = new Map<string, StoredPollVote[]>();
    if (pollIds.length > 0) {
      for (const v of await this.store.listPollVotesForMessages(spaceId, pollIds)) {
        votesByMessage.set(v.messageId, [...(votesByMessage.get(v.messageId) ?? []), v]);
      }
    }
    return messages.map((m) => ({
      ...m,
      reactions: foldReactions(byMessage.get(m.id) ?? []),
      ...(m.poll ? { poll: foldPollVotes(m.poll, votesByMessage.get(m.id) ?? []) } : {}),
    }));
  }

  private pageLimit(limit?: number): number {
    return Math.min(Math.max(limit ?? MESSAGES_PAGE_DEFAULT, 1), MESSAGES_PAGE_MAX);
  }

  /** A topic listing's activity stamp: the newest reply, else the root's post. */
  private static activityOf(root: Message | undefined, topic: Topic): string {
    return root?.lastReplyAt ?? root?.postedAt ?? topic.createdAt;
  }

  async listTopics(ctx: ActorCtx, spaceId: string, includeArchived = false): Promise<TopicListing[]> {
    await this.requireMember(ctx, spaceId);
    const topics = await this.store.listTopics(spaceId, includeArchived);
    // Every consumer needs the root message (reply chips, parent cards,
    // unread anchors) — always folded in; activity computes from its denorm.
    // Folded like any page read: a root's reactions and poll votes are the
    // rail's business too (a poll root card with zero votes would lie).
    const roots: Message[] = [];
    for (const t of topics) {
      const root = await this.store.getMessage(spaceId, t.rootMessageId);
      if (root) roots.push(root);
    }
    const folded = new Map((await this.foldPage(spaceId, roots)).map((m) => [m.id, m]));
    const listings: TopicListing[] = topics.map((t) => {
      const root = folded.get(t.rootMessageId) ?? null;
      return { ...t, rootMessage: root, lastActivityAt: HarborService.activityOf(root ?? undefined, t) };
    });
    return listings.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id));
  }

  async listStream(
    ctx: ActorCtx,
    spaceId: string,
    opts?: { beforeOffset?: number; limit?: number },
  ): Promise<{ messages: Message[]; topics: Topic[]; hasMore: boolean; readOffset: number }> {
    await this.requireMember(ctx, spaceId);
    // Newest page by default — never the full history. One extra row answers
    // hasMore without a count query.
    const limit = this.pageLimit(opts?.limit);
    const window = await this.store.listStream(spaceId, {
      ...(opts?.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: limit + 1,
    });
    const hasMore = window.length > limit;
    const roots = hasMore ? window.slice(1) : window;
    // The page's topic badges, one batched decoration.
    const topics: Topic[] = [];
    for (const m of roots) {
      const topic = await this.store.getTopicByRoot(spaceId, m.id);
      if (topic) topics.push(topic);
    }
    return {
      messages: await this.foldPage(spaceId, roots),
      topics,
      hasMore,
      readOffset: await this.store.getStreamReadMark(spaceId, ctx.memberId),
    };
  }

  /** A reply's id resolves to its root — callers always land on the thread. */
  private async resolveRoot(spaceId: string, messageId: string): Promise<Message> {
    const message = await this.store.getMessage(spaceId, messageId);
    if (!message) throw new HarborError('not_found', 'no such message');
    if (message.threadRoot === undefined) return message;
    const root = await this.store.getMessage(spaceId, message.threadRoot);
    if (!root) throw new HarborError('internal', 'reply points at a missing root');
    return root;
  }

  async listThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    opts?: { beforeOffset?: number; limit?: number },
  ): Promise<{
    root: Message;
    topic: Topic | null;
    messages: Message[];
    hasMore: boolean;
    readOffset: number | null;
    following: boolean;
  }> {
    await this.requireMember(ctx, spaceId);
    const root = await this.resolveRoot(spaceId, rootMessageId);
    const limit = this.pageLimit(opts?.limit);
    const window = await this.store.listThread(spaceId, root.id, {
      ...(opts?.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: limit + 1,
    });
    const hasMore = window.length > limit;
    const replies = hasMore ? window.slice(1) : window;
    const [foldedRoot] = await this.foldPage(spaceId, [root]);
    const mark = await this.store.getThreadReadMark(spaceId, root.id, ctx.memberId);
    return {
      root: foldedRoot!,
      topic: (await this.store.getTopicByRoot(spaceId, root.id)) ?? null,
      messages: await this.foldPage(spaceId, replies),
      hasMore,
      readOffset: mark?.following ? mark.readOffset : null,
      following: mark?.following ?? false,
    };
  }

  /** Live folded state onto one message: reactions always, poll votes when a poll rides it. */
  private async foldLive(spaceId: string, message: Message): Promise<Message> {
    const folded: Message = {
      ...message,
      reactions: foldReactions(await this.store.listReactionsByMessage(spaceId, message.id)),
    };
    if (message.poll) {
      folded.poll = foldPollVotes(message.poll, await this.store.listPollVotesByMessage(spaceId, message.id));
    }
    return folded;
  }

  async postMessage(ctx: ActorCtx, spaceId: string, input: NewMessage): Promise<{ message: Message }> {
    const space = await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const author: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    const stamps = await this.stampsFor(spaceId, input.body);
    const result = await this.locked(spaceId, async () => {
      const at = this.now();
      // The org stamps the poll from its own clock: answer ids 1..n, a
      // duration in becomes an expiry out (the Discord create asymmetry).
      const poll: Poll | undefined = input.poll
        ? {
            question: input.poll.question,
            answers: input.poll.answers.map((a, i) => ({ id: i + 1, text: a.text, ...(a.emoji ? { emoji: a.emoji } : {}) })),
            allowMultiselect: input.poll.allowMultiselect ?? false,
            expiresAt: new Date(Date.parse(at) + (input.poll.durationHours ?? DEFAULT_POLL_HOURS) * 3_600_000).toISOString(),
            votes: [],
          }
        : undefined;

      if (input.threadRoot) {
        // A reply. Normalize to the root (Slack-style: replying to a reply is
        // replying to its thread) — threads stay flat by construction.
        const root = await this.resolveRoot(spaceId, input.threadRoot);
        const offset = (await this.store.head(spaceId)) + 1;
        const message: Message = {
          id: this.ulid(),
          spaceId,
          threadRoot: root.id,
          author,
          body: input.body,
          postedAt: at,
          offset,
          replyCount: 0,
          reactions: [],
          ...(poll ? { poll } : {}),
          ...stampFields(stamps),
        };
        await this.store.appendMessage(message);
        await this.store.refreshReplyStats(spaceId, root.id);
        await this.append(spaceId, offset, at, { type: 'message', message });
        // Read state (2026-09-09), the provisional follow rules: replying
        // follows the thread, and a root's author follows it from the first
        // reply on (lazily — a reply-less root holds no row). The replier's
        // mark advances to the reply (posting reads). Direct acts only: an
        // agent's 3am reply must not read as you having seen the thread.
        if (author.actingMode === 'direct') {
          await this.store.setThreadFollowing(spaceId, root.id, ctx.memberId, true, at);
          await this.store.advanceThreadReadMark(spaceId, root.id, ctx.memberId, offset, at);
        }
        if (root.author.memberId !== ctx.memberId && !(await this.store.getThreadReadMark(spaceId, root.id, root.author.memberId))) {
          await this.store.setThreadFollowing(spaceId, root.id, root.author.memberId, true, at);
          await this.store.advanceThreadReadMark(spaceId, root.id, root.author.memberId, root.offset, at);
        }
        await this.followMentioned(spaceId, root.id, stamps, ctx.memberId, at);
        // Gmail semantics: activity returns an archived topic to the rail.
        const topic = await this.store.getTopicByRoot(spaceId, root.id);
        if (topic?.archived) {
          const revived: Topic = { ...topic, archived: false };
          await this.store.putTopic(revived);
          await this.append(spaceId, offset + 1, at, { type: 'topic', topic: revived, action: 'unarchived', by: author });
        }
        return { message };
      }

      // A new root in the stream. Never a container — createTopic is the
      // deliberate ceremony.
      if (input.anchorChangeSetId) {
        const anchor = await this.store.getChangeSet(spaceId, input.anchorChangeSetId);
        if (!anchor) throw new HarborError('invalid_request', 'anchorChangeSetId does not exist in this space');
      }
      const offset = (await this.store.head(spaceId)) + 1;
      const message: Message = {
        id: this.ulid(),
        spaceId,
        author,
        body: input.body,
        postedAt: at,
        offset,
        replyCount: 0,
        ...(input.anchorChangeSetId ? { anchorChangeSetId: input.anchorChangeSetId } : {}),
        reactions: [],
        ...(poll ? { poll } : {}),
        ...stampFields(stamps),
      };
      await this.store.appendMessage(message);
      await this.append(spaceId, offset, at, { type: 'message', message });
      // Posting directly reads the stream up to your own message (read state, 2026-09-09).
      if (author.actingMode === 'direct') await this.store.advanceStreamReadMark(spaceId, ctx.memberId, offset, at);
      await this.followMentioned(spaceId, message.id, stamps, ctx.memberId, at);
      return { message };
    });
    // Notification decisions run OUTSIDE the lock and never block the reply
    // (notify.ts: the `notify` frame to every connection, push to phones);
    // the notifier logs its own failures.
    if (this.notifier) void this.notifier.onMessage(space, result.message);
    return result;
  }

  // --- push (PUSH_PLAN.md) ---------------------------------------------------

  /** A member's device registers its token + the member's level. Idempotent. */
  async registerPush(ctx: ActorCtx, input: { token: string; level: PushLevel }): Promise<{ ok: true }> {
    await this.store.putPushToken(ctx.memberId, input.token, this.now());
    await this.store.setPushLevel(ctx.memberId, input.level);
    return { ok: true };
  }

  /** Sign-out: forget one device. The member's level stays. */
  async unregisterPush(_ctx: ActorCtx, input: { token: string }): Promise<{ ok: true }> {
    await this.store.deletePushToken(input.token);
    return { ok: true };
  }

  /**
   * The deliberate ceremony (spec §7): annotate a thread with a stated goal.
   * Promote (rootMessageId) inserts one row and cannot touch a message; from
   * scratch (body) posts the root first — nothing is born outside the stream.
   */
  async createTopic(
    ctx: ActorCtx,
    spaceId: string,
    input: CreateTopicInput,
  ): Promise<{ topic: Topic; rootMessage: Message }> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.locked(spaceId, async () => {
      const at = this.now();

      let root: Message;
      let offset = (await this.store.head(spaceId)) + 1;
      if (input.rootMessageId) {
        const message = await this.store.getMessage(spaceId, input.rootMessageId);
        if (!message) throw new HarborError('not_found', 'no such message');
        if (message.threadRoot !== undefined) {
          throw new HarborError('invalid_request', `this is a reply — promote the thread's root (${message.threadRoot})`);
        }
        const claimed = await this.store.getTopicByRoot(spaceId, message.id);
        if (claimed) {
          throw new HarborError('invalid_request', `this thread already has a topic (${claimed.id})`);
        }
        root = message;
      } else {
        const stamps = await this.stampsFor(spaceId, input.body!);
        root = {
          id: this.ulid(),
          spaceId,
          author: by,
          body: input.body!,
          postedAt: at,
          offset,
          replyCount: 0,
          reactions: [],
          ...stampFields(stamps),
        };
        await this.store.appendMessage(root);
        await this.append(spaceId, offset, at, { type: 'message', message: root });
        if (by.actingMode === 'direct') await this.store.advanceStreamReadMark(spaceId, ctx.memberId, root.offset, at);
        await this.followMentioned(spaceId, root.id, stamps, ctx.memberId, at);
        offset += 1;
      }

      const topic: Topic = {
        id: this.ulid(),
        spaceId,
        rootMessageId: root.id,
        title: input.title,
        createdBy: by,
        createdAt: at,
        archived: false,
      };
      await this.store.putTopic(topic);
      await this.append(spaceId, offset, at, { type: 'topic', topic, action: 'created', by });
      return { topic, rootMessage: root };
    });
  }

  /**
   * The edit itself: row + stored event rewritten (the sanctioned in-place
   * rewrite), stamps re-derived, one message_edited event. Shared by
   * editMessage and the mentions backfill, which edits AS the author. The
   * caller holds the space lock.
   */
  private async applyEdit(
    spaceId: string,
    message: Message,
    body: string,
    stamps: MentionStamps,
    by: Attribution,
    at: string,
  ): Promise<Message> {
    await this.store.markMessageEdited(spaceId, message.id, body, at, stamps);
    const offset = (await this.store.head(spaceId)) + 1;
    await this.append(spaceId, offset, at, {
      type: 'message_edited',
      edit: {
        spaceId,
        messageId: message.id,
        ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}),
        body,
        by,
        at,
        ...stampFields(stamps),
      },
    });
    return { ...message, body, editedAt: at, ...stampFields(stamps) };
  }

  /**
   * The mentions backfill (2026-09-10, a dogfood decision): the pre-token
   * spelling — "@<memberId>", bare "@here" / "@rowboat" — becomes mention
   * tokens through the ORDINARY edit path, attributed to the author, so the
   * log shows an edit by them and the "(edited)" mark appears; titles go
   * through retitle the same way. Rows that carry tokens but stale stamps
   * are restamped in place (derived data, no event). Idempotent: a second
   * run finds nothing — and a ledger row makes it run ONCE per org, so a
   * later bare "@<id>" typed as prose is never rewritten behind the author.
   * Runs at boot, per org, before the faces serve.
   */
  async migrateMentions(opts: { force?: boolean } = {}): Promise<{ messages: number; titles: number; restamped: number }> {
    const out = { messages: 0, titles: 0, restamped: 0 };
    if (!opts.force && (await this.store.backfillDone('017-mentions'))) return out;
    const names = new Map((await this.store.listAllMembers()).map((m) => [m.id, m.displayName]));
    for (const space of await this.store.listAllSpaces()) {
      await this.locked(space.id, async () => {
        for (const m of await this.store.listMessagesBySpace(space.id)) {
          if (m.deletedAt) continue;
          // A poll's body is its immutable fallback rendering — left alone.
          const body = m.poll ? m.body : legacyToTokens(m.body, names);
          if (body !== m.body) {
            await this.applyEdit(space.id, m, body, await this.stampsFor(space.id, body), m.author, this.now());
            out.messages += 1;
            continue;
          }
          const stamps = await this.stampsFor(space.id, m.body);
          if (!stampsEqual(stamps, stampsOf(m))) {
            await this.store.restampMessage(space.id, m.id, stamps);
            out.restamped += 1;
          }
        }
        for (const t of await this.store.listTopics(space.id, true)) {
          const title = legacyToTokens(t.title, names);
          if (title === t.title) continue;
          const updated: Topic = { ...t, title };
          await this.store.putTopic(updated);
          const at = this.now();
          const offset = (await this.store.head(space.id)) + 1;
          await this.append(space.id, offset, at, { type: 'topic', topic: updated, action: 'retitled', by: t.createdBy });
          out.titles += 1;
        }
      });
    }
    await this.store.markBackfillDone('017-mentions', this.now());
    if (out.messages || out.titles || out.restamped) {
      console.log(`[harbor] mentions backfill: ${out.messages} messages rewritten, ${out.titles} titles, ${out.restamped} restamped`);
    }
    return out;
  }

  /**
   * Author-only tombstone (spec §4: the content plane is role-flat, so
   * deleter == author — admins moderate membership, never content). The body
   * is redacted everywhere it lives, message row and stored message event
   * alike, and a message_deleted event narrates; the row itself stays so
   * threads anchored to the message keep their parent. Re-deleting is an
   * idempotent 200 no-op with no event, like reaction toggles.
   */
  async deleteMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: DeleteMessageInput,
  ): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.locked(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      if (message.author.memberId !== ctx.memberId) {
        throw new HarborError('forbidden', 'only the author can delete a message');
      }
      if (message.deletedAt) return this.foldLive(spaceId, message);

      const at = this.now();
      await this.store.markMessageDeleted(spaceId, messageId, at);
      // The tombstone stays a row (threads anchored under it survive) but a
      // deleted reply stops counting toward its root's chip. lastReplyAt is
      // deliberately untouched — deleting must not resurface or reorder.
      if (message.threadRoot !== undefined) {
        await this.store.refreshReplyStats(spaceId, message.threadRoot);
      }
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, at, {
        type: 'message_deleted',
        deletion: {
          spaceId,
          messageId,
          ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}),
          by,
          at,
        },
      });
      // A poll is content: redacted with the body (the store already dropped it). A tombstone addresses nobody.
      const { poll: _poll, ...rest } = message;
      return this.foldLive(spaceId, { ...rest, body: '', deletedAt: at, mentions: [], mentionsHere: false, mentionsRowboat: false });
    });
  }

  /**
   * Author-only body rewrite (spec §4 posture shared with deletion: the
   * content plane is role-flat, so editor == author). The body is replaced
   * everywhere it lives — message row and stored message event — and a
   * message_edited event narrates. Tombstones refuse; an identical body is
   * an idempotent 200 no-op with no event. Activity is not bumped.
   */
  async editMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: EditMessageInput,
  ): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    const stamps = await this.stampsFor(spaceId, input.body);
    return this.locked(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      if (message.author.memberId !== ctx.memberId) {
        throw new HarborError('forbidden', 'only the author can edit a message');
      }
      if (message.deletedAt) throw new HarborError('invalid_request', 'cannot edit a deleted message');
      // The Discord posture: a poll message is immutable once posted — its
      // body is the poll's fallback rendering, and votes were cast on it.
      if (message.poll) throw new HarborError('invalid_request', 'poll messages cannot be edited');
      if (message.body === input.body) return this.foldLive(spaceId, message);

      const at = this.now();
      const edited = await this.applyEdit(spaceId, message, input.body, stamps, by, at);
      // A newly mentioned member follows the thread from the edit on.
      await this.followMentioned(spaceId, message.threadRoot ?? message.id, stamps, ctx.memberId, at);
      return this.foldLive(spaceId, edited);
    });
  }

  /**
   * Toggle a reaction (Slack semantics): any member, any message in the
   * space, one per (member, emoji). Re-adding what exists / removing what
   * doesn't is an idempotent no-op — no write, no event. Returns the message
   * with reactions folded so the caller can render without the live frame.
   */
  async reactToMessage(ctx: ActorCtx, spaceId: string, messageId: string, input: ReactInput): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.locked(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      if (message.deletedAt && input.action === 'add') {
        // Removes stay legal so people can clean up reactions left on a tombstone.
        throw new HarborError('invalid_request', 'cannot react to a deleted message');
      }
      const existing = await this.store.getReaction(spaceId, messageId, input.emoji, ctx.memberId);
      const at = this.now();

      const reaction = {
        spaceId,
        messageId,
        ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}),
        emoji: input.emoji,
        by,
        at,
      };
      if (input.action === 'add' && !existing) {
        await this.store.putReaction({ spaceId, messageId, emoji: input.emoji, by, at });
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, { type: 'reaction', reaction, action: 'added' });
      } else if (input.action === 'remove' && existing) {
        await this.store.deleteReaction(spaceId, messageId, input.emoji, ctx.memberId);
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, { type: 'reaction', reaction, action: 'removed' });
      }

      return this.foldLive(spaceId, message);
    });
  }

  /**
   * Toggle a vote on a poll answer — reaction semantics (per-(member, answer),
   * idempotent no-ops), plus the single-select rule: adding while another
   * answer holds this member's vote MOVES it (remove-then-add, two events,
   * one lock). Closed polls and tombstones refuse. Any acting mode may vote
   * (parity, 2026-09-09): a vote cast by a member's agent IS that member's
   * vote — attribution records how it happened, never who else.
   */
  async votePoll(ctx: ActorCtx, spaceId: string, messageId: string, input: VotePollInput): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.locked(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      const poll = message.poll;
      if (!poll || message.deletedAt) throw new HarborError('invalid_request', 'no poll on this message');
      const at = this.now();
      // Lazy expiry: both close states end voting; ISO-8601 UTC compares lexically.
      if (poll.endedAt || poll.expiresAt <= at) throw new HarborError('invalid_request', 'the poll has ended');
      if (!poll.answers.some((a) => a.id === input.answerId)) {
        throw new HarborError('invalid_request', 'no such answer');
      }
      const existing = await this.store.getPollVote(spaceId, messageId, input.answerId, ctx.memberId);

      if (input.action === 'add' && !existing) {
        if (!poll.allowMultiselect) {
          const mine = (await this.store.listPollVotesByMessage(spaceId, messageId)).filter(
            (v) => v.by.memberId === ctx.memberId,
          );
          for (const v of mine) {
            await this.store.deletePollVote(spaceId, messageId, v.answerId, ctx.memberId);
            const offset = (await this.store.head(spaceId)) + 1;
            await this.append(spaceId, offset, at, {
              type: 'poll_vote',
              vote: { spaceId, ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}), messageId, answerId: v.answerId, by, at },
              action: 'removed',
            });
          }
        }
        await this.store.putPollVote({ spaceId, messageId, answerId: input.answerId, by, at });
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, {
          type: 'poll_vote',
          vote: { spaceId, ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}), messageId, answerId: input.answerId, by, at },
          action: 'added',
        });
      } else if (input.action === 'remove' && existing) {
        await this.store.deletePollVote(spaceId, messageId, input.answerId, ctx.memberId);
        const offset = (await this.store.head(spaceId)) + 1;
        await this.append(spaceId, offset, at, {
          type: 'poll_vote',
          vote: { spaceId, ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}), messageId, answerId: input.answerId, by, at },
          action: 'removed',
        });
      }

      return this.foldLive(spaceId, message);
    });
  }

  /**
   * End a poll early — author-only, deletion's posture (any acting mode:
   * the author's agent counts as the author). Ending an already-
   * closed poll (early-ended or naturally expired) is an idempotent no-op
   * with no event; natural expiry itself never calls this.
   */
  async endPoll(ctx: ActorCtx, spaceId: string, messageId: string, input: EndPollInput): Promise<Message> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    // Same line as voting (parity, 2026-09-09): the author's agent counts as
    // the author — the author-only check below is on memberId, not mode.
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: input.actingMode,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    };

    return this.locked(spaceId, async () => {
      const message = await this.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      const poll = message.poll;
      if (!poll || message.deletedAt) throw new HarborError('invalid_request', 'no poll on this message');
      if (message.author.memberId !== ctx.memberId) {
        throw new HarborError('forbidden', 'only the poll author can end it');
      }
      const at = this.now();
      if (poll.endedAt || poll.expiresAt <= at) return this.foldLive(spaceId, message);

      await this.store.markPollEnded(spaceId, messageId, at);
      const offset = (await this.store.head(spaceId)) + 1;
      await this.append(spaceId, offset, at, {
        type: 'poll_ended',
        end: { spaceId, ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}), messageId, by, at },
      });
      return this.foldLive(spaceId, { ...message, poll: { ...poll, endedAt: at } });
    });
  }

  /**
   * One-row lifecycle ops on the annotation — none can touch a message.
   * Retitle/archive/unarchive update the row; remove deletes it ("convert
   * back to thread") and the conversation never knew. Every act narrates on
   * the log with its actor, so threads can render attributed lifecycle lines.
   */
  async manageTopic(ctx: ActorCtx, spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    await this.requireMember(ctx, spaceId);
    this.guardWrite();
    const by: Attribution = {
      memberId: ctx.memberId,
      actingMode: action.actingMode,
      ...(action.agentName ? { agentName: action.agentName } : {}),
    };

    return this.locked(spaceId, async () => {
      const topic = await this.store.getTopic(spaceId, topicId);
      if (!topic) throw new HarborError('not_found', 'no such topic');
      const at = this.now();

      switch (action.action) {
        case 'retitle': {
          if (topic.title === action.title) return topic; // idempotent, no event
          const updated: Topic = { ...topic, title: action.title };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated, action: 'retitled', by });
          return updated;
        }
        case 'archive':
        case 'unarchive': {
          const archived = action.action === 'archive';
          if (topic.archived === archived) return topic; // idempotent, no event
          const updated: Topic = { ...topic, archived };
          await this.store.putTopic(updated);
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic', topic: updated, action: action.action === 'archive' ? 'archived' : 'unarchived', by });
          return updated;
        }
        case 'remove': {
          await this.store.deleteTopic(spaceId, topicId);
          const removal: TopicRemoval = { spaceId, topicId, rootMessageId: topic.rootMessageId, by, at };
          const offset = (await this.store.head(spaceId)) + 1;
          await this.append(spaceId, offset, at, { type: 'topic_removed', removal });
          return topic;
        }
      }
    });
  }

  /**
   * Space search (protocol search.ts): three categorized top-N lists over one
   * pair of GIN-backed store calls per kind. Member names are resolved here —
   * not in the store — so mention expansion (search.ts) always sees the
   * CURRENT roster: renames are correct on the very next query. Structure
   * (which thread a hit lives in, which topic annotates it) is joined at
   * query time, never copied into any index.
   */
  async search(
    ctx: ActorCtx,
    spaceId: string,
    rawQuery: string,
    opts?: { kinds?: SearchKind[]; limit?: number },
  ): Promise<SearchResults> {
    await this.requireMember(ctx, spaceId);
    const limit = Math.min(opts?.limit ?? 10, 50);
    const kinds = new Set<SearchKind>(opts?.kinds ?? ['messages', 'topics', 'assets']);

    const memberships = await this.store.listMemberships(spaceId);
    const members: Member[] = [];
    for (const m of memberships) {
      const member = await this.store.getMember(m.memberId);
      if (member) members.push(member);
    }
    const query = parseSearchQuery(rawQuery, members);

    const empty: SearchResults = {
      messages: [],
      topics: [],
      assets: [],
      truncated: { messages: false, topics: false, assets: false },
    };
    if (query.terms.length === 0) return empty;
    const results = empty;

    if (kinds.has('messages')) {
      // limit+1 detects truncation without a count query.
      const rows = await this.store.searchMessages(spaceId, query, limit + 1);
      results.truncated.messages = rows.length > limit;
      const titleByRoot = new Map<string, string>();
      for (const { message, snippet } of rows.slice(0, limit)) {
        const rootId = message.threadRoot ?? message.id;
        if (!titleByRoot.has(rootId)) {
          const topic = await this.store.getTopicByRoot(spaceId, rootId);
          if (topic) titleByRoot.set(rootId, topic.title);
        }
        const topicTitle = titleByRoot.get(rootId);
        results.messages.push({
          messageId: message.id,
          threadRootId: rootId,
          ...(topicTitle !== undefined ? { topicTitle } : {}),
          author: message.author,
          snippet,
          postedAt: message.postedAt,
          offset: message.offset,
        });
      }
    }
    if (kinds.has('topics')) {
      const rows = await this.store.searchTopics(spaceId, query, limit + 1);
      results.truncated.topics = rows.length > limit;
      results.topics = rows.slice(0, limit).map((topic) => ({ topic }));
    }
    if (kinds.has('assets')) {
      const rows = await this.store.searchAssets(spaceId, query, limit + 1);
      results.truncated.assets = rows.length > limit;
      results.assets = rows.slice(0, limit).map(({ record, snippet }) => ({
        path: record.path,
        version: record.version,
        updatedAt: record.updatedAt,
        ...(record.blob !== undefined ? { blob: record.blob } : {}),
        ...(snippet !== undefined ? { snippet } : {}),
      }));
    }
    return results;
  }

  // --- live ------------------------------------------------------------------

  // --- read state ------------------------------------------------------------
  // Per-member cursors the org owns (read state, 2026-09-09) so every device
  // agrees. Offsets, never timestamps. Never on the log: a mark is private
  // member state, not a space fact — the member's other connections learn by
  // an ephemeral read_mark frame, and a reconnecting client refetches unread().

  /** Advance the stream mark, or a followed thread's mark. Monotone; past head refuses. */
  async markRead(ctx: ActorCtx, spaceId: string, input: MarkReadInput): Promise<{ readOffset: number | null }> {
    await this.requireMember(ctx, spaceId);
    const head = await this.store.head(spaceId);
    if (input.offset > head) {
      throw new HarborError('invalid_request', `offset ${input.offset} is past the space's head (${head})`);
    }
    const at = this.now();
    let threadRootId: string | undefined;
    let readOffset: number | undefined;
    if (input.threadRootId !== undefined) {
      const root = await this.resolveRoot(spaceId, input.threadRootId);
      threadRootId = root.id;
      readOffset = await this.store.advanceThreadReadMark(spaceId, root.id, ctx.memberId, input.offset, at);
      // Not following: nothing is recorded (v1 tracks followed threads only).
      if (readOffset === undefined) return { readOffset: null };
    } else {
      readOffset = await this.store.advanceStreamReadMark(spaceId, ctx.memberId, input.offset, at);
    }
    this.hub.publishToMember(ctx.memberId, {
      kind: 'read_mark',
      spaceId,
      ...(threadRootId !== undefined ? { threadRootId } : {}),
      offset: readOffset,
      at,
    });
    return { readOffset };
  }

  /** Follow or unfollow a thread; the mark survives an unfollow. */
  async followThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    following: boolean,
  ): Promise<{ following: boolean; readOffset: number }> {
    await this.requireMember(ctx, spaceId);
    const root = await this.resolveRoot(spaceId, rootMessageId);
    const mark = await this.store.setThreadFollowing(spaceId, root.id, ctx.memberId, following, this.now());
    return { following: mark.following, readOffset: mark.readOffset };
  }

  // --- activity (2026-09-10) -------------------------------------------------
  // The member's feed is a query over facts the org already keeps (stamps,
  // follow rows, DM kind, reactions), never a second table: edits, deletes
  // and the backfill stay consistent for free, and unread is the read marks'
  // answer. Cursor = the last item's (at, id), opaque on the wire.

  async activity(
    ctx: ActorCtx,
    q: { kinds?: ActivityKind[]; spaceId?: string; unread?: boolean; cursor?: string; limit?: number },
  ): Promise<ActivityPage> {
    let spaces = await this.store.listSpacesFor(ctx.memberId, { includeDirect: true });
    if (q.spaceId !== undefined) {
      await this.requireMember(ctx, q.spaceId);
      spaces = spaces.filter((s) => s.id === q.spaceId);
    }
    const byId = new Map(spaces.map((s) => [s.id, s]));
    const limit = q.limit ?? DEFAULT_ACTIVITY_PAGE;
    const rows = await this.store.listActivity(ctx.memberId, {
      spaceIds: spaces.map((s) => s.id),
      ...(q.kinds ? { kinds: new Set(q.kinds) } : {}),
      ...(q.cursor !== undefined ? { before: decodeActivityCursor(q.cursor) } : {}),
      limit: limit + 1,
      unreadOnly: q.unread === true,
    });
    const page = rows.slice(0, limit);
    const items: ActivityItem[] = page.map((r) => {
      const space = byId.get(r.spaceId)!;
      return {
        id: r.id,
        kind: r.kind,
        spaceId: r.spaceId,
        spaceKind: space.kind,
        spaceName: space.name,
        ...(r.message.threadRoot !== undefined ? { threadRootId: r.message.threadRoot } : {}),
        message: r.message,
        actors: r.actors,
        ...(r.emoji !== undefined ? { emoji: r.emoji } : {}),
        at: r.at,
        unread: r.unread,
      };
    });
    const last = page[page.length - 1];
    // Names for everyone on the page, from the roster the caller may see —
    // actors and mention labels alike, so no client walks spaces for names.
    const wanted = new Set<string>();
    for (const item of items) {
      for (const actor of item.actors) wanted.add(actor.memberId);
      wanted.add(item.message.author.memberId);
      for (const id of item.message.mentions) wanted.add(id);
    }
    const names: Record<string, string> = {};
    if (wanted.size > 0) {
      for (const m of await this.listOrgMembers(ctx)) if (wanted.has(m.id)) names[m.id] = m.displayName;
    }
    return {
      items,
      ...(rows.length > limit && last ? { nextCursor: encodeActivityCursor(last) } : {}),
      seenAt: (await this.store.getActivitySeenAt(ctx.memberId)) ?? null,
      names,
    };
  }

  /** Reactions through `at` read as seen. Monotone. */
  async markActivitySeen(ctx: ActorCtx, at: string): Promise<{ seenAt: string }> {
    return { seenAt: await this.store.advanceActivitySeenAt(ctx.memberId, at) };
  }

  /** Every space the member is in (DMs included): cursor, unread roots, unread followed threads. */
  async unread(ctx: ActorCtx): Promise<UnreadSnapshot> {
    const spaces = await this.store.listSpacesFor(ctx.memberId, { includeDirect: true });
    const out: UnreadSnapshot['spaces'] = [];
    for (const space of spaces) {
      const head = await this.store.head(space.id);
      const readOffset = await this.store.getStreamReadMark(space.id, ctx.memberId);
      const threads = await this.store.listUnreadFollowedThreads(space.id, ctx.memberId);
      out.push({
        spaceId: space.id,
        head,
        readOffset,
        unreadRoots: await this.store.countUnreadRoots(space.id, ctx.memberId, readOffset),
        // The number on the space: mentions in unread roots plus mentions in the unread replies of followed threads.
        unreadMentions:
          (await this.store.countUnreadRootMentions(space.id, ctx.memberId, readOffset)) +
          threads.reduce((sum, t) => sum + t.unreadMentions, 0),
        threads,
      });
    }
    return { spaces: out };
  }

  async publishPresence(
    ctx: ActorCtx,
    spaceId: string,
    state: PresenceState,
    threadRootId?: string,
  ): Promise<void> {
    await this.requireMember(ctx, spaceId);
    this.hub.publish(spaceId, {
      kind: 'presence',
      spaceId,
      memberId: ctx.memberId,
      state,
      ...(threadRootId !== undefined ? { threadRootId } : {}),
      at: this.now(),
    });
  }

  /**
   * Relay one ephemeral whiteboard frame to the space's subscribers. The
   * payload stays opaque (content-blind, like presence): membership is the
   * only check, nothing is stored, nothing is replayed. Durable board state
   * arrives separately as blob snapshots via proposeChange.
   */
  async publishWhiteboard(ctx: ActorCtx, spaceId: string, boardId: string, payload: unknown): Promise<void> {
    await this.requireMember(ctx, spaceId);
    this.hub.publish(spaceId, {
      kind: 'whiteboard',
      spaceId,
      boardId,
      memberId: ctx.memberId,
      at: this.now(),
      payload,
    });
  }

  async eventsAfter(spaceId: string, afterOffset: number): Promise<StoredEvent[]> {
    return this.store.listEventsAfter(spaceId, afterOffset);
  }

  async headOffset(spaceId: string): Promise<number> {
    return this.store.head(spaceId);
  }
}

/** Stored rows (oldest first) → groups in ANSWER order (a poll's order is fixed); voteless answers are omitted. */
function foldPollVotes(poll: Poll, votes: StoredPollVote[]): Poll {
  const groups = new Map<number, string[]>();
  for (const v of votes) {
    const members = groups.get(v.answerId) ?? [];
    if (!members.includes(v.by.memberId)) members.push(v.by.memberId);
    groups.set(v.answerId, members);
  }
  return {
    ...poll,
    votes: poll.answers
      .filter((a) => groups.has(a.id))
      .map((a) => ({ answerId: a.id, memberIds: groups.get(a.id)! })),
  };
}

/** Stored rows (oldest first) → display groups: emojis in first-reacted order, members likewise. */
function foldReactions(reactions: StoredReaction[]): ReactionGroup[] {
  const groups = new Map<string, string[]>();
  for (const r of reactions) {
    const members = groups.get(r.emoji) ?? [];
    if (!members.includes(r.by.memberId)) members.push(r.by.memberId);
    groups.set(r.emoji, members);
  }
  return [...groups.entries()].map(([emoji, memberIds]) => ({ emoji, memberIds }));
}

export type { ActingMode };
