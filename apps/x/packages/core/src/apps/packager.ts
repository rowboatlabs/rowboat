import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yazl from 'yazl';
import { RowboatAppManifestSchema, type RowboatAppManifest } from '@x/shared/dist/rowboat-app.js';
import { appDir } from './indexer.js';

// Packager (spec §4.4): builds the `<name>.rowboat-app` ZIP from the ALLOWLIST
// only — rowboat-app.json, dist/**, agents/<manifest.agents>, defaults/** — in
// sorted path order (determinism). Personal data cannot leak by omission (D15):
// src/, package.json, node_modules/, data/, dotfiles, and .rowboat-*.json are
// simply never on the list. Symlinks are skipped with a warning, never followed.

export class PackageError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

/** Recursively collect files under root; returns package-relative POSIX paths. */
async function collectFiles(absRoot: string, relPrefix: string, warnings: string[]): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
        entries = await fsp.readdir(absRoot, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const abs = path.join(absRoot, entry.name);
        const rel = `${relPrefix}/${entry.name}`;
        if (entry.isSymbolicLink()) {
            warnings.push(`skipped symlink: ${rel}`);
            continue;
        }
        if (entry.isDirectory()) {
            out.push(...await collectFiles(abs, rel, warnings));
        } else if (entry.isFile()) {
            out.push(rel);
        }
    }
    return out;
}

export interface PackageResult {
    /** Absolute path of the written bundle. */
    bundlePath: string;
    /** Lowercase-hex SHA-256 of the finished ZIP bytes. */
    sha256: string;
    manifest: RowboatAppManifest;
    /** Package-relative paths included, in the order written. */
    files: string[];
    warnings: string[];
}

/**
 * Build `<name>.rowboat-app` for the app at `folder`, writing the bundle to
 * `outDir` (created if needed).
 */
export async function packageApp(folder: string, outDir: string): Promise<PackageResult> {
    const dir = appDir(folder);

    // 1. Manifest must parse and dist/<entry> must exist.
    let manifest: RowboatAppManifest;
    try {
        manifest = RowboatAppManifestSchema.parse(
            JSON.parse(await fsp.readFile(path.join(dir, 'rowboat-app.json'), 'utf-8')),
        );
    } catch (e) {
        throw new PackageError('invalid_manifest', `rowboat-app.json is missing or invalid: ${e instanceof Error ? e.message : String(e)}`);
    }
    const entryAbs = path.join(dir, 'dist', manifest.entry);
    if (!fs.existsSync(entryAbs) || !fs.statSync(entryAbs).isFile()) {
        throw new PackageError('missing_entry', `dist/${manifest.entry} does not exist`);
    }

    // 2. Assemble the allowlist, sorted for determinism.
    const warnings: string[] = [];
    const files: string[] = ['rowboat-app.json'];
    files.push(...(await collectFiles(path.join(dir, 'dist'), 'dist', warnings)).sort());
    // agents/: ONLY files listed in manifest.agents (and they must exist).
    for (const agentFile of [...manifest.agents].sort()) {
        const abs = path.join(dir, 'agents', agentFile);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
            throw new PackageError('missing_agent', `agents/${agentFile} is listed in the manifest but missing`);
        }
        files.push(`agents/${agentFile}`);
    }
    files.push(...(await collectFiles(path.join(dir, 'defaults'), 'defaults', warnings)).sort());

    // 3. Write the ZIP.
    await fsp.mkdir(outDir, { recursive: true });
    const bundlePath = path.join(outDir, `${manifest.name}.rowboat-app`);
    const zip = new yazl.ZipFile();
    for (const rel of files) {
        zip.addFile(path.join(dir, ...rel.split('/')), rel);
    }
    zip.end();

    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(bundlePath);
        zip.outputStream.on('data', (chunk: Buffer) => hash.update(chunk));
        zip.outputStream.pipe(out);
        out.on('close', () => resolve());
        out.on('error', reject);
        zip.outputStream.on('error', reject);
    });

    return {
        bundlePath,
        sha256: hash.digest('hex'),
        manifest,
        files,
        warnings,
    };
}
