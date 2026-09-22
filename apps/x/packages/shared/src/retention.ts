import { z } from 'zod';

/**
 * Storage retention settings — the daily sweep that keeps
 * `$WorkDir/storage/` from growing forever.
 *
 * Two policies, one switch:
 * - Chats: sessions whose last activity is older than `chatDays` are
 *   deleted via the session layer (session file + the full turn chain,
 *   including sub-agent child turns).
 * - Task transcripts: sessionless turn files (note creation, background
 *   tasks, knowledge sync, …) older than `taskDays` are deleted unless
 *   they are still reachable from a live session. Only the run transcripts
 *   go — the notes/files those runs produced are never touched.
 *
 * `noticeShown` is the legacy startup gate, initialized by the renderer.
 * The startup popup was removed on 2026-09-22 for onboarding simplification;
 * the persisted field remains so existing retention settings stay compatible.
 */

export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;

const days = z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS);

export const RetentionSettingsSchema = z.object({
  enabled: z.boolean(),
  // null = never auto-delete chats (task-transcript cleanup still runs).
  chatDays: days.nullable(),
  taskDays: days,
  noticeShown: z.boolean(),
});

export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>;

/** Renderer-updatable subset; `taskDays`/`noticeShown` stay runtime-managed. */
export const RetentionSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  chatDays: days.nullable().optional(),
});

export type RetentionSettingsUpdate = z.infer<typeof RetentionSettingsUpdateSchema>;

export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  enabled: true,
  chatDays: 60,
  taskDays: 14,
  noticeShown: false,
};
