export const BILLING_ERROR_PATTERNS = [
  {
    kind: 'subscription_required',
    pattern: /upgrade required/i,
    title: 'A subscription is required',
    subtitle: 'Get started with a plan to access AI features in Rowboat.',
    cta: 'Subscribe',
  },
  {
    kind: 'out_of_credits',
    pattern: /not enough credits/i,
    title: "You've run out of credits",
    subtitle: 'Upgrade your plan for more usage. Daily usage resets at 00:00 UTC.',
    cta: 'Upgrade plan',
  },
  {
    kind: 'subscription_inactive',
    pattern: /subscription not active/i,
    title: 'Your subscription is inactive',
    subtitle: 'Reactivate your subscription to continue using AI features.',
    cta: 'Reactivate',
  },
] as const

export type BillingErrorMatch = (typeof BILLING_ERROR_PATTERNS)[number]

export function matchBillingError(message: string): BillingErrorMatch | null {
  return BILLING_ERROR_PATTERNS.find(({ pattern }) => pattern.test(message)) ?? null
}
