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
  // One recommended model id per provider FLAVOR (e.g. { openai: "gpt-5.4",
  // openrouter: "anthropic/claude-opus-4.8" }), in each provider's native id
  // format. A hint for the INITIAL selection when a provider is first
  // connected — never a catalog, and never applied over a saved choice
  // (see core/models/initial-selection.ts). Local/custom flavors are
  // intentionally absent: the API can't know which models exist in a user's
  // environment. Optional so older API deployments and failed fetches never
  // break parsing — recommendations are best-effort by design.
  modelRecommendations: z.record(z.string(), z.string()).optional(),
});
