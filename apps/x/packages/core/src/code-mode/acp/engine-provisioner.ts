// Code-mode engine provisioner.
//
// Code mode drives Claude Code / Codex through their ACP adapters, which spawn a heavy
// native engine binary (~200 MB each). We do NOT bundle those engines into the installer
// (that would add ~400 MB). Instead we provision them on demand: the first time an agent
// is used we download the per-platform npm package AT THE EXACT VERSION OUR ADAPTER WAS
// BUILT AGAINST (see engine-manifest.ts), verify its integrity, and extract it into
// ~/.rowboat/engines/<agent>/<version>/. Subsequent runs reuse the cached copy.
//
// The adapters are then pointed at the provisioned binary via CLAUDE_CODE_EXECUTABLE /
// CODEX_PATH (see agents.ts). This keeps the installer small while making code mode work
// out of the box, with no dependency on the user having a global claude/codex install.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ENGINE_MANIFEST } from './engine-manifest.js';
import type { CodingAgent } from './types.js';

export const ENGINES_ROOT = path.join(os.homedir(), '.rowboat', 'engines');

interface PlatformEntry {
    pkg: string;
    pkgVersion: string;
    tarball: string;
    integrity: string;
}

export interface EngineProgress {
    phase: 'check' | 'download' | 'verify' | 'extract' | 'done';
    /** Bytes received so far (download phase). */
    receivedBytes?: number;
    /** Total bytes, when the server reports content-length. */
    totalBytes?: number;
}

export interface EnsureEngineOptions {
    onProgress?: (p: EngineProgress) => void;
    signal?: AbortSignal;
}

export interface ProvisionedEngine {
    executablePath: string;
    version: string;
}

// Map this process's platform/arch (+ libc on linux) to a manifest platform key for the
// given agent. Returns null when no engine is published for this platform.
function platformKey(agent: CodingAgent): string | null {
    const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
    if (!arch) return null;
    const plats = ENGINE_MANIFEST[agent].platforms as Record<string, PlatformEntry>;
    const candidates: string[] = [];
    if (process.platform === 'darwin') {
        candidates.push(`darwin-${arch}`);
    } else if (process.platform === 'win32') {
        candidates.push(`win32-${arch}`);
    } else if (process.platform === 'linux') {
        // Prefer a musl build on musl systems (Alpine); fall back to the glibc build.
        if (isMuslLibc()) candidates.push(`linux-${arch}-musl`);
        candidates.push(`linux-${arch}`);
    }
    return candidates.find((c) => c in plats) ?? null;
}

// glibc builds expose a glibcVersionRuntime in the process report header; musl (Alpine)
// does not. Same heuristic Node's native-addon loaders use.
function isMuslLibc(): boolean {
    try {
        const report = (process as unknown as { report?: { getReport?: () => unknown } }).report?.getReport?.();
        const header = (report as { header?: Record<string, unknown> } | undefined)?.header;
        return !(header && 'glibcVersionRuntime' in header);
    } catch {
        return false;
    }
}

