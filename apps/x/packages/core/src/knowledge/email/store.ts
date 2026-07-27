import fs from 'fs';
import path from 'path';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { WorkDir } from '../../config/config.js';
import { createEvent } from '../../events/producer.js';
import { recordImportanceCorrection } from '../email_importance_feedback.js';
import { recordCategoryCorrection } from '../email_category_feedback.js';
import { notifyIfEnabled } from '../../application/notification/notifier.js';

// Provider-independent email store: the snapshot cache (inbox_lists/), the
// search index (search_index/), the markdown mirror directory (gmail_sync/ —
// kept under its historical name because the knowledge-graph builder, the
// draft-emails skill, and every stored savedPath reference it; it is the
// generic email artifact dir for ALL providers), and the pure helpers shared
// by the Gmail and Outlook sync backends.

export type EmailCategory = string;

/** The markdown mirror + attachments dir shared by all email providers. */
export const SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const LEGACY_CACHE_DIR = path.join(SYNC_DIR, 'cache');
export const CACHE_DIR = path.join(WorkDir, 'inbox_lists');
// Local index of full-text search results. Kept separate from inbox_lists/ so it
// never leaks non-inbox threads into the inbox view. Grows as you search; we
// don't prune it (the user wants a durable local index).
export const SEARCH_CACHE_DIR = path.join(WorkDir, 'search_index');

(function migrateLegacyCacheDir() {
    try {
        if (fs.existsSync(LEGACY_CACHE_DIR) && !fs.existsSync(CACHE_DIR)) {
            fs.renameSync(LEGACY_CACHE_DIR, CACHE_DIR);
            console.log(`[Email store] Migrated cache from ${LEGACY_CACHE_DIR} → ${CACHE_DIR}`);
        }
    } catch (err) {
        console.warn('[Email store] Cache directory migration failed:', err);
    }
})();

const MAX_THREADS_IN_DIGEST = 10;
const nhm = new NodeHtmlMarkdown();

// Bump whenever snapshot-building logic changes in a way that should invalidate
// previously cached snapshots (e.g. attachment / recipient parsing fixes). The
// short-circuit in the sync backends only reuses a cache whose version matches,
// so stale entries are transparently rebuilt on the next sync.
export const SNAPSHOT_PARSER_VERSION = 3;

export type EmailProviderTag = 'gmail' | 'outlook';

export interface EmailThreadSnapshot {
    threadId: string;
    threadUrl: string;
    summary?: string;
    subject?: string;
    from?: string;
    to?: string;
    date?: string;
    latest_email?: string;
    past_summary?: string;
    /**
     * Provider-supplied plain-text preview of the latest message (Gmail's
     * `snippet`, Graph's `bodyPreview`) — what the native clients show in
     * their list rows. Unlike latest_email (markdown), it never leads with
     * table scaffolding from HTML→markdown conversion.
     */
    preview?: string;
    unread?: boolean;
    importance?: 'important' | 'other';
    /** 'user' when the user explicitly set importance in the UI — sticky; re-classification never overrides it. */
    importanceSource?: 'user';
    /** What kind of email this is (chip in the inbox UI, context for the knowledge pipeline). */
    category?: EmailCategory;
    /** 'user' when the user explicitly picked the category in the UI — sticky; re-classification never overrides it. */
    categorySource?: 'user';
    /** Knowledge-graph admission verdict, stamped into the gmail_sync markdown frontmatter. */
    knowledge?: 'extract' | 'skip';
    draft_response?: string;
    gmail_draft?: string;
    /** Provider-side draft id, present on entries from listDraftThreads. */
    draftId?: string;
    messages: Array<{
        id?: string;
        from?: string;
        to?: string;
        cc?: string;
        date?: string;
        subject?: string;
        body?: string;
        bodyHtml?: string;
        unread?: boolean;
        bodyHeight?: number;
        attachments?: Array<{
            filename: string;
            mimeType?: string;
            sizeBytes?: number;
            savedPath: string;
            messageId?: string;
            attachmentId?: string;
        }>;
        messageIdHeader?: string;
        isDraft?: boolean;
        /**
         * The draft's own stored In-Reply-To / References headers. Only set
         * on draft messages — the composer reuses them on send since the
         * Drafts pseudo-thread has no other messages to rebuild the reply
         * chain from. (Gmail only; the Outlook send path threads server-side.)
         */
        inReplyToHeader?: string;
        referencesHeader?: string;
    }>;
}

