import { z } from 'zod';
import { Membership, Space } from './core.js';
import { SpaceId } from './ids.js';

// Decision 4 (CONTRACT.md): auth is standard OAuth 2.x, stated as TIERED
// requirements rather than schemas (spec §4, amended 2026-08-18 — the
// contract mandates interoperability shape; organizational policy stays with
// the org):
//
//   MUST (interop floor): the org serves protected-resource metadata
//   (RFC 9728) naming its authorization server; that AS serves RFC 8414
//   metadata; OAuth 2.1 authorization-code + PKCE (S256); standard bearer
//   validation, tokens scoped to the org. The org itself is only ever a
//   RESOURCE server — the AS behind it is pluggable (Supabase Auth flagship,
//   Keycloak, corporate IdP, anything conforming).
//
//   SHOULD / org policy (consequences named in spec §4): Dynamic Client
//   Registration (RFC 7591) — on, gated, or off; off degrades "any agent is
//   your edge" to approved-clients-only, and clients must handle its absence
//   gracefully. Refresh tokens — needed by automations acting with no
//   browser open; orgs restricting them accept visible re-login instead of
//   unattended runs.
//
// This tiering matches the MCP remote-server authorization contract
// (discovery MUST, DCR SHOULD) — deliberate (spec §4, §9).
//
// The invite link is the one auth-adjacent artifact with a wire shape:
//   https://<org>/join/<token>
// Resolution is allowed pre-auth so the app can show what's being joined;
// acceptance requires auth and is subject to org membership policy.
//
// Amended 2026-08-19 (spec §4: invites/profile/roles): an invite is ONE
// shape — an open bearer secret. Acceptance binds to the authenticated
// (issuer, subject); every bind-time condition is ORG POLICY checked in one
// place at acceptance (v1: email-domain rule — a standing invite under a
// domain rule is a safe de-facto public join link). No per-token claim
// checks, by decision. "Invite by email" is delivery UX, not a security
// artifact. On the wire (built 2026-08-19): the accept path refuses with
// ErrorCode 'policy_refused' (human-readable message, never a cryptic 401);
// Member carries the org-level admin bit (role — membership/policy powers
// only; content plane stays role-flat). Deferred until human mentions ship:
// an org-unique handle. Attribution keys on member id, never name/handle.

export const InviteToken = z.string().min(16).max(256);
export type InviteToken = z.infer<typeof InviteToken>;

export const ResolveInvite = z.object({ token: InviteToken });
export type ResolveInvite = z.infer<typeof ResolveInvite>;

// Amended 2026-10-19 (spec §4 Invites, §5 answer 3 — team invites): an
// invite is to the ORG, with an optional list of spaces. Accepting creates
// the member (if new), then joins the org's default spaces and the listed
// ones. A per-space link is the case of an invite that lists one space; there
// is no second shape. `space` stays on both results as the LANDING space —
// the first listed space, else the first default — so a client from before
// this change still opens somewhere. It is absent only when the invite joins
// no space at all (the org has no live default and the invite lists none):
// the invitee is in the org and browses from there.

/** A space an invite will join, as the pre-auth preview names it. */
export const InviteSpace = z.object({ id: SpaceId, name: z.string() });
export type InviteSpace = z.infer<typeof InviteSpace>;

export const ResolveInviteResult = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    org: z.object({ address: z.string(), name: z.string() }),
    /** The landing space: `spaces[0]`, or absent when the invite joins none. */
    space: InviteSpace.optional(),
    /** Every space accepting joins, landing space first: the listed ones, then the org's defaults. */
    spaces: z.array(InviteSpace).default([]),
    invitedBy: z.string().optional(),
  }),
  z.object({ state: z.literal('expired') }),
  z.object({ state: z.literal('revoked') }),
]);
export type ResolveInviteResult = z.infer<typeof ResolveInviteResult>;

export const AcceptInvite = z.object({ token: InviteToken });
export type AcceptInvite = z.infer<typeof AcceptInvite>;

export const AcceptInviteResult = z.object({
  /** The membership of the landing space; absent with it. */
  membership: Membership.optional(),
  /** The landing space: `spaces[0]`, or absent when the accept joined none. */
  space: Space.optional(),
  /** Every space the accept put the member in, landing space first — including ones they were already in. */
  spaces: z.array(Space).default([]),
});
export type AcceptInviteResult = z.infer<typeof AcceptInviteResult>;

/** At most this many spaces on one invite: a team's onboarding set, not the whole org. */
export const MAX_INVITE_SPACES = 50;

export const CreateInvite = z.object({
  /** The spaces to list, each one the caller is in. None = the org and its default spaces only. */
  spaceIds: z.array(SpaceId).max(MAX_INVITE_SPACES).optional(),
  /** One space, as clients before 2026-10-19 send it: the same as `spaceIds: [spaceId]`. */
  spaceId: SpaceId.optional(),
  /** Org policy may cap or ignore this. */
  expiresInHours: z.number().int().positive().max(24 * 30).optional(),
});
export type CreateInvite = z.infer<typeof CreateInvite>;

export const CreateInviteResult = z.object({
  token: InviteToken,
  /** Full https invite link, ready to share. */
  link: z.string().url(),
  expiresAt: z.iso.datetime().optional(),
});
export type CreateInviteResult = z.infer<typeof CreateInviteResult>;
