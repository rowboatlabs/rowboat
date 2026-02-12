import { z } from 'zod';

export const ExecutionProfile = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local') }),
  z.object({
    mode: z.literal('cloud'),
    session: z.object({
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      userId: z.string(),
    }),
  }),
]);

export type ExecutionProfile = z.infer<typeof ExecutionProfile>;
