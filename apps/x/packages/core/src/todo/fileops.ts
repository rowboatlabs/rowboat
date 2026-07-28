import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { TodoBlock, TodoItem, TodoLink, TodoList, TodoReceipt } from '@x/shared/dist/todo.js';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';

const log = new PrefixLogger('Todo:Fileops');

// ---------------------------------------------------------------------------
// One rolling list at ~/.rowboat/todo.md — the file is the whole truth.
// Receipts (agent outcomes) are indented "- → …" lines under their item.
// Completed items get archived to todo/archive/<YYYY-MM>.md.
// ---------------------------------------------------------------------------

const TODO_PATH = path.join(WorkDir, 'todo.md');
const ARCHIVE_DIR = path.join(WorkDir, 'todo', 'archive');

/** Workspace-relative path handed to the agent's file tools. */
export const TODO_REL_PATH = 'todo.md';

const ROWBOAT_MENTION_RE = /(^|\s)@rowboat\b/i;
const TASK_LINE_RE = /^- \[( |x|X)\] (.*\S)\s*$/;
const RECEIPT_LINE_RE = /^\s+- → (.*\S)\s*$/;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function normalizeKey(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isDelegated(text: string): boolean {
    return ROWBOAT_MENTION_RE.test(text);
}

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

function parseReceipt(body: string): TodoReceipt {
    let kind: TodoReceipt['kind'] = 'result';
    let rest = body;
    if (/^needs you:\s*/i.test(body)) {
        kind = 'question';
        rest = body.replace(/^needs you:\s*/i, '');
    } else if (/^failed:\s*/i.test(body)) {
        kind = 'error';
        rest = body.replace(/^failed:\s*/i, '');
    }
    const links: TodoLink[] = [];
    const text = rest
        .replace(LINK_RE, (_m, label: string, target: string) => {
            links.push(/^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? { label, url: target } : { label, path: target });
            return '';
        })
        .replace(/\s*—\s*/g, ' — ')
        .replace(/^[\s,—-]+|[\s,—-]+$/g, '')
        .replace(/\s+/g, ' ');
    return { kind, text, links };
}

function serializeReceipt(r: TodoReceipt): string {
    if (r.kind === 'question') return `  - → needs you: ${r.text}`;
    if (r.kind === 'error') return `  - → failed: ${r.text}`;
    const links = r.links.map(l => `[${l.label}](${l.url ?? l.path ?? ''})`).join(', ');
    if (links && r.text) return `  - → ${links} — ${r.text}`;
    if (links) return `  - → ${links}`;
    return `  - → ${r.text}`;
}

export function parseTodoFile(markdown: string): TodoList {
    const blocks: TodoBlock[] = [];
    const lines = markdown.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const task = TASK_LINE_RE.exec(lines[i]);
        if (!task) {
            blocks.push({ kind: 'raw', text: lines[i] });
            continue;
        }
        const text = task[2].trim();
        const receipts: TodoReceipt[] = [];
        while (i + 1 < lines.length) {
            const receipt = RECEIPT_LINE_RE.exec(lines[i + 1]);
            if (!receipt) break;
            receipts.push(parseReceipt(receipt[1]));
            i++;
        }
        blocks.push({
            kind: 'item',
            item: {
                key: normalizeKey(text),
                text,
                checked: task[1].toLowerCase() === 'x',
                delegated: isDelegated(text),
                receipts,
            },
        });
    }
    // Drop trailing empty raw lines beyond one — keeps repeated saves from
    // growing the file.
    while (blocks.length > 1) {
        const last = blocks[blocks.length - 1];
        const prev = blocks[blocks.length - 2];
        if (last.kind === 'raw' && last.text.trim() === '' && prev.kind === 'raw' && prev.text.trim() === '') {
            blocks.pop();
        } else break;
    }
    return { blocks };
}

function serializeItem(item: TodoItem): string[] {
    const box = item.checked ? 'x' : ' ';
    return [`- [${box}] ${item.text.trim()}`, ...item.receipts.map(serializeReceipt)];
}

export function serializeTodoFile(list: TodoList): string {
    const out: string[] = [];
    for (const block of list.blocks) {
        if (block.kind === 'raw') out.push(block.text);
        else out.push(...serializeItem(block.item));
    }
    let md = out.join('\n');
    if (!md.endsWith('\n')) md += '\n';
    return md;
}

// ---------------------------------------------------------------------------
// First-run seed — the tutorial is real data in the real file.
// ---------------------------------------------------------------------------

const SEED = `- [ ] Add your first to-do — just type below
- [ ] @rowboat introduce yourself — what can you do here?
- [ ] Dismiss anything you don't want — hover a row and hit ✕
`;

