import type { Member } from '@rowboat/spaces-protocol';
import { HarborError } from './errors.js';
import type { Store } from './store.js';

// Fake single-org auth — STUB ONLY. The real Harbor implements the OAuth
// contract stated in the protocol's invite.ts header (well-known discovery,
// DCR, PKCE, refresh tokens). Here a bearer token of the form `dev-<memberId>`
// IS the identity, so client work and tests never wait on the OAuth build.

export function parseDevToken(authorization: string | undefined, queryToken?: string | null): string {
  const raw = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : (queryToken ?? undefined);
  if (!raw) throw new HarborError('unauthorized', 'missing bearer token');
  if (!raw.startsWith('dev-')) {
    throw new HarborError('unauthorized', 'the stub Harbor accepts dev-<memberId> tokens only');
  }
  const memberId = raw.slice('dev-'.length);
  if (!memberId) throw new HarborError('unauthorized', 'empty member id in dev token');
  return memberId;
}

/** First sight of a dev token creates the member — the stub's stand-in for IdP signup. */
export async function ensureMember(store: Store, memberId: string): Promise<Member> {
  const existing = await store.getMember(memberId);
  if (existing) return existing;
  const member: Member = { id: memberId, displayName: prettify(memberId) };
  await store.putMember(member);
  return member;
}

function prettify(id: string): string {
  const name = id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => (w[0]?.toUpperCase() ?? '') + w.slice(1))
    .join(' ');
  return name || id;
}