export interface SnapshotCacheEntry {
    /** Gmail historyId, or the Outlook change-fingerprint — an opaque freshness token. */
    historyId: string;
    fetchedAt: string;
    parserVersion?: number;
    /** Which provider wrote this entry. Absent = legacy Gmail entry. */
    provider?: EmailProviderTag;
    snapshot: EmailThreadSnapshot;
}

export function cachePath(threadId: string): string {
    return path.join(CACHE_DIR, `${encodeURIComponent(threadId)}.json`);
}

export function readCachedSnapshot(threadId: string): SnapshotCacheEntry | null {
    try {
        const raw = fs.readFileSync(cachePath(threadId), 'utf-8');
        return JSON.parse(raw) as SnapshotCacheEntry;
    } catch {
        return null;
    }
}

export function writeCachedSnapshot(
    threadId: string,
    historyId: string,
    snapshot: EmailThreadSnapshot,
    provider: EmailProviderTag,
): void {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        const entry: SnapshotCacheEntry = {
            historyId,
            fetchedAt: new Date().toISOString(),
            parserVersion: SNAPSHOT_PARSER_VERSION,
            provider,
            snapshot,
        };
        fs.writeFileSync(cachePath(threadId), JSON.stringify(entry), 'utf-8');
    } catch (err) {
        console.warn(`[Email cache] write failed for ${threadId}:`, err);
    }
}

export function deleteCachedSnapshot(threadId: string): void {
    try {
        fs.rmSync(cachePath(threadId), { force: true });
    } catch (err) {
        console.warn(`[Email cache] delete failed for ${threadId}:`, err);
    }
}

// Local search index — same on-disk shape as the inbox cache, separate dir.
function searchCachePath(threadId: string): string {
    return path.join(SEARCH_CACHE_DIR, `${encodeURIComponent(threadId)}.json`);
}

export function readSearchSnapshot(threadId: string): SnapshotCacheEntry | null {
    try {
        const raw = fs.readFileSync(searchCachePath(threadId), 'utf-8');
        return JSON.parse(raw) as SnapshotCacheEntry;
    } catch {
        return null;
    }
}

export function writeSearchSnapshot(
    threadId: string,
    historyId: string,
    snapshot: EmailThreadSnapshot,
    provider: EmailProviderTag,
): void {
    try {
        if (!fs.existsSync(SEARCH_CACHE_DIR)) fs.mkdirSync(SEARCH_CACHE_DIR, { recursive: true });
        const entry: SnapshotCacheEntry = {
            historyId,
            fetchedAt: new Date().toISOString(),
            parserVersion: SNAPSHOT_PARSER_VERSION,
            provider,
            snapshot,
        };
        fs.writeFileSync(searchCachePath(threadId), JSON.stringify(entry), 'utf-8');
    } catch (err) {
        console.warn(`[Email search index] write failed for ${threadId}:`, err);
    }
}

/**
 * User explicitly flips a thread's importance in the UI. Two effects:
 *  1. The verdict is applied to the cached snapshot and marked sticky
 *     (importanceSource: 'user') so re-classification never overrides it.
 *  2. The disagreement is recorded as a correction the classifier learns from
 *     (few-shot + distilled rules) for FUTURE threads.
 */
