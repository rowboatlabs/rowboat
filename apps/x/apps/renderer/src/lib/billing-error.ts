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

/**
 * Auth/credit refusals that reach a one-shot LLM call as a bare HTTP status —
 * the gateway answers 403 and the AI SDK surfaces the reason phrase verbatim,
 * so the user sees "Forbidden" with no idea what to do about it. The billing
 * patterns above only match the backend's worded errors, which a raw status
 * never carries.
 */
const AUTH_OR_CREDIT_PATTERN = /\b(?:forbidden|unauthorized|401|403)\b/i

const OUT_OF_CREDITS_TEXT =
  'Out of credits — add credits or configure your own API key in Settings'

/**
 * A model/IPC failure as one line of human text, for surfaces that show the
 * error inline (with their own Retry) rather than through BillingErrorDialog.
 * Anything we don't recognise passes through unchanged rather than being
 * flattened into a generic message, so real diagnostics still reach the user.
 */
export function humanizeModelError(message: string): string {
  const raw = (message ?? '').trim()
  if (!raw) return 'Something went wrong. Try again.'
  const billing = matchBillingError(raw)
  if (billing) {
    return billing.kind === 'out_of_credits'
      ? OUT_OF_CREDITS_TEXT
      : `${billing.title}. ${billing.subtitle}`
  }
  if (AUTH_OR_CREDIT_PATTERN.test(raw)) return OUT_OF_CREDITS_TEXT
  return raw
}
