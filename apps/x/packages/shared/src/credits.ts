import { z } from 'zod';
import { CREDITS_PER_DOLLAR } from './billing.js';

// First-time-action credit rewards.
//
// Each activity maps to an activation code in the backend's credit-activation
// catalog (rowboatx-backend packages/shared/src/billing/credit-activations.ts).
// The app calls POST /v1/billing/credit-activations with the code when the
// user completes the action; the backend grants the credits at most once per
// (customer, code). This catalog is display metadata only — the granted
// amount is whatever the backend returns.
export const CreditActivityCodeSchema = z.enum([
  'first_gmail_connected',
  'first_email_sent',
  'first_meeting_note',
  'first_bg_agent',
  'first_app_built',
]);
export type CreditActivityCode = z.infer<typeof CreditActivityCodeSchema>;

export interface CreditActivity {
  code: CreditActivityCode;
  title: string;
  description: string;
  // expected reward, for display before the action is done; the backend
  // catalog is the source of truth for what is actually granted
  credits: number;
}

export const CREDIT_ACTIVITIES: CreditActivity[] = [
  {
    code: 'first_gmail_connected',
    title: 'Connect Gmail',
    description: 'Link your Google account to sync email and calendar',
    credits: CREDITS_PER_DOLLAR * 1,
  },
  {
    code: 'first_email_sent',
    title: 'Send an email',
    description: 'Send your first email from inside Rowboat',
    credits: CREDITS_PER_DOLLAR * 1,
  },
  {
    code: 'first_meeting_note',
    title: 'Take meeting notes',
    description: 'Record a meeting and let Rowboat write the notes',
    credits: CREDITS_PER_DOLLAR * 1,
  },
  {
    code: 'first_bg_agent',
    title: 'Set up a background agent',
    description: 'Create an agent that works for you on a schedule or trigger',
    credits: CREDITS_PER_DOLLAR * 1,
  },
  {
    code: 'first_app_built',
    title: 'Build an app',
    description: 'Create your first Rowboat app',
    credits: CREDITS_PER_DOLLAR * 1,
  },
];

export const CreditActivityStateSchema = z.object({
  code: CreditActivityCodeSchema,
  title: z.string(),
  description: z.string(),
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
