import {
  inviteUrl,
  Member,
  type AcceptInviteResult,
  type CreateInviteResult,
  type Membership,
  type PresenceState,
  type ResolveInviteResult,
  type Routes,
  type Space,
} from '@rowboat/spaces-protocol';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { HarborError } from '../errors.js';
import { canBind, canChangeMembership, canJoinSpace, canRenameSpace, enforce } from '../policy.js';
import { DIRECT_SPACE_NAME, directKeyFor, type PushLevel, type StoredEvent } from '../store.js';
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

export type RenameSpaceInput = z.infer<Routes['renameSpace']['request']>;
export type AddMembersInput = z.infer<Routes['addMembers']['request']>;

const DEFAULT_INVITE_HOURS = 24 * 7;

export class Spaces {
  constructor(private readonly k: Kernel) {}

  // --- identity --------------------------------------------------------------

  /** The caller's own row — what /v1/me and whoami serve. */
  async me(ctx: ActorCtx): Promise<Member> {
    const member = await this.k.store.getMember(ctx.memberId);
    if (!member) throw new HarborError('not_found', 'member not found');
    return member;
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

  async createSpace(ctx: ActorCtx, name: string, visibility: Space['visibility'] = 'private'): Promise<Space> {
    this.k.guardWrite();
    const now = this.k.now();
    const space: Space = { id: this.k.ulid(), name, createdAt: now, kind: 'shared', visibility };
    await this.k.store.putSpace(space);
    return this.k.locked(space.id, async () => {
      const membership: Membership = { spaceId: space.id, memberId: ctx.memberId, joinedAt: now };
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
    }
    const participants = self ? [ctx.memberId] : [ctx.memberId, otherMemberId].sort();
    const key = directKeyFor(participants);
    const existing = await this.k.store.getDirectSpace(key);
    if (existing) return { space: existing, created: false };

    this.k.guardWrite();
    const now = this.k.now();
    const space: Space = { id: this.k.ulid(), name: DIRECT_SPACE_NAME, createdAt: now, kind: 'direct', visibility: 'private', participants };
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
      if (!(await this.k.store.getMember(id))) throw new HarborError('not_found', `no member ${id} in this org`);
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

  async leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canChangeMembership(space, 'leave'));
    // No write guard on purpose: over its limit an org cannot grow, but anyone may leave (policy.ts canWrite).
    const at = this.k.now();
    await this.k.lockedAs(ctx, spaceId, async (membership) => {
      await this.k.store.deleteMembership(spaceId, ctx.memberId);
      await this.k.store.deleteReadMarks(spaceId, ctx.memberId);
      await this.k.appendNext(spaceId, at, { type: 'membership', membership, action: 'left' });
    });
    // Every connection the member holds ends its subscription to the space
    // (2026-09-22) — leave on the laptop, the phone stops receiving too.
    this.k.hub.publishToMember(ctx.memberId, { kind: 'space_removed', spaceId, by: ctx.memberId, at });
  }

  // --- invites ---------------------------------------------------------------

  async createInvite(ctx: ActorCtx, spaceId: string, expiresInHours?: number): Promise<CreateInviteResult> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canChangeMembership(space, 'invite'));
    this.k.guardWrite();
    const token = randomBytes(24).toString('base64url');
    const now = this.k.now();
    const expiresAt = new Date(Date.now() + (expiresInHours ?? DEFAULT_INVITE_HOURS) * 3_600_000).toISOString();
    await this.k.lockedAs(ctx, spaceId, () =>
      this.k.store.putInvite({ token, spaceId, createdBy: ctx.memberId, createdAt: now, expiresAt, revoked: false }));
    return { token, link: inviteUrl(this.k.org.address, token), expiresAt };
  }

  /** Pre-auth on purpose: the app shows what's being joined before the OAuth dance. */
  async resolveInvite(token: string): Promise<ResolveInviteResult> {
    const invite = await this.k.store.getInvite(token);
    if (!invite) throw new HarborError('not_found', 'unknown invite');
    if (invite.revoked) return { state: 'revoked' };
    if (invite.expiresAt && invite.expiresAt < this.k.now()) return { state: 'expired' };
    const space = await this.k.requireSpace(invite.spaceId);
    const inviter = await this.k.store.getMember(invite.createdBy);
    return {
      state: 'ok',
      org: { address: this.k.org.address, name: this.k.org.name },
      space: { id: space.id, name: space.name },
      invitedBy: inviter?.displayName,
    };
  }

  /**
   * The invite-binding ceremony (spec §4, amended 2026-08-19): an
   * authenticated identity + an open bearer invite → member (created on
   * first bind, displayName seeded from IdP profile claims) + membership.
   * Every bind-time condition is org policy, checked in policy.ts canBind and
   * nowhere else — v1 is the email-domain rule. The (iss, sub) → member row written here is
   * what the oidc auth driver resolves on every later request.
   */
  async bindInvite(identity: BindIdentity, token: string): Promise<AcceptInviteResult> {
    const resolved = await this.resolveInvite(token);
    if (resolved.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${resolved.state}`);
    }
    this.k.guardWrite();
    enforce(canBind(identity, this.k.org));
    let member = await this.k.store.getMemberByIdentity(identity.iss, identity.sub);
    if (!member) {
      // Minted id, NOT the raw sub: issuer subjects live only in the mapping
      // table, so an org can change AS someday without rewriting history.
      member = { id: this.k.ulid(), displayName: seedDisplayName(identity), role: 'member', kind: 'human' };
      await this.k.store.putMember(member);
      await this.k.store.putIdentity(identity.iss, identity.sub, member.id);
    }
    return this.acceptInvite({ memberId: member.id }, token);
  }

  async acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    const resolved = await this.resolveInvite(token);
    if (resolved.state !== 'ok') {
      throw new HarborError('forbidden', `invite is ${resolved.state}`);
    }
    this.k.guardWrite();
    const spaceId = resolved.space.id;
    const space = await this.k.requireSpace(spaceId);
    return this.k.locked(spaceId, async () => {
      const existing = await this.k.store.getMembership(spaceId, ctx.memberId);
      if (existing) return { membership: existing, space }; // idempotent join
      const membership: Membership = { spaceId, memberId: ctx.memberId, joinedAt: this.k.now() };
      await this.k.store.putMembership(membership);
      await this.k.appendNext(spaceId, membership.joinedAt, { type: 'membership', membership, action: 'joined' });
      return { membership, space };
    });
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