export function setThreadImportance(
    threadId: string,
    importance: 'important' | 'other',
): { success: boolean; previous?: 'important' | 'other'; error?: string } {
    const cached = readCachedSnapshot(threadId);
    if (!cached) {
        return { success: false, error: `No inbox entry found for thread ${threadId}` };
    }
    const previous = cached.snapshot.importance === 'other' ? 'other' as const : 'important' as const;
    cached.snapshot.importance = importance;
    cached.snapshot.importanceSource = 'user';
    try {
        fs.writeFileSync(cachePath(threadId), JSON.stringify(cached), 'utf-8');
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    recordImportanceCorrection({
        threadId,
        subject: cached.snapshot.subject || '(no subject)',
        from: cached.snapshot.from || 'unknown',
        agentVerdict: previous,
        userVerdict: importance,
        at: new Date().toISOString(),
    });
    // Keep the markdown mirror's stamped importance truthful. The knowledge
    // verdict is deliberately untouched — "stop showing me this" must never
    // silently starve the knowledge graph.
    stampClassificationFrontmatter(threadId, cached.snapshot);
    return { success: true, previous };
}

/**
 * User explicitly picks a thread's category in the UI. Sticky on the thread
 * (categorySource: 'user'; re-classification never overrides it) and recorded
 * as a correction the classifier learns from as few-shot examples. Like
 * importance flips, this never touches the knowledge verdict.
 */
export function setThreadCategory(
    threadId: string,
    category: EmailCategory,
): { success: boolean; error?: string } {
    const cached = readCachedSnapshot(threadId);
    if (!cached) {
        return { success: false, error: `No inbox entry found for thread ${threadId}` };
    }
    const previous = cached.snapshot.category;
    cached.snapshot.category = category;
    cached.snapshot.categorySource = 'user';
    try {
        fs.writeFileSync(cachePath(threadId), JSON.stringify(cached), 'utf-8');
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    recordCategoryCorrection({
        threadId,
        subject: cached.snapshot.subject || '(no subject)',
        from: cached.snapshot.from || 'unknown',
        agentCategory: previous ?? 'unknown',
        userCategory: category,
        at: new Date().toISOString(),
    });
    stampClassificationFrontmatter(threadId, cached.snapshot);
    return { success: true };
}

export function saveMessageBodyHeight(threadId: string, messageId: string, height: number): void {
    const cached = readCachedSnapshot(threadId);
    if (!cached) return;
    const message = cached.snapshot.messages.find((m) => m.id === messageId);
    if (!message) return;
    if (message.bodyHeight === height) return;
    message.bodyHeight = height;
    try {
        fs.writeFileSync(cachePath(threadId), JSON.stringify(cached), 'utf-8');
    } catch (err) {
        console.warn(`[Email cache] height write failed for ${threadId}/${messageId}:`, err);
    }
}

/** Mirror a new read state onto every message in the cached thread. */
export function mirrorThreadReadState(threadId: string, read: boolean): void {
    const cached = readCachedSnapshot(threadId);
    if (!cached) return;
    for (const m of cached.snapshot.messages) m.unread = !read;
    cached.snapshot.unread = !read;
    try {
        fs.writeFileSync(cachePath(threadId), JSON.stringify(cached), 'utf-8');
    } catch (err) {
        console.warn(`[Email cache] markRead write failed for ${threadId}:`, err);
    }
}

/**
 * Mirror the composer's autosaved draft body onto the thread's cached snapshot
 * so reopening the reply composer shows the text. Surgical — draft autosaves
 * must never wake the whole sync loop (md/event writes + LLM reclassification).
 */
export function mirrorThreadDraft(threadId: string, bodyText: string | undefined): void {
    const cached = readCachedSnapshot(threadId);
    if (!cached) return;
    cached.snapshot.gmail_draft = bodyText?.trim() || undefined;
    try {
        fs.writeFileSync(cachePath(threadId), JSON.stringify(cached), 'utf-8');
    } catch (err) {
        console.warn(`[Email cache] draft write failed for ${threadId}:`, err);
    }
}

// --- Inbox listing ---

export type InboxSection = 'important' | 'other';

export interface InboxPageOptions {
    section: InboxSection;
    cursor?: string;
    limit?: number;
    /** Restrict the page to threads of this category (used by the "Everything else" filter pills). */
    category?: string;
}

export interface InboxPageResult {
    threads: EmailThreadSnapshot[];
    nextCursor: string | null;
    /**
     * Threads per category across the WHOLE section (ignoring `category` and
     * pagination) — drives the filter pills. Threads with no verdict yet count
     * under 'unclassified'.
     */
    categoryCounts: Record<string, number>;
}

interface IndexedEntry {
    threadId: string;
    dateMs: number;
    snapshot: EmailThreadSnapshot;
}

export function snapshotImportance(s: EmailThreadSnapshot): InboxSection {
    return s.importance === 'other' ? 'other' : 'important';
}

export function snapshotDateMs(s: EmailThreadSnapshot): number {
    const latest = s.messages[s.messages.length - 1];
    const raw = latest?.date || s.date;
    if (!raw) return 0;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
}

function parseCursor(cursor: string | undefined): { dateMs: number; threadId: string } | null {
    if (!cursor) return null;
    const idx = cursor.indexOf('|');
    if (idx < 0) return null;
    const dateMs = Number(cursor.slice(0, idx));
    const threadId = cursor.slice(idx + 1);
    if (!Number.isFinite(dateMs) || !threadId) return null;
    return { dateMs, threadId };
}

function encodeCursor(entry: { dateMs: number; threadId: string }): string {
    return `${entry.dateMs}|${entry.threadId}`;
}

export function listImportantThreads(opts: { cursor?: string; limit?: number } = {}): InboxPageResult {
    return listInboxPage({ section: 'important', ...opts });
}

export function listEverythingElseThreads(opts: { cursor?: string; limit?: number; category?: string } = {}): InboxPageResult {
    return listInboxPage({ section: 'other', ...opts });
}

// In-memory index of parsed snapshots, keyed by cache filename and validated by
// file mtime. listInboxPage runs on every inbox open, every "load more", and
// every throttled live reload during a sync — without this it re-reads and
// JSON.parses every cached thread (message bodies included) on each call. The
// cache lets unchanged files skip the read+parse, so e.g. the "Everything else"
// page right after "Important", reloads mid-sync, and re-opening the inbox cost
// a cheap stat() per file instead of a full parse of the whole cache.
interface ListCacheEntry {
    mtimeMs: number;
    dateMs: number;
    section: InboxSection;
    snapshot: EmailThreadSnapshot;
}
const listCache = new Map<string, ListCacheEntry>();

export function listInboxPage(opts: InboxPageOptions): InboxPageResult {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 25));
    const cursor = parseCursor(opts.cursor);
    const categoryCounts: Record<string, number> = {};

    if (!fs.existsSync(CACHE_DIR)) {
        listCache.clear();
        return { threads: [], nextCursor: null, categoryCounts };
    }

    let names: string[];
    try {
        names = fs.readdirSync(CACHE_DIR);
    } catch {
        return { threads: [], nextCursor: null, categoryCounts };
    }

    const seen = new Set<string>();
    const entries: IndexedEntry[] = [];
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        seen.add(name);
        const filePath = path.join(CACHE_DIR, name);

        let mtimeMs: number;
        try {
            mtimeMs = fs.statSync(filePath).mtimeMs;
        } catch {
            listCache.delete(name);
            continue;
        }

        let cached = listCache.get(name);
        if (!cached || cached.mtimeMs !== mtimeMs) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const wrapper = JSON.parse(raw) as SnapshotCacheEntry;
                const snapshot = wrapper.snapshot;
                if (!snapshot) {
                    listCache.delete(name);
                    continue;
                }
                cached = {
                    mtimeMs,
                    dateMs: snapshotDateMs(snapshot),
                    section: snapshotImportance(snapshot),
                    snapshot,
                };
                listCache.set(name, cached);
            } catch (err) {
                console.warn(`[Inbox lists] read failed for ${name}:`, err);
                listCache.delete(name);
                continue;
            }
        }

        if (cached.section !== opts.section) continue;
        const cat = cached.snapshot.category ?? 'unclassified';
        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
        if (opts.category && cat !== opts.category) continue;
        entries.push({
            threadId: cached.snapshot.threadId,
            dateMs: cached.dateMs,
            snapshot: cached.snapshot,
        });
    }

    // Evict cache entries for files that are gone (archived/trashed/pruned).
    for (const key of listCache.keys()) {
        if (!seen.has(key)) listCache.delete(key);
    }

    // Newest first, threadId asc as tiebreak.
    entries.sort((a, b) => {
        if (b.dateMs !== a.dateMs) return b.dateMs - a.dateMs;
        return a.threadId < b.threadId ? -1 : 1;
    });

    let startIdx = 0;
    if (cursor) {
        startIdx = entries.findIndex((e) => {
            if (e.dateMs < cursor.dateMs) return true;
            if (e.dateMs === cursor.dateMs && e.threadId > cursor.threadId) return true;
            return false;
        });
        if (startIdx < 0) startIdx = entries.length;
    }

    const slice = entries.slice(startIdx, startIdx + limit);
    const hasMore = startIdx + slice.length < entries.length;
    const last = slice[slice.length - 1];

    return {
        threads: slice.map((e) => e.snapshot),
        nextCursor: hasMore && last ? encodeCursor({ dateMs: last.dateMs, threadId: last.threadId }) : null,
        categoryCounts,
    };
}

