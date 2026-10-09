import type { ErrorCode, Invocation, InvocationRefusal, Member, Membership, Message, Space } from '@rowboat/spaces-protocol';
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

/** Membership remains the write boundary (spec §5, 2026-09-22). */
export function canAccessSpace(space: Space, membership: Membership | undefined): Decision {
  if (membership) return null;
  return {
    code: 'forbidden',
    message: space.kind === 'shared' && space.visibility === 'open'
      ? 'join this space to post' : 'you are not a member of this space',
  };
}

/** Browsing never grants acting rights, and never opens a DM (spec §5, 2026-09-22). */
export function canReadSpace(space: Space, membership: Membership | undefined, orgMember: boolean): Decision {
  if (membership || (orgMember && space.kind === 'shared' && space.visibility === 'open')) return null;
  return { code: 'forbidden', message: 'you are not a member of this space' };
}

export function canJoinSpace(space: Space): Decision {
  if (space.kind === 'shared' && space.visibility === 'open') return null;
  return { code: 'forbidden', message: 'only shared open spaces can be self-joined' };
}

/**
 * read_only_limit (spec §4: over a limit the org is read-only, never locked
 * out): the org cannot GROW. Content writes and membership growth — invites,
 * joins — refuse; leaving, read marks, follows and push registration pass.
 */
export function canWrite(org: { readOnly: boolean }): Decision {
  if (!org.readOnly) return null;
  return { code: 'read_only_limit', message: 'org is over its plan limit: writes are paused, reads still work' };
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
 * A group chat (spec §4, 2026-10-07): an org with one shared space and no
 * DMs. One answer for every member — the org's count, not anyone's
 * listing — so a group is a chat, or a workspace, for everyone at once.
 * "No DMs" keeps an org that already talks in DMs a workspace: nothing
 * that exists is ever hidden by this rule.
 */
export function isGroupChat(counts: { shared: number; direct: number }): boolean {
  return counts.shared === 1 && counts.direct === 0;
}

/** DMs are off in a group chat, notes to self included; a second space turns them on (2026-10-07). */
export function canOpenDirect(groupChat: boolean): Decision {
  if (!groupChat) return null;
  return { code: 'forbidden', message: 'direct messages are off in a group chat — add a channel to turn them on' };
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
 * The invite-binding ceremony's policy (spec §4, amended 2026-08-19): every
 * bind-time condition is org policy, checked here and nowhere else. v1 is
 * the email-domain rule; empty or absent = no restriction.
 */
export function canBind(identity: { email?: string }, org: { allowedEmailDomains?: string[] }): Decision {
  const domains = org.allowedEmailDomains;
  if (!domains || domains.length === 0) return null;
  const domain = identity.email?.toLowerCase().split('@')[1];
  if (domain && domains.some((d) => d.toLowerCase() === domain)) return null;
  return { code: 'policy_refused', message: `this org admits only ${domains.map((d) => `@${d}`).join(', ')} accounts` };
}

/** The org's logo is its admins' to set (2026-10-02); a member's avatar is always their own. */
export function canSetOrgLogo(actor: Member): Decision {
  if (actor.role === 'admin') return null;
  return { code: 'forbidden', message: 'only an admin can change the org’s logo' };
}

// --- agent members and their keys (spec §4 Agent members, 2026-09-29) --------

/** Any person may add an agent and becomes its owner. An agent may not: one agent minting others escapes every owner. */
export function canAddAgent(actor: Member): Decision {
  if (actor.kind === 'human') return null;
  return { code: 'forbidden', message: 'only a person can add an agent' };
}

/**
 * Creating a key is the owner's alone. A key IS the agent's identity: an
 * admin who could mint one could post as the agent, so admins get the off
 * switch (revoke) and never this. An org-owned agent (no owner) takes no keys.
 */
export function canCreateAgentKey(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can create its keys' };
}

/** Pointing an agent's alerts at a space (spec §8 Alerts, 2026-10-03): the owner, as with its keys. */
export function canSetAgentHook(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && agent.ownerId !== undefined && agent.ownerId === actor.id) return null;
  return { code: 'forbidden', message: 'only the agent’s owner can set where its alerts go' };
}

/** Turning its alerts off: the owner, or any admin, like revoking a key. */
export function canClearAgentHook(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && (actor.role === 'admin' || (agent.ownerId !== undefined && agent.ownerId === actor.id))) return null;
  return { code: 'forbidden', message: 'only the agent’s owner or an admin can turn its alerts off' };
}

/** Revoking: the owner, or any admin — the off switch for an agent that misbehaves. */
export function canRevokeAgentKey(actor: Member, agent: Member): Decision {
  if (agent.kind === 'agent' && (actor.role === 'admin' || (agent.ownerId !== undefined && agent.ownerId === actor.id))) return null;
  return { code: 'forbidden', message: 'only the agent’s owner or an admin can revoke its keys' };
}

/** The agents a member manages, and so sees on the Agents screen: an admin, every one; anyone else, their own. */
export function agentsManagedBy(actor: Member): 'all' | 'owned' {
  return actor.role === 'admin' ? 'all' : 'owned';
}

// --- invoking agent members (spec §8 Invoking agent members, 2026-09-30) -----

/** How many agent hand-offs may lead to an invocation. A person's mention is depth 0. */
export const AGENT_HOP_LIMIT = 3;

/**
 * Whether a mention may invoke an agent, or why not. You must share a shared
 * space with the agent: a DM alone does not count (PR #1130's rule for
 * Replicas, generalized). Past the hop limit an agent's hand-off is refused.
 * A refusal is a recorded outcome shown under the message, not an error.
 */
export function invocationRefusal(sharesSharedSpace: boolean, depth: number): InvocationRefusal | null {
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

/** Stopping a running invocation: its invoker or an admin, and only when the agent's connector can stop. */
export function canStopInvocation(actor: Member, invocation: Invocation, stopDeclared: boolean): Decision {
  if (invocation.trigger.authorId !== actor.id && actor.role !== 'admin') {
    return { code: 'forbidden', message: 'only the person who asked, or an admin, can stop it' };
  }
  if (!stopDeclared) return { code: 'invalid_request', message: 'this agent can’t be stopped from Spaces; open it in its own app' };
  return null;
}
