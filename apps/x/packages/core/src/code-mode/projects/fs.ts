import fs from 'fs/promises';
import path from 'path';

// Contained file browsing for the Code section. Session cwds are arbitrary
// user directories (outside the Rowboat workspace), so every access resolves
// against the session root and is validated to stay inside it — realpath on
// the containing directory defeats both `..` traversal and symlink escapes.

const MAX_FILE_BYTES = 1024 * 1024;

async function resolveContained(root: string, relPath: string): Promise<string> {
    if (path.isAbsolute(relPath)) {
        throw new Error('Absolute paths are not allowed');
    }
    const realRoot = await fs.realpath(root);
    const resolved = path.resolve(realRoot, relPath);
    // Realpath the parent so symlinked ancestors can't escape...
    const realParent = await fs.realpath(path.dirname(resolved)).catch(() => null);
    if (realParent === null) {
        throw new Error(`No such directory: ${relPath}`);
    }
    // ...and the target itself, so the final component being a symlink
    // (e.g. a link to /etc) can't either. A missing target keeps its own path.
    const joined = path.join(realParent, path.basename(resolved));
    const realTarget = await fs.realpath(joined).catch(() => joined);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
        throw new Error('Path escapes the session directory');
    }
    return realTarget;
}

export interface ProjectDirEntry {
    name: string;
    kind: 'file' | 'dir';
    size?: number;
}

// One level at a time — the tree lazily expands, so node_modules costs nothing
// until the user opens it. `.git` is always hidden.
export async function readProjectDir(root: string, relPath: string): Promise<ProjectDirEntry[]> {
    const target = await resolveContained(root, relPath || '.');
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const entries: ProjectDirEntry[] = [];
    for (const d of dirents) {
        if (d.name === '.git') continue;
        if (d.isDirectory()) {
            entries.push({ name: d.name, kind: 'dir' });
        } else if (d.isFile()) {
            let size: number | undefined;
            try {
                size = (await fs.stat(path.join(target, d.name))).size;
            } catch {
                size = undefined;
            }
            entries.push({ name: d.name, kind: 'file', size });
        }
        // symlinks and other entry kinds are skipped
    }
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    return entries;
}

export interface ProjectFileContent {
    content: string;
    isBinary: boolean;
    tooLarge: boolean;
}

export async function readProjectFile(root: string, relPath: string): Promise<ProjectFileContent> {
    const target = await resolveContained(root, relPath);
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
        throw new Error(`Not a file: ${relPath}`);
    }
    if (stat.size > MAX_FILE_BYTES) {
        return { content: '', isBinary: false, tooLarge: true };
    }
    const buf = await fs.readFile(target);
    if (buf.includes(0)) {
        return { content: '', isBinary: true, tooLarge: false };
    }
    return { content: buf.toString('utf8'), isBinary: false, tooLarge: false };
}
