import { z } from 'zod';

/**
 * Manifest for a Mini App stored at ~/.rowboat/apps/<id>/manifest.json.
 *
 * Static assets are served from `<id>/dist/` via app://miniapp/<id>/. The
 * optional `agent` links a background task (bg-tasks engine) that writes
 * `<id>/data.json`, which the host reads and pushes to the app.
 */
export const MiniAppManifest = z.object({
  /** Stable slug; also the on-disk folder name and the app:// host path. */
  id: z.string(),
  /** Display name shown on the card and in the open view. */
  title: z.string(),
  /** One-line description for the card. */
  description: z.string().default(''),
  /** Primary integration shown in the card footer pill (e.g. 'GitHub'). */
  source: z.string().default(''),
  /** Composio toolkits this app may use; enforced host-side on bridge calls. */
  scope: z.array(z.string()).default([]),
  /** Whether the app's agent is active (drives the status badge). */
  active: z.boolean().default(true),
  /** Human last-run label for the card footer (e.g. '2m ago'). */
  lastRun: z.string().default(''),
  /** Entry file within the app folder, served via app://miniapp/<id>/. */
  entry: z.string().default('dist/index.html'),
  /** Optional associated background-task slug that produces data.json. */
  agent: z.string().optional(),
});

export type MiniAppManifest = z.infer<typeof MiniAppManifest>;
