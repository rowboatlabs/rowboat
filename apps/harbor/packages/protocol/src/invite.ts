import { z } from 'zod';
import { Membership, Space } from './core.js';
import { MemberId, SpaceId } from './ids.js';

// Decision 4 (CONTRACT.md): auth is standard OAuth 2.x, stated as TIERED
// requirements rather than schemas (spec §4, amended 2026-08-18 — the
// contract mandates interoperability shape; organizational policy stays with
// the server):
//
//   MUST (interop floor): the server serves protected-resource metadata
//   (RFC 9728) naming its authorization server; that AS serves RFC 8414
//   metadata; OAuth 2.1 authorization-code + PKCE (S256); standard bearer
//   validation, tokens scoped to the server. The server itself is only ever a
//   RESOURCE server — the AS behind it is pluggable (Supabase Auth flagship,
//   Keycloak, corporate IdP, anything conforming).
//
//   SHOULD / server policy (consequences named in spec §4): Dynamic Client
//   Registration (RFC 7591) — on, gated, or off; off degrades "any agent is
//   your edge" to approved-clients-only, and clients must handle its absence
//   gracefully. Refresh tokens — needed by automations acting with no
//   browser open; servers restricting them accept visible re-login instead of
//   unattended runs.
//
// This tiering matches the MCP remote-server authorization contract
// (discovery MUST, DCR SHOULD) — deliberate (spec §4, §9).
//
// The invite link is the one auth-adjacent artifact with a wire shape:
//   https://<server>/join/<token>
// Resolution is allowed pre-auth so the app can show what's being joined;
// acceptance requires auth and binds the newcomer to the server.
//
// Amended 2026-08-19 (spec §4: invites/profile/roles): an invite is ONE
// shape — an open bearer secret. Acceptance binds to the authenticated
// (issuer, subject); every bind-time condition was ORG POLICY checked in one
// place at acceptance (v1: an email-domain rule, gone with the orgs
// 2026-11-09; every invite link is a public join link now). No per-token claim
// checks, by decision. "Invite by email" is delivery UX, not a security
// artifact. On the wire (built 2026-08-19): the accept path refuses with
// ErrorCode 'policy_refused' (human-readable message, never a cryptic 401);
// Member carried the org-level admin bit (role — membership/policy powers
// only; content plane stays role-flat; on the membership since 2026-11-09). Deferred until human mentions ship:
// a server-unique handle. Attribution keys on member id, never name/handle.

export const InviteToken = z.string().min(16).max(256);
export type InviteToken = z.infer<typeof InviteToken>;

export const ResolveInvite = z.object({ token: InviteToken });
export type ResolveInvite = z.infer<typeof ResolveInvite>;

// Amended 2026-11-09 (spec §4 Invites — one server, no orgs): an invite is
// to ONE space, or it is a person's link — a DM as its target. Accepting
// binds a newcomer to the server, then joins the space (a no-op for a member
// already in it) or opens the DM with the maker (get-or-create). The
// 2026-10-19 shape — an invite to the org listing several spaces, plus the
// org's default spaces — went with the orgs.

/** The space an invite joins, as the pre-auth preview names it. */
export const InviteSpace = z.object({ id: SpaceId, name: z.string() });
export type InviteSpace = z.infer<typeof InviteSpace>;

/** The person a personal link opens a DM with, as the pre-auth preview names them. */
export const InvitePerson = z.object({ id: MemberId, displayName: z.string() });
export type InvitePerson = z.infer<typeof InvitePerson>;

export const ResolveInviteResult = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    /** The space accepting joins. Absent for a personal link, and when the space is gone, archived, or its inviter has left it. */
    space: InviteSpace.optional(),
    /** A personal link: accepting opens the DM with this person. */
    direct: InvitePerson.optional(),
    invitedBy: z.string().optional(),
  }),
  z.object({ state: z.literal('expired') }),
  z.object({ state: z.literal('revoked') }),
]);
export type ResolveInviteResult = z.infer<typeof ResolveInviteResult>;

export const AcceptInvite = z.object({ token: InviteToken });
export type AcceptInvite = z.infer<typeof AcceptInvite>;

export const AcceptInviteResult = z.object({
  /** The caller's membership of the space joined, or of the DM opened; absent when the accept joined nothing. */
  membership: Membership.optional(),
  /** The space joined, or the DM opened; absent when the accept joined nothing. */
  space: Space.optional(),
});
export type AcceptInviteResult = z.infer<typeof AcceptInviteResult>;

export const CreateInvite = z.object({
  /** The space to invite to: one the caller is in. */
  spaceId: SpaceId.optional(),
  /** A personal link instead: accepting opens a DM with the caller. Exactly one of `spaceId` and `direct`. */
  direct: z.literal(true).optional(),
  /** Up to thirty days; seven by default. */
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
