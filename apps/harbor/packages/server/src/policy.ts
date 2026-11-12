import type { ErrorCode, Invocation, InvocationRefusal, Member, MemberRole, Membership, Message, MessageSecrets, Space } from '@rowboat/spaces-protocol';
import { OWNER_ONLY_CONNECTIONS } from '@rowboat/spaces-protocol';
import { HarborError } from './errors.js';

// Who may do what. The service loads the facts (space, membership, message,
// identity) and asks here; nothing in this file reads or writes anything, so
// the rules are testable without a store and readable top to bottom. Every
// rule about an ACTOR or a SPACE KIND lives here. Preconditions on an
// object's own state — a tombstone, a closed poll, a stale base version, an
// occupied path — are the same for every actor and stay with the operation.

/** Why an act is refused, or null: allowed. `enforce` turns a refusal into the thrown HarborError. */
export type Decision = { code: ErrorCode; message: string } | null;

export function enforce(decision: Decision): void {
  if (decision) throw new HarborError(decision.code, decision.message);
}

/** Membership is the one gate (spec §5; open spaces were retired 2026-11-09): reading and acting alike. */
export function canAccessSpace(_space: Space, membership: Membership | undefined): Decision {
  if (membership) return null;
  return { code: 'forbidden', message: 'you are not a member of this space' };
}

/** The admin bit is on the membership row (spec §4 Roles, 2026-11-09). */
export function isAdmin(membership: Membership | undefined): boolean {
  return membership?.role === 'admin';
}

/**
 * read_only_limit (spec §4: over a limit the server is read-only, never locked
 * out): it cannot GROW. Content writes and membership growth — invites,
 * joins — refuse; leaving, read marks, follows and push registration pass.
 */
export function canWrite(server: { readOnly: boolean }): Decision {
  if (!server.readOnly) return null;
  return { code: 'read_only_limit', message: 'this server is over its plan limit: writes are paused, reads still work' };
}

/** A direct space has a fixed membership: nobody is invited, nobody leaves. */
export function canChangeMembership(space: Space, act: 'invite' | 'add' | 'leave'): Decision {
  if (space.kind !== 'direct') return null;
  return {
    code: 'invalid_request',
    message:
      act === 'invite'
        ? 'a direct message has a fixed membership — nobody can be invited'
        : act === 'add'
          ? 'a direct message has a fixed membership — nobody can be added'
          : 'a direct message has a fixed membership — it cannot be left',
  };
}

/** A direct space is named by its other participant, never by a stored name. */
export function canRenameSpace(space: Space): Decision {
  if (space.kind !== 'direct') return null;
  return { code: 'invalid_request', message: 'a direct message cannot be renamed — its name is the other person' };
}

/**
 * Archive and unarchive are admin acts on a shared space (spec §4 Roles and
 * §6, built 2026-10-13; the space's admin since 2026-11-09). A DM has no
 * admin path into it, so it never archives.
 */
export function canArchiveSpace(actor: Membership | undefined, space: Space, act: 'archive' | 'unarchive'): Decision {
  if (space.kind === 'direct') return { code: 'invalid_request', message: `a direct message cannot be ${act}d` };
  if (isAdmin(actor)) return null;
  return { code: 'forbidden', message: `only an admin of this space can ${act} it` };
}

/** Deleting a space is an admin act too, on the same terms as archiving it (spec §6, built 2026-10-14). */
export function canDeleteSpace(actor: Membership | undefined, space: Space): Decision {
  if (space.kind === 'direct') return { code: 'invalid_request', message: 'a direct message cannot be deleted' };
  if (isAdmin(actor)) return null;
  return { code: 'forbidden', message: 'only an admin of this space can delete it' };
}

/**
 * Removing someone from a shared space is an admin act (spec §4 Roles,
 * built 2026-10-19). A DM's membership is fixed; your own tool is leave.
 */
