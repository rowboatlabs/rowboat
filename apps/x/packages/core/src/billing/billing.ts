import { getAccessToken } from '../auth/tokens.js';
import { API_URL } from '../config/env.js';
import { PlanOffersSchema, type BillingInfo, type BillingPlanId, type PlanOffers } from '@x/shared/dist/billing.js';
import { getRowboatConfig } from '../config/rowboat.js';

export async function getBillingInfo(): Promise<BillingInfo> {
  const config = await getRowboatConfig();
  const accessToken = await getAccessToken();
  const response = await fetch(`${API_URL}/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Billing API failed: ${response.status}`);
  }
  const body = await response.json() as {
    user: {
      id: string;
      email: string;
    };
    billing: {
      planId: BillingPlanId | null;
      status: string | null;
      trialExpiresAt: string | null;
      usage: {
        monthly: {
          sanctionedCredits: number;
          usedCredits: number;
          availableCredits: number;
          resetsAt?: string;
        };
        daily: {
          sanctionedCredits: number;
          usedCredits: number;
          availableCredits: number;
          usageDay: string;
          resetsAt?: string;
        };
        // credit-store bucket; absent on API deployments that predate grants
        store?: {
          availableCredits: number;
        };
      };
    };
  };
  return {
    userEmail: body.user.email ?? null,
    userId: body.user.id ?? null,
    subscriptionPlanId: body.billing.planId,
    subscriptionStatus: body.billing.status,
    trialExpiresAt: body.billing.trialExpiresAt ?? null,
    catalog: config.billing,
    monthly: body.billing.usage.monthly,
    daily: body.billing.usage.daily,
    store: {
      availableCredits: body.billing.usage.store?.availableCredits ?? 0,
    },
  };
}

/**
 * The plans as Baarali's pricing page words them (control GET /v1/plans),
 * for the app's own window. Null when the API serves none (an upstream
 * deployment) or cannot be reached: the window says so.
 */
export async function getPlanOffers(lang: 'fr' | 'en'): Promise<PlanOffers | null> {
  try {
    const response = await fetch(`${API_URL}/v1/plans?lang=${lang}`);
    if (!response.ok) return null;
    return PlanOffersSchema.parse(await response.json());
  } catch {
    return null;
  }
}
