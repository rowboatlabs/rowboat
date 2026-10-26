import {
  inviteUrl,
  MAX_INVITE_SPACES,
  Member,
  type Attribution,
  type AcceptInviteResult,
  type CreateInviteResult,
  type Membership,
  type OrgSettings,
  type PresenceState,
  type ResolveInviteResult,
  type Routes,
  type Space,
  type UpdateProfile,
} from '@rowboat/spaces-protocol';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { BlobStore } from '../blobs.js';
import { HarborError } from '../errors.js';
import { canArchiveSpace, canBind, canDeleteSpace, canChangeMembership, canEditProfile, canInvite, canJoinSpace, canListOnInvite, canOpenDirect, canReachMember, canRemoveFromOrg, canRemoveFromSpace, canRenameSpace, canSetDefaultSpace, canSetOrgSettings, canSetRole, canSetSpaceVisibility, canSignIn, canWriteSpace, enforce, isGroupChat } from '../policy.js';
import { DIRECT_SPACE_NAME, directKeyFor, type PushLevel, type StoredEvent, type StoredInvite } from '../store.js';
import { Kernel, type ActorCtx, type BindIdentity } from './kernel.js';

// Spaces and membership: the org's containers and who is in them — spaces and
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
export type SetSpaceVisibilityInput = z.infer<Routes['setSpaceVisibility']['request']>;
export type RemoveMemberInput = z.infer<Routes['removeMember']['request']>;
export type SetMemberRoleInput = z.infer<Routes['setMemberRole']['request']>;
export type UpdateOrgSettingsInput = z.infer<Routes['updateOrgSettings']['request']>;
export type SetDefaultSpaceInput = z.infer<Routes['setDefaultSpace']['request']>;
export type CreateInviteInput = z.infer<Routes['createInvite']['request']>;

const DEFAULT_INVITE_HOURS = 24 * 7;