/**
 * Thread ids of every "Everything else" thread of the given category — the
 * bulk-archive gesture behind the category filter pills. Walks the local cache
 * (never the live mailbox), so it can only touch threads the user can see in
 * the section.
 */
export function listCategoryThreadIds(category: string): string[] {
    if (!fs.existsSync(CACHE_DIR)) return [];
    let names: string[];
    try {
        names = fs.readdirSync(CACHE_DIR);
    } catch {
        return [];
    }
    const targets: string[] = [];
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const threadId = decodeURIComponent(name.replace(/\.json$/, ''));
        const snapshot = readCachedSnapshot(threadId)?.snapshot;
        if (!snapshot) continue;
        if (snapshotImportance(snapshot) !== 'other') continue;
        if ((snapshot.category ?? 'unclassified') !== category) continue;
        targets.push(threadId);
    }
    return targets;
}

/**
 * Wipe the provider-specific email caches. Called when an email provider is
 * disconnected: thread/message/draft ids in these caches belong to that
 * provider's API and would 404 against the other one. The gmail_sync/ markdown
 * mirror is deliberately kept — it is knowledge source material, not an API
 * cache. Outlook's delta state goes too so a reconnect starts with a full sync.
 */
export function purgeEmailCaches(): void {
    for (const dir of [CACHE_DIR, SEARCH_CACHE_DIR, path.join(WorkDir, 'outlook_sync')]) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (err) {
            console.warn(`[Email store] cache purge failed for ${dir}:`, err);
        }
    }
    for (const file of ['contacts_sent.json', 'outlook_contacts_sent.json']) {
        try {
            fs.rmSync(path.join(WorkDir, file), { force: true });
        } catch (err) {
            console.warn(`[Email store] cache purge failed for ${file}:`, err);
        }
    }
}

