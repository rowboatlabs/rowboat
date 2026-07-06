import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import {
    RowboatAppManifestSchema,
    AppInstallRecordSchema,
    type RowboatAppManifest,
    type AppInstallRecord,
    type AppSummary,
    type RegistryRecord,
} from '@x/shared/dist/rowboat-app.js';
import { WorkDir } from '../config/config.js';
import {
    APPS_DIR,
    FOLDER_SLUG_RE,
    MAX_BUNDLE_COMPRESSED,
    MAX_BUNDLE_UNCOMPRESSED,
    MAX_BUNDLE_ENTRIES,
} from './constants.js';
import { getApp } from './indexer.js';
import { registryClient } from './registry.js';
import { syncAppAgents, deleteAppAgents } from './agents.js';

// Installer (spec §12): two-phase install with D18 capability disclosure,
// zip-slip/symlink/size guards, bundle-identity + capability-mismatch checks,
// defaults→data on first install only, pinned file hashes, one-step rollback.

const TMP_ROOT = path.join(WorkDir, 'tmp');
const URL_STAGING_TTL_MS = 10 * 60 * 1000;

export class InstallError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

export interface InstallPreview {
    status: 'preview';
    name: string;
    version: string;
    description: string;
    capabilities: string[];
    agents: string[];
    /** §12.5 only: whether check-for-update will work after install. */
    updateSource?: 'github' | 'none';
}

export interface InstallDone {
    status: 'installed';
    app: AppSummary;
}

const RELEASE_MANAGED = ['rowboat-app.json', 'dist', 'agents', 'defaults'];

// ---------------------------------------------------------------------------
// Bundle download + extraction (shared by catalog + URL installs)
// ---------------------------------------------------------------------------

async function downloadBundle(url: string, destDir: string): Promise<{ zipPath: string; sha256: string }> {
    await fsp.mkdir(destDir, { recursive: true });
    const zipPath = path.join(destDir, 'bundle.zip');
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new InstallError('download_failed', `bundle download: HTTP ${res.status}`);

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(zipPath);
    const reader = res.body?.getReader();
    if (!reader) throw new InstallError('download_failed', 'empty response body');
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BUNDLE_COMPRESSED) {
            out.destroy();
            await fsp.rm(zipPath, { force: true });
            throw new InstallError('bundle_too_large', `bundle exceeds ${MAX_BUNDLE_COMPRESSED} bytes compressed`);
        }
        hash.update(value);
        await new Promise<void>((resolve, reject) => out.write(value, (e) => (e ? reject(e) : resolve())));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    return { zipPath, sha256: hash.digest('hex') };
}

/**
 * Extract with REQUIRED guards (§12.1 step 4): reject absolute paths, `..`
 * segments, backslashes (zip-slip); reject symlink/hardlink entries; enforce
 * entry-count and cumulative-size limits. Records per-file sha256 (step 7).
 */
