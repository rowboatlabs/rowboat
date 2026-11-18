import {
  OWNER_ONLY_CONNECTIONS,
  inviteUrl,
  Member,
  type Attribution,
  type AcceptInviteResult,
  type CreateInviteResult,
  type Membership,
  type PresenceState,
  type ResolveInviteResult,
  type Routes,
  type Space,
  type SpaceMember,
  type UpdateProfile,
} from '@rowboat/spaces-protocol';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { BlobStore } from '../blobs.js';
import { HarborError } from '../errors.js';
import { canArchiveSpace, canDeleteSpace, canChangeMembership, canEditProfile, canAddToSpace, canListOnInvite, canMessageAgent, canOpenDirect, canReachMember, canRemoveFromSpace, canSetAgentAccess, canRenameSpace, canSetRole, canSignIn, canWriteSpace, enforce } from '../policy.js';
import { DIRECT_SPACE_NAME, directKeyFor, type PushLevel, type StoredEvent, type StoredInvite } from '../store.js';
import { Kernel, type ActorCtx, type BindIdentity } from './kernel.js';

// Spaces and membership: the server's containers and who is in them — spaces and
// direct messages, invites and the bind ceremony, the roster and its agent
// members, push registration, and the membership-gated live relays (presence,
// whiteboard, the subscribe-time replay).

function seedDisplayName(identity: BindIdentity): string {
  const name = identity.name?.trim();
  if (name) return name.slice(0, 128);
  const local = identity.email?.split('@')[0];
  if (local) return local.slice(0, 128);
  return identity.sub.slice(0, 24);
}