/** All threadIds currently present in the inbox cache. */
export function listCachedThreadIds(): string[] {
    if (!fs.existsSync(CACHE_DIR)) return [];
    let names: string[];
    try {
        names = fs.readdirSync(CACHE_DIR);
    } catch {
        return [];
    }
    return names
        .filter((n) => n.endsWith('.json'))
        .map((n) => decodeURIComponent(n.replace(/\.json$/, '')));
}

// --- Classification frontmatter ---

/**
 * Path of a thread's markdown mirror under gmail_sync/. The filename is the
 * URI-encoded threadId: identity for Gmail's hex ids (so existing files keep
 * their names), and filesystem-safe for Graph conversation ids, which are
 * base64-ish and can contain path-hostile characters.
 */
export function emailMarkdownPath(threadId: string): string {
    return path.join(SYNC_DIR, `${encodeURIComponent(threadId)}.md`);
}

/** Drop a leading YAML frontmatter block, returning just the document body. */
function stripLeadingFrontmatter(content: string): string {
    if (!content.startsWith('---\n')) return content;
    const end = content.indexOf('\n---', 4);
    if (end === -1) return content;
    const afterClose = content.indexOf('\n', end + 4);
    if (afterClose === -1) return '';
    return content.slice(afterClose + 1).replace(/^\n+/, '');
}

