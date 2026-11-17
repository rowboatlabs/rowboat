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

export const SlackImportSelection = z.object({
  existingChannels: z.enum(['skip', 'append']).optional(),
  workspace: z.string().trim().toLowerCase().min(1).max(128).regex(/^[a-z0-9][a-z0-9.-]*$/, 'Use the Slack workspace domain, e.g. team.slack.com'),
  channelIds: z.array(z.string().min(1).max(128)).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Select each channel once'),
});
export type SlackImportSelection = z.infer<typeof SlackImportSelection>;
export const StartSlackImportInput = SlackPreviewInput.extend(SlackImportSelection.shape);
export const SlackImportJob = z.object({
  existingChannels: z.enum(['skip', 'append']).optional(),
  id: z.string(), workspace: z.string(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  channels: z.array(z.object({ id: z.string(), name: z.string(), spaceId: z.string(), existing: z.boolean().optional(), messages: Count, source: z.object({ private: z.boolean(), archived: z.boolean(), topic: z.string(), purpose: z.string(), memberIds: z.array(z.string()) }), status: z.enum(['pending', 'imported', 'skipped']) })),
  warnings: SlackImportPreview.shape.warnings,
  error: z.string().optional(),
});
export type SlackImportJob = z.infer<typeof SlackImportJob>;

// 2026-11-17: links describe historical authors in one space, never access rights.
export const SlackProfileLink = z.object({
  workspace: z.string(), userId: z.string(), name: z.string(), memberId: z.string().nullable(),
});
export const LinkSlackProfileInput = z.object({ memberId: z.string().min(1).nullable() });
