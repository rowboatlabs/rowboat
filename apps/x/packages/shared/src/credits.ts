import { z } from 'zod';
import { CREDITS_PER_DOLLAR } from './billing.js';

// First-time-action credit rewards.
//
// Only the activity CODES are known to the app — they anchor the trigger call
// sites (which action fires which code) and per-code UI like icons and
// navigation. Everything else (display name, description, credit amount) is
// the backend catalog's to define and comes from GET /v1/config
// `creditActivations`; the app never hardcodes amounts or copy, so the
// catalog can change without an app release. Codes present in the config but
// unknown to this app version are ignored (nothing here can trigger them);
// known codes absent from the config are treated as retired and hidden.
export const CreditActivityCodeSchema = z.enum([
  'first_gmail_connected',
  'first_email_sent',
  'first_meeting_note',
  'first_bg_agent',
  'first_app_built',
]);
export type CreditActivityCode = z.infer<typeof CreditActivityCodeSchema>;

// One catalog entry as served by GET /v1/config — `code` is an open string
// because the backend may serve codes this app version doesn't know yet.
export const CreditActivationCatalogEntrySchema = z.object({
  code: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  credits: z.number(),
});
export type CreditActivationCatalogEntry = z.infer<typeof CreditActivationCatalogEntrySchema>;

export const CreditActivityStateSchema = z.object({
  code: CreditActivityCodeSchema,
  title: z.string(),
  description: z.string().optional(),
  credits: z.number(),
  claimed: z.boolean(),
});
export type CreditActivityState = z.infer<typeof CreditActivityStateSchema>;

// Referral ("invite friends") state, from GET /v1/referral. The code is the
// caller's permanent invite code; the backend grants both sides credits per
// successful claim, up to maxClaims claims of one code. `claimedByMe` is
// whether THIS account has redeemed someone else's code (from the local
// claimed cache — the backend rejects repeats either way).
export const ReferralStateSchema = z.object({
  // canonical display form, e.g. ABC-DEF-GHJ
  code: z.string(),
  claimsUsed: z.number(),
  maxClaims: z.number(),
  // what the inviter earns per claim / what the invited person earns
  referrerCredits: z.number(),
  refereeCredits: z.number(),
  claimedByMe: z.boolean(),
});
export type ReferralState = z.infer<typeof ReferralStateSchema>;

// Result of redeeming an invite code (`referral:claim`). Failure messages are
// already user-presentable (the backend's own copy where available).
export const ReferralClaimResultSchema = z.union([
  z.object({ ok: z.literal(true), creditsGranted: z.number() }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type ReferralClaimResult = z.infer<typeof ReferralClaimResultSchema>;

export const CreditsStateSchema = z.object({
  // Rewards are feature-flagged (PostHog `credit-rewards`, ROWBOAT_CREDITS
  // env override in dev); when off, no UI shows and no activation fires.
  enabled: z.boolean(),
  // signed in to Rowboat AND on the free tier — rewards target free users,
  // so BYOK-only setups and paid plans (starter/pro) are excluded. All UI
  // surfaces gate on this.
  eligible: z.boolean(),
  activities: z.array(CreditActivityStateSchema),
  // absent when not eligible or the referral status fetch failed
  referral: ReferralStateSchema.optional(),
});
export type CreditsState = z.infer<typeof CreditsStateSchema>;

// Payload of the main → renderer `credits:didActivate` event, emitted after
// the backend confirms a grant — either a first-time-action activation or a
// redeemed invite code (`referral_claimed`).
export const CreditActivatedEventSchema = z.object({
  code: z.union([CreditActivityCodeSchema, z.literal('referral_claimed')]),
  title: z.string(),
  // actual granted amount, from the backend response
  credits: z.number(),
});
export type CreditActivatedEvent = z.infer<typeof CreditActivatedEventSchema>;

/** Format a raw credit amount as a dollar string, e.g. 100_000_000 → "$1". */
export function formatCreditsAsDollars(credits: number): string {
  const dollars = credits / CREDITS_PER_DOLLAR;
  const rounded = Math.round(dollars * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}