/**
 * Stamp the classification verdict into the thread's gmail_sync markdown as
 * YAML frontmatter. The knowledge-graph builder holds any email file without
 * frontmatter (it can't tell noise from signal yet), so this stamp is what
 * admits — or permanently excludes — the thread from knowledge extraction.
 *
 * No-op when the snapshot carries no verdict (LLM failure → the sweep in the
 * sync backend retries later) or when the file already carries this verdict.
 *
 * Exported for tests.
 */
export function stampClassificationFrontmatter(threadId: string, snapshot: EmailThreadSnapshot): void {
    if (!snapshot.category || !snapshot.knowledge) return;
    const mdPath = emailMarkdownPath(threadId);
    let content: string;
    try {
        content = fs.readFileSync(mdPath, 'utf-8');
    } catch {
        return; // no markdown mirror for this thread (e.g. draft-only)
    }
    const importance = snapshot.importance === 'other' ? 'other' : 'important';
    const frontmatter = [
        '---',
        `importance: ${importance}`,
        `category: ${snapshot.category}`,
        `knowledge: ${snapshot.knowledge}`,
        `classified_at: "${new Date().toISOString()}"`,
        '---',
        '',
    ].join('\n');
    if (
        content.startsWith('---') &&
        content.includes(`\nimportance: ${importance}\n`) &&
        content.includes(`\ncategory: ${snapshot.category}\n`) &&
        content.includes(`\nknowledge: ${snapshot.knowledge}\n`)
    ) {
        return; // already stamped with this exact verdict
    }
    try {
        fs.writeFileSync(mdPath, frontmatter + stripLeadingFrontmatter(content));
    } catch (err) {
        console.warn(`[Email store] frontmatter stamp failed for ${threadId}:`, err);
    }
}

// --- New-mail notifications ---

/**
 * A "new email" notification for a message older than this is treated as a
 * stale backlog item — e.g. the provider replaying history after the app
 * reopens from a long offline period — and suppressed, so a reopen doesn't
 * surface day-old mail as if it just arrived.
 */
export const NEW_EMAIL_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * True when an email is too old to be worth a "new email" ping. A `dateMs` of 0
 * means the age couldn't be determined, in which case we err toward notifying
 * rather than risk silently dropping genuinely-new mail.
 */
export function isEmailTooOldToNotify(dateMs: number, now: number = Date.now()): boolean {
    return dateMs > 0 && now - dateMs > NEW_EMAIL_MAX_AGE_MS;
}

/**
 * Fire one OS notification per genuinely-new email thread. Only ever called
 * from the incremental sync path, so a first-time connect (full sync) never
 * notifies. Suppressed while the app is focused, and for stale backlog (see
 * isEmailTooOldToNotify).
 */
export function notifyNewEmailThreads(threadIds: string[]): void {
    const now = Date.now();
    for (const threadId of threadIds) {
        const snapshot = readCachedSnapshot(threadId)?.snapshot;
        if (snapshot?.importance !== 'important') continue;
        if (snapshot && isEmailTooOldToNotify(snapshotDateMs(snapshot), now)) continue;
        const subject = snapshot?.subject?.trim() || '(no subject)';
        const from = snapshot?.from?.trim();
        void notifyIfEnabled('new_email', {
            title: from ? `New email from ${from}` : 'New email',
            message: subject,
            link: `rowboat://open?type=email&threadId=${threadId}`,
            actionLabel: 'Open',
            onlyWhenBackground: true,
        });
    }
}

