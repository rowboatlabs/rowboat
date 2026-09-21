import type { ErrorCode, Membership, Message, Space } from '@rowboat/spaces-protocol';
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

/**
 * THE access gate: a membership row, nothing else. Direct spaces pass
 * through it unchanged — their participants are ordinary members. If this
 * ever grows a non-membership path (open spaces: browse/self-join for any
 * org member), that path MUST require `space.kind === 'shared'`; a DM is
 * private forever (SpaceKind, core.ts).
 */
export function canAccessSpace(_space: Space, membership: Membership | undefined): Decision {
  if (membership) return null;
  return { code: 'forbidden', message: 'you are not a member of this space' };
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
export function canChangeMembership(space: Space, act: 'invite' | 'leave'): Decision {
  if (space.kind !== 'direct') return null;
  return {
    code: 'invalid_request',
    message:
      act === 'invite'
        ? 'a direct message has a fixed membership — nobody can be invited'
        : 'a direct message has a fixed membership — it cannot be left',
  };
}

/** A direct space is named by its other participant, never by a stored name. */
export function canRenameSpace(space: Space): Decision {
  if (space.kind !== 'direct') return null;
  return { code: 'invalid_request', message: 'a direct message cannot be renamed — its name is the other person' };
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
