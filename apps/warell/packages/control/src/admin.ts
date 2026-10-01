import { timingSafeEqual } from 'node:crypto';
import type { Money } from './pricing.js';
import { hashToken, type ControlStore } from './store.js';

// Operator routes. Media credits are added here by hand until a payment rail
// calls the same rule (decided 01/10/2026: credits first, payments after).
// Without an admin token they do not exist (404), so a deployment that never
// set one exposes nothing.

/** A pack as sold: its prices and the credits it gives (pricing.ts, packCredits). */
export interface SoldPack {
  id: string;
  credits: number;
  prices: Money[];
}

export interface AdminDeps {
  store: ControlStore;
  /** SHA-256 of the admin token (hashToken); unset: admin routes answer 404. */
  adminTokenHash?: string;
  packs: SoldPack[];
  now: () => number;
}

export function isAdmin(deps: AdminDeps, token: string | null): boolean {
  if (!deps.adminTokenHash || !token) return false;
  const given = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(deps.adminTokenHash, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Adds one pack to an account. `reference` names the payment it answers (a
 * receipt, a mobile money transaction): the same reference twice adds once.
 */
export async function topUpMedia(deps: AdminDeps, req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: { code: 'invalid_request', message: 'Expected a JSON object' } }, { status: 400 });
  }
  const pack = deps.packs.find((p) => p.id === body.pack);
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!pack || !reference || typeof body.account_id !== 'string') {
    return Response.json(
      { error: { code: 'invalid_request', message: `Expected account_id, reference and pack, one of: ${deps.packs.map((p) => p.id).join(', ')}` } },
      { status: 400 },
    );
  }
  const account = await deps.store.account(body.account_id);
  if (!account) return Response.json({ error: { code: 'not_found', message: 'No such account' } }, { status: 404 });

  const result = await deps.store.applyMediaEntry({
    accountId: account.id,
    at: deps.now(),
    kind: 'topup',
    credits: pack.credits,
    reference,
  });
  return Response.json({
    added: result === 'applied' ? pack.credits : 0,
    duplicate: result === 'duplicate',
    balance: await deps.store.mediaBalance(account.id),
  });
}