// --- Sync events (knowledge pipeline) ---

export interface SyncedThread {
    threadId: string;
    markdown: string;
}

function summarizeEmailSync(threads: SyncedThread[]): string {
    const lines: string[] = [
        `# Gmail sync update`,
        ``,
        `${threads.length} new/updated thread${threads.length === 1 ? '' : 's'}.`,
        ``,
    ];

    const shown = threads.slice(0, MAX_THREADS_IN_DIGEST);
    const hidden = threads.length - shown.length;

    if (shown.length > 0) {
        lines.push(`## Threads`, ``);
        for (const { markdown } of shown) {
            lines.push(markdown.trimEnd(), ``, `---`, ``);
        }
        if (hidden > 0) {
            lines.push(`_…and ${hidden} more thread(s) omitted from digest._`, ``);
        }
    }

    return lines.join('\n');
}

/**
 * Publish the synced-threads digest to the event pipeline. The `source` stays
 * 'gmail' for all providers — it is a free-form tag nothing filters on, and
 * keeping it stable avoids touching every event consumer.
 */
export async function publishEmailSyncEvent(threads: SyncedThread[]): Promise<void> {
    if (threads.length === 0) return;
    try {
        await createEvent({
            source: 'gmail',
            type: 'email.synced',
            createdAt: new Date().toISOString(),
            payload: summarizeEmailSync(threads),
        });
    } catch (err) {
        console.error('[Email store] Failed to publish sync event:', err);
    }
}

// --- Body helpers ---

