import { getAccessToken } from '../models/gateway.js';
import { API_URL } from '../config/env.js';

export interface BillingInfo {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  sanctionedCredits: number;
  availableCredits: number;
}

export async function getBillingInfo(): Promise<BillingInfo> {
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
      plan: string | null;
      status: string | null;
      usage: {
        sanctionedCredits: number;
        availableCredits: number;
      };
    };
  };
  return {
    subscriptionPlan: body.billing.plan,
    subscriptionStatus: body.billing.status,
    sanctionedCredits: body.billing.usage.sanctionedCredits,
    availableCredits: body.billing.usage.availableCredits,
  };
}