export function canRemoveFromSpace(actor: Membership | undefined, space: Space, targetId: string): Decision {
  if (space.kind === 'direct') return { code: 'invalid_request', message: 'a direct message has a fixed membership — nobody can be removed' };
  if (!isAdmin(actor)) return { code: 'forbidden', message: 'only an admin of this space can remove someone from it' };
  if (targetId === actor!.memberId) return { code: 'invalid_request', message: 'to take yourself out of a space, leave it' };
  return null;
}

/**
 * Giving and taking the admin bit in a space (spec §4 Roles, rewritten
 * 2026-11-09): an admin of the space, on an active person who is in it. An
 * agent is never an admin (spec §4 Agent members). A DM has no admin. The
 * only-admin rule needs the count, so the store decides it.
 */
export function canSetRole(actor: Membership | undefined, space: Space, target: Member, targetMembership: Membership | undefined, role: MemberRole): Decision {
  if (space.kind === 'direct') return { code: 'invalid_request', message: 'a direct message has no admin' };
  if (!isAdmin(actor)) return { code: 'forbidden', message: 'only an admin of this space can change who is an admin' };
  if (!targetMembership) return { code: 'invalid_request', message: `${target.displayName} is not in this space` };
  if (target.kind === 'agent' && role === 'admin') return { code: 'invalid_request', message: 'an agent can’t be an admin' };
  if (target.removedAt !== undefined || target.deactivatedAt !== undefined) {
    return { code: 'invalid_request', message: `${target.displayName} is no longer here` };
  }
  return null;
}

/**
 * Inviting to a space requires being a member of it (spec §4 Invites, amended
 * 2026-09-22; one space per invite since 2026-11-09). A DM is never the
 * target — its membership is fixed.
 */
export function canListOnInvite(space: Space, membership: Membership | undefined): Decision {
  return canChangeMembership(space, 'invite') ?? canAccessSpace(space, membership);
}

/**
 * An archived space refuses every write that would add to it (spec §6,
 * 2026-10-13). Asked by the space lock for every member's act; leaving and
 * unarchiving opt out, and personal state (read marks, follows) never asks.
 * A deleted agent's DM is read-only too (2026-11-11, spec §8 Managed deletion).
 */
export function canWriteSpace(space: Space, members: readonly Member[] = []): Decision {
  if (space.kind === 'direct' && members.some((m) => m.kind === 'agent' && (m.deactivatedAt || m.removedAt))) {
    return { code: 'forbidden', message: 'this agent was deleted — its conversation is read-only' };
  }
  if (!space.archived) return null;
  return { code: 'forbidden', message: 'this space is archived — an admin can unarchive it' };
}

/**
 * The reach rule (spec §5 Direct messages, 2026-11-09): you may open a DM
 * with yourself, or with anyone you share a space with (archived included);
 * a DM that already exists is returned whatever the two share now. Anyone
 * else is reached by their personal link — an invite with a DM target, which
 * opens the DM on acceptance — or by inviting them to a group. Your own agent
 * is always yours to message, in a space or not (spec §4 Agent members).
 */
export function canOpenDirect(self: boolean, sharesSpace: boolean, ownsAgent: boolean): Decision {
  if (self || sharesSpace || ownsAgent) return null;
  return { code: 'forbidden', message: 'you can message people you share a space with — ask them for their link, or invite them to a group' };
}

/**
 * The content plane is role-flat (spec §4): the one act restricted to a
 * single member is an author acting on their own message — edit, delete,
 * end a poll. The check is on the member id, never the acting mode: a
 * member's agent counts as the member (parity, 2026-09-09).
 */
export function isAuthor(
  actor: { memberId: string },
  message: Message,
  act: 'edit a message' | 'delete a message' | 'end a poll',
): Decision {
  if (message.author.memberId === actor.memberId) return null;
  return { code: 'forbidden', message: `only the author can ${act}` };
}