function ensureDirs(): void {
    if (!fsSync.existsSync(ARCHIVE_DIR)) fsSync.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

async function readRaw(): Promise<string> {
    try {
        return await fs.readFile(TODO_PATH, 'utf-8');
    } catch {
        return '';
    }
}

async function writeRaw(markdown: string): Promise<void> {
    ensureDirs();
    await fs.writeFile(TODO_PATH, markdown, 'utf-8');
}

function withTodoLock<T>(fn: () => Promise<T>): Promise<T> {
    return withFileLock(TODO_PATH, fn);
}

// ---------------------------------------------------------------------------
// Reads & writes (all mutations run under the file lock)
// ---------------------------------------------------------------------------

/** Read the list, seeding the tutorial content on first run. */
export async function readTodo(): Promise<TodoList> {
    return withTodoLock(async () => {
        if (!fsSync.existsSync(TODO_PATH)) {
            log.log('first run — seeding todo.md');
            await writeRaw(SEED);
        }
        return parseTodoFile(await readRaw());
    });
}

function itemsByKey(list: TodoList): Map<string, TodoItem> {
    const map = new Map<string, TodoItem>();
    for (const block of list.blocks) {
        if (block.kind === 'item' && !map.has(block.item.key)) map.set(block.item.key, block.item);
    }
    return map;
}

const receiptId = (r: TodoReceipt) => serializeReceipt(r);

/**
 * Full-model save from the renderer. Merges against disk so a receipt that
 * landed after the renderer's last read is never lost: receipts are unioned
 * per item, and an item the agent just checked stays checked if the incoming
 * copy predates its receipts.
 */
export async function saveTodo(incoming: TodoList): Promise<TodoList> {
    return withTodoLock(async () => {
        const disk = parseTodoFile(await readRaw());
        const diskItems = itemsByKey(disk);
        for (const block of incoming.blocks) {
            if (block.kind !== 'item') continue;
            const item = block.item;
            item.key = normalizeKey(item.text);
            item.delegated = isDelegated(item.text);
            const onDisk = diskItems.get(item.key);
            if (!onDisk) continue;
            const have = new Set(item.receipts.map(receiptId));
            const missing = onDisk.receipts.filter(r => !have.has(receiptId(r)));
            if (missing.length > 0) {
                item.receipts = [...item.receipts, ...missing];
                // The incoming copy predates these receipts — the agent's
                // completion check-off wins over the stale unchecked box.
                if (onDisk.checked && !item.checked) item.checked = true;
            }
        }
        await writeRaw(serializeTodoFile(incoming));
        return incoming;
    });
}

/** Append one task line to the end of the list. */
export async function addItem(text: string): Promise<TodoItem> {
    const item: TodoItem = {
        key: normalizeKey(text),
        text: text.replace(/\s+/g, ' ').trim(),
        checked: false,
        delegated: isDelegated(text),
        receipts: [],
    };
    await withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        list.blocks.push({ kind: 'item', item });
        await writeRaw(serializeTodoFile(list));
    });
    return item;
}

export async function getItem(key: string): Promise<TodoItem | null> {
    const list = await readTodo();
    return itemsByKey(list).get(normalizeKey(key)) ?? null;
}

/**
 * Attach a receipt under the item and optionally check its box. Returns
 * false when the line no longer exists — the user deleted or rewrote it
 * mid-run, which means dismiss: the receipt is dropped.
 */
export async function attachReceipt(
    key: string,
    receipt: TodoReceipt,
    opts?: { check?: boolean },
): Promise<boolean> {
    const norm = normalizeKey(key);
    return withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        for (const block of list.blocks) {
            if (block.kind !== 'item' || block.item.key !== norm) continue;
            const have = new Set(block.item.receipts.map(receiptId));
            if (!have.has(receiptId(receipt))) block.item.receipts.push(receipt);
            if (opts?.check) block.item.checked = true;
            await writeRaw(serializeTodoFile(list));
            return true;
        }
        log.log(`receipt dropped — item vanished: "${norm}"`);
        return false;
    });
}

/** Set an item's checkbox. Returns false when the line no longer exists. */
export async function setChecked(key: string, checked: boolean): Promise<boolean> {
    const norm = normalizeKey(key);
    return withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        for (const block of list.blocks) {
            if (block.kind !== 'item' || block.item.key !== norm) continue;
            if (block.item.checked !== checked) {
                block.item.checked = checked;
                await writeRaw(serializeTodoFile(list));
            }
            return true;
        }
        return false;
    });
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

function archivePath(now: Date): string {
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return path.join(ARCHIVE_DIR, `${month}.md`);
}

function localDateStr(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

/** Move checked items (with receipts) out of the list into the monthly
 * archive, stamped with today's date. Returns how many were archived. */
export async function clearCompleted(now: Date = new Date()): Promise<number> {
    return withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        const kept: TodoBlock[] = [];
        const archived: TodoItem[] = [];
        for (const block of list.blocks) {
            if (block.kind === 'item' && block.item.checked) archived.push(block.item);
            else kept.push(block);
        }
        if (archived.length === 0) return 0;

        ensureDirs();
        const target = archivePath(now);
        const existing = await fs.readFile(target, 'utf-8').catch(() => '');
        const stamp = `\n## ${localDateStr(now)}\n\n`;
        const body = archived.map(i => serializeItem(i).join('\n')).join('\n') + '\n';
        await fs.writeFile(target, existing + stamp + body, 'utf-8');

        await writeRaw(serializeTodoFile({ blocks: kept }));
        log.log(`archived ${archived.length} item(s) → ${path.basename(target)}`);
        return archived.length;
    });
}