export function cleanFilename(name: string): string {
    return name.replace(/[\\/*?:":<>|]/g, "").substring(0, 100).trim();
}

export function normalizeBody(body: string): string {
    return body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** HTML body → markdown with quoted-reply lines dropped. */
export function htmlToMarkdownBody(html: string): string {
    const md = nhm.translate(html);
    return md.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
}

/** Plain-text body with quoted-reply lines dropped. */
export function plainTextBody(text: string): string {
    return text.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
}

/**
 * Parse an RFC 2822 address-list header value into name/email pairs,
 * respecting quoted display names and angle brackets
 * (`"Last, First" <a@b>, c@d`). Emails are lowercased.
 */
export function parseAddressList(header: string): Array<{ name: string; email: string }> {
    if (!header) return [];
    const parts: string[] = [];
    let buf = '';
    let inQuotes = false;
    let inBrackets = 0;
    for (const ch of header) {
        if (ch === '"' && inBrackets === 0) inQuotes = !inQuotes;
        else if (ch === '<') inBrackets++;
        else if (ch === '>') inBrackets = Math.max(0, inBrackets - 1);
        if (ch === ',' && !inQuotes && inBrackets === 0) {
            if (buf.trim()) parts.push(buf.trim());
            buf = '';
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) parts.push(buf.trim());

    const out: Array<{ name: string; email: string }> = [];
    for (const part of parts) {
        const angled = part.match(/^(.*?)<\s*([^>]+?)\s*>\s*$/);
        if (angled) {
            const name = angled[1].trim().replace(/^"|"$/g, '').trim();
            const email = angled[2].trim().toLowerCase();
            if (email.includes('@')) out.push({ name, email });
        } else if (part.includes('@')) {
            out.push({ name: '', email: part.trim().toLowerCase() });
        }
    }
    return out;
}

// --- Quoted-reply stripping (shared by composer send/draft paths) ---

function isGmailQuoteAttribution(line: string): boolean {
    const trimmed = line.trim();
    return /^On\b.+\bwrote:\s*$/i.test(trimmed);
}

function isOriginalMessageBoundary(line: string): boolean {
    return /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim());
}

function isForwardedMessageBoundary(line: string): boolean {
    return /^-{2,}\s*Forwarded message\s*-{2,}$/i.test(line.trim());
}

function isOutlookHeaderBoundary(lines: string[], index: number): boolean {
    if (!/^From:\s+\S/i.test(lines[index]?.trim() || '')) return false;
    const next = lines.slice(index + 1, index + 6).map((line) => line.trim());
    return next.some((line) => /^(Sent|Date):\s+\S/i.test(line))
        && next.some((line) => /^To:\s+\S/i.test(line))
        && next.some((line) => /^Subject:\s+\S/i.test(line));
}

function findQuotedReplyBoundary(lines: string[]): number {
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] || '';
        if (
            isGmailQuoteAttribution(line)
            || isOriginalMessageBoundary(line)
            || isForwardedMessageBoundary(line)
            || isOutlookHeaderBoundary(lines, i)
        ) {
            return i;
        }

        // Plain text drafts often carry older messages as a quoted block.
        // Treat a trailing blockquote as history, but avoid stripping an inline
        // quote the user is actively writing at the top of the reply.
        if (i > 0 && line.trim().startsWith('>') && (lines[i - 1]?.trim() === '' || lines[i - 1]?.trim().startsWith('>'))) {
            return i;
        }
    }
    return -1;
}

export function stripQuotedReplyText(text: string): string {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const boundary = findQuotedReplyBoundary(lines);
    const visible = boundary >= 0 ? lines.slice(0, boundary) : lines;
    return visible
        .join('\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function htmlQuoteBoundaryIndex(html: string): number {
    const candidates: number[] = [];
    const patterns = [
        /<[^>]+\bclass\s*=\s*["'][^"']*\bgmail_(?:quote|attr)\b[^"']*["'][^>]*>/i,
        /<blockquote\b[^>]*(?:type\s*=\s*["']cite["']|class\s*=\s*["'][^"']*\bgmail_quote\b[^"']*["'])[^>]*>/i,
        /<(p|div|li)\b[^>]*>\s*(?:<(?:span|b|strong|i|em)\b[^>]*>\s*)*On\b[\s\S]{0,800}?\bwrote:\s*(?:<br\s*\/?>\s*)?(?:<\/(?:span|b|strong|i|em)>\s*)*<\/\1>/i,
        /<(p|div|li)\b[^>]*>\s*-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}\s*<\/\1>/i,
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(html);
        if (match?.index !== undefined) candidates.push(match.index);
    }

    return candidates.length > 0 ? Math.min(...candidates) : -1;
}

export function stripQuotedReplyHtml(html: string): string {
    const boundary = htmlQuoteBoundaryIndex(html);
    const visible = boundary >= 0 ? html.slice(0, boundary) : html;
    return visible.trim();
}

export function textToHtml(text: string): string {
    return text
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
        .join('');
}

/**
 * Decode the HTML entities Gmail's `snippet` field ships with (`&#39;`,
 * `&amp;`, …). Handles numeric (decimal/hex) and the common named entities;
 * unknown entities are left as-is. Single-pass — no double decoding.
 */
export function decodeHtmlEntities(value: string): string {
    const named: Record<string, string> = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    };
    return value.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
        if (body.startsWith('#')) {
            const isHex = body[1] === 'x' || body[1] === 'X';
            const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
            return String.fromCodePoint(code);
        }
        return named[body.toLowerCase()] ?? match;
    });
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function sanitizeReplyBody(bodyHtml: string, bodyText: string): { bodyHtml: string; bodyText: string } {
    const cleanText = stripQuotedReplyText(bodyText);
    const cleanHtml = stripQuotedReplyHtml(bodyHtml);
    const textWasStripped = cleanText !== bodyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const htmlWasStripped = cleanHtml !== bodyHtml.trim();

    return {
        bodyText: cleanText,
        bodyHtml: textWasStripped && !htmlWasStripped ? textToHtml(cleanText) : cleanHtml,
    };
}
