import type { z } from 'zod';
import type { RowboatApiConfig } from '@x/shared/dist/rowboat-account.js';
import { budgetsForWeek } from './quota.js';
import type { Plan } from './store.js';

export type ApiConfig = z.infer<typeof RowboatApiConfig>;

export interface ControlSettings {
  /** Public URL of this control plane, without a trailing slash. */
  publicUrl: string;
  /** Our Spaces server (Harbor), once deployed; unset: the apps hide Spaces. */
  spacesUrl?: string;
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
 * - `spacesApexUrl` is our own Harbor (apps/harbor) once it is deployed,
 *   null before: the apps never reach the Rowboat Labs fleet (decided
 *   02/10/2026: we host Spaces ourselves).
 * - `composio: false`: `/v1/composio` is off in V1 (TARGET_AGENTIC_ARCHITECTURE
 *   « Désactivé en V1 »), so the apps never call a route that answers 404;
 *   a user's own Composio key still works.
 * - `billing.plans` keeps the upstream shape: `monthlyCredits` carries the
 *   week budget and `dailyCredits` the session budget (architecture §3.5,
 *   quota decided 30/09/2026). The upstream field holds one price, in
 *   cents: the euro price is served there.
 */
export function buildApiConfig(settings: ControlSettings, plans: Plan[] = []): ApiConfig {
  const base = settings.publicUrl.replace(/\/+$/, '');
  return {
    appUrl: base,
    websocketApiUrl: '',
    supabaseUrl: base,
    spacesApexUrl: settings.spacesUrl ? settings.spacesUrl.replace(/\/+$/, '') : null,
    composio: false,
    billing: {
      plans: plans.map((plan) => ({
        id: plan.id,
        category: plan.category,
        displayName: plan.displayName,
        monthlyCredits: plan.weekCredits,
        dailyCredits: budgetsForWeek(plan.weekCredits).sessionCredits,
        monthlyPriceCents: plan.monthlyPrices.find((p) => p.currency === 'EUR')?.amount ?? null,
      })),
    },
  };
}
