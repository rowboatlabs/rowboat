import fs from 'node:fs';
import path from 'node:path';
import git from 'isomorphic-git';
import { WorkDir } from '../config/config.js';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');

// Simple promise-based mutex to serialize commits
let commitLock: Promise<void> = Promise.resolve();

// Commit listeners for notifying other layers (e.g. renderer refresh)
type CommitListener = () => void;
const commitListeners: CommitListener[] = [];

export function onCommit(listener: CommitListener): () => void {
    commitListeners.push(listener);
    return () => {
        const idx = commitListeners.indexOf(listener);
        if (idx >= 0) commitListeners.splice(idx, 1);
    };
}

/**
 * Initialize a git repo in the knowledge directory if one doesn't exist.
 * Stages all existing .md files and makes an initial commit.
 */
export async function initRepo(): Promise<void> {
    const gitDir = path.join(KNOWLEDGE_DIR, '.git');
    if (fs.existsSync(gitDir)) {
        return;
    }

    // Ensure knowledge dir exists
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    }

    await git.init({ fs, dir: KNOWLEDGE_DIR });

    // Stage all existing .md files
    const files = getAllMdFiles(KNOWLEDGE_DIR, '');
    for (const file of files) {
        await git.add({ fs, dir: KNOWLEDGE_DIR, filepath: file });
    }

    if (files.length > 0) {
        await git.commit({
            fs,
            dir: KNOWLEDGE_DIR,
            message: 'Initial snapshot',
            author: { name: 'Rowboat', email: 'local' },
        });
    }
}

/**
 * Recursively find all .md files relative to the knowledge dir.
 */
function getAllMdFiles(baseDir: string, relDir: string): string[] {
    const results: string[] = [];
    const absDir = relDir ? path.join(baseDir, relDir) : baseDir;
    let entries: string[];
    try {
        entries = fs.readdirSync(absDir);
    } catch {
        return results;
    }
    for (const entry of entries) {
        if (entry === '.git' || entry.startsWith('.')) continue;
        const fullPath = path.join(absDir, entry);
        const relPath = relDir ? `${relDir}/${entry}` : entry;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...getAllMdFiles(baseDir, relPath));
        } else if (entry.endsWith('.md')) {
            results.push(relPath);
        }
    }
    return results;
}

/**
 * Stage all changes to .md files and commit. No-op if nothing changed.
 * Serialized via a promise lock to prevent concurrent git index corruption.
 */
export async function commitAll(message: string, authorName: string): Promise<void> {
    const prev = commitLock;
    let resolve: () => void;
    commitLock = new Promise(r => { resolve = r; });

    await prev;
    try {
        await commitAllInner(message, authorName);
    } finally {
        resolve!();
    }
}

async function commitAllInner(message: string, authorName: string): Promise<void> {
    const matrix = await git.statusMatrix({ fs, dir: KNOWLEDGE_DIR });

    let hasChanges = false;
    for (const [filepath, head, workdir, stage] of matrix) {
        // Skip non-md files
        if (!filepath.endsWith('.md')) continue;

        // [filepath, HEAD, WORKDIR, STAGE]
        // Unchanged: [f, 1, 1, 1]
        if (head === 1 && workdir === 1 && stage === 1) continue;

        hasChanges = true;

        if (workdir === 0) {
            // File deleted from workdir
            await git.remove({ fs, dir: KNOWLEDGE_DIR, filepath });
        } else {
            // File added or modified
            await git.add({ fs, dir: KNOWLEDGE_DIR, filepath });
        }
    }

    if (!hasChanges) return;

    await git.commit({
        fs,
        dir: KNOWLEDGE_DIR,
        message,
        author: { name: authorName, email: 'local' },
    });

    for (const listener of commitListeners) {
        try { listener(); } catch { /* ignore */ }
    }
}

export interface CommitInfo {
    oid: string;
    message: string;
    timestamp: number;
    author: string;
}

const MAX_FILE_HISTORY = 50;

/**
 * Get commit history for a specific file.
 * Returns commits where the file content changed, most recent first.
 * Capped at MAX_FILE_HISTORY entries.
 */
export async function getFileHistory(knowledgeRelPath: string): Promise<CommitInfo[]> {
    // Normalize path separators for git (always forward slashes)
    const filepath = knowledgeRelPath.replace(/\\/g, '/');

    let commits: Awaited<ReturnType<typeof git.log>>;
    try {
        commits = await git.log({ fs, dir: KNOWLEDGE_DIR });
    } catch {
        return [];
    }

    if (commits.length === 0) return [];

    const result: CommitInfo[] = [];

    // Walk through commits and check if file changed between consecutive commits
    for (let i = 0; i < commits.length; i++) {
        if (result.length >= MAX_FILE_HISTORY) break;

        const commit = commits[i]!;
        const parentCommit = commits[i + 1]; // undefined for the first (oldest) commit

        const currentOid = await getBlobOidAtCommit(commit.oid, filepath);
        const parentOid = parentCommit
            ? await getBlobOidAtCommit(parentCommit.oid, filepath)
            : null;

        // Include this commit if:
        // - The file existed and changed from parent
        // - The file was added (parentOid is null but currentOid exists)
        // - The file was deleted (currentOid is null but parentOid exists)
        if (currentOid !== parentOid) {
            result.push({
                oid: commit.oid,
                message: commit.commit.message.trim(),
                timestamp: commit.commit.author.timestamp,
                author: commit.commit.author.name,
            });
        }
    }

    return result;
}

/**
 * Get the blob OID for a file at a specific commit, or null if not found.
 */
async function getBlobOidAtCommit(commitOid: string, filepath: string): Promise<string | null> {
    try {
        const result = await git.readBlob({
            fs,
            dir: KNOWLEDGE_DIR,
            oid: commitOid,
            filepath,
        });
        // Compute a content hash from the blob to compare
        return result.oid;
    } catch {
        return null;
    }
}

/**
 * Read file content at a specific commit.
 */
export async function getFileAtCommit(knowledgeRelPath: string, oid: string): Promise<string> {
    const filepath = knowledgeRelPath.replace(/\\/g, '/');
    const result = await git.readBlob({
        fs,
        dir: KNOWLEDGE_DIR,
        oid,
        filepath,
    });
    return Buffer.from(result.blob).toString('utf-8');
}

/**
 * Restore a file to its content at a given commit, then commit the restoration.
 */
export async function restoreFile(knowledgeRelPath: string, oid: string): Promise<void> {
    const content = await getFileAtCommit(knowledgeRelPath, oid);
    const absPath = path.join(KNOWLEDGE_DIR, knowledgeRelPath);

    // Ensure parent directory exists
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absPath, content, 'utf-8');

    const filename = path.basename(knowledgeRelPath);
    await commitAll(`Restored ${filename}`, 'You');
}
