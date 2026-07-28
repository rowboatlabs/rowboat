import { z } from 'zod';
import { BillingCatalogSchema } from './billing.js';
import { CreditActivationCatalogEntrySchema } from './credits.js';

export const RowboatApiConfig = z.object({
  appUrl: z.string(),
  websocketApiUrl: z.string(),
  supabaseUrl: z.string(),
  billing: BillingCatalogSchema,
  // first-time-action reward catalog (non-archived entries); optional so the
  // app keeps working against API deployments that predate it — the rewards
  // UI just stays empty until the backend serves the catalog
  creditActivations: z.array(CreditActivationCatalogEntrySchema).optional(),
  // Recommended models per provider FLAVOR, in each provider's native id
  // format: one assistantModel (the primary) plus optional per-task
  // taskModels overrides mirroring models.json v2 vocabulary (a missing
  // task key = inherit the assistant — task recs exist only where the
  // intended model differs; for rowboat they reproduce the pre-v2 curated
  // lite-tier task models so plan credits aren't burned by background
  // services). Hints for the INITIAL selection when a provider is first
  // connected — never a catalog, and never applied over a saved choice
  // (see shared/initial-selection.ts). The bare-string form is the legacy
  // wire shape, accepted so backend deploy order and rollback are
  // non-events. Local/custom flavors are intentionally absent: the API
  // can't know which models exist in a user's environment. Optional so
  // older API deployments and failed fetches never break parsing —
  // recommendations are best-effort by design.
  modelRecommendations: z.record(z.string(), z.union([
    z.string(),
    z.object({
      assistantModel: z.string(),
      taskModels: z.record(z.string(), z.string()).optional(),
    }),
  ])).optional(),
});

export type ModelRecommendations = NonNullable<z.infer<typeof RowboatApiConfig>['modelRecommendations']>;

export interface NormalizedModelRecommendation {
  assistantModel: string;
  taskModels: Record<string, string>;
}

/** One provider's recommendation in canonical form; null when absent. */
export function normalizeModelRecommendation(
  recommendations: ModelRecommendations | undefined,
  flavor: string,
): NormalizedModelRecommendation | null {
  const raw = recommendations?.[flavor];
  if (!raw) return null;
  if (typeof raw === 'string') return { assistantModel: raw, taskModels: {} };
  return { assistantModel: raw.assistantModel, taskModels: raw.taskModels ?? {} };
}
