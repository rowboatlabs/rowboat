import type { BillingInfo } from '@x/shared/dist/billing.js'

/**
 * A user is "out of credits" when EITHER the daily or the monthly bucket is
 * exhausted. Either exhaustion is what triggers the backend's "not enough
 * credits" API error, and this mirrors the two usage bars shown in Settings
 * (Plan usage = monthly, Daily use = daily). `availableCredits` already comes
 * down in the /v1/me payload, so no extra API work is needed.
 */
export function isOutOfCredits(billing: BillingInfo): boolean {
  return billing.daily.availableCredits <= 0 || billing.monthly.availableCredits <= 0
}

/** Fired when we learn the user is out of credits (billing data or a usage API error). */
export const CREDIT_EXHAUSTED_EVENT = 'credit-status:exhausted'

/** Fired when a successful cost-incurring call (LLM / voice) proves credits are available again. */
export const CREDIT_REPLENISHED_EVENT = 'credit-status:replenished'

export function dispatchCreditExhausted(): void {
  window.dispatchEvent(new Event(CREDIT_EXHAUSTED_EVENT))
}

export function dispatchCreditReplenished(): void {
  window.dispatchEvent(new Event(CREDIT_REPLENISHED_EVENT))
}
