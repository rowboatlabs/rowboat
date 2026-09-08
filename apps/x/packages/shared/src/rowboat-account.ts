import { z } from 'zod';
import { BillingCatalogSchema } from './billing.js';
import { CreditActivationCatalogEntrySchema } from './credits.js';
import { ReasoningEffort } from './models.js';

// One recommended slot on the wire: a bare model id (legacy — effort Auto)
// or { model, effort? }. Effort is MORE lenient than stored config: any
// unrecognized value (not just null/"auto") normalizes to undefined (= Auto)
// — a backend experimenting with a new level (e.g. "minimal") must degrade
// this hint, never fail the whole /v1/config parse that auth and billing
// also ride on.
const RecommendedChoice = z.union([
  z.string(),
  z.object({
    model: z.string(),
    effort: z.unknown().transform((v) =>
      v === 'low' || v === 'medium' || v === 'high' ? v : undefined,
    ).optional(),
  }),
]);

export const RowboatApiConfig = z.object({
  appUrl: z.string(),
  websocketApiUrl: z.string(),
  supabaseUrl: z.string(),
  // Rowboat Spaces managed apex (org creation) — null/absent until a spaces
  // fleet exists for the environment behind API_URL
  spacesApexUrl: z.string().nullable().optional(),
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
  // services). Two consumers, same rule — never applied over a concrete
  // saved choice: they steer the INITIAL selection when a provider is first
  // connected (see shared/initial-selection.ts), and they are what a saved
  // "auto" sentinel selection resolves to at run time (core/models/auto.ts).
  // The bare-string form is the legacy wire shape, accepted so backend
  // deploy order and rollback are non-events. Local/custom flavors are
  // intentionally absent: the API can't know which models exist in a user's
  // environment. Optional so older API deployments and failed fetches never
  // break parsing — recommendations are best-effort by design.
  modelRecommendations: z.record(z.string(), z.union([
    z.string(),
    z.object({
      assistantModel: RecommendedChoice,
      taskModels: z.record(z.string(), RecommendedChoice).optional(),
    }),
  ])).optional(),
  // App rollout flags. Additive by contract: absent (older API deployments,
  // failed fetches) reads the same as all-false, and each flag is parsed
  // leniently — a backend experimenting with non-boolean values must
  // degrade the flag, never fail the /v1/config parse that auth and
  // billing also ride on. autoModelDefault: fresh Rowboat sign-ins seed
  // the assistant as the Auto selection instead of pinning a concrete
  // model (core/models/rowboat-selection.ts).
  features: z.object({
    autoModelDefault: z.unknown().transform((v) => v === true).optional(),
  }).optional(),
});

export type ModelRecommendations = NonNullable<z.infer<typeof RowboatApiConfig>['modelRecommendations']>;

/** A recommendation slot in canonical form: model id + normalized effort. */
export interface RecommendedModelChoice {
  model: string;
  effort?: z.infer<typeof ReasoningEffort>;
}

export interface NormalizedModelRecommendation {
  assistantModel: RecommendedModelChoice;
  taskModels: Record<string, RecommendedModelChoice>;
}

function normalizeChoice(raw: z.infer<typeof RecommendedChoice>): RecommendedModelChoice {
  if (typeof raw === 'string') return { model: raw };
  return { model: raw.model, ...(raw.effort ? { effort: raw.effort } : {}) };
}

/** One provider's recommendation in canonical form; null when absent. */
export function normalizeModelRecommendation(
  recommendations: ModelRecommendations | undefined,
  flavor: string,
): NormalizedModelRecommendation | null {
  const raw = recommendations?.[flavor];
  if (!raw) return null;
  if (typeof raw === 'string') return { assistantModel: { model: raw }, taskModels: {} };
  return {
    assistantModel: normalizeChoice(raw.assistantModel),
    taskModels: Object.fromEntries(
      Object.entries(raw.taskModels ?? {}).map(([key, value]) => [key, normalizeChoice(value)]),
    ),
  };
}