/** A profile field is one line: rosters and mentions have no room for a newline. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export type RenameSpaceInput = z.infer<Routes['renameSpace']['request']>;
export type AddMembersInput = z.infer<Routes['addMembers']['request']>;
export type ArchiveSpaceInput = z.infer<Routes['archiveSpace']['request']>;
export type RemoveMemberInput = z.infer<Routes['removeMember']['request']>;
export type SetSpaceRoleInput = z.infer<Routes['setSpaceRole']['request']>;
export type SetAgentAccessInput = z.infer<Routes['setAgentAccess']['request']>;
export type CreateInviteInput = z.infer<Routes['createInvite']['request']>;

const DEFAULT_INVITE_HOURS = 24 * 7;

export class Spaces {
  constructor(
    private readonly k: Kernel,
    /** The server's blob bytes: deleting a space removes the ones nothing else uses. Absent = uploads unconfigured. */
    private readonly blobs?: BlobStore,
  ) {}

  // --- identity --------------------------------------------------------------

  /** The caller's own row — what /v1/me and whoami serve. */
  async me(ctx: ActorCtx): Promise<Member> {
    const member = await this.k.store.getMember(ctx.memberId);
    if (!member) throw new HarborError('not_found', 'member not found');
    return member;
  }

  /**
   * Your own name and title (spec §4 Member profile; built 2026-10-19). An
   * server fact, not a space's: the profile_updated frame refreshes connected clients
   * after persistence (2026-10-22). Rosters and `me` recover missed updates. Attribution keys on the id, so a
   * rename never touches history.
   */
  async updateProfile(ctx: ActorCtx, input: UpdateProfile): Promise<Member> {
    const member = await this.me(ctx);
    enforce(canEditProfile(member));
    const updated: Member = { ...member };
    if (input.displayName !== undefined) {
      const displayName = oneLine(input.displayName);
      if (!displayName) throw new HarborError('invalid_request', 'a display name needs at least one character');
      updated.displayName = displayName;
    }
    if (input.title !== undefined) {
      const title = oneLine(input.title);
      if (title) updated.title = title;
      else delete updated.title;
    }
    if (updated.displayName === member.displayName && updated.title === member.title && (!input.availability || Object.entries(input.availability).every(([key, value]) => JSON.stringify(member.availability?.[key as keyof typeof input.availability]) === JSON.stringify(value)))) return member; // idempotent no-op: no write
    this.k.guardWrite();
    if (updated.displayName !== member.displayName || updated.title !== member.title) await this.k.store.putMember(updated);
    if (input.availability) await this.k.store.patchAvailability(member.id, input.availability);
    const saved = await this.me(ctx);
    await this.k.publishProfile(saved);
    return saved;
  }

  /**
   * An agent member (spec §4 Agent members, 2026-09-29): a minted id, a
   * display name, never admin, and no identity binding, so no one signs in as
   * it. It joins spaces through ordinary membership. No route creates one on
   * its own: the integration that owns the agent calls this and gates who may.
   * The first is the Replicas coding agent (PR #1130).
   */
  async createAgent(input: { displayName: string; ownerId?: string; agentKind?: string; agentConnection?: string; agentInstance?: string }): Promise<Member> {
    const displayName = input.displayName.trim();
    if (!Member.shape.displayName.safeParse(displayName).success) {
      throw new HarborError('invalid_request', 'an agent needs a display name of 1 to 128 characters');
    }
    this.k.guardWrite();
    // A member-added agent names its person (core/agents.ts); its kind and
    // connection default to custom/contract (spec §4 Agent members, 2026-09-30).
    const member: Member = {
      id: this.k.ulid(),
      displayName,
      kind: 'agent',
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      agentKind: input.agentKind ?? 'custom',
      agentConnection: input.agentConnection ?? 'contract',
      ...(input.agentInstance ? { agentInstance: input.agentInstance } : {}),
    };
    await this.k.store.putMember(member);
    return member;
  }

  // --- spaces & membership ---------------------------------------------------

  async listSpaces(ctx: ActorCtx, opts: { includeDirect?: boolean } = {}): Promise<Space[]> {
    return this.k.store.listSpacesFor(ctx.memberId, opts);
  }

  /** A new shared space: its creator is its first member and its admin (spec §4 Roles, 2026-11-09). */
  async createSpace(ctx: ActorCtx, name: string): Promise<Space> {
    this.k.guardWrite();
    const now = this.k.now();
    const space: Space = { id: this.k.ulid(), name, createdAt: now, kind: 'shared', archived: false, graph: false };
    await this.k.store.putSpace(space);
    return this.k.locked(space.id, async () => {
      const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: now, role: 'admin' };
      await this.k.store.putMembership(membership);
      await this.k.appendNext(space.id, now, { type: 'membership', membership, action: 'joined' });
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
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canRenameSpace(space));
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const current = (await this.k.store.getSpace(spaceId)) ?? space;
      if (current.name === input.name) return current; // idempotent, no event
      const updated: Space = { ...current, name: input.name };
      await this.k.store.putSpace(updated);
      await this.k.appendNext(spaceId, this.k.now(), { type: 'space_renamed', space: updated, by });
      return updated;
    });
  }

  /**
   * Archive a shared space (spec §6, 2026-10-13): an admin act, in the
   * renameSpace shape. The space lock then refuses every member's write
   * (kernel.ts lockedAs); reads, read marks and leaving go on. Archiving an
   * archived space is a no-op with no event.
   */
  async archiveSpace(ctx: ActorCtx, spaceId: string, input: ArchiveSpaceInput): Promise<Space> {
    return this.setArchived(ctx, spaceId, input, true);
  }

  /** Unarchive: the same act reversed; a live space is a no-op with no event. */
  async unarchiveSpace(ctx: ActorCtx, spaceId: string, input: ArchiveSpaceInput): Promise<Space> {
    return this.setArchived(ctx, spaceId, input, false);
  }

  private async setArchived(ctx: ActorCtx, spaceId: string, input: ArchiveSpaceInput, archived: boolean): Promise<Space> {
    const { space, membership } = await this.k.requireMembership(ctx, spaceId);
    enforce(canArchiveSpace(membership, space, archived ? 'archive' : 'unarchive'));
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const current = (await this.k.store.getSpace(spaceId)) ?? space;
      if (current.archived === archived) return current; // idempotent, no event
      const updated: Space = { ...current, archived };
      await this.k.store.putSpace(updated);
      await this.k.appendNext(spaceId, this.k.now(), { type: archived ? 'space_archived' : 'space_unarchived', space: updated, by });
      return updated;
    }, { archived: 'allow' });
  }

  /**
   * Delete a shared space (spec §6, the deletion doctrine; built 2026-10-14):
   * an admin act, on the same terms as archive, and allowed on an archived
   * space. One statement drops the space and, through the cascade (migration
   * 039), every row that hangs off it. No undo and no event: the log goes
   * with it.
   *
   * No write guard: over its limit a server cannot grow, but it may shrink
   * (policy.ts canWrite), as anyone may leave.
   *
   * What the delete erases is read first, inside the lock. Everything that
   * cannot be undone waits for the commit: the frames, because hub frames do
   * not ride the lock's outbox, and the blob bytes, because a rolled-back
   * delete must still find its files.
   */
  async deleteSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    const { space, membership } = await this.k.requireMembership(ctx, spaceId);
    enforce(canDeleteSpace(membership, space));
    const at = this.k.now();
    const { hashes, told } = await this.k.lockedAs(ctx, spaceId, async () => {
      // Only its members know the space, and only they are told.
      const told = await this.k.store.listSpaceMembers(spaceId);
      const hashes = await this.k.store.listSpaceBlobHashes(spaceId);
      await this.k.store.deleteSpace(spaceId);
      return { hashes, told };
    }, { archived: 'allow' });
    if (this.blobs) {
      for (const hash of await this.k.store.unreferencedBlobs(hashes)) {
        // The space is already gone: a byte delete that fails leaves garbage
        // for the blob sweep (spec §12), never a broken space, so it is
        // logged rather than failing a delete that has happened.
        await this.blobs.delete(hash).catch((err: unknown) => {
          console.warn(`[harbor] space ${spaceId} deleted; blob ${hash} not removed:`, err);
        });
      }
    }
    for (const member of told) {
      this.k.hub.publishToMember(member.id, { kind: 'space_removed', spaceId, by: ctx.memberId, at });
    }
  }

  /**
   * Direct messages (api.ts openDirect): get-or-create the one DM between
   * the caller and `otherMemberId`. Membership is written for both under the
   * new space's lock — two `joined` events are the whole membership history
   * of a DM, forever (no invites, no leave). The other participant is told
   * by a member-addressed `space_added` frame: the server is the trust
   * boundary, so there is no acceptance step. Two participants opening the
   * same DM at once both pass the lookup; the store's direct-key uniqueness
   * refuses the second row and that caller re-reads the winner's space.
   *
   * Your own id opens your SELF-DM (2026-09-08): one participant, one
   * membership, one `joined` event, nobody to tell. Notes to self that live
   * on the server — every device sees them, and so does your agent, through
   * the same face as any space.
   */
  async openDirect(ctx: ActorCtx, otherMemberId: string, opts: { byInvite?: boolean } = {}): Promise<{ space: Space; created: boolean }> {
    const self = otherMemberId === ctx.memberId;
    let ownsAgent = false;
    if (!self) {
      const other = await this.k.store.getMember(otherMemberId);
      if (!other) throw new HarborError('not_found', 'no such member');
      enforce(canReachMember(other));
      enforce(canMessageAgent(ctx.memberId, other));
      ownsAgent = other.kind === 'agent' && other.ownerId === ctx.memberId;
    }
    const participants = self ? [ctx.memberId] : [ctx.memberId, otherMemberId].sort();
    const key = directKeyFor(participants);
    const existing = await this.k.store.getDirectSpace(key);
    if (existing) return { space: existing, created: false };
    // The reach rule (policy.ts canOpenDirect, 2026-11-09); an accepted personal link is the maker's consent.
    if (!opts.byInvite) enforce(canOpenDirect(self, await this.k.store.sharesSharedSpace(ctx.memberId, otherMemberId), ownsAgent));

    this.k.guardWrite();
    const now = this.k.now();
    const space: Space = { id: this.k.ulid(), name: DIRECT_SPACE_NAME, createdAt: now, kind: 'direct', participants, archived: false, graph: false };
    try {
      await this.k.store.putSpace(space);
    } catch (err) {
      const raced = await this.k.store.getDirectSpace(key);
      if (raced) return { space: raced, created: false };
      throw err;
    }
    await this.k.locked(space.id, async () => {
      let offset = await this.k.store.head(space.id);
      for (const memberId of participants) {
        // An agent in a DM answers the one person there: its seat is owner-only (2026-11-09).
        const membership: Membership = { spaceId: space.id, memberId, joinedAt: now, role: 'member', ...(ownsAgent && memberId !== ctx.memberId ? { invocableBy: 'owner' as const } : {}) };
        await this.k.store.putMembership(membership);
        await this.k.append(space.id, ++offset, now, { type: 'membership', membership, action: 'joined' });
      }
    });
    if (!self) this.k.hub.publishToMember(otherMemberId, {
      kind: 'space_added',
      spaceId: space.id,
      spaceKind: 'direct',
      by: ctx.memberId,
      at: now,
    });
    return { space, created: true };
  }

  async listMembers(ctx: ActorCtx, spaceId: string): Promise<SpaceMember[]> {
    await this.k.requireMember(ctx, spaceId);
    return this.k.store.listSpaceMembers(spaceId);
  }

  /**
   * Your contacts (spec §3, 2026-11-09; the server roster until then): the
   * people you share a space with now and the agents you own, sorted by name.
   * There is no list of everyone on the server — discovery happens through
   * invite links, off-platform.
   */
  async listContacts(ctx: ActorCtx): Promise<Member[]> {
    await this.k.requireActiveMember(ctx);
    return this.k.store.listContacts(ctx.memberId);
  }

  /**
   * Add existing members, people or agents, to a shared space the caller
   * is in (spec §4 Roles: any member adds to spaces they are in; 2026-09-29).
   * All or nothing: every id must be an member before anything is
   * written. Each one added gets the ordinary `joined` event with `by`, and a
   * `space_added` frame once the transaction commits. No notification in v1
   * (decided 2026-09-29): the sidebar and the stream's join line say it.
   * Anyone already in is a no-op, so a repeated call writes nothing and
   * passes a read-only server.
   */
  async addMembers(ctx: ActorCtx, spaceId: string, input: AddMembersInput): Promise<Membership[]> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canChangeMembership(space, 'add'));
    const actor = await this.me(ctx);
    const ids = [...new Set(input.memberIds)];
    const members = new Map<string, Member>();
    for (const id of ids) {
      const member = await this.k.store.getMember(id);
      if (!member) throw new HarborError('not_found', `no member ${id}`);
      enforce(canReachMember(member));
      enforce(canAddToSpace(actor, member));
      members.set(id, member);
    }
    // An agent's seat (spec §4 Agent members, 2026-11-09): as asked, default everyone; a local agent's is its owner's whatever was asked.
    const seatFor = (member: Member): Membership['invocableBy'] =>
      member.kind === 'agent' ? (OWNER_ONLY_CONNECTIONS.includes(member.agentConnection ?? '') ? 'owner' : (input.invocableBy ?? 'members')) : undefined;
    const by = this.k.attributionOf(ctx, input);
    const at = this.k.now();
    const { memberships, added } = await this.k.lockedAs(ctx, spaceId, async () => {
      for (const id of ids) enforce(canReachMember((await this.k.store.getMember(id))!));
      const existing = new Map<string, Membership>();
      for (const id of ids) {
        const m = await this.k.store.getMembership(spaceId, id);
        if (m) existing.set(id, m);
      }
      const added: Membership[] = [];
      if (existing.size < ids.length) this.k.guardWrite();
      for (const memberId of ids) {
        if (existing.has(memberId)) continue;
        const seat = seatFor(members.get(memberId)!);
        const membership: Membership = { spaceId, memberId, joinedAt: at, role: 'member', ...(seat ? { invocableBy: seat } : {}) };
        await this.k.store.putMembership(membership);
        await this.k.appendNext(spaceId, at, { type: 'membership', membership, action: 'joined', by });
        added.push(membership);
      }
      const memberships = ids.map((id) => existing.get(id) ?? added.find((m) => m.memberId === id)!);
      return { memberships, added };
    });
    for (const m of added) {
      this.k.hub.publishToMember(m.memberId, { kind: 'space_added', spaceId, spaceKind: 'shared', by: ctx.memberId, at });
    }
    return memberships;
  }

  /**
   * Remove someone from a shared space (spec §4 Roles, built 2026-10-19): an
   * admin act by a member of the space; allowed on an archived space, since
   * it shrinks it, and with no write guard for the same reason (policy.ts
   * canWrite). The `removed` event carries the admin as `by`, and the
   * removed member's connections get `space_removed`. Someone not in the
   * space is a no-op with no event.
   */
  async removeMember(ctx: ActorCtx, spaceId: string, memberId: string, input: RemoveMemberInput): Promise<{ removed: boolean }> {
    const { space, membership } = await this.k.requireMembership(ctx, spaceId);
    enforce(canRemoveFromSpace(membership, space, memberId));
    const by = this.k.attributionOf(ctx, input);
    const at = this.k.now();
    const { removed, agents } = await this.k.lockedAs(ctx, spaceId, async () => {
      const removed = await this.removeMembershipLocked(spaceId, memberId, by, at, 'removed');
      const agents = removed ? await this.removeOwnedAgentsLocked(spaceId, memberId, by, at, 'removed') : [];
      if (removed) await this.ensureAdminLocked(space, by, at);
      return { removed, agents };
    }, { archived: 'allow' });
    for (const id of removed ? [memberId, ...agents] : []) this.k.hub.publishToMember(id, { kind: 'space_removed', spaceId, by: ctx.memberId, at });
    return { removed };
  }

  /** The removal itself, inside the space lock: the row, the member's read marks, the `left` or `removed` event. */
  private async removeMembershipLocked(spaceId: string, memberId: string, by: Attribution, at: string, action: 'left' | 'removed'): Promise<boolean> {
    const membership = await this.k.store.getMembership(spaceId, memberId);
    if (!membership) return false;
    await this.k.store.deleteMembership(spaceId, memberId);
    await this.k.store.deleteReadMarks(spaceId, memberId);
    await this.k.appendNext(spaceId, at, { type: 'membership', membership, action, by });
    return true;
  }

  /**
   * Your agents leave a space when you do (spec §4 Agent members, 2026-11-09):
   * nobody should spend your money in a room you are no longer in, and the
   * one person who could change their seats has just left. One event each,
   * attributed to the act that took you out. Inside the space lock.
   */
  private async removeOwnedAgentsLocked(spaceId: string, ownerId: string, by: Attribution, at: string, action: 'left' | 'removed'): Promise<string[]> {
    const gone: string[] = [];
    for (const m of await this.k.store.listSpaceMembers(spaceId)) {
      if (m.kind === 'agent' && m.ownerId === ownerId && (await this.removeMembershipLocked(spaceId, m.id, by, at, action))) gone.push(m.id);
    }
    return gone;
  }

  async leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canChangeMembership(space, 'leave'));
    // No write guard on purpose: over its limit a server cannot grow, but anyone may leave (policy.ts canWrite).
    const at = this.k.now();
    const by: Attribution = { memberId: ctx.memberId, actingMode: 'direct' };
    const agents = await this.k.lockedAs(ctx, spaceId, async (membership) => {
      await this.k.store.deleteMembership(spaceId, ctx.memberId);
      await this.k.store.deleteReadMarks(spaceId, ctx.memberId);
      await this.k.appendNext(spaceId, at, { type: 'membership', membership, action: 'left' });
      const agents = await this.removeOwnedAgentsLocked(spaceId, ctx.memberId, by, at, 'left');
      await this.ensureAdminLocked(space, by, at);
      return agents;
    }, { archived: 'allow' }); // anyone may leave an archived space (2026-10-13)
    // Every connection the member holds ends its subscription to the space
    // (2026-09-22) — leave on the laptop, the phone stops receiving too; the
    // agents that left with them likewise.
    for (const id of [ctx.memberId, ...agents]) this.k.hub.publishToMember(id, { kind: 'space_removed', spaceId, by: ctx.memberId, at });
  }

  // --- roles on the space (spec §4 Roles, rewritten 2026-11-09) ----------------

  /**
   * Give or take the admin bit for a member of a space: an admin of the
   * space, on a person in it. The only admin cannot step down (the store
   * decides under a row lock). The same role is a no-op with no event; a
   * change appends `role_changed` with the row as it now stands.
   */
  async setSpaceRole(ctx: ActorCtx, spaceId: string, memberId: string, input: SetSpaceRoleInput): Promise<Membership> {
    const { space, membership } = await this.k.requireMembership(ctx, spaceId);
    const target = await this.k.store.getMember(memberId);
    if (!target) throw new HarborError('not_found', 'no such member');
    const targetMembership = await this.k.store.getMembership(spaceId, memberId);
    enforce(canSetRole(membership, space, target, targetMembership, input.role));
    if (targetMembership!.role === input.role) return targetMembership!; // idempotent, no event
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const current = await this.k.store.getMembership(spaceId, memberId);
      if (!current) throw new HarborError('invalid_request', `${target.displayName} is not in this space`);
      if (current.role === input.role) return current;
      if ((await this.k.store.setMembershipRole(spaceId, memberId, input.role)) === 'last_admin') {
        throw new HarborError('forbidden', 'a space keeps at least one admin — make someone else an admin first');
      }
      const updated: Membership = { ...current, role: input.role };
      await this.k.appendNext(spaceId, this.k.now(), { type: 'role_changed', membership: updated, by });
      return updated;
    }, { archived: 'allow' });
  }

  /**
   * Change an agent's seat in a space (spec §4 Agent members, 2026-11-09):
   * its owner only. The same value is a no-op with no event; a change
   * appends `agent_access_changed` with the row as it now stands. Work
   * already queued finishes; the rule applies to what is asked after.
   */
  async setAgentAccess(ctx: ActorCtx, spaceId: string, agentId: string, input: SetAgentAccessInput): Promise<Membership> {
    const { space } = await this.k.requireMembership(ctx, spaceId);
    if (space.kind === 'direct') throw new HarborError('invalid_request', 'an agent in a DM answers the one person there');
    const agent = await this.k.store.getMember(agentId);
    if (!agent) throw new HarborError('not_found', 'no such agent');
    const current = await this.k.store.getMembership(spaceId, agentId);
    enforce(canSetAgentAccess(await this.me(ctx), agent, current, input.invocableBy));
    if (current!.invocableBy === input.invocableBy) return current!; // idempotent, no event
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const row = await this.k.store.getMembership(spaceId, agentId);
      if (!row) throw new HarborError('invalid_request', `${agent.displayName} is not in this space`);
      if (row.invocableBy === input.invocableBy) return row;
      await this.k.store.setMembershipAccess(spaceId, agentId, input.invocableBy);
      const updated: Membership = { ...row, invocableBy: input.invocableBy };
      await this.k.appendNext(spaceId, this.k.now(), { type: 'agent_access_changed', membership: updated, by });
      return updated;
    }, { archived: 'allow' });
  }

  /**
   * When the last admin goes, the longest-standing active human left becomes
   * admin (spec §4 Roles, 2026-11-09): inside the space lock, after a leave or
   * a removal, with its own `role_changed` attributed to the departing act.
   * Never an agent, never on a DM; a space with no humans left has no admin
   * until one arrives.
   */
  private async ensureAdminLocked(space: Space, by: Attribution, at: string): Promise<void> {
    if (space.kind !== 'shared') return;
    const members = await this.k.store.listSpaceMembers(space.id);
    if (members.some((m) => m.role === 'admin')) return;
    const heir = members
      .filter((m) => m.kind === 'human' && m.removedAt === undefined && m.deactivatedAt === undefined)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id))[0];
    if (!heir) return;
    await this.k.store.setMembershipRole(space.id, heir.id, 'admin');
    const membership: Membership = { spaceId: space.id, memberId: heir.id, joinedAt: heir.joinedAt, role: 'admin' };
    await this.k.appendNext(space.id, at, { type: 'role_changed', membership, by });
  }

  // --- invites ---------------------------------------------------------------

  /**
   * An invite to one space, or a personal link (spec §4 Invites, rewritten
   * 2026-11-09). Anyone in a space may invite to it; an archived space takes
   * no new members. A personal link needs nothing but an active member: it is
   * how someone who shares no space with you reaches you.
   */
  async createInvite(ctx: ActorCtx, input: CreateInviteInput): Promise<CreateInviteResult> {
    await this.k.requireActiveMember(ctx);
    if ((input.spaceId !== undefined) === (input.direct === true)) {
      throw new HarborError('invalid_request', 'an invite names one space, or is a personal link (direct: true)');
    }
    if (input.spaceId !== undefined) {
      const space = await this.k.requireSpace(input.spaceId);
      enforce(canListOnInvite(space, await this.k.store.getMembership(input.spaceId, ctx.memberId)));
      enforce(canWriteSpace(space)); // an archived space takes no new members (2026-10-13)
    }
    this.k.guardWrite();
    const token = randomBytes(24).toString('base64url');
    const now = this.k.now();
    const expiresAt = new Date(Date.now() + (input.expiresInHours ?? DEFAULT_INVITE_HOURS) * 3_600_000).toISOString();
    await this.k.store.putInvite({
      token,
      ...(input.spaceId !== undefined ? { spaceId: input.spaceId } : {}),
      direct: input.direct === true,
      createdBy: ctx.memberId,
      createdAt: now,
      expiresAt,
      revoked: false,
    });
    return { token, link: inviteUrl(this.k.server.address, token), expiresAt };
  }

  /** The invite behind a token if it can still be accepted; expired and revoked are states, an unknown token is not_found. */
  private async lookupInvite(token: string): Promise<{ state: 'ok'; invite: StoredInvite } | { state: 'expired' | 'revoked' }> {
    const invite = await this.k.store.getInvite(token);
    if (!invite) throw new HarborError('not_found', 'unknown invite');
    if (invite.revoked) return { state: 'revoked' };
    if (invite.expiresAt && invite.expiresAt < this.k.now()) return { state: 'expired' };
    return { state: 'ok', invite };
  }

  /**
   * What accepting does, decided at acceptance: join the space, if it still
   * stands, is not archived, and its inviter is still in it (what they
   * offered was their own membership, 2026-10-19); or open the DM with the
   * maker, if they are still here. Nothing, otherwise.
   */
  private async inviteTarget(invite: StoredInvite): Promise<{ space: Space } | { direct: Member } | null> {
    if (invite.direct) {
      const maker = await this.k.store.getMember(invite.createdBy);
      return maker && maker.deactivatedAt === undefined && maker.removedAt === undefined ? { direct: maker } : null;
    }
    if (invite.spaceId === undefined) return null;
    const space = await this.k.store.getSpace(invite.spaceId);
    if (!space || space.archived) return null;
    if (!(await this.k.store.getMembership(space.id, invite.createdBy))) return null;
    return { space };
  }

  /** Pre-auth on purpose: the app shows what's being joined before the OAuth dance. */
  async resolveInvite(token: string): Promise<ResolveInviteResult> {
    const found = await this.lookupInvite(token);
    if (found.state !== 'ok') return { state: found.state };
    const target = await this.inviteTarget(found.invite);
    const inviter = await this.k.store.getMember(found.invite.createdBy);
    return {
      state: 'ok',
      ...(target && 'space' in target ? { space: { id: target.space.id, name: target.space.name } } : {}),
      ...(target && 'direct' in target ? { direct: { id: target.direct.id, displayName: target.direct.displayName } } : {}),
      ...(inviter ? { invitedBy: inviter.displayName } : {}),
    };
  }

  /**
   * The invite-binding ceremony (spec §4, amended 2026-08-19): an
   * authenticated identity + an open bearer invite → member (created on
   * first bind, displayName seeded from IdP profile claims) + what the
   * invite opens. There is no bind-time policy (2026-11-09: possession of
   * the link plus a sign-in is the whole claim). The (iss, sub) → member row
   * written here is what the oidc auth driver resolves on every later request.
   */
  async bindInvite(identity: BindIdentity, token: string): Promise<AcceptInviteResult> {
    const found = await this.lookupInvite(token);
    if (found.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${found.state}`);
    }
    const { member } = await this.memberForIdentity(identity);
    return this.acceptInvite({ memberId: member.id }, token);
  }

  /**
   * A signed-in account becomes a member on first contact (POST /v1/me,
   * 2026-11-09, spec §4 Joining): the cold start with no invite link. The
   * same binding an invite does, without the space.
   */
  async enroll(identity: BindIdentity): Promise<{ member: Member; created: boolean }> {
    this.k.guardWrite();
    return this.memberForIdentity(identity);
  }

  /** The member behind an identity, made on first sight; a deactivated one is refused as at sign-in. */
  private async memberForIdentity(identity: BindIdentity): Promise<{ member: Member; created: boolean }> {
    const existing = await this.k.store.getMemberByIdentity(identity.iss, identity.sub);
    if (existing) {
      enforce(canSignIn(existing));
      return { member: existing, created: false };
    }
    // Minted id, NOT the raw sub: issuer subjects live only in the mapping
    // table, so the server can change AS someday without rewriting history.
    const member: Member = { id: this.k.ulid(), displayName: seedDisplayName(identity), kind: 'human' };
    await this.k.store.putMember(member);
    await this.k.store.putIdentity(identity.iss, identity.sub, member.id);
    return { member, created: true };
  }

  /**
   * Accepting joins the space under its lock, with the same `joined` event
   * any join appends — a no-op for a member already in it, so accepting twice
   * writes nothing — or opens the DM with the maker (get-or-create; the
   * maker's own click opens nothing). The member's other connections learn
   * by `space_added`.
   */
  async acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    const found = await this.lookupInvite(token);
    if (found.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${found.state}`);
    }
    this.k.guardWrite();
    const target = await this.inviteTarget(found.invite);
    if (!target) return {};
    if ('direct' in target) {
      if (target.direct.id === ctx.memberId) return {};
      const { space } = await this.openDirect(ctx, target.direct.id, { byInvite: true });
      const membership = await this.k.store.getMembership(space.id, ctx.memberId);
      return { space, ...(membership ? { membership } : {}) };
    }
    const result = await this.k.locked(target.space.id, async () => {
      const space = await this.k.store.getSpace(target.space.id);
      if (!space) return null;
      const existing = await this.k.store.getMembership(space.id, ctx.memberId);
      if (existing) return { space, membership: existing, created: false };
      if (space.archived) return null; // an archived space takes no new members (2026-10-13)
      const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: this.k.now(), role: 'member' };
      await this.k.store.putMembership(membership);
      await this.k.appendNext(space.id, membership.joinedAt, { type: 'membership', membership, action: 'joined' });
      return { space, membership, created: true };
    });
    if (!result) return {};
    if (result.created) this.k.hub.publishToMember(ctx.memberId, {
      kind: 'space_added', spaceId: result.space.id, spaceKind: 'shared', by: found.invite.createdBy, at: result.membership.joinedAt,
    });
    return { membership: result.membership, space: result.space };
  }

  // --- push (CONTRACT.md, the push bullet) -----------------------------------

  /** A member's device registers its token + the member's level. Idempotent. */
  async registerPush(ctx: ActorCtx, input: { token: string; level: PushLevel }): Promise<{ ok: true }> {
    await this.k.store.putPushToken(ctx.memberId, input.token, this.k.now());
    await this.k.store.setPushLevel(ctx.memberId, input.level);
    return { ok: true };
  }

  /** Sign-out: forget one of YOUR devices — a token registered to someone else is untouched. The member's level stays. */
  async unregisterPush(ctx: ActorCtx, input: { token: string }): Promise<{ ok: true }> {
    await this.k.store.deleteMemberPushToken(ctx.memberId, input.token);
    return { ok: true };
  }

  /**
   * Account deletion, minimal v1 (2026-10-08, App Store 5.1.1(v)); the apex's
   * DELETE /v1/me calls it once per server. The member leaves every shared space
   * the ordinary way, then the row is marked (store.deactivateMember): the
   * name stays, so their messages keep their author (Ramnique's review,
   * 2026-10-13), and canSignIn refuses the identity from now on. DMs keep
   * their membership: a DM is named by its other participant, who keeps the
   * conversation. Idempotent.
   */
  async deactivateSelf(ctx: ActorCtx): Promise<void> {
    for (const space of await this.k.store.listSpacesFor(ctx.memberId)) await this.leaveSpace(ctx, space.id);
    await this.k.store.deactivateMember(ctx.memberId, this.k.now());
  }

  /** Managed deletion (2026-11-11): keep authorship and DM history, but retire every shared-space seat. */
  async deactivateAgent(agentId: string): Promise<void> {
    const agent = await this.k.store.getMember(agentId);
    if (!agent || agent.kind !== 'agent') return;
    const at = agent.deactivatedAt ?? this.k.now();
    const by: Attribution = { memberId: agent.ownerId ?? agent.id, actingMode: 'direct' };
    if (!agent.deactivatedAt) {
      await this.k.store.deactivateMember(agentId, at);
      await this.k.publishProfile((await this.k.store.getMember(agentId))!);
    }
    for (const key of await this.k.store.listAgentKeys([agentId])) {
      if (!key.revokedAt) await this.k.store.revokeAgentKey(key.id, at);
    }
    for (const space of await this.k.store.listSpacesFor(agentId)) {
      await this.k.locked(space.id, async () => {
        await this.removeMembershipLocked(space.id, agentId, by, at, 'removed');
      });
      this.k.hub.publishToMember(agentId, { kind: 'space_removed', spaceId: space.id, by: by.memberId, at });
    }
  }

  async publishPresence(
    ctx: ActorCtx,
    spaceId: string,
    state: PresenceState,
    threadRootId?: string,
  ): Promise<void> {
    await this.k.requireMember(ctx, spaceId);
    this.k.hub.publish(spaceId, {
      kind: 'presence',
      spaceId,
      memberId: ctx.memberId,
      state,
      ...(threadRootId !== undefined ? { threadRootId } : {}),
      at: this.k.now(),
    });
  }

  /**
   * Relay one ephemeral whiteboard frame to the space's subscribers. The
   * payload stays opaque (content-blind, like presence): membership is the
   * only check, nothing is stored, nothing is replayed. Durable board state
   * arrives separately as blob snapshots via proposeChange.
   */
  async publishWhiteboard(ctx: ActorCtx, spaceId: string, boardId: string, payload: unknown): Promise<void> {
    await this.k.requireMember(ctx, spaceId);
    this.k.hub.publish(spaceId, {
      kind: 'whiteboard',
      spaceId,
      boardId,
      memberId: ctx.memberId,
      at: this.k.now(),
      payload,
    });
  }

  /**
   * The live face's catch-up read (ws.ts subscribe): the space's head and,
   * with `afterOffset`, every durable event past it. Gated like every other
   * read of a space — the log has no ungated door.
   */
  async replay(ctx: ActorCtx, spaceId: string, afterOffset?: number): Promise<{ head: number; events: StoredEvent[] }> {
    await this.k.requireMember(ctx, spaceId);
    const head = await this.k.store.head(spaceId);
    const events = afterOffset === undefined ? [] : await this.k.store.listEventsAfter(spaceId, afterOffset);
    return { head, events };
  }
}
