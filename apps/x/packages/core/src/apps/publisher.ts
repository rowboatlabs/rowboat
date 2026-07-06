import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
    RowboatAppManifestSchema,
    AppPublishRecordSchema,
    PACKAGE_NAME_RE,
    type RowboatAppManifest,
    type AppPublishRecord,
    type RegistryRecord,
} from '@x/shared/dist/rowboat-app.js';
import { WorkDir } from '../config/config.js';
import { REGISTRY_REPO } from './constants.js';
import { appDir } from './indexer.js';
import { packageApp } from './packager.js';
import { registryClient } from './registry.js';
import { getGithubToken, clearAuth } from './github-auth.js';

// Publisher (spec §11): guided first publish as a resumable state machine —
// each step is persisted to .rowboat-publish.json so a failed publish resumes
// instead of duplicating side effects.

export class PublishError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

const STEPS = ['packaged', 'repo_created', 'source_pushed', 'release_created', 'assets_uploaded', 'registered', 'published'] as const;
export type PublishStep = typeof STEPS[number];

export type PublishProgress = (step: PublishStep | 'polling', detail?: string) => void;

// ---------------------------------------------------------------------------
// GitHub REST helpers
// ---------------------------------------------------------------------------

async function gh<T = unknown>(token: string, method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
        await clearAuth();
        throw new PublishError('github_auth_expired', 'GitHub session expired; sign in again');
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new PublishError('github_api_error', `${method} ${url}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? (undefined as T) : (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Publish record persistence
// ---------------------------------------------------------------------------

function publishRecordPath(folder: string): string {
    return path.join(appDir(folder), '.rowboat-publish.json');
}

async function readPublishRecord(folder: string): Promise<AppPublishRecord | null> {
    try {
        return AppPublishRecordSchema.parse(JSON.parse(await fsp.readFile(publishRecordPath(folder), 'utf-8')));
    } catch {
        return null;
    }
}

async function writePublishRecord(folder: string, record: AppPublishRecord): Promise<void> {
    await fsp.writeFile(publishRecordPath(folder), JSON.stringify(record, null, 2));
}

// ---------------------------------------------------------------------------
// Preflight (§11.1)
// ---------------------------------------------------------------------------

async function preflight(folder: string, firstPublish: boolean): Promise<{ manifest: RowboatAppManifest; token: string; login: string }> {
    let manifest: RowboatAppManifest;
    try {
        manifest = RowboatAppManifestSchema.parse(
            JSON.parse(await fsp.readFile(path.join(appDir(folder), 'rowboat-app.json'), 'utf-8')),
        );
    } catch (e) {
        throw new PublishError('invalid_manifest', e instanceof Error ? e.message : String(e));
    }
    if (!PACKAGE_NAME_RE.test(manifest.name)) throw new PublishError('invalid_name', `"${manifest.name}" is not a valid package name`);
    const entryAbs = path.join(appDir(folder), 'dist', manifest.entry);
    if (!fs.existsSync(entryAbs)) throw new PublishError('missing_entry', `dist/${manifest.entry} does not exist`);

    const auth = await getGithubToken();
    if (!auth) throw new PublishError('not_signed_in', 'sign in to GitHub to publish');

    if (firstPublish) {
        const existing = await registryClient.resolve(manifest.name).catch(() => null);
        if (existing) throw new PublishError('name_taken', `"${manifest.name}" is already registered`);
    }
    return { manifest, token: auth.token, login: auth.login };
}

// ---------------------------------------------------------------------------
// Source push (§11.2 step 3) — one commit via the Git Data API
// ---------------------------------------------------------------------------

const PUSH_EXCLUDES = new Set(['data', 'node_modules', '.previous']);

async function collectSourceFiles(dir: string, rel = ''): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.name.startsWith('.')) continue; // dotfiles incl. .rowboat-*.json
        if (PUSH_EXCLUDES.has(entry.name) && !rel) continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) out.push(...await collectSourceFiles(dir, relPath));
        else if (entry.isFile()) out.push(relPath);
    }
    return out;
}

function generatedReadme(manifest: RowboatAppManifest): string {
    return `# ${manifest.name}

${manifest.description || 'A Rowboat app.'}

## Install in Rowboat

Open Rowboat → Apps → Catalog → search for **${manifest.name}** → Install.
${manifest.agents.length ? `\nBundled background agents: ${manifest.agents.map((a) => `\`${a}\``).join(', ')} (installed disabled; enable them in Rowboat).\n` : ''}`;
}

