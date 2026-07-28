import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import path from 'path';
import type { TodoThreadEntry } from '@x/shared/dist/todo.js';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import { normalizeKey } from './fileops.js';

// ---------------------------------------------------------------------------
// Per-item threads — the conversation behind a delegated item. Human-readable
// markdown at todo/threads/<slug>-<hash>.md:
//
//   # build a deck
//
//   ## rowboat — 2026-07-28T12:36:10.000Z (run tr_abc)
//   Drafted an outline in knowledge/Projects/deck.md.
//
//   ## you — 2026-07-28T12:40:02.000Z
//   Too long — cut it to 8 slides.
//
// Threads are keyed by the item's normalized text, like runs: rewriting an
// item's line starts a fresh thread (the old file stays behind, readable).
// The list in todo.md never depends on these files — losing them loses
// conversation history, never state.
// ---------------------------------------------------------------------------

const THREADS_DIR = path.join(WorkDir, 'todo', 'threads');

const ENTRY_HEADER_RE = /^## (you|rowboat) — (\S+)(?: \(run ([^)]+)\))?\s*$/;

export function threadPath(key: string): string {
    const norm = normalizeKey(key);
    const slug = norm.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
    const hash = crypto.createHash('sha256').update(norm).digest('hex').slice(0, 8);
    return path.join(THREADS_DIR, `${slug}-${hash}.md`);
}

function withThreadLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return withFileLock(threadPath(key), fn);
}

export function parseThread(markdown: string): TodoThreadEntry[] {
    const entries: TodoThreadEntry[] = [];
    let current: TodoThreadEntry | null = null;
    let body: string[] = [];
    const flush = () => {
        if (current) {
            current.text = body.join('\n').trim();
            entries.push(current);
        }
        body = [];
    };
    for (const line of markdown.split('\n')) {
        const m = ENTRY_HEADER_RE.exec(line);
        if (m) {
            flush();
            current = {
                author: m[1] === 'you' ? 'user' : 'rowboat',
                at: m[2],
                text: '',
                ...(m[3] ? { runId: m[3] } : {}),
            };
            continue;
        }
        if (current) body.push(line);
    }
    flush();
    return entries;
}

function serializeEntry(entry: TodoThreadEntry): string {
    const author = entry.author === 'user' ? 'you' : 'rowboat';
    const run = entry.runId ? ` (run ${entry.runId})` : '';
    return `## ${author} — ${entry.at}${run}\n\n${entry.text.trim()}\n`;
}

export async function readThread(key: string): Promise<TodoThreadEntry[]> {
    try {
        const raw = await fs.readFile(threadPath(key), 'utf-8');
        return parseThread(raw);
    } catch {
        return [];
    }
}

export async function appendThreadEntry(key: string, entry: TodoThreadEntry): Promise<void> {
    await withThreadLock(key, async () => {
        if (!fsSync.existsSync(THREADS_DIR)) fsSync.mkdirSync(THREADS_DIR, { recursive: true });
        const target = threadPath(key);
        let existing = await fs.readFile(target, 'utf-8').catch(() => '');
        if (!existing) existing = `# ${normalizeKey(key)}\n`;
        await fs.writeFile(target, `${existing}\n${serializeEntry(entry)}`, 'utf-8');
    });
}

/** The thread rendered for a follow-up run's Context block. */
export function renderThreadForContext(entries: TodoThreadEntry[]): string {
    return entries
        .map(e => `${e.author === 'user' ? 'USER' : 'YOU (previous run)'}: ${e.text}`)
        .join('\n\n');
}
