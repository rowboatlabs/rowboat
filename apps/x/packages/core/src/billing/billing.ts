import { getAccessToken } from '../models/gateway.js';
import { ROWBOAT_BILLING_BASE_URL } from '../config/env.js';

export interface BillingInfo {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  trialUsed: boolean;
  sanctionedCredits: number;
  availableCredits: number;
}

export async function getBillingInfo(): Promise<BillingInfo> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${ROWBOAT_BILLING_BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Billing API failed: ${response.status}`);
  }
  const body = await response.json() as {
    customer: {
      subscriptionPlan: string | null;
      subscriptionStatus: string | null;
      trialUsed: boolean;
    };
    usage: {
      sanctionedCredits: number;
      availableCredits: number;
    };
  };
  return {
    subscriptionPlan: body.customer.subscriptionPlan,
    subscriptionStatus: body.customer.subscriptionStatus,
    trialUsed: body.customer.trialUsed,
    sanctionedCredits: body.usage.sanctionedCredits,
    availableCredits: body.usage.availableCredits,
  };
}
