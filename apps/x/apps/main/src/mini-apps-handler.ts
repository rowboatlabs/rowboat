import fs from 'fs';
import path from 'path';
import { WorkDir } from '@x/core/dist/config/config.js';
import { MiniAppManifest } from '@x/shared/dist/mini-app.js';
import type { z } from 'zod';

type Manifest = z.infer<typeof MiniAppManifest>;

// All Mini Apps live under ~/.rowboat/apps/<id>/.
//   manifest.json   — MiniAppManifest
//   dist/           — static assets served via app://miniapp/<id>/
//   data.json       — latest agent output (read by the host)
const APPS_DIR = path.join(WorkDir, 'apps');

function appDir(id: string): string {
  return path.join(APPS_DIR, id);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Seed/refresh built-in apps. Manifest + dist are managed (always overwritten so
 * built-in updates propagate); data.json is written only if missing so a
 * background agent's output is never clobbered.
 */
export function seedApps(apps: Array<{ manifest: Manifest; html: string; data?: unknown }>): { seeded: string[] } {
  const seeded: string[] = [];
  for (const app of apps) {
    const manifest = MiniAppManifest.parse(app.manifest);
    const dir = appDir(manifest.id);
    const distDir = path.join(dir, 'dist');
    ensureDir(distDir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(distDir, 'index.html'), app.html);
    const dataPath = path.join(dir, 'data.json');
    if (app.data !== undefined && !fs.existsSync(dataPath)) {
      fs.writeFileSync(dataPath, JSON.stringify(app.data, null, 2));
    }
    seeded.push(manifest.id);
  }
  return { seeded };
}

/** List installed app manifests (skips folders without a valid manifest). */
export function listApps(): { manifests: Manifest[] } {
  const manifests: Manifest[] = [];
  if (!fs.existsSync(APPS_DIR)) return { manifests };
  for (const entry of fs.readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(APPS_DIR, entry.name, 'manifest.json');
    try {
      const parsed = MiniAppManifest.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
      manifests.push(parsed);
    } catch {
      // skip folders without a valid manifest
    }
  }
  return { manifests };
}

/** Read an app's latest data.json (agent output), or null if absent/invalid. */
export function getAppData(id: string): { data: unknown | null } {
  try {
    const raw = fs.readFileSync(path.join(appDir(id), 'data.json'), 'utf-8');
    return { data: JSON.parse(raw) };
  } catch {
    return { data: null };
  }
}

/**
 * Resolve app://miniapp/<id>/<rel> to an absolute file path under the app's dist
 * dir, guarding against path traversal. Returns null if outside the dist root.
 */
export function resolveMiniAppAsset(id: string, relPath: string): string | null {
  const distRoot = path.resolve(appDir(id), 'dist');
  const clean = relPath.replace(/^\/+/, '') || 'index.html';
  const abs = path.resolve(distRoot, clean);
  if (abs !== distRoot && !abs.startsWith(distRoot + path.sep)) return null;
  return abs;
}
