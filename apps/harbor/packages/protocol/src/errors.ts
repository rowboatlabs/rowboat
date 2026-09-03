import { z } from 'zod';

// Decision 6 (CONTRACT.md), error half. Conflicts are NOT errors — a stale base
// returns ProposeChangeResult{outcome:'conflict'} with HTTP 200, because it is
// a normal outcome of the merge-then-correct model, not a failure.

export const ErrorCode = z.enum([
  /** Missing/expired/invalid token. Re-run the OAuth journey. */
  'unauthorized',
  /** Authenticated but not allowed (e.g. not a member of the space). */
  'forbidden',
  /**
   * Valid token, but the identity maps to no member of this org — the join
   * flow's entry point (spec §4: acceptance binds (issuer, subject) → member).
   * Distinct from `unauthorized` (re-auth won't help) and `forbidden`
   * (which presumes membership).
   */
  'not_a_member',
  /**
   * Org policy refused the bind (spec §4, amended 2026-08-19: all bind-time
   * gating is org policy — v1 is the email-domain rule). The message is the
   * human-readable reason ("this org admits only @acme.com accounts") —
   * never a cryptic 401.
   */
  'policy_refused',
  'not_found',
  /** Path failed AssetPath rules or org policy (e.g. non-text in v1). */
  'invalid_path',
  'payload_too_large',
  /** Org is over a limit knob: writes rejected, reads still work (spec §4: read-only, never lockout). */
  'read_only_limit',
  'rate_limited',
  /** Malformed request body — schema validation failed. */
  'invalid_request',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  /** True where retrying the identical request later can succeed (rate_limited, internal). */
  retryable: z.boolean(),
});
export type ApiError = z.infer<typeof ApiError>;
