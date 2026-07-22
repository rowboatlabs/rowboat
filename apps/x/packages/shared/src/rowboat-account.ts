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
});