async function extractBundle(zipPath: string, pkgDir: string): Promise<Record<string, string>> {
    await fsp.mkdir(pkgDir, { recursive: true });
    const fileHashes: Record<string, string> = {};

    await new Promise<void>((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
            if (err || !zip) return reject(new InstallError('bundle_unreadable', String(err)));
            let entries = 0;
            let uncompressed = 0;

            zip.on('entry', (entry: yauzl.Entry) => {
                entries += 1;
                if (entries > MAX_BUNDLE_ENTRIES) {
                    zip.close();
                    return reject(new InstallError('bundle_too_many_entries', `more than ${MAX_BUNDLE_ENTRIES} entries`));
                }
                const name = entry.fileName;
                if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || name.includes('\0')) {
                    zip.close();
                    return reject(new InstallError('zip_slip', `unsafe entry path: ${name}`));
                }
                // Symlinks/hardlinks: mode is in the top 16 bits of externalFileAttributes.
                const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
                if ((unixMode & 0xf000) === 0xa000) {
                    zip.close();
                    return reject(new InstallError('symlink_entry', `symlink entry rejected: ${name}`));
                }
                if (name.endsWith('/')) {
                    fsp.mkdir(path.join(pkgDir, name), { recursive: true }).then(() => zip.readEntry(), reject);
                    return;
                }
                uncompressed += entry.uncompressedSize;
                if (uncompressed > MAX_BUNDLE_UNCOMPRESSED) {
                    zip.close();
                    return reject(new InstallError('bundle_too_large', `bundle exceeds ${MAX_BUNDLE_UNCOMPRESSED} bytes uncompressed`));
                }
                zip.openReadStream(entry, (streamErr, stream) => {
                    if (streamErr || !stream) {
                        zip.close();
                        return reject(new InstallError('bundle_unreadable', String(streamErr)));
                    }
                    const dest = path.join(pkgDir, name);
                    void fsp.mkdir(path.dirname(dest), { recursive: true }).then(() => {
                        const hash = crypto.createHash('sha256');
                        stream.on('data', (chunk: Buffer) => hash.update(chunk));
                        const out = fs.createWriteStream(dest);
                        stream.pipe(out);
                        out.on('close', () => {
                            fileHashes[name] = hash.digest('hex');
                            zip.readEntry();
                        });
                        out.on('error', reject);
                        stream.on('error', reject);
                    }, reject);
                });
            });
            zip.on('end', () => resolve());
            zip.on('error', (e) => reject(new InstallError('bundle_unreadable', String(e))));
            zip.readEntry();
        });
    });

    return fileHashes;
}

async function copyDefaultsToData(dir: string): Promise<void> {
    const defaultsDir = path.join(dir, 'defaults');
    const dataDir = path.join(dir, 'data');
    await fsp.mkdir(dataDir, { recursive: true });
    try {
        await fsp.cp(defaultsDir, dataDir, { recursive: true, force: false, errorOnExist: false });
    } catch { /* no defaults, or partial copy of existing files — fine */ }
}

async function chooseTargetFolder(name: string): Promise<string> {
    let candidate = name;
    for (let i = 2; fs.existsSync(path.join(APPS_DIR, candidate)); i++) {
        candidate = `${name}-${i}`;
        if (i > 50) throw new InstallError('folder_unavailable', 'could not find a free folder name');
    }
    return candidate;
}

async function assembleInstall(
    pkgDir: string,
    manifest: RowboatAppManifest,
    record: Omit<AppInstallRecord, 'files'> & { files: Record<string, string> },
): Promise<AppSummary> {
    const folder = await chooseTargetFolder(manifest.name);
    const dir = path.join(APPS_DIR, folder);
    try {
        await fsp.mkdir(APPS_DIR, { recursive: true });
        await fsp.rename(pkgDir, dir).catch(async () => {
            // cross-device fallback
            await fsp.cp(pkgDir, dir, { recursive: true });
            await fsp.rm(pkgDir, { recursive: true, force: true });
        });
        await copyDefaultsToData(dir);
        await fsp.writeFile(
            path.join(dir, '.rowboat-install.json'),
            JSON.stringify(AppInstallRecordSchema.parse(record), null, 2),
        );
        const summary = await getApp(folder);
        if (!summary) throw new InstallError('install_failed', 'installed app failed to index');
        await syncAppAgents(summary); // §8.3 materialize disabled
        return summary;
    } catch (e) {
        await fsp.rm(dir, { recursive: true, force: true });
        throw e;
    }
}

