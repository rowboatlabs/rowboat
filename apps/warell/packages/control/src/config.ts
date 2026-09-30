import type { z } from 'zod';
import type { RowboatApiConfig } from '@x/shared/dist/rowboat-account.js';
import { budgetsForWeek } from './quota.js';
import type { Plan } from './store.js';

export type ApiConfig = z.infer<typeof RowboatApiConfig>;

export interface ControlSettings {
  /** Public URL of this control plane, without a trailing slash. */
  publicUrl: string;
}

/**
 * Body of `GET /v1/config`, the route every instance reads first (core
 * `config/remote-config.ts`). Same schema as the Rowboat Labs backend so the
 * upstream client works unchanged (architecture §3.5, 30/09/2026).
 *
 * - `supabaseUrl` is the OIDC issuer base: core appends `/auth/v1`. The
 *   control plane is that issuer (architecture §3.5, login by phone).
 * - `websocketApiUrl` stays empty until the voice phase (roadmap phase 8):
 *   core then fails voice with an explicit error instead of calling Rowboat.
 * - `spacesApexUrl` is null: no managed Spaces fleet in V1.
 * - `billing.plans` keeps the upstream shape: `monthlyCredits` carries the
 *   week budget and `dailyCredits` the session budget (architecture §3.5,
 *   quota decided 30/09/2026). No price is served until one is decided.
 */
export function buildApiConfig(settings: ControlSettings, plans: Plan[] = []): ApiConfig {
  const base = settings.publicUrl.replace(/\/+$/, '');
  return {
    appUrl: base,
    websocketApiUrl: '',
    supabaseUrl: base,
    spacesApexUrl: null,
    billing: {
      plans: plans.map((plan) => ({
        id: plan.id,
        category: plan.category,
        displayName: plan.displayName,
        monthlyCredits: plan.weekCredits,
        dailyCredits: budgetsForWeek(plan.weekCredits).sessionCredits,
        monthlyPriceCents: null,
      })),
    },
  };
}
