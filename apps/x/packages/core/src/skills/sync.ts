import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { WorkDir } from "../config/config.js";

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REPO_OWNER = "rowboatlabs";
const REPO_NAME = "skills";
const BRANCH = "main";
const TARBALL_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/tarball/${BRANCH}`;

const officialDir = path.join(WorkDir, "skills", "official");
const syncStateFile = path.join(WorkDir, "skills", "last-sync.json");

interface SyncState {
    timestamp: string;
    etag: string | null;
}

function log(msg: string) {
    console.log(`[SkillSync] ${msg}`);
}

async function readSyncState(): Promise<SyncState | null> {
    try {
        const raw = await fsp.readFile(syncStateFile, "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function writeSyncState(state: SyncState): Promise<void> {
    await fsp.writeFile(syncStateFile, JSON.stringify(state, null, 2));
}

/**
 * Download and extract the GitHub tarball to the official skills directory.
 * Returns true if new skills were downloaded, false if 304 (not modified).
 */
async function syncFromGitHub(): Promise<boolean> {
    const state = await readSyncState();

    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            "User-Agent": "Rowboat-SkillSync/1.0",
            Accept: "application/vnd.github+json",
        };
        if (state?.etag) {
            headers["If-None-Match"] = state.etag;
        }

        const makeRequest = (url: string) => {
            const mod = url.startsWith("https") ? https : http;
            mod.get(url, { headers }, (res) => {
                // Handle redirects (GitHub returns 302 for tarball)
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const location = res.headers.location;
                    if (location) {
                        makeRequest(location);
                        return;
                    }
                }

                if (res.statusCode === 304) {
                    log("Skills up to date (304 Not Modified)");
                    resolve(false);
                    return;
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`GitHub API returned ${res.statusCode}`));
                    return;
                }

                const newEtag = res.headers.etag ?? null;
                const tmpDir = path.join(WorkDir, "skills", ".sync-tmp");

                // Clean tmp dir
                fs.rmSync(tmpDir, { recursive: true, force: true });
                fs.mkdirSync(tmpDir, { recursive: true });

                const tarPath = path.join(tmpDir, "download.tar.gz");
                const writeStream = fs.createWriteStream(tarPath);

                pipeline(res, writeStream)
                    .then(async () => {
                        // Extract tarball
                        const extractDir = path.join(tmpDir, "extracted");
                        fs.mkdirSync(extractDir, { recursive: true });
                        execSync(`tar -xzf "${tarPath}" -C "${extractDir}"`, { stdio: "pipe" });

                        // GitHub tarballs have a top-level directory like owner-repo-hash/
                        const entries = await fsp.readdir(extractDir);
                        const topDir = entries[0];
                        if (!topDir) {
                            throw new Error("Extracted tarball is empty");
                        }

                        const sourceDir = path.join(extractDir, topDir);

                        // Atomic swap: rename old -> .old, new -> official, delete .old
                        const oldDir = path.join(WorkDir, "skills", ".official-old");
                        fs.rmSync(oldDir, { recursive: true, force: true });

                        const officialExists = fs.existsSync(officialDir);
                        if (officialExists) {
                            await fsp.rename(officialDir, oldDir);
                        }
                        await fsp.rename(sourceDir, officialDir);
                        if (officialExists) {
                            fs.rmSync(oldDir, { recursive: true, force: true });
                        }

                        // Cleanup tmp
                        fs.rmSync(tmpDir, { recursive: true, force: true });

                        // Update sync state
                        await writeSyncState({
                            timestamp: new Date().toISOString(),
                            etag: newEtag,
                        });

                        log("Skills synced from GitHub successfully");
                        resolve(true);
                    })
                    .catch(reject);
            }).on("error", reject);
        };

        makeRequest(TARBALL_URL);
    });
}

async function runSync(): Promise<void> {
    // Ensure official dir exists
    await fsp.mkdir(officialDir, { recursive: true });

    // Try syncing from GitHub
    try {
        await syncFromGitHub();
    } catch (error) {
        log(`Sync failed (will use cached skills): ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function init(): Promise<void> {
    log("Starting skill sync service...");

    // Initial sync
    await runSync();

    // Periodic sync
    const loop = async () => {
        while (true) {
            await new Promise((resolve) => setTimeout(resolve, SYNC_INTERVAL_MS));
            log("Running periodic sync...");
            await runSync();
        }
    };
    loop().catch((error) => {
        log(`Sync loop error: ${error instanceof Error ? error.message : String(error)}`);
    });
}
