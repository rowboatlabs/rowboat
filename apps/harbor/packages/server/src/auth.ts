import type { Member } from '@rowboat/spaces-protocol';
import { HarborError } from './errors.js';
import type { Store } from './store.js';

// The auth-driver boundary (spec §4). Two steps the dev stub used to conflate:
//
//   authenticate(token)        → identity (iss, sub, profile claims)
//   resolveMember(identity)    → member of THIS org, or not_a_member
//
// The `dev` driver below keeps the stub behavior (bearer `dev-<memberId>` IS
// the identity; first sight creates the member) — it runs every existing test
// and stays the local-dev default, guarded by a loud warning in main.ts. The
// real driver is auth-oidc.ts: pinned issuer, JWKS-verified JWTs, and a
// lookup that NEVER auto-creates — a valid token with no mapping is the
// not_a_member state the invite ceremony converts.

/** Who the token proves you are. `iss` namespaces `sub` (spec §4). */
export interface AuthIdentity {
  iss: string;
  sub: string;
  /** IdP-verified profile claims, used to seed displayName at invite binding. */
  email?: string;
  name?: string;
}

export interface AuthDriver {
  /**
   * Validate credentials → identity. `queryToken` supports the WS face
   * (browsers cannot set headers on WebSocket upgrades).
   * Throws HarborError('unauthorized') for missing/invalid/expired tokens.
   */
  authenticate(authorization: string | undefined, queryToken?: string | null): Promise<AuthIdentity>;
  /** Identity → member. Throws HarborError('not_a_member') when unmapped. */
  resolveMember(store: Store, identity: AuthIdentity): Promise<Member>;
  /**
   * RFC 9728 protected-resource metadata source. Undefined = no AS configured
   * (dev driver): the well-known route 404s and 401s carry no pointer.
   */
  metadata?(): { authorizationServers: string[] } | undefined;
}

// --- dev driver --------------------------------------------------------------

export const DEV_ISSUER = 'dev';

export function parseDevToken(authorization: string | undefined, queryToken?: string | null): string {
  const raw = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : (queryToken ?? undefined);
  if (!raw) throw new HarborError('unauthorized', 'missing bearer token');
  if (!raw.startsWith('dev-')) {
    throw new HarborError('unauthorized', 'this Harbor accepts dev-<memberId> tokens only (dev auth)');
  }
  const memberId = raw.slice('dev-'.length);
  if (!memberId) throw new HarborError('unauthorized', 'empty member id in dev token');
  return memberId;
}

/** First sight of a dev token creates the member — the stub's stand-in for the invite ceremony. */
export async function ensureMember(store: Store, memberId: string): Promise<Member> {
  const existing = await store.getMember(memberId);
  if (existing) return existing;
  const member: Member = { id: memberId, displayName: prettify(memberId), role: 'member' };
  await store.putMember(member);
  return member;
}

export class DevAuthDriver implements AuthDriver {
  async authenticate(authorization: string | undefined, queryToken?: string | null): Promise<AuthIdentity> {
    return { iss: DEV_ISSUER, sub: parseDevToken(authorization, queryToken) };
  }

  async resolveMember(store: Store, identity: AuthIdentity): Promise<Member> {
    return ensureMember(store, identity.sub);
  }
}

function prettify(id: string): string {
  const name = id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => (w[0]?.toUpperCase() ?? '') + w.slice(1))
    .join(' ');
  return name || id;
}