/**
 * A deleted account's member (2026-10-13): kept for attribution, refused as
 * a sign-in — through any driver, and through an invite, which would
 * otherwise rebind the same row.
 */
export function canSignIn(member: Member): Decision {
  if (member.deactivatedAt !== undefined) return { code: 'not_a_member', message: 'this account was deleted' };
  // A departed row (2026-11-09: the losing rows of the identity merge) keeps
  // history and is nobody's sign-in; the identity names the surviving row.
  if (member.removedAt !== undefined) return { code: 'not_a_member', message: 'this member has departed' };
  return null;
}

/** Nobody adds, or opens a DM with, a deactivated or departed member (2026-10-13, 2026-10-19, 2026-11-09). */
export function canReachMember(member: Member): Decision {
  if (member.deactivatedAt !== undefined) return { code: 'invalid_request', message: `${member.displayName} has deleted their account` };
  if (member.removedAt !== undefined) return { code: 'invalid_request', message: `${member.displayName} is no longer here` };
  return null;
}

/**
 * Only you edit your profile (spec §4 Member profile, 2026-09-22), and only a
 * person has one to edit: an agent member is named by its owner when it is
 * added (built 2026-10-19), so an agent's own key cannot rename it. A
 * person's own assistant acting for them is the person, and may.
 */
export function canEditProfile(actor: Member): Decision {
  if (actor.kind !== 'agent') return null;
  return { code: 'forbidden', message: 'an agent’s name is set when it is added' };
}

// --- agent members and their keys (spec §4 Agent members, 2026-09-29) --------

/** Any person may add an agent and becomes its owner. An agent may not: one agent minting others escapes every owner. */
export function canAddAgent(actor: Member): Decision {
  if (actor.kind === 'human') return null;
  return { code: 'forbidden', message: 'only a person can add an agent' };
}

/**
 * Creating a key is the owner's alone. A key IS the agent's identity (spec
 * §4 Agent members). An agent without an owner takes no keys.
 */
export function canCreateAgentKey(actor: Member, agent: Member): Decision {
  if (agent.deactivatedAt || agent.removedAt) return { code: 'invalid_request', message: 'this agent was deleted' };
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can create its keys' };
}

/**
 * Renaming an agent is its owner's (spec §4 Agent members, amended
 * 2026-10-21): the name was theirs to pick when they added it. Admins remove
 * an agent from the server; they don't rename it.
 */
export function canRenameAgent(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can rename it' };
}

/** An agent's description and instructions (spec §4 Agent members, 2026-10-29): the owner, as with its name. */
export function canSetAgentProfile(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can change its description and instructions' };
}

/** Pointing an agent's alerts at a space (spec §8 Alerts, 2026-10-03): the owner, as with its keys. */
export function canSetAgentHook(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can set where its alerts go' };
}

/** Turning its alerts off: the owner, like revoking a key (nothing stands above the owner since 2026-11-09). */
export function canClearAgentHook(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can turn its alerts off' };
}

// --- super agents (spec §4 Agent members, 2026-11-02) --------------------------

/**
 * Making an agent a super agent, changing what it may do, or making it
 * ordinary again: its owner (spec §4 Agent members, 2026-11-09; an admin
 * until then, while what it created could run on Rowboat's trial credit —
 * it bills the owner now, §8 Billing). Only an agent with an owner, who will
 * own what it creates.
 */
export function canSetSuperAgent(actor: Member, agent: Member): Decision {
  if (agent.kind !== 'agent') return { code: 'invalid_request', message: 'only an agent can be a super agent' };
  if (agent.ownerId === undefined) return { code: 'invalid_request', message: 'an agent without an owner can’t be a super agent: what it creates needs a person to own it' };
  if (agent.ownerId !== actor.id) return { code: 'forbidden', message: 'only the agent’s owner can make it a super agent' };
  return null;
}

/**
 * A super agent creating a managed agent. What it creates is its owner's,
 * never its own, so no agent escapes every owner (canAddAgent).
 */
