import { getAccessToken } from '../auth/tokens.js';
import { API_URL } from '../config/env.js';
import type { BillingInfo, BillingPlanId } from '@x/shared/dist/billing.js';
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
        };
        daily: {
          sanctionedCredits: number;
          usedCredits: number;
          availableCredits: number;
          usageDay: string;
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
  };
}