function generatedLicense(holder: string): string {
    const year = new Date().getFullYear();
    return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

async function pushSource(token: string, login: string, repoName: string, folder: string, manifest: RowboatAppManifest, version: string): Promise<void> {
    const dir = appDir(folder);
    const files = await collectSourceFiles(dir);

    // The Git Data API (blobs/trees/commits) answers 409 "Git Repository is
    // empty" on a repo with no commits — it cannot bootstrap an empty repo.
    // Ensure main exists first via the Contents API, then chain onto it.
    let parents: string[] = [];
    try {
        const ref = await gh<{ object: { sha: string } }>(token, 'GET', `/repos/${login}/${repoName}/git/ref/heads/main`);
        parents = [ref.object.sha];
    } catch {
        await gh(token, 'PUT', `/repos/${login}/${repoName}/contents/README.md`, {
            message: 'bootstrap',
            content: Buffer.from(generatedReadme(manifest)).toString('base64'),
            branch: 'main',
        });
        const ref = await gh<{ object: { sha: string } }>(token, 'GET', `/repos/${login}/${repoName}/git/ref/heads/main`);
        parents = [ref.object.sha];
    }

    type TreeEntry = { path: string; mode: '100644'; type: 'blob'; sha: string };
    const tree: TreeEntry[] = [];
    for (const rel of files) {
        const content = await fsp.readFile(path.join(dir, rel));
        const blob = await gh<{ sha: string }>(token, 'POST', `/repos/${login}/${repoName}/git/blobs`, {
            content: content.toString('base64'),
            encoding: 'base64',
        });
        tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
    }
    // Generated companions when the author has none (§11.2 step 3).
    const addGenerated = async (relPath: string, content: string) => {
        if (files.some((f) => f.toLowerCase() === relPath.toLowerCase())) return;
        const blob = await gh<{ sha: string }>(token, 'POST', `/repos/${login}/${repoName}/git/blobs`, {
            content: Buffer.from(content).toString('base64'), encoding: 'base64',
        });
        tree.push({ path: relPath, mode: '100644', type: 'blob', sha: blob.sha });
    };
    await addGenerated('README.md', generatedReadme(manifest));
    await addGenerated('LICENSE', generatedLicense(login));
    await addGenerated('.gitignore', 'data/\nnode_modules/\n.rowboat-install.json\n.rowboat-publish.json\n.previous/\n');

    const treeRes = await gh<{ sha: string }>(token, 'POST', `/repos/${login}/${repoName}/git/trees`, { tree });

    const commit = await gh<{ sha: string }>(token, 'POST', `/repos/${login}/${repoName}/git/commits`, {
        message: `Publish ${manifest.name} v${version}`,
        tree: treeRes.sha,
        parents,
    });

    await gh(token, 'PATCH', `/repos/${login}/${repoName}/git/refs/heads/main`, { sha: commit.sha, force: false });
}

async function uploadAsset(token: string, uploadUrlBase: string, name: string, data: Buffer, contentType: string): Promise<void> {
    const res = await fetch(`${uploadUrlBase}?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': contentType,
            'Content-Length': String(data.length),
        },
        body: new Uint8Array(data),
    });
    if (!res.ok && res.status !== 422) { // 422 = asset already exists (resume)
        throw new PublishError('asset_upload_failed', `upload ${name}: HTTP ${res.status}`);
    }
}

// ---------------------------------------------------------------------------
// Guided first publish (§11.2)
// ---------------------------------------------------------------------------

export async function publishApp(
    folder: string,
    onProgress: PublishProgress = () => undefined,
): Promise<{ status: 'published' | 'pending'; repoUrl: string; releaseUrl: string; prUrl?: string }> {
    const { manifest, token, login } = await preflight(folder, true);
    const name = manifest.name;
    const repoUrl = `https://github.com/${login}/${name}`;
    const releaseUrl = `${repoUrl}/releases/tag/v${manifest.version}`;

    const prior = await readPublishRecord(folder);
    const completed = new Set(prior?.pendingSteps?.version === manifest.version ? prior.pendingSteps.completed : []);
    let releaseId = prior?.pendingSteps?.releaseId;
    let prUrl = prior?.pendingSteps?.prUrl;

    const record: AppPublishRecord = {
        name, login, repo: `${login}/${name}`,
        pendingSteps: { version: manifest.version, completed: [...completed], ...(releaseId ? { releaseId } : {}), ...(prUrl ? { prUrl } : {}) },
    };
    const mark = async (step: PublishStep) => {
        completed.add(step);
        record.pendingSteps = { version: manifest.version, completed: [...completed], ...(releaseId ? { releaseId } : {}), ...(prUrl ? { prUrl } : {}) };
        await writePublishRecord(folder, record);
        onProgress(step);
    };

    // 1. packaged
    const outDir = path.join(WorkDir, 'tmp', `app-publish-${name}`);
    const pkg = await packageApp(folder, outDir);
    await mark('packaged');

    // 2. repo_created (resume-aware)
    if (!completed.has('repo_created')) {
        try {
            await gh(token, 'POST', '/user/repos', { name, description: manifest.description, visibility: 'public', auto_init: false });
        } catch (e) {
            const exists = await gh(token, 'GET', `/repos/${login}/${name}`).then(() => true).catch(() => false);
            if (!exists) throw e;
        }
        await mark('repo_created');
    }

    // 3. source_pushed
    if (!completed.has('source_pushed')) {
        await pushSource(token, login, name, folder, manifest, manifest.version);
        await mark('source_pushed');
    }

    // 4. release_created
    if (!completed.has('release_created') || !releaseId) {
        try {
            const release = await gh<{ id: number }>(token, 'POST', `/repos/${login}/${name}/releases`, {
                tag_name: `v${manifest.version}`, name: `v${manifest.version}`, body: `sha256: ${pkg.sha256}`,
            });
            releaseId = release.id;
        } catch {
            const existing = await gh<{ id: number }>(token, 'GET', `/repos/${login}/${name}/releases/tags/v${manifest.version}`);
            releaseId = existing.id;
        }
        await mark('release_created');
    }

    // 5. assets_uploaded (both REQUIRED — the standalone manifest powers update checks)
    if (!completed.has('assets_uploaded')) {
        const uploadBase = `https://uploads.github.com/repos/${login}/${name}/releases/${releaseId}/assets`;
        await uploadAsset(token, uploadBase, `${name}.rowboat-app`, await fsp.readFile(pkg.bundlePath), 'application/zip');
        await uploadAsset(token, uploadBase, 'rowboat-app.json',
            Buffer.from(await fsp.readFile(path.join(appDir(folder), 'rowboat-app.json'))), 'application/json');
        await mark('assets_uploaded');
    }

    // 7. registered — fork + branch + record + PR
    if (!completed.has('registered')) {
        const [registryOwner, registryName] = REGISTRY_REPO.split('/');
        await gh(token, 'POST', `/repos/${REGISTRY_REPO}/forks`).catch(() => undefined);
        // Forks are async — poll up to 60s.
        const forkRepo = `${login}/${registryName}`;
        let forked = false;
        for (let i = 0; i < 30; i++) {
            forked = await gh(token, 'GET', `/repos/${forkRepo}`).then(() => true).catch(() => false);
            if (forked) break;
            await new Promise((r) => setTimeout(r, 2000));
        }
        if (!forked) throw new PublishError('fork_timeout', `fork of ${REGISTRY_REPO} did not appear`);

        const upstreamMain = await gh<{ object: { sha: string } }>(token, 'GET', `/repos/${REGISTRY_REPO}/git/ref/heads/main`);
        const branch = `publish-${name}`;
        await gh(token, 'POST', `/repos/${forkRepo}/git/refs`, { ref: `refs/heads/${branch}`, sha: upstreamMain.object.sha })
            .catch(() => undefined); // resume: branch may exist

        const registryRecord: RegistryRecord = {
            schemaVersion: 1, name, owner: login, repo: `${login}/${name}`,
            description: manifest.description,
            ...(manifest.icon ? { iconUrl: `https://raw.githubusercontent.com/${login}/${name}/HEAD/dist/${manifest.icon}` } : {}),
            createdAt: new Date().toISOString(),
        };
        await gh(token, 'PUT', `/repos/${forkRepo}/contents/apps/${name}.json`, {
            message: `publish: ${name}`,
            content: Buffer.from(JSON.stringify(registryRecord, null, 2) + '\n').toString('base64'),
            branch,
        });

        const pr = await gh<{ html_url: string }>(token, 'POST', `/repos/${REGISTRY_REPO}/pulls`, {
            title: `publish: ${name}`, head: `${login}:${branch}`, base: 'main',
        }).catch(async () => {
            // resume: PR may already exist
            const open = await gh<Array<{ html_url: string }>>(token, 'GET',
                `/repos/${REGISTRY_REPO}/pulls?head=${login}:${branch}&state=all`);
            if (!open.length) throw new PublishError('pr_failed', 'could not open the registry PR');
            return open[0];
        });
        prUrl = pr.html_url;
        void registryOwner;
        await mark('registered');
    }

    // 8. published — poll the PR (10s cadence, 5-min timeout)
    onProgress('polling', prUrl);
    const prNumber = prUrl ? Number(prUrl.split('/').pop()) : NaN;
    for (let i = 0; i < 30 && prUrl && Number.isFinite(prNumber); i++) {
        const pr = await gh<{ merged: boolean; state: string }>(token, 'GET', `/repos/${REGISTRY_REPO}/pulls/${prNumber}`);
        if (pr.merged) {
            await writePublishRecord(folder, {
                name, login, repo: `${login}/${name}`,
                lastPublishedVersion: manifest.version, lastSha256: pkg.sha256,
            });
            onProgress('published');
            return { status: 'published', repoUrl, releaseUrl, prUrl };
        }
        if (pr.state === 'closed') {
            const comments = await gh<Array<{ body: string }>>(token, 'GET', `/repos/${REGISTRY_REPO}/issues/${prNumber}/comments`);
            const rejection = comments.map((c) => /^rejected: (\S+)/m.exec(c.body)?.[1]).find(Boolean);
            throw new PublishError(rejection ?? 'registry_rejected', `registry PR was closed (${rejection ?? 'see PR'})`);
        }
        await new Promise((r) => setTimeout(r, 10_000));
    }
    return { status: 'pending', repoUrl, releaseUrl, prUrl };
}

// ---------------------------------------------------------------------------
// Publish update (§11.3) — no registry interaction (D5)
// ---------------------------------------------------------------------------

export async function publishUpdate(
    folder: string,
    increment: 'patch' | 'minor' | 'major',
): Promise<{ version: string; releaseUrl: string }> {
    const record = await readPublishRecord(folder);
    if (!record) throw new PublishError('not_published', 'this app has not been published yet');
    const { manifest, token, login } = await preflight(folder, false);
    if (record.login !== login) throw new PublishError('wrong_account', `published by ${record.login}; signed in as ${login}`);

    const [maj, min, pat] = manifest.version.split('.').map(Number);
    const version = increment === 'major' ? `${maj + 1}.0.0` : increment === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

    // Bump the manifest (pretty-printed, §4.2).
    const manifestPath = path.join(appDir(folder), 'rowboat-app.json');
    const raw = JSON.parse(await fsp.readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
    raw.version = version;
    await fsp.writeFile(manifestPath, JSON.stringify(raw, null, 2) + '\n');

    const repoName = record.repo.split('/')[1];
    const pkg = await packageApp(folder, path.join(WorkDir, 'tmp', `app-publish-${manifest.name}`));
    await pushSource(token, login, repoName, folder, { ...manifest, version } as RowboatAppManifest, version);
    const release = await gh<{ id: number }>(token, 'POST', `/repos/${record.repo}/releases`, {
        tag_name: `v${version}`, name: `v${version}`, body: `sha256: ${pkg.sha256}`,
    });
    const uploadBase = `https://uploads.github.com/repos/${record.repo}/releases/${release.id}/assets`;
    await uploadAsset(token, uploadBase, `${manifest.name}.rowboat-app`, await fsp.readFile(pkg.bundlePath), 'application/zip');
    await uploadAsset(token, uploadBase, 'rowboat-app.json', Buffer.from(await fsp.readFile(manifestPath)), 'application/json');

    await writePublishRecord(folder, { ...record, lastPublishedVersion: version, lastSha256: pkg.sha256, pendingSteps: undefined });
    return { version, releaseUrl: `https://github.com/${record.repo}/releases/tag/v${version}` };
}

// ---------------------------------------------------------------------------
// Advanced path (§11.5): register an existing GitHub release
// ---------------------------------------------------------------------------

export async function registerExisting(name: string, repo: string): Promise<{ status: 'published' | 'pending'; prUrl: string }> {
    const auth = await getGithubToken();
    if (!auth) throw new PublishError('not_signed_in', 'sign in to GitHub first');
    if (!PACKAGE_NAME_RE.test(name)) throw new PublishError('invalid_name', name);

    // Courtesy client-side probe of §9.3 check 7.
    const probe = await fetch(`https://github.com/${repo}/releases/latest/download/${name}.rowboat-app`, { method: 'HEAD', redirect: 'follow' });
    if (!probe.ok) throw new PublishError('missing_release_asset', `releases/latest has no ${name}.rowboat-app`);

    const [, registryName] = REGISTRY_REPO.split('/');
    await gh(auth.token, 'POST', `/repos/${REGISTRY_REPO}/forks`).catch(() => undefined);
    const forkRepo = `${auth.login}/${registryName}`;
    for (let i = 0; i < 30; i++) {
        if (await gh(auth.token, 'GET', `/repos/${forkRepo}`).then(() => true).catch(() => false)) break;
        await new Promise((r) => setTimeout(r, 2000));
    }
    const upstreamMain = await gh<{ object: { sha: string } }>(auth.token, 'GET', `/repos/${REGISTRY_REPO}/git/ref/heads/main`);
    const branch = `publish-${name}`;
    await gh(auth.token, 'POST', `/repos/${forkRepo}/git/refs`, { ref: `refs/heads/${branch}`, sha: upstreamMain.object.sha }).catch(() => undefined);
    const record: RegistryRecord = {
        schemaVersion: 1, name, owner: auth.login, repo, description: '', createdAt: new Date().toISOString(),
    };
    await gh(auth.token, 'PUT', `/repos/${forkRepo}/contents/apps/${name}.json`, {
        message: `publish: ${name}`,
        content: Buffer.from(JSON.stringify(record, null, 2) + '\n').toString('base64'),
        branch,
    });
    const pr = await gh<{ html_url: string }>(auth.token, 'POST', `/repos/${REGISTRY_REPO}/pulls`, {
        title: `publish: ${name}`, head: `${auth.login}:${branch}`, base: 'main',
    });
    return { status: 'pending', prUrl: pr.html_url };
}