export function canSuperAgentCreate(agent: Member): Decision {
  if (agent.kind === 'agent' && agent.superAgent && agent.ownerId !== undefined) return null;
  return { code: 'forbidden', message: 'only a super agent can create agents; an admin makes one on the agent’s page' };
}

/** A super agent deleting: only an agent it created. */
export function canSuperAgentDelete(agent: Member, requestedBy: string | undefined): Decision {
  if (!(agent.kind === 'agent' && agent.superAgent && agent.ownerId !== undefined)) {
    return { code: 'forbidden', message: 'only a super agent can delete agents' };
  }
  if (requestedBy !== agent.id) return { code: 'forbidden', message: 'a super agent deletes only the agents it created' };
  return null;
}

/** Deciding a super agent's request: its owner alone, who the agent is created for or taken from. */
export function canDecideSuperAgentRequest(actor: Member, superAgent: Member | undefined): Decision {
  if (superAgent?.ownerId !== undefined && superAgent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can decide this' };
}

/** Revoking: the owner — the off switch for an agent that misbehaves (an admin's too until 2026-11-09; nothing stands above the owner now). */
/** Deleting an agent (2026-11-13): its owner alone, as with its keys. */
export function canDeleteAgent(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can delete it' };
}

export function canRevokeAgentKey(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can revoke its keys' };
}

/** An agent's seat in a space (spec §4 Agent members, 2026-11-09): who may ask it there. Absent, or a person's row, reads as everyone. */
export type Seat = 'owner' | 'members';
export function seatOf(membership: Membership | undefined): Seat {
  return membership?.invocableBy ?? 'members';
}

/**
 * Who may add a member to a space (spec §4 Agent members, 2026-11-09): any
 * member adds a person; an agent is added only by its owner — nobody else
 * knows it exists — or by a super agent of the same owner, bringing an agent
 * it created into the space it was asked in.
 */
export function canAddToSpace(actor: Member, member: Member): Decision {
  if (member.kind !== 'agent') return null;
  if (member.ownerId !== undefined && member.ownerId === actor.id) return null;
  if (actor.kind === 'agent' && actor.ownerId !== undefined && member.ownerId === actor.ownerId) return null;
  return { code: 'forbidden', message: `only its owner can add ${member.displayName} to a space` };
}

/** A DM with an agent is its owner's alone (spec §4 Agent members, 2026-11-09): nobody else is there to hold its seat. */
export function canMessageAgent(actorId: string, agent: Member): Decision {
  if (agent.kind !== 'agent' || agent.ownerId === actorId) return null;
  return { code: 'forbidden', message: `${agent.displayName} is someone else’s agent: only its owner can message it` };
}

/**
 * Changing an agent's seat (spec §4 Agent members, 2026-11-09): its owner,
 * for an agent in the space; an agent on its owner's own computer stays
 * owner-only.
 */
export function canSetAgentAccess(actor: Member, agent: Member, membership: Membership | undefined, invocableBy: Seat): Decision {
  if (agent.kind !== 'agent') return { code: 'invalid_request', message: 'only an agent has a seat to set' };
  if (agent.ownerId === undefined || agent.ownerId !== actor.id) return { code: 'forbidden', message: 'only the agent’s owner can change who may ask it' };
  if (!membership) return { code: 'invalid_request', message: `${agent.displayName} is not in this space` };
  if (invocableBy === 'members' && OWNER_ONLY_CONNECTIONS.includes(agent.agentConnection ?? '')) {
    return { code: 'invalid_request', message: `${agent.displayName} runs on its owner’s computer, so only its owner can use it` };
  }
  return null;
}
/**
 * Handing secrets in a message (2026-11-04, "secrets card" in Main): to the
 * members it mentions, its readers, so a message that mentions no one carries
 * none. An agent whose seat here is owner-only takes one only from its owner,
 * since only its owner can ask it for anything (seats, 2026-11-09).
 */
export function canHandSecrets(authorId: string, readers: Array<{ member: Member; seat: Seat }>): Decision {
  if (readers.length === 0) return { code: 'invalid_request', message: 'mention who should read the secret' };
  for (const { member, seat } of readers) {
    if (member.kind === 'agent' && seat === 'owner' && member.ownerId !== authorId) {
      return { code: 'forbidden', message: `${member.displayName} answers only its owner here, so only its owner can hand it a secret` };
    }
  }
  return null;
}

/** Reading a secret is its readers' alone, the author and admins included; anyone else finds nothing (2026-11-04). */
export function canReadSecret(actorId: string, secrets: MessageSecrets | undefined, name: string): Decision {
  if (secrets && secrets.names.includes(name) && secrets.readers.includes(actorId)) return null;
  return { code: 'not_found', message: 'no such secret for you' };
}

// --- invoking agent members (spec §8 Invoking agent members, 2026-09-30) -----

/**
 * How many agent hand-offs may lead to an invocation. A person's mention is
 * depth 0. Raised from 3 to 20 (2026-11-04, Arjun): agents working together in
 * one thread ran out of hand-offs mid-review. The cap still ends a loop of
 * agents mentioning each other; a guard against ping-pong is not built
 * until loops show up.
 */
export const AGENT_HOP_LIMIT = 20;

/**
 * Whether a mention may invoke an agent, or why not. An agent whose seat in
 * this space is owner-only answers its owner alone (spec §4 Agent members;
 * seats 2026-11-09): another person and another agent are refused. You must
 * share a shared space with the agent: a DM alone does not count (PR #1130's
 * rule for Replicas, generalized). Past the hop limit an agent's hand-off is
 * refused. A refusal is a recorded outcome shown under the message, not an
 * error.
 */
export function invocationRefusal(
  sharesSharedSpace: boolean,
  depth: number,
  invoked: { agent: Member; authorId: string; seat: Seat },
): InvocationRefusal | null {
  if (invoked.seat === 'owner' && invoked.agent.ownerId !== invoked.authorId) {
    return { reason: 'not_permitted', message: `${invoked.agent.displayName} answers only its owner here.` };
  }
  if (!sharesSharedSpace) {
    return { reason: 'not_permitted', message: 'You need to share a space with this agent to ask it for something.' };
  }
  if (depth > AGENT_HOP_LIMIT) {
    return { reason: 'hop_limit', message: `Too many agent hand-offs: at most ${AGENT_HOP_LIMIT} agents can pass work along in a row.` };
  }
  return null;
}

/** Cancelling an invocation still in the queue is its invoker's act. */
export function canCancelQueuedInvocation(actor: { memberId: string }, invocation: Invocation): Decision {
  if (invocation.trigger.authorId === actor.memberId) return null;
  return { code: 'forbidden', message: 'only the person who asked can cancel it' };
}

/**
 * Deciding an approval (spec §8 part 4, 2026-10-01): any person who can see
 * it, for now, but a person acting directly. An agent, or a person's Rowboat
 * assistant acting for them, may not: an approval is a person's OK.
 */
export function canDecideApproval(ctx: { agent?: boolean }, actingMode: string): Decision {
  if (ctx.agent || actingMode !== 'direct') return { code: 'forbidden', message: 'only a person, acting directly, can decide an approval' };
  return null;
}

/** Stopping a running invocation: its invoker or an admin of the space, and only when the agent's connector can stop. */
export function canStopInvocation(actor: Membership | undefined, invocation: Invocation, stopDeclared: boolean): Decision {
  if (invocation.trigger.authorId !== actor?.memberId && !isAdmin(actor)) {
    return { code: 'forbidden', message: 'only the person who asked, or an admin of this space, can stop it' };
  }
  if (!stopDeclared) return { code: 'invalid_request', message: 'this agent can’t be stopped from Spaces; open it in its own app' };
  return null;
}
