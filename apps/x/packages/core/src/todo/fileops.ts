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
// Top-level task lines are items; task lines indented under one are its
// sub-items (one level only). Receipts (agent outcomes) are indented
// "- → …" lines under their line. Completed/dismissed items get archived to
// todo/archive/<YYYY-MM>.md.
// ---------------------------------------------------------------------------

const TODO_PATH = path.join(WorkDir, 'todo.md');
const ARCHIVE_DIR = path.join(WorkDir, 'todo', 'archive');

/** Workspace-relative path handed to the agent's file tools. */
export const TODO_REL_PATH = 'todo.md';

const ROWBOAT_MENTION_RE = /(^|\s)@rowboat\b/i;
const TASK_LINE_RE = /^- \[( |x|X)\] (.*\S)\s*$/;
const SUB_TASK_LINE_RE = /^\s{2,6}- \[( |x|X)\] (.*\S)\s*$/;
const RECEIPT_LINE_RE = /^\s+- → (.*\S)\s*$/;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
/** Receipt stamped onto a dismissed sub-item so restore can re-nest it. */
const FROM_RE = /^from: (.+)$/;

export function normalizeKey(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A sub-item's identity: scoped by its parent so same-named steps under
 * different projects never collide. */
export function subKey(parentText: string, subText: string): string {
    return `${normalizeKey(parentText)} :: ${normalizeKey(subText)}`;
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

function serializeReceipt(r: TodoReceipt, indent: string): string {
    // A receipt is exactly one line — embedded newlines (e.g. multi-line
    // provider errors) would leak raw text lines into the file.
    const text = r.text.replace(/\s+/g, ' ').trim();
    if (r.kind === 'question') return `${indent}- → needs you: ${text}`;
    if (r.kind === 'error') return `${indent}- → failed: ${text}`;
    const links = r.links.map(l => `[${l.label}](${l.url ?? l.path ?? ''})`).join(', ');
    if (links && text) return `${indent}- → ${links} — ${text}`;
    if (links) return `${indent}- → ${links}`;
    return `${indent}- → ${text}`;
}

function newItem(text: string, checked: boolean, key: string): TodoItem {
    return {
        key,
        text: text.trim(),
        checked,
        delegated: isDelegated(text),
        receipts: [],
        children: [],
    };
}

export function parseTodoFile(markdown: string): TodoList {
    const blocks: TodoBlock[] = [];
    // Receipts and sub-items attach to the immediately preceding line's
    // item; any other line breaks the block.
    let parent: TodoItem | null = null;
    let current: TodoItem | null = null;

    for (const line of markdown.split('\n')) {
        const receipt = RECEIPT_LINE_RE.exec(line);
        if (receipt && current) {
            current.receipts.push(parseReceipt(receipt[1]));
            continue;
        }
        const task = TASK_LINE_RE.exec(line);
        if (task) {
            const item = newItem(task[2], task[1].toLowerCase() === 'x', normalizeKey(task[2]));
            blocks.push({ kind: 'item', item });
            parent = item;
            current = item;
            continue;
        }
        const sub = SUB_TASK_LINE_RE.exec(line);
        if (sub && parent) {
            const child = newItem(sub[2], sub[1].toLowerCase() === 'x', subKey(parent.text, sub[2]));
            parent.children.push(child);
            current = child;
            continue;
        }
        blocks.push({ kind: 'raw', text: line });
        parent = null;
        current = null;
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
    const out = [
        `- [${item.checked ? 'x' : ' '}] ${item.text.trim()}`,
        ...item.receipts.map(r => serializeReceipt(r, '  ')),
    ];
    for (const child of item.children) {
        out.push(`  - [${child.checked ? 'x' : ' '}] ${child.text.trim()}`);
        out.push(...child.receipts.map(r => serializeReceipt(r, '    ')));
    }
    return out;
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
// Walking & key resolution
// ---------------------------------------------------------------------------

export type FoundItem = { item: TodoItem; parent: TodoItem | null };

function* walkItems(list: TodoList): Generator<FoundItem> {
    for (const block of list.blocks) {
        if (block.kind !== 'item') continue;
        yield { item: block.item, parent: null };
        for (const child of block.item.children) {
            yield { item: child, parent: block.item };
        }
    }
}

/** Re-derive every key from current text (authoritative on save). */
function rekey(list: TodoList): void {
    for (const block of list.blocks) {
        if (block.kind !== 'item') continue;
        const item = block.item;
        item.key = normalizeKey(item.text);
        item.delegated = isDelegated(item.text);
        for (const child of item.children) {
            child.key = subKey(item.text, child.text);
            child.delegated = isDelegated(child.text);
            child.children = [];
        }
    }
}

/**
 * Find by key. Scoped keys match exactly; a bare key that misses at the top
 * level falls back to a unique sub-item text match — so an agent reporting
 * without parent context still lands when unambiguous.
 */
function resolveLocked(list: TodoList, key: string): FoundItem | null {
    const norm = normalizeKey(key);
    for (const found of walkItems(list)) {
        if (found.item.key === norm) return found;
    }
    if (!norm.includes(' :: ')) {
        const matches = [...walkItems(list)].filter(
            f => f.parent && normalizeKey(f.item.text) === norm,
        );
        if (matches.length === 1) return matches[0];
    }
    return null;
}

// ---------------------------------------------------------------------------
// First-run seed — the tutorial is real data in the real file.
// ---------------------------------------------------------------------------

const SEED = `- [ ] Add your first to-do — just type below
- [ ] @rowboat introduce yourself — what can you do here?
- [ ] Dismiss anything you don't want — hover a row and hit ✕ (it lands in Done & dismissed below, restorable)
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

const receiptId = (r: TodoReceipt) => serializeReceipt(r, '');

/**
 * Full-model save from the renderer. Merges against disk so a receipt that
 * landed after the renderer's last read is never lost: receipts are unioned
 * per item (top-level and sub), and an item the agent just checked stays
 * checked if the incoming copy predates its receipts.
 */
export async function saveTodo(incoming: TodoList): Promise<TodoList> {
    return withTodoLock(async () => {
        rekey(incoming);
        const disk = parseTodoFile(await readRaw());
        const diskByKey = new Map<string, TodoItem>();
        for (const { item } of walkItems(disk)) {
            if (!diskByKey.has(item.key)) diskByKey.set(item.key, item);
        }
        for (const { item } of walkItems(incoming)) {
            const onDisk = diskByKey.get(item.key);
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
    const item = newItem(text.replace(/\s+/g, ' ').trim(), false, normalizeKey(text));
    await withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        list.blocks.push({ kind: 'item', item });
        await writeRaw(serializeTodoFile(list));
    });
    return item;
}

/** Add a sub-item under an existing top-level item. */
export async function addSubItem(parentKey: string, text: string): Promise<TodoItem | null> {
    const norm = normalizeKey(parentKey);
    return withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        for (const block of list.blocks) {
            if (block.kind !== 'item' || block.item.key !== norm) continue;
            const clean = text.replace(/\s+/g, ' ').trim();
            const child = newItem(clean, false, subKey(block.item.text, clean));
            block.item.children.push(child);
            await writeRaw(serializeTodoFile(list));
            return child;
        }
        return null;
    });
}

export async function getItem(key: string): Promise<TodoItem | null> {
    return (await findItem(key))?.item ?? null;
}

/** Find an item (top-level or sub) with its parent context. */
export async function findItem(key: string): Promise<FoundItem | null> {
    const list = await readTodo();
    return resolveLocked(list, key);
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
    return withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        const found = resolveLocked(list, key);
        if (!found) {
            log.log(`receipt dropped — item vanished: "${normalizeKey(key)}"`);
            return false;
        }
        const have = new Set(found.item.receipts.map(receiptId));
        if (!have.has(receiptId(receipt))) found.item.receipts.push(receipt);
        if (opts?.check) found.item.checked = true;
        await writeRaw(serializeTodoFile(list));
        return true;
    });
}

/** Set an item's checkbox. Returns false when the line no longer exists. */
export async function setChecked(key: string, checked: boolean): Promise<boolean> {
    return withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        const found = resolveLocked(list, key);
        if (!found) return false;
        if (found.item.checked !== checked) {
            found.item.checked = checked;
            await writeRaw(serializeTodoFile(list));
        }
        return true;
    });
}

// ---------------------------------------------------------------------------
// Attachments — files given to a to-do at creation. Copied into the
// workspace so the links on the item's line survive the source moving;
// the agent reads them like any workspace file.
// ---------------------------------------------------------------------------

const ATTACHMENTS_DIR = path.join(WorkDir, 'todo', 'attachments');

/** Copy files into todo/attachments and return links for the item's line. */
export async function importTodoAttachments(
    files: { path: string; name: string }[],
): Promise<TodoLink[]> {
    if (files.length === 0) return [];
    if (!fsSync.existsSync(ATTACHMENTS_DIR)) fsSync.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    const links: TodoLink[] = [];
    for (const file of files) {
        const base = file.name.replace(/[^\w.\- ]+/g, '_') || 'attachment';
        let target = path.join(ATTACHMENTS_DIR, base);
        for (let n = 1; fsSync.existsSync(target); n++) {
            const ext = path.extname(base);
            target = path.join(ATTACHMENTS_DIR, `${path.basename(base, ext)}-${n}${ext}`);
        }
        try {
            await fs.copyFile(file.path, target);
            links.push({ label: file.name, path: `todo/attachments/${path.basename(target)}` });
        } catch (err) {
            log.log(`attachment copy failed for ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return links;
}

/** Serialize links for inclusion in an item's line text. */
export function linksToText(links: TodoLink[]): string {
    return links.map(l => `[${l.label}](${l.url ?? l.path ?? ''})`).join(' ');
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

async function appendToArchive(items: TodoItem[], now: Date): Promise<void> {
    ensureDirs();
    const target = archivePath(now);
    const existing = await fs.readFile(target, 'utf-8').catch(() => '');
    const stamp = `\n## ${localDateStr(now)}\n\n`;
    const body = items.map(i => serializeItem(i).join('\n')).join('\n') + '\n';
    await fs.writeFile(target, existing + stamp + body, 'utf-8');
}

/** Move checked TOP-LEVEL items (children and receipts intact) into the
 * monthly archive. Checked sub-items of an open parent stay — they are the
 * parent's progress record until the parent itself clears. */
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

        await appendToArchive(archived, now);
        await writeRaw(serializeTodoFile({ blocks: kept }));
        log.log(`archived ${archived.length} item(s) → ${path.basename(archivePath(now))}`);
        return archived.length;
    });
}

/**
 * Dismiss = move to the monthly archive, not delete. A parent takes its
 * whole block (children included); a sub-item is archived standalone with a
 * "from: <parent>" receipt so restore can re-nest it. Everything stays
 * restorable; nothing typed into the list is ever lost from disk.
 */
export async function dismissItem(key: string, now: Date = new Date()): Promise<boolean> {
    const norm = normalizeKey(key);
    return withTodoLock(async () => {
        const list = parseTodoFile(await readRaw());
        const found = resolveLocked(list, norm);
        if (!found) return false;

        if (found.parent) {
            found.parent.children = found.parent.children.filter(c => c !== found.item);
            const standalone: TodoItem = {
                ...found.item,
                key: normalizeKey(found.item.text),
                receipts: [...found.item.receipts, { kind: 'result', text: `from: ${found.parent.text}`, links: [] }],
                children: [],
            };
            await appendToArchive([standalone], now);
        } else {
            const idx = list.blocks.findIndex(b => b.kind === 'item' && b.item === found.item);
            if (idx === -1) return false;
            list.blocks.splice(idx, 1);
            await appendToArchive([found.item], now);
        }
        await writeRaw(serializeTodoFile(list));
        log.log(`dismissed "${norm}" → ${path.basename(archivePath(now))}`);
        return true;
    });
}

export type ArchivedTodo = {
    /** YYYY-MM — which archive file. */
    month: string;
    /** Block index inside that file — the restore handle. */
    blockIndex: number;
    /** YYYY-MM-DD stamp the item was archived under, when present. */
    date: string | null;
    item: TodoItem;
};

const ARCHIVE_DATE_RE = /^## (\d{4}-\d{2}-\d{2})\s*$/;

/** Pure helper: archive-file markdown → items with their date stamps. */
export function parseArchive(month: string, markdown: string): ArchivedTodo[] {
    const out: ArchivedTodo[] = [];
    let date: string | null = null;
    const blocks = parseTodoFile(markdown).blocks;
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.kind === 'raw') {
            const m = ARCHIVE_DATE_RE.exec(block.text);
            if (m) date = m[1];
            continue;
        }
        out.push({ month, blockIndex: i, date, item: block.item });
    }
    return out;
}

function monthStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Recent archived items (this month + last), newest first. */
export async function listArchived(limit = 30, now: Date = new Date()): Promise<ArchivedTodo[]> {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const months = [monthStr(now), monthStr(prev)];
    const out: ArchivedTodo[] = [];
    for (const month of months) {
        const raw = await fs.readFile(path.join(ARCHIVE_DIR, `${month}.md`), 'utf-8').catch(() => '');
        if (raw) out.push(...parseArchive(month, raw));
    }
    // File order is chronological (appends); newest first for display.
    return out.reverse().slice(0, limit);
}

/**
 * Bring an archived item back onto the list, unchecked (restoring means
 * "this is active again"). A "from: <parent>" stamp re-nests the item under
 * its parent when that parent still exists; otherwise it lands top-level.
 * The handle is (month, blockIndex) from listArchived; `key` guards against
 * the file having changed since.
 */
export async function restoreItem(month: string, blockIndex: number, key: string): Promise<boolean> {
    if (!/^\d{4}-\d{2}$/.test(month)) return false;
    const norm = normalizeKey(key);
    return withTodoLock(async () => {
        const target = path.join(ARCHIVE_DIR, `${month}.md`);
        const raw = await fs.readFile(target, 'utf-8').catch(() => '');
        if (!raw) return false;
        const blocks = parseTodoFile(raw).blocks;
        const block = blocks[blockIndex];
        if (!block || block.kind !== 'item' || block.item.key !== norm) return false;
        blocks.splice(blockIndex, 1);
        await fs.writeFile(target, serializeTodoFile({ blocks }), 'utf-8');

        const list = parseTodoFile(await readRaw());
        const fromIdx = block.item.receipts.findIndex(r => FROM_RE.test(r.text));
        const parentText = fromIdx >= 0 ? FROM_RE.exec(block.item.receipts[fromIdx].text)![1] : null;
        const restored: TodoItem = { ...block.item, checked: false };
        if (fromIdx >= 0) restored.receipts = restored.receipts.filter((_r, i) => i !== fromIdx);

        const parent = parentText
            ? list.blocks.find(
                  (b): b is Extract<TodoBlock, { kind: 'item' }> =>
                      b.kind === 'item' && b.item.key === normalizeKey(parentText),
              )
            : undefined;
        if (parent) {
            restored.key = subKey(parent.item.text, restored.text);
            restored.children = [];
            parent.item.children.push(restored);
        } else {
            restored.key = normalizeKey(restored.text);
            list.blocks.push({ kind: 'item', item: restored });
        }
        await writeRaw(serializeTodoFile(list));
        log.log(`restored "${norm}" from ${month}`);
        return true;
    });
}
