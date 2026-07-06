import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {
    RegistryRecordSchema,
    RowboatAppManifestSchema,
    type RegistryRecord,
    type RowboatAppManifest,
} from '@x/shared/dist/rowboat-app.js';
import { REGISTRY_REPO, REGISTRY_BRANCH, CATALOG_CACHE_PATH, CATALOG_TTL_MS } from './constants.js';

// Registry client (spec §9.2). All registry access goes through RegistryClient —
// this is the backend swap seam (D5). The GitHub implementation reads the
// registry repo as one unauthenticated tarball and resolves versions via
// release-asset URLs (plain HTTPS redirects, no API quota).

export interface RegisterResult {
    status: 'published' | 'pending' | 'rejected';
    prUrl?: string;
    rejectionCode?: string;
}

export interface RegistryClient {
    refreshIndex(force?: boolean): Promise<{ records: RegistryRecord[]; stale: boolean; fetchedAt: string }>;
    resolve(name: string): Promise<RegistryRecord | null>;
    search(query: string): Promise<RegistryRecord[]>;
    latestManifest(record: RegistryRecord): Promise<RowboatAppManifest>;
}

type CatalogCache = { fetchedAt: string; records: RegistryRecord[] };

// ---------------------------------------------------------------------------
// Minimal tar reader — enough to pull apps/*.json out of a codeload tarball.
// ---------------------------------------------------------------------------

function* tarEntries(tarBuf: Buffer): Generator<{ name: string; body: Buffer }> {
    let offset = 0;
    while (offset + 512 <= tarBuf.length) {
        const header = tarBuf.subarray(offset, offset + 512);
        if (header.every((b) => b === 0)) break; // end-of-archive
        const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '');
        const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim();
        const size = parseInt(sizeOctal, 8) || 0;
        const body = tarBuf.subarray(offset + 512, offset + 512 + size);
        yield { name, body: Buffer.from(body) };
        offset += 512 + Math.ceil(size / 512) * 512;
    }
}

async function readCache(): Promise<CatalogCache | null> {
    try {
        return JSON.parse(await fs.readFile(CATALOG_CACHE_PATH, 'utf-8')) as CatalogCache;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// GitHub implementation
// ---------------------------------------------------------------------------

export class GitHubRegistryClient implements RegistryClient {
    async refreshIndex(force = false): Promise<{ records: RegistryRecord[]; stale: boolean; fetchedAt: string }> {
        const cache = await readCache();
        if (!force && cache && Date.now() - new Date(cache.fetchedAt).getTime() < CATALOG_TTL_MS) {
            return { records: cache.records, stale: false, fetchedAt: cache.fetchedAt };
        }

        try {
            const res = await fetch(`https://codeload.github.com/${REGISTRY_REPO}/tar.gz/${REGISTRY_BRANCH}`);
            if (!res.ok) throw new Error(`registry tarball: HTTP ${res.status}`);
            const gz = Buffer.from(await res.arrayBuffer());
            const tar = zlib.gunzipSync(gz);

            const records: RegistryRecord[] = [];
            for (const entry of tarEntries(tar)) {
                // Entries look like "<repo>-<branch>/apps/<name>.json".
                const m = /^[^/]+\/apps\/([^/]+)\.json$/.exec(entry.name);
                if (!m) continue;
                try {
                    const parsed = RegistryRecordSchema.safeParse(JSON.parse(entry.body.toString('utf-8')));
                    if (parsed.success) {
                        records.push(parsed.data);
                    } else {
                        console.warn(`[Apps] registry record ${m[1]} failed schema; skipping`);
                    }
                } catch {
                    console.warn(`[Apps] registry record ${m[1]} is invalid JSON; skipping`);
                }
            }
            records.sort((a, b) => a.name.localeCompare(b.name));

            const fetchedAt = new Date().toISOString();
            await fs.mkdir(path.dirname(CATALOG_CACHE_PATH), { recursive: true });
            await fs.writeFile(CATALOG_CACHE_PATH, JSON.stringify({ fetchedAt, records } satisfies CatalogCache, null, 2));
            return { records, stale: false, fetchedAt };
        } catch (err) {
            // Network failure with a cache present → serve cache, marked stale.
            if (cache) return { records: cache.records, stale: true, fetchedAt: cache.fetchedAt };
            throw err;
        }
    }

    async resolve(name: string): Promise<RegistryRecord | null> {
        const cache = await readCache();
        if (cache && Date.now() - new Date(cache.fetchedAt).getTime() < CATALOG_TTL_MS) {
            return cache.records.find((r) => r.name === name) ?? null;
        }
        try {
            const res = await fetch(`https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_BRANCH}/apps/${name}.json`);
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`registry record: HTTP ${res.status}`);
            const parsed = RegistryRecordSchema.safeParse(await res.json());
            return parsed.success ? parsed.data : null;
        } catch {
            // Fall back to any cache we have, however old.
            return cache?.records.find((r) => r.name === name) ?? null;
        }
    }

    async search(query: string): Promise<RegistryRecord[]> {
        const { records } = await this.refreshIndex();
        const q = query.trim().toLowerCase();
        if (!q) return records;
        return records.filter((r) =>
            r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    }

    /**
     * Latest version's manifest via the release-asset URL — a plain HTTPS
     * redirect, NOT the REST API, so it costs no unauthenticated API quota.
     */
    async latestManifest(record: RegistryRecord): Promise<RowboatAppManifest> {
        const res = await fetch(`https://github.com/${record.repo}/releases/latest/download/rowboat-app.json`, {
            redirect: 'follow',
        });
        if (!res.ok) throw new Error(`latest_manifest_unavailable: HTTP ${res.status}`);
        const manifest = RowboatAppManifestSchema.parse(await res.json());
        if (manifest.name !== record.name) {
            throw new Error(`name_mismatch: release manifest says "${manifest.name}" but the registry record is "${record.name}"`);
        }
        return manifest;
    }
}

export const registryClient: RegistryClient = new GitHubRegistryClient();