// Locate the engine executable inside an extracted package root. We extract the whole npm
// package (so codex's bundled ripgrep travels with it), then find the binary.
function locateExecutable(agent: CodingAgent, root: string): string | null {
    if (agent === 'claude') {
        for (const name of ['claude', 'claude.exe']) {
            const p = path.join(root, name);
            if (fs.existsSync(p)) return p;
        }
        return null;
    }
    // codex: vendor/<target-triple>/codex/codex[.exe]
    const vendor = path.join(root, 'vendor');
    if (!fs.existsSync(vendor)) return null;
    for (const triple of fs.readdirSync(vendor)) {
        for (const name of ['codex', 'codex.exe']) {
            const p = path.join(vendor, triple, 'codex', name);
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

async function downloadTo(url: string, dest: string, opts: EnsureEngineOptions): Promise<void> {
    opts.onProgress?.({ phase: 'download', receivedBytes: 0 });
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok || !res.body) {
        throw new Error(`Code mode: engine download failed (HTTP ${res.status}) — ${url}`);
    }
    const total = Number(res.headers.get('content-length')) || undefined;
    let received = 0;
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (chunk: Buffer) => {
        received += chunk.length;
        opts.onProgress?.({ phase: 'download', receivedBytes: received, totalBytes: total });
    });
    await pipeline(body, fs.createWriteStream(dest));
}

// Verify the tarball against the npm Subresource Integrity string ("sha512-<base64>").
function verifyIntegrity(file: string, integrity: string): void {
    const dash = integrity.indexOf('-');
    const algo = integrity.slice(0, dash);
    const expected = integrity.slice(dash + 1);
    const actual = crypto.createHash(algo).update(fs.readFileSync(file)).digest('base64');
    if (actual !== expected) {
        throw new Error(`Code mode: engine integrity check failed (${algo}) — download may be corrupt.`);
    }
}

// Extract an npm tarball, stripping its leading `package/` component so the package
// contents land directly in destDir. Uses the system tar (bsdtar on macOS/Windows 10+,
// GNU tar on Linux) — all support -xzf and --strip-components.
function extractTarball(tarPath: string, destDir: string): void {
    const r = spawnSync('tar', ['-xzf', tarPath, '-C', destDir, '--strip-components=1'], { stdio: 'pipe' });
    if (r.status !== 0) {
        const err = r.stderr?.toString().trim() || r.error?.message || `tar exited ${r.status}`;
        throw new Error(`Code mode: failed to extract engine — ${err}`);
    }
}

// Mark the engine (and codex's bundled ripgrep) executable on unix.
function makeExecutable(agent: CodingAgent, root: string, exe: string): void {
    fs.chmodSync(exe, 0o755);
    if (agent === 'codex') {
        const vendor = path.join(root, 'vendor');
        for (const triple of fs.existsSync(vendor) ? fs.readdirSync(vendor) : []) {
            const rg = path.join(vendor, triple, 'path', 'rg');
            if (fs.existsSync(rg)) fs.chmodSync(rg, 0o755);
        }
    }
}

/**
 * Ensure the pinned engine for `agent` is provisioned locally, downloading it on first
 * use. Returns the absolute path to the engine executable. Idempotent and cached.
 */
export async function ensureEngine(agent: CodingAgent, opts: EnsureEngineOptions = {}): Promise<ProvisionedEngine> {
    const entry = ENGINE_MANIFEST[agent];
    const version = entry.version;
    const key = platformKey(agent);
    if (!key) {
        throw new Error(`Code mode: no ${agent} engine is available for ${process.platform}/${process.arch}.`);
    }
    const plat = (entry.platforms as Record<string, PlatformEntry>)[key];

    const agentRoot = path.join(ENGINES_ROOT, agent);
    const versionDir = path.join(agentRoot, version);
    const metaDir = path.join(agentRoot, '.meta');
    const metaPath = path.join(metaDir, `${agent}-${version}.json`);

    opts.onProgress?.({ phase: 'check' });
    // Fast path: already provisioned and intact.
    const existing = locateExecutable(agent, versionDir);
    if (existing && fs.existsSync(metaPath)) {
        opts.onProgress?.({ phase: 'done' });
        return { executablePath: existing, version };
    }

    // Download to a unique temp dir, verify, extract, then swap into place. Concurrent
    // callers each use their own temp dir; the final rename is idempotent (same content).
    fs.mkdirSync(agentRoot, { recursive: true });
    const tmpRoot = fs.mkdtempSync(path.join(agentRoot, `.tmp-${version}-`));
    try {
        const tarPath = path.join(tmpRoot, 'engine.tgz');
        await downloadTo(plat.tarball, tarPath, opts);

        opts.onProgress?.({ phase: 'verify' });
        verifyIntegrity(tarPath, plat.integrity);

        opts.onProgress?.({ phase: 'extract' });
        const extractDir = path.join(tmpRoot, 'pkg');
        fs.mkdirSync(extractDir);
        extractTarball(tarPath, extractDir);

        const exe = locateExecutable(agent, extractDir);
        if (!exe) {
            throw new Error(`Code mode: ${agent} engine binary not found in the downloaded package.`);
        }
        if (process.platform !== 'win32') makeExecutable(agent, extractDir, exe);

        // Swap the freshly extracted package into the versioned location.
        if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true, force: true });
        fs.renameSync(extractDir, versionDir);

        const finalExe = locateExecutable(agent, versionDir);
        if (!finalExe) {
            throw new Error(`Code mode: ${agent} engine binary missing after install.`);
        }
        fs.mkdirSync(metaDir, { recursive: true });
        fs.writeFileSync(metaPath, JSON.stringify({
            version,
            platform: key,
            integrity: plat.integrity,
            binRelPath: path.relative(versionDir, finalExe),
        }, null, 2));

        opts.onProgress?.({ phase: 'done' });
        return { executablePath: finalExe, version };
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
}