export class Spaces {
  constructor(
    private readonly k: Kernel,
    /** The org's blob bytes: deleting a space removes the ones nothing else uses. Absent = uploads unconfigured. */
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
   * org fact, not a space's: no event, no lock — rosters and `me` carry it on
   * the next read, as the avatar does. Attribution keys on the id, so a
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
    if (updated.displayName === member.displayName && updated.title === member.title) return member; // idempotent no-op: no write
    this.k.guardWrite();
    await this.k.store.putMember(updated);
    return updated;
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
      role: 'member',
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

  /** Whether the org is a group chat right now (policy.ts isGroupChat): the same answer for every member. */
  async isGroupChat(): Promise<boolean> {
    return isGroupChat(await this.k.store.countSpacesByKind());
  }

  async browseSpaces(ctx: ActorCtx): Promise<Array<{ space: Space; joined: boolean }>> {
    await this.k.requireOrgMember(ctx);
    return this.k.store.browseSpaces(ctx.memberId);
  }

  async joinSpace(ctx: ActorCtx, spaceId: string): Promise<{ space: Space; membership: Membership }> {
    const result = await this.k.locked(spaceId, async () => {
      const space = await this.k.requireSpace(spaceId);
      await this.k.requireOrgMember(ctx);
      enforce(canJoinSpace(space));
      const existing = await this.k.store.getMembership(spaceId, ctx.memberId);
      if (existing) return { space, membership: existing, created: false };
      enforce(canWriteSpace(space)); // an archived space takes no new members (2026-10-13)
      this.k.guardWrite();
      const membership: Membership = { spaceId, memberId: ctx.memberId, joinedAt: this.k.now() };
      await this.k.store.putMembership(membership);
      await this.k.appendNext(spaceId, membership.joinedAt, { type: 'membership', membership, action: 'joined' });
      return { space, membership, created: true };
    });
    if (result.created) this.k.hub.publishToMember(ctx.memberId, {
      kind: 'space_added', spaceId, spaceKind: 'shared', by: ctx.memberId, at: result.membership.joinedAt,
    });
    return { space: result.space, membership: result.membership };
  }

  /**
   * `isDefault` is for provisioning only (apex.ts): the org's first space is
   * its first default (spec §5 answer 3). No route passes it — an admin sets
   * defaults with setDefaultSpace.
   */
  async createSpace(ctx: ActorCtx, name: string, visibility: Space['visibility'] = 'private', opts: { isDefault?: boolean } = {}): Promise<Space> {
    this.k.guardWrite();
    const now = this.k.now();
    const isDefault = opts.isDefault === true;
    if (isDefault && visibility !== 'open') throw new HarborError('invalid_request', 'only an open space can be a default space');
    const space: Space = { id: this.k.ulid(), name, createdAt: now, kind: 'shared', visibility, archived: false, isDefault };
    const wasGroupChat = await this.isGroupChat();
    await this.k.store.putSpace(space);
    const created = await this.k.locked(space.id, async () => {
      const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: now };
      await this.k.store.putMembership(membership);
      await this.k.appendNext(space.id, now, { type: 'membership', membership, action: 'joined' });
      // The stream needs no object (annotation model): it is simply the
      // space's root messages, born empty.
      return space;
    });
    // A second space makes a group chat a workspace for everyone at once
    // (2026-10-07), including members who are not in the new space: tell
    // every member's connections so their listings move with it.
    if (wasGroupChat) {
      for (const member of await this.k.store.listAllMembers()) {
        this.k.hub.publishToMember(member.id, { kind: 'org_changed', at: now });
      }
    }
    return created;
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
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canArchiveSpace(await this.me(ctx), space, archived ? 'archive' : 'unarchive'));
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
   * Change who may find a shared space (spec §4 Roles, built 2026-10-19): an
   * admin act by a member of the space, in the renameSpace shape, refused on
   * an archived space like any write. Every org member is told
   * (`org_changed`), since browse listings move; going private also sends
   * `space_removed` to every org member not in the space, so nobody keeps a
   * reading subscription to a space they can no longer see.
   */
  async setSpaceVisibility(ctx: ActorCtx, spaceId: string, input: SetSpaceVisibilityInput): Promise<Space> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canSetSpaceVisibility(await this.me(ctx), space));
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    const at = this.k.now();
    const { updated, changed, members } = await this.k.lockedAs(ctx, spaceId, async () => {
      const current = (await this.k.store.getSpace(spaceId)) ?? space;
      if (current.visibility === input.visibility) return { updated: current, changed: false, members: [] };
      // Only an open space can be a default (spec §5 answer 3, migration 041):
      // an admin takes it off the defaults first, deliberately.
      if (input.visibility === 'private' && current.isDefault) {
        throw new HarborError('invalid_request', 'this is a default space — remove it from the default spaces before making it private');
      }
      const updated: Space = { ...current, visibility: input.visibility };
      await this.k.store.putSpace(updated);
      await this.k.appendNext(spaceId, at, { type: 'space_visibility_changed', space: updated, by });
      return { updated, changed: true, members: await this.k.store.listSpaceMembers(spaceId) };
    });
    if (changed) {
      const inSpace = new Set(members.map((m) => m.id));
      for (const member of await this.k.store.listAllMembers()) {
        if (updated.visibility === 'private' && !inSpace.has(member.id)) {
          this.k.hub.publishToMember(member.id, { kind: 'space_removed', spaceId, by: ctx.memberId, at });
        }
        this.k.hub.publishToMember(member.id, { kind: 'org_changed', at });
      }
    }
    return updated;
  }

  /**
   * Make a space a default space or take it off (spec §5 answer 3, built
   * 2026-10-19): an admin act, in the renameSpace shape. The admin need not
   * be in the space, so the gate is reading it, and the write takes the plain
   * space lock — an operator's pass, like an admin's archive of a space they
   * are in. An archived space cannot become a default; it can stop being one.
   * Setting the flag a space already has is a no-op with no event.
   */
  async setDefaultSpace(ctx: ActorCtx, spaceId: string, input: SetDefaultSpaceInput): Promise<Space> {
    const space = await this.k.requireReadableSpace(ctx, spaceId);
    const actor = await this.me(ctx);
    enforce(canSetDefaultSpace(actor, space, input.isDefault));
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    return this.k.locked(spaceId, async () => {
      const current = (await this.k.store.getSpace(spaceId)) ?? space;
      if (current.isDefault === input.isDefault) return current; // idempotent, no event
      enforce(canSetDefaultSpace(actor, current, input.isDefault));
      if (input.isDefault) enforce(canWriteSpace(current));
      const updated: Space = { ...current, isDefault: input.isDefault };
      await this.k.store.putSpace(updated);
      await this.k.appendNext(spaceId, this.k.now(), { type: 'space_default_changed', space: updated, by });
      return updated;
    });
  }

  /**
   * Delete a shared space (spec §6, the deletion doctrine; built 2026-10-14):
   * an admin act, on the same terms as archive, and allowed on an archived
   * space. One statement drops the space and, through the cascade (migration
   * 039), every row that hangs off it. No undo and no event: the log goes
   * with it.
   *
   * No write guard: over its limit an org cannot grow, but it may shrink
   * (policy.ts canWrite), as anyone may leave.
   *
   * What the delete erases is read first, inside the lock. Everything that
   * cannot be undone waits for the commit: the frames, because hub frames do
   * not ride the lock's outbox, and the blob bytes, because a rolled-back
   * delete must still find its files.
   */
  async deleteSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canDeleteSpace(await this.me(ctx), space));
    const at = this.k.now();
    const { hashes, told } = await this.k.lockedAs(ctx, spaceId, async () => {
      const current = (await this.k.store.getSpace(spaceId)) ?? space;
      // An open space may be open in anyone's window, member or not; a
      // private one is known only to its members, and only they are told.
      const told = current.visibility === 'open'
        ? await this.k.store.listAllMembers()
        : await this.k.store.listSpaceMembers(spaceId);
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
      const other = await this.k.store.getMember(otherMemberId);
      if (!other) throw new HarborError('not_found', 'no such member on this org');
      enforce(canReachMember(other));
    }
    const participants = self ? [ctx.memberId] : [ctx.memberId, otherMemberId].sort();
    const key = directKeyFor(participants);
    const existing = await this.k.store.getDirectSpace(key);
    if (existing) return { space: existing, created: false };

    enforce(canOpenDirect(await this.isGroupChat()));
    this.k.guardWrite();
    const now = this.k.now();
    const space: Space = { id: this.k.ulid(), name: DIRECT_SPACE_NAME, createdAt: now, kind: 'direct', visibility: 'private', participants, archived: false, isDefault: false };
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
        const membership: Membership = { spaceId: space.id, memberId, joinedAt: now };
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

  async listMembers(ctx: ActorCtx, spaceId: string): Promise<Member[]> {
    await this.k.requireReadableSpace(ctx, spaceId);
    return this.k.store.listSpaceMembers(spaceId);
  }

  /**
   * The org roster (api.ts listOrgMembers): every member, people and agents,
   * sorted by display name (case-insensitive, id breaks ties). Org-wide since
   * 2026-09-29 (spec §5 answer 4): inside one org the org is the trust
   * boundary, so anyone can find, DM, mention, or add anyone. It was bounded
   * to shared spaces until then; guests, when built, get that bound back.
   * Admins see nothing members do not.
   */
  async listOrgMembers(_ctx: ActorCtx): Promise<Member[]> {
    const members = await this.k.store.listAllMembers();
    return members.sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
    );
  }

  /**
   * Add existing org members, people or agents, to a shared space the caller
   * is in (spec §4 Roles: any member adds to spaces they are in; 2026-09-29).
   * All or nothing: every id must be an org member before anything is
   * written. Each one added gets the ordinary `joined` event with `by`, and a
   * `space_added` frame once the transaction commits. No notification in v1
   * (decided 2026-09-29): the sidebar and the stream's join line say it.
   * Anyone already in is a no-op, so a repeated call writes nothing and
   * passes a read-only org.
   */
  async addMembers(ctx: ActorCtx, spaceId: string, input: AddMembersInput): Promise<Membership[]> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canChangeMembership(space, 'add'));
    const ids = [...new Set(input.memberIds)];
    for (const id of ids) {
      const member = await this.k.store.getMember(id);
      if (!member) throw new HarborError('not_found', `no member ${id} in this org`);
      enforce(canReachMember(member));
    }
    const by = this.k.attributionOf(ctx, input);
    const at = this.k.now();
    const { memberships, added } = await this.k.lockedAs(ctx, spaceId, async () => {
      const existing = new Map<string, Membership>();
      for (const id of ids) {
        const m = await this.k.store.getMembership(spaceId, id);
        if (m) existing.set(id, m);
      }
      const added: Membership[] = [];
      if (existing.size < ids.length) this.k.guardWrite();
      for (const memberId of ids) {
        if (existing.has(memberId)) continue;
        const membership: Membership = { spaceId, memberId, joinedAt: at };
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
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canRemoveFromSpace(await this.me(ctx), space, memberId));
    const by = this.k.attributionOf(ctx, input);
    const at = this.k.now();
    const removed = await this.k.lockedAs(ctx, spaceId, () => this.removeMembershipLocked(spaceId, memberId, by, at), { archived: 'allow' });
    if (removed) this.k.hub.publishToMember(memberId, { kind: 'space_removed', spaceId, by: ctx.memberId, at });
    return { removed };
  }

  /** The removal itself, inside the space lock: the row, the member's read marks, the `removed` event. */
  private async removeMembershipLocked(spaceId: string, memberId: string, by: Attribution, at: string): Promise<boolean> {
    const membership = await this.k.store.getMembership(spaceId, memberId);
    if (!membership) return false;
    await this.k.store.deleteMembership(spaceId, memberId);
    await this.k.store.deleteReadMarks(spaceId, memberId);
    await this.k.appendNext(spaceId, at, { type: 'membership', membership, action: 'removed', by });
    return true;
  }

  async leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canChangeMembership(space, 'leave'));
    // No write guard on purpose: over its limit an org cannot grow, but anyone may leave (policy.ts canWrite).
    const at = this.k.now();
    await this.k.lockedAs(ctx, spaceId, async (membership) => {
      await this.k.store.deleteMembership(spaceId, ctx.memberId);
      await this.k.store.deleteReadMarks(spaceId, ctx.memberId);
      await this.k.appendNext(spaceId, at, { type: 'membership', membership, action: 'left' });
    }, { archived: 'allow' }); // anyone may leave an archived space (2026-10-13)
    // Every connection the member holds ends its subscription to the space
    // (2026-09-22) — leave on the laptop, the phone stops receiving too.
    this.k.hub.publishToMember(ctx.memberId, { kind: 'space_removed', spaceId, by: ctx.memberId, at });
  }

  // --- org administration (spec §4 Roles, built 2026-10-19) ---------------------

  /**
   * Remove a member, person or agent, from the org. The row stays and is
   * stamped (store.removeMemberFromOrg), so everything they wrote keeps its
   * author, and canSignIn refuses them until an invite reactivates the row
   * (bindInvite). They leave every shared space with a `removed` event; DMs
   * keep the membership, as with a deleted account: a DM is named by its
   * other participant, who keeps the conversation. Re-running finishes a
   * removal that stopped halfway, and on a removed member writes nothing.
   */
  async removeOrgMember(ctx: ActorCtx, memberId: string, input: { actingMode: Attribution['actingMode']; agentName?: string }): Promise<Member> {
    const target = await this.k.store.getMember(memberId);
    if (!target) throw new HarborError('not_found', 'no such member on this org');
    enforce(canRemoveFromOrg(await this.me(ctx), target));
    const by = this.k.attributionOf(ctx, input);
    const at = this.k.now();
    // Stamped first: from here every sign-in and socket read is refused, so
    // nothing can join a space behind the sweep below.
    if (target.removedAt === undefined) await this.k.store.removeMemberFromOrg(memberId, at);
    for (const space of await this.k.store.listSpacesFor(memberId)) {
      const removed = await this.k.locked(space.id, () => this.removeMembershipLocked(space.id, memberId, by, at));
      if (removed) this.k.hub.publishToMember(memberId, { kind: 'space_removed', spaceId: space.id, by: ctx.memberId, at });
    }
    if (target.removedAt === undefined) await this.tellOrg(at);
    return (await this.k.store.getMember(memberId))!;
  }

  /** Promote or demote an admin; the store keeps the last one (store.setMemberRole). */
  async setMemberRole(ctx: ActorCtx, memberId: string, input: SetMemberRoleInput): Promise<Member> {
    const target = await this.k.store.getMember(memberId);
    if (!target) throw new HarborError('not_found', 'no such member on this org');
    enforce(canSetRole(await this.me(ctx), target, input.role));
    if (target.role === input.role) return target; // idempotent, nothing to tell
    if ((await this.k.store.setMemberRole(memberId, input.role)) === 'last_admin') {
      throw new HarborError('invalid_request', 'the org needs at least one admin — make someone else an admin first');
    }
    await this.tellOrg(this.k.now());
    return (await this.k.store.getMember(memberId))!;
  }

  async getOrgSettings(ctx: ActorCtx): Promise<OrgSettings> {
    await this.k.requireOrgMember(ctx);
    return this.k.store.getOrgSettings();
  }

  async updateOrgSettings(ctx: ActorCtx, input: UpdateOrgSettingsInput): Promise<OrgSettings> {
    enforce(canSetOrgSettings(await this.me(ctx)));
    const current = await this.k.store.getOrgSettings();
    if (input.invitePolicy === undefined || input.invitePolicy === current.invitePolicy) return current;
    const at = this.k.now();
    await this.k.store.setInvitePolicy(input.invitePolicy, ctx.memberId, at);
    await this.tellOrg(at);
    return this.k.store.getOrgSettings();
  }

  /** Org facts have no log (spec §4 Roles): every member's connections refetch on `org_changed`. */
  private async tellOrg(at: string): Promise<void> {
    for (const member of await this.k.store.listAllMembers()) this.k.hub.publishToMember(member.id, { kind: 'org_changed', at });
  }

  // --- invites ---------------------------------------------------------------

  /**
   * An invite to the org, with an optional list of spaces (spec §4 Invites,
   * amended 2026-09-22; built 2026-10-19). Any org member may make one, and
   * may list any shared space they are in that takes members. The list is
   * checked whole before anything is written.
   */
  async createInvite(ctx: ActorCtx, input: CreateInviteInput): Promise<CreateInviteResult> {
    await this.k.requireOrgMember(ctx);
    enforce(canInvite(await this.me(ctx), (await this.k.store.getOrgSettings()).invitePolicy));
    const spaceIds = [...new Set([...(input.spaceId ? [input.spaceId] : []), ...(input.spaceIds ?? [])])];
    if (spaceIds.length > MAX_INVITE_SPACES) {
      throw new HarborError('invalid_request', `an invite lists at most ${MAX_INVITE_SPACES} spaces`);
    }
    for (const spaceId of spaceIds) {
      const space = await this.k.requireSpace(spaceId);
      enforce(canListOnInvite(space, await this.k.store.getMembership(spaceId, ctx.memberId)));
      enforce(canWriteSpace(space)); // an archived space takes no new members (2026-10-13)
    }
    this.k.guardWrite();
    const token = randomBytes(24).toString('base64url');
    const now = this.k.now();
    const expiresAt = new Date(Date.now() + (input.expiresInHours ?? DEFAULT_INVITE_HOURS) * 3_600_000).toISOString();
    await this.k.store.putInvite({ token, spaceIds, createdBy: ctx.memberId, createdAt: now, expiresAt, revoked: false });
    return { token, link: inviteUrl(this.k.org.address, token), expiresAt };
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
   * What accepting joins, landing space first: the listed spaces in the
   * order given, then the org's defaults (spec §5 answer 3). Decided at
   * acceptance, not when the invite was made, so a default an admin adds
   * later is joined too. Archived spaces are left out, and so is a listed
   * space its inviter has since left: what they offered was their own
   * membership (2026-10-19).
   */
  private async invitePlan(invite: StoredInvite): Promise<Space[]> {
    const plan: Space[] = [];
    for (const spaceId of invite.spaceIds) {
      const space = await this.k.store.getSpace(spaceId);
      if (!space || space.archived) continue;
      if (!(await this.k.store.getMembership(spaceId, invite.createdBy))) continue;
      plan.push(space);
    }
    for (const space of await this.k.store.listDefaultSpaces()) {
      if (!space.archived && !plan.some((s) => s.id === space.id)) plan.push(space);
    }
    return plan;
  }

  /** Pre-auth on purpose: the app shows what's being joined before the OAuth dance. */
  async resolveInvite(token: string): Promise<ResolveInviteResult> {
    const found = await this.lookupInvite(token);
    if (found.state !== 'ok') return { state: found.state };
    const spaces = (await this.invitePlan(found.invite)).map((s) => ({ id: s.id, name: s.name }));
    const inviter = await this.k.store.getMember(found.invite.createdBy);
    return {
      state: 'ok',
      org: { address: this.k.org.address, name: this.k.org.name },
      ...(spaces[0] ? { space: spaces[0] } : {}),
      spaces,
      invitedBy: inviter?.displayName,
    };
  }

  /**
   * The invite-binding ceremony (spec §4, amended 2026-08-19): an
   * authenticated identity + an open bearer invite → member (created on
   * first bind, displayName seeded from IdP profile claims) + memberships.
   * Every bind-time condition is org policy, checked in policy.ts canBind and
   * nowhere else — v1 is the email-domain rule. The (iss, sub) → member row written here is
   * what the oidc auth driver resolves on every later request.
   */
  async bindInvite(identity: BindIdentity, token: string): Promise<AcceptInviteResult> {
    const found = await this.lookupInvite(token);
    if (found.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${found.state}`);
    }
    this.k.guardWrite();
    enforce(canBind(identity, this.k.org));
    let member = await this.k.store.getMemberByIdentity(identity.iss, identity.sub);
    if (member && member.deactivatedAt === undefined && member.removedAt !== undefined) {
      // A removed member comes back as the same row (spec §4 Roles,
      // 2026-10-19), but only through an invite made after the removal: a
      // link they were sent before, perhaps still pinned in a space, is not
      // a re-invite.
      const invite = await this.k.store.getInvite(token);
      if (invite && invite.createdAt > member.removedAt) {
        await this.k.store.reactivateMember(member.id);
        const { removedAt: _removed, ...active } = member;
        member = active;
      }
    }
    if (member) enforce(canSignIn(member));
    if (!member) {
      // Minted id, NOT the raw sub: issuer subjects live only in the mapping
      // table, so an org can change AS someday without rewriting history.
      member = { id: this.k.ulid(), displayName: seedDisplayName(identity), role: 'member', kind: 'human' };
      await this.k.store.putMember(member);
      await this.k.store.putIdentity(identity.iss, identity.sub, member.id);
    }
    return this.acceptInvite({ memberId: member.id }, token);
  }

  /**
   * Accepting joins every space in the plan, each under its own lock, with
   * the same `joined` event a self-join appends. A space the member is
   * already in is kept in the result and writes nothing, so accepting twice
   * is a no-op. Each join is its own transaction: a space archived or
   * deleted between the plan and its lock is skipped, and the rest still
   * join. The member's other connections learn by `space_added`.
   */
  async acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    const found = await this.lookupInvite(token);
    if (found.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${found.state}`);
    }
    this.k.guardWrite();
    const joined: Array<{ space: Space; membership: Membership }> = [];
    for (const planned of await this.invitePlan(found.invite)) {
      const result = await this.k.locked(planned.id, async () => {
        const space = await this.k.store.getSpace(planned.id);
        if (!space) return null;
        const existing = await this.k.store.getMembership(space.id, ctx.memberId);
        if (existing) return { space, membership: existing, created: false };
        if (space.archived) return null; // an archived space takes no new members (2026-10-13)
        const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: this.k.now() };
        await this.k.store.putMembership(membership);
        await this.k.appendNext(space.id, membership.joinedAt, { type: 'membership', membership, action: 'joined' });
        return { space, membership, created: true };
      });
      if (!result) continue;
      joined.push(result);
      if (result.created) this.k.hub.publishToMember(ctx.memberId, {
        kind: 'space_added', spaceId: result.space.id, spaceKind: 'shared', by: found.invite.createdBy, at: result.membership.joinedAt,
      });
    }
    const landing = joined[0];
    return {
      ...(landing ? { membership: landing.membership, space: landing.space } : {}),
      spaces: joined.map((j) => j.space),
    };
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
   * DELETE /v1/me calls it once per org. The member leaves every shared space
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
    await this.k.requireReadableSpace(ctx, spaceId);
    const head = await this.k.store.head(spaceId);
    const events = afterOffset === undefined ? [] : await this.k.store.listEventsAfter(spaceId, afterOffset);
    return { head, events };
  }
}
