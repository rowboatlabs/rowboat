import { z } from 'zod';

export const RowboatApiConfig = z.object({
  appUrl: z.string(),
  websocketApiUrl: z.string(),
  supabaseUrl: z.string(),
});
