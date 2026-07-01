import { z } from 'zod';
import { BillingCatalogSchema } from './billing.js';

export const RowboatApiConfig = z.object({
  appUrl: z.string(),
  websocketApiUrl: z.string(),
  supabaseUrl: z.string(),
  billing: BillingCatalogSchema,
});
