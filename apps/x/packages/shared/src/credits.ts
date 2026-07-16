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

export const CreditsStateSchema = z.object({
  // Rewards are feature-flagged (PostHog `credit-rewards`, ROWBOAT_CREDITS
  // env override in dev); when off, no UI shows and no activation fires.
  enabled: z.boolean(),
  // signed in to Rowboat AND on the free tier — rewards target free users,
  // so BYOK-only setups and paid plans (starter/pro) are excluded. All UI
  // surfaces gate on this.
  eligible: z.boolean(),
  activities: z.array(CreditActivityStateSchema),
});
export type CreditsState = z.infer<typeof CreditsStateSchema>;

// Payload of the main → renderer `credits:didActivate` event, emitted after
// the backend confirms a grant.
export const CreditActivatedEventSchema = z.object({
  code: CreditActivityCodeSchema,
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
