import { isSignedIn } from '../account/account.js';
import { getBillingInfo } from '../billing/billing.js';
import { identify } from './posthog.js';

/**
 * If the user has rowboat OAuth tokens, fetch their billing info and
 * call posthog.identify(). Idempotent — safe to call on every app start.
 * Catches all errors so analytics never blocks app launch.
 */
export async function identifyIfSignedIn(): Promise<void> {
  try {
    if (!(await isSignedIn())) return;
    const billing = await getBillingInfo();
    if (!billing.userId) return;
    identify(billing.userId, {
      ...(billing.userEmail ? { email: billing.userEmail } : {}),
      plan: billing.subscriptionPlan,
      status: billing.subscriptionStatus,
    });
  } catch (err) {
    console.error('[Analytics] startup identify failed:', err);
  }
}
