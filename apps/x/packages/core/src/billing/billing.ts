import { getAccessToken } from '../auth/tokens.js';
import { API_URL } from '../config/env.js';
import { MediaCreditsSchema, PlanOffersSchema, type BillingInfo, type BillingPlanId, type MediaCredits, type PlanOffers } from '@x/shared/dist/billing.js';
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
    // BAARALI(03/10/2026): sent for an admin's account only.
    admin?: { url?: unknown };
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
    adminUrl: typeof body.admin?.url === 'string' ? body.admin.url : null,
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

/**
 * The media credits as the usage page shows them (control /v1/media/*,
 * Baarali, 03/10/2026). Null when the API serves none (an upstream
 * deployment) or cannot be reached: the page says so.
 */
export async function getMediaCredits(): Promise<MediaCredits | null> {
  try {
    const accessToken = await getAccessToken();
    const get = async (path: string) => {
      const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.json() as Promise<Record<string, unknown>>;
    };
    const [models, history, packs] = await Promise.all([get('/v1/media/models'), get('/v1/media/history'), get('/v1/media/packs')]);
    const costs = Array.isArray(models.data)
      ? (models.data as { kind: string; name: string; credits: number }[]).map(({ kind, name, credits }) => ({ kind, name, credits }))
      : [];
    return MediaCreditsSchema.parse({
      balance: models.balance,
      history: history.data,
      packs: packs.data,
      costs,
    });
  } catch {
    return null;
  }
}