function validatePkgManifest(pkgDir: string, expected?: { name: string; version: string }): RowboatAppManifest {
    let manifest: RowboatAppManifest;
    try {
        manifest = RowboatAppManifestSchema.parse(
            JSON.parse(fs.readFileSync(path.join(pkgDir, 'rowboat-app.json'), 'utf-8')),
        );
    } catch (e) {
        throw new InstallError('bundle_mismatch', `bundle manifest missing/invalid: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (expected && (manifest.name !== expected.name || manifest.version !== expected.version)) {
        throw new InstallError('bundle_mismatch',
            `bundle is ${manifest.name}@${manifest.version}, expected ${expected.name}@${expected.version}`);
    }
    return manifest;
}

/** D18 (§12.1 step 6): the bundle must not exceed what the user confirmed. */
function checkCapabilitySubset(bundle: RowboatAppManifest, confirmed: { capabilities: string[]; agents: string[] }): void {
    const extraCaps = bundle.capabilities.filter((c) => !confirmed.capabilities.includes(c));
    const extraAgents = bundle.agents.filter((a) => !confirmed.agents.includes(a));
    if (extraCaps.length || extraAgents.length) {
        throw new InstallError('capability_mismatch',
            `bundle declares more than previewed (capabilities: [${extraCaps.join(', ')}], agents: [${extraAgents.join(', ')}])`);
    }
}

// ---------------------------------------------------------------------------
// Catalog install (§12.1)
// ---------------------------------------------------------------------------

export async function previewInstall(record: RegistryRecord): Promise<InstallPreview> {
    const manifest = await registryClient.latestManifest(record);
    return {
        status: 'preview',
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        capabilities: manifest.capabilities,
        agents: manifest.agents,
    };
}

export async function installFromRegistry(record: RegistryRecord, confirmed: InstallPreview): Promise<InstallDone> {
    const staging = path.join(TMP_ROOT, `app-install-${crypto.randomBytes(4).toString('hex')}`);
    try {
        const bundleUrl = `https://github.com/${record.repo}/releases/latest/download/${record.name}.rowboat-app`;
        const { zipPath, sha256 } = await downloadBundle(bundleUrl, staging);
        const pkgDir = path.join(staging, 'pkg');
        const files = await extractBundle(zipPath, pkgDir);
        const manifest = validatePkgManifest(pkgDir, { name: confirmed.name, version: confirmed.version });
        checkCapabilitySubset(manifest, confirmed);

        const app = await assembleInstall(pkgDir, manifest, {
            name: manifest.name,
            repo: record.repo,
            version: manifest.version,
            sha256,
            installedAt: new Date().toISOString(),
            files,
        });
        return { status: 'installed', app };
    } finally {
        await fsp.rm(staging, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// URL install (§12.5) — two-phase with retained staging
// ---------------------------------------------------------------------------

type UrlStaging = {
    staging: string;
    sha256: string;
    manifest: RowboatAppManifest;
    files: Record<string, string>;
    createdAt: number;
};
const urlStagings = new Map<string, UrlStaging>();

function githubProvenance(url: string): string | undefined {
    const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\//.exec(url);
    return m ? m[1] : undefined;
}

export async function previewUrlInstall(url: string): Promise<InstallPreview> {
    if (!url.startsWith('https:')) throw new InstallError('invalid_url', 'only https URLs are allowed');

    // Reuse fresh staging for the same URL.
    const existing = urlStagings.get(url);
    if (existing && Date.now() - existing.createdAt < URL_STAGING_TTL_MS) {
        return {
            status: 'preview',
            name: existing.manifest.name,
            version: existing.manifest.version,
            description: existing.manifest.description,
            capabilities: existing.manifest.capabilities,
            agents: existing.manifest.agents,
            updateSource: githubProvenance(url) ? 'github' : 'none',
        };
    }

    const staging = path.join(TMP_ROOT, `app-install-${crypto.randomBytes(4).toString('hex')}`);
    const { zipPath, sha256 } = await downloadBundle(url, staging);
    const pkgDir = path.join(staging, 'pkg');
    const files = await extractBundle(zipPath, pkgDir);
    const manifest = validatePkgManifest(pkgDir); // identity comes from the bundle itself
    urlStagings.set(url, { staging, sha256, manifest, files, createdAt: Date.now() });

    return {
        status: 'preview',
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        capabilities: manifest.capabilities,
        agents: manifest.agents,
        updateSource: githubProvenance(url) ? 'github' : 'none',
    };
}

export async function confirmUrlInstall(url: string): Promise<InstallDone> {
    let staged = urlStagings.get(url);
    if (!staged || Date.now() - staged.createdAt >= URL_STAGING_TTL_MS) {
        await previewUrlInstall(url); // re-download if evicted
        staged = urlStagings.get(url);
        if (!staged) throw new InstallError('staging_missing', 'could not stage the bundle');
    }
    urlStagings.delete(url);
    try {
        const repo = githubProvenance(url);
        const app = await assembleInstall(path.join(staged.staging, 'pkg'), staged.manifest, {
            name: staged.manifest.name,
            ...(repo ? { repo } : { sourceUrl: url }),
            version: staged.manifest.version,
            sha256: staged.sha256,
            installedAt: new Date().toISOString(),
            files: staged.files,
        });
        return { status: 'installed', app };
    } finally {
        await fsp.rm(staged.staging, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Update / rollback / uninstall (§12.3–12.4)
// ---------------------------------------------------------------------------

async function readInstallRecord(folder: string): Promise<AppInstallRecord> {
    try {
        return AppInstallRecordSchema.parse(
            JSON.parse(await fsp.readFile(path.join(APPS_DIR, folder, '.rowboat-install.json'), 'utf-8')),
        );
    } catch {
        throw new InstallError('not_installed', `${folder} has no install record`);
    }
}

export async function checkUpdate(folder: string): Promise<{ current: string; latest: string; updateAvailable: boolean }> {
    const install = await readInstallRecord(folder);
    if (!install.repo) throw new InstallError('no_update_source', 'installed from a non-GitHub URL; updates unavailable');
    const record: RegistryRecord = {
        schemaVersion: 1, name: install.name, owner: '', repo: install.repo,
        description: '', createdAt: install.installedAt,
    };
    const latest = await registryClient.latestManifest(record);
    const cmp = compareSemver(latest.version, install.version);
    return { current: install.version, latest: latest.version, updateAvailable: cmp > 0 };
}

function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
}

export async function updateApp(
    folder: string,
    opts: { confirmOverwriteModified?: boolean; confirmNewCapabilities?: boolean } = {},
): Promise<AppSummary> {
    const install = await readInstallRecord(folder);
    if (!install.repo) throw new InstallError('no_update_source', 'updates unavailable for URL installs without GitHub provenance');
    const dir = path.join(APPS_DIR, folder);

    const currentManifest = validatePkgManifest(dir); // current on-disk manifest

    const staging = path.join(TMP_ROOT, `app-update-${crypto.randomBytes(4).toString('hex')}`);
    try {
        const bundleUrl = `https://github.com/${install.repo}/releases/latest/download/${install.name}.rowboat-app`;
        const { zipPath, sha256 } = await downloadBundle(bundleUrl, staging);
        const pkgDir = path.join(staging, 'pkg');
        const files = await extractBundle(zipPath, pkgDir);
        const nextManifest = validatePkgManifest(pkgDir);
        if (nextManifest.name !== install.name) {
            throw new InstallError('bundle_mismatch', `bundle is ${nextManifest.name}, installed app is ${install.name}`);
        }

        // D18 scoped to the diff: an update must not silently widen access.
        const newCaps = nextManifest.capabilities.filter((c) => !currentManifest.capabilities.includes(c));
        const newAgents = nextManifest.agents.filter((a) => !currentManifest.agents.includes(a));
        if ((newCaps.length || newAgents.length) && !opts.confirmNewCapabilities) {
            throw new InstallError('new_capabilities',
                `update adds capabilities [${newCaps.join(', ')}] agents [${newAgents.join(', ')}]; confirm to proceed`);
        }

        // Step 8: warn when locally-modified release-managed files would be lost.
        const modified: string[] = [];
        for (const [rel, hash] of Object.entries(install.files)) {
            try {
                const current = crypto.createHash('sha256')
                    .update(await fsp.readFile(path.join(dir, rel)))
                    .digest('hex');
                if (current !== hash) modified.push(rel);
            } catch {
                modified.push(`${rel} (deleted)`);
            }
        }
        if (modified.length && !opts.confirmOverwriteModified) {
            throw new InstallError('modified_files', modified.join(', '));
        }

        // Steps 9–11: swap with one-step rollback.
        const previousDir = path.join(dir, '.previous');
        await fsp.rm(previousDir, { recursive: true, force: true });
        await fsp.mkdir(previousDir, { recursive: true });
        for (const item of RELEASE_MANAGED) {
            const from = path.join(dir, item);
            if (fs.existsSync(from)) await fsp.rename(from, path.join(previousDir, item));
        }
        try {
            for (const item of RELEASE_MANAGED) {
                const from = path.join(pkgDir, item);
                if (fs.existsSync(from)) await fsp.rename(from, path.join(dir, item));
            }
        } catch (e) {
            // Rollback the half-finished swap.
            for (const item of RELEASE_MANAGED) {
                await fsp.rm(path.join(dir, item), { recursive: true, force: true });
                const backup = path.join(previousDir, item);
                if (fs.existsSync(backup)) await fsp.rename(backup, path.join(dir, item));
            }
            throw e;
        }

        const nextRecord: AppInstallRecord = {
            ...install,
            version: nextManifest.version,
            sha256,
            files,
            updatedAt: new Date().toISOString(),
            previousVersion: install.version,
        };
        await fsp.writeFile(path.join(dir, '.rowboat-install.json'), JSON.stringify(nextRecord, null, 2));

        const summary = await getApp(folder);
        if (!summary) throw new InstallError('update_failed', 'updated app failed to index');
        await syncAppAgents(summary); // §8.4 update semantics
        return summary;
    } finally {
        await fsp.rm(staging, { recursive: true, force: true });
    }
}

export async function rollbackApp(folder: string): Promise<AppSummary> {
    const install = await readInstallRecord(folder);
    const dir = path.join(APPS_DIR, folder);
    const previousDir = path.join(dir, '.previous');
    if (!fs.existsSync(previousDir)) throw new InstallError('no_rollback', 'no previous version retained');

    for (const item of RELEASE_MANAGED) {
        await fsp.rm(path.join(dir, item), { recursive: true, force: true });
        const backup = path.join(previousDir, item);
        if (fs.existsSync(backup)) await fsp.rename(backup, path.join(dir, item));
    }
    await fsp.rm(previousDir, { recursive: true, force: true });

    const restoredManifest = validatePkgManifest(dir);
    const nextRecord: AppInstallRecord = {
        ...install,
        version: restoredManifest.version,
        updatedAt: new Date().toISOString(),
    };
    delete nextRecord.previousVersion;
    await fsp.writeFile(path.join(dir, '.rowboat-install.json'), JSON.stringify(nextRecord, null, 2));

    const summary = await getApp(folder);
    if (!summary) throw new InstallError('rollback_failed', 'rolled-back app failed to index');
    await syncAppAgents(summary);
    return summary;
}

export async function uninstallApp(folder: string): Promise<void> {
    if (!FOLDER_SLUG_RE.test(folder)) throw new InstallError('invalid_folder', folder);
    await readInstallRecord(folder); // must be an installed app
    await deleteAppAgents(folder); // §8.5 (confirmation happens in the renderer)
    await fsp.rm(path.join(APPS_DIR, folder), { recursive: true, force: true });
}

/** Startup hygiene: clear leftover install stagings (§12.1). */
export async function cleanInstallTmp(): Promise<void> {
    try {
        const entries = await fsp.readdir(TMP_ROOT);
        await Promise.all(entries
            .filter((e) => e.startsWith('app-install-') || e.startsWith('app-update-'))
            .map((e) => fsp.rm(path.join(TMP_ROOT, e), { recursive: true, force: true })));
    } catch { /* no tmp dir yet */ }
}
