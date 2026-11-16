import { z } from 'zod';

// 2026-11-16: preview is ephemeral; only summaries leave the parser.
export const MAX_SLACK_ZIP_BYTES = 25 * 1024 * 1024;
export const SlackPreviewInput = z.object({
  bytes: z.string().min(4).max(Math.ceil(MAX_SLACK_ZIP_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Expected base64 ZIP bytes')
    .refine(value => value.length % 4 === 0, 'Expected padded base64 ZIP bytes'),
});
const Count = z.number().int().nonnegative();
export const SlackImportPreview = z.object({
  channels: z.array(z.object({
    id: z.string(), name: z.string(), private: z.boolean(), archived: z.boolean(),
    messages: Count, replies: Count, authors: Count,
    firstTimestamp: z.string().optional(), lastTimestamp: z.string().optional(),
  })),
  warnings: z.array(z.object({ code: z.string(), path: z.string(), record: Count.optional(), detail: z.string() })),
  records: z.object({ read: Count, accepted: Count, skipped: Count, superseded: Count }),
});
export type SlackImportPreview = z.infer<typeof SlackImportPreview>;
