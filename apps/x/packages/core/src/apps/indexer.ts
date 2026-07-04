import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import {
    RowboatAppManifestSchema,
    AppInstallRecordSchema,
    AppPublishRecordSchema,
    type RowboatAppManifest,
    type AppSummary,
} from '@x/shared/dist/rowboat-app.js';
import { APPS_DIR, FOLDER_SLUG_RE, appOrigin } from './constants.js';

// Local app management (spec §5). Scan-on-demand; correctness never depends
// on caching.

export function appDir(folder: string): string {
    return path.join(APPS_DIR, folder);
}

async function readJsonIfExists(file: string): Promise<unknown | undefined> {
    try {
        return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
        return undefined;
    }
}

/** Derive the materialized bg-task slug for a bundled agent file (§8.3). */
export function agentTaskSlug(folder: string, agentFile: string): string {
    const base = agentFile.replace(/\.yaml$/, '');
    return `app--${folder}--${base}`;
}

async function summarizeApp(folder: string): Promise<AppSummary | null> {
    const dir = appDir(folder);
    const manifestPath = path.join(dir, 'rowboat-app.json');

    let manifestRaw: string;
    try {
        manifestRaw = await fs.readFile(manifestPath, 'utf-8');
    } catch {
        return null; // no manifest → not an app folder (old prototype folders are ignored)
    }

    let manifest: RowboatAppManifest | undefined;
    let manifestError: string | undefined;
    try {
        const parsed = RowboatAppManifestSchema.safeParse(JSON.parse(manifestRaw));
        if (parsed.success) {
            manifest = parsed.data;
            // entry/icon traversal guard (§4.2): must resolve inside dist/.
            for (const rel of [parsed.data.entry, parsed.data.icon].filter((v): v is string => !!v)) {
                if (rel.includes('..') || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) {
                    manifest = undefined;
                    manifestError = `unsafe path in manifest: ${rel}`;
                    break;
                }
            }
        } else {
            manifestError = parsed.error.issues
                .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
                .join('; ');
        }
    } catch (e) {
        manifestError = `invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }

    const installRaw = await readJsonIfExists(path.join(dir, '.rowboat-install.json'));
    const install = installRaw !== undefined ? AppInstallRecordSchema.safeParse(installRaw) : undefined;
    const publishRaw = await readJsonIfExists(path.join(dir, '.rowboat-publish.json'));
    const publish = publishRaw !== undefined ? AppPublishRecordSchema.safeParse(publishRaw) : undefined;

    let hasDist = false;
    try {
        hasDist = (await fs.stat(path.join(dir, 'dist'))).isDirectory();
    } catch { /* absent */ }

    return {
        folder,
        status: manifest ? 'ok' : 'invalid',
        ...(manifest ? { manifest } : {}),
        ...(manifestError ? { manifestError } : {}),
        origin: appOrigin(folder),
        kind: install?.success ? 'installed' : 'local',
        ...(install?.success ? { install: install.data } : {}),
        ...(publish?.success ? { publish: publish.data } : {}),
        hasDist,
        agentSlugs: (manifest?.agents ?? []).map((f) => agentTaskSlug(folder, f)),
    };
}

/** List all apps under APPS_DIR (§5.1). Invalid manifests are surfaced, not hidden. */
export async function listApps(): Promise<AppSummary[]> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(APPS_DIR, { withFileTypes: true });
    } catch {
        return [];
    }
    const out: AppSummary[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!FOLDER_SLUG_RE.test(entry.name)) {
            if (!entry.name.startsWith('.')) {
                console.warn(`[Apps] ignoring folder with invalid slug: ${entry.name}`);
            }
            continue;
        }
        const summary = await summarizeApp(entry.name);
        if (summary) out.push(summary);
    }
    return out.sort((a, b) => a.folder.localeCompare(b.folder));
}

export async function getApp(folder: string): Promise<AppSummary | null> {
    if (!FOLDER_SLUG_RE.test(folder)) return null;
    return summarizeApp(folder);
}

const SCAFFOLD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New Rowboat app</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .card { text-align: center; color: #555; }
    code { background: rgba(127,127,127,.15); padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1 id="name">Loading…</h1>
    <p id="meta"></p>
    <p>Edit <code>dist/index.html</code> to build this app.</p>
  </div>
  <script>
    fetch('/_rowboat/app').then(function (r) { return r.json(); }).then(function (a) {
      document.getElementById('name').textContent = a.name;
      document.getElementById('meta').textContent = 'v' + a.version + ' · ' + a.folder;
      document.title = a.name;
    }).catch(function () {
      document.getElementById('name').textContent = 'Host API unreachable';
    });
  </script>
</body>
</html>
`;

/** Create a minimal valid app scaffold (§5.2). */
export async function createApp(input: { folder: string; name: string; description: string }): Promise<AppSummary> {
    const { folder, name, description } = input;
    if (!FOLDER_SLUG_RE.test(folder)) throw new Error(`invalid_folder: "${folder}" must match ${FOLDER_SLUG_RE}`);
    const dir = appDir(folder);
    try {
        await fs.mkdir(dir, { recursive: false });
    } catch {
        throw new Error(`folder_exists: ${folder}`);
    }
    const manifest = RowboatAppManifestSchema.parse({
        schemaVersion: 1,
        name,
        version: '0.1.0',
        description,
    });
    await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
    await fs.mkdir(path.join(dir, 'data'), { recursive: true });
    // Pretty-printed manifest (§4.2) — keeps diffs clean in the author's repo.
    await fs.writeFile(path.join(dir, 'rowboat-app.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.writeFile(path.join(dir, 'dist', 'index.html'), SCAFFOLD_HTML);
    const summary = await summarizeApp(folder);
    if (!summary) throw new Error('scaffold_failed');
    return summary;
}

/** Read the app's README.md (root or dist/), if any. Best effort. */
export async function readAppReadme(folder: string): Promise<string | undefined> {
    for (const candidate of ['README.md', 'dist/README.md']) {
        try {
            return await fs.readFile(path.join(appDir(folder), candidate), 'utf-8');
        } catch { /* try next */ }
    }
    return undefined;
}

/** Whether a one-step rollback is available (§12.3: .previous/ exists). */
export async function rollbackAvailable(folder: string): Promise<boolean> {
    try {
        return (await fs.stat(path.join(appDir(folder), '.previous'))).isDirectory();
    } catch {
        return false;
    }
}

/** Delete a local app (§5.3). Installed apps must go through uninstall. */
export async function deleteApp(folder: string): Promise<void> {
    if (!FOLDER_SLUG_RE.test(folder)) throw new Error(`invalid_folder: ${folder}`);
    const dir = appDir(folder);
    try {
        await fs.access(path.join(dir, '.rowboat-install.json'));
        throw new Error('app_is_installed: use uninstall instead');
    } catch (e) {
        if (e instanceof Error && e.message.startsWith('app_is_installed')) throw e;
        // no install record → fine to delete
    }
    await fs.rm(dir, { recursive: true, force: true });
}
