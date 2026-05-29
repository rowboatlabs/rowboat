import fs from 'fs';
import path from 'path';
import { google, gmail_v1 as gmail } from 'googleapis';
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { OAuth2Client } from 'google-auth-library';
import { WorkDir } from '../config/config.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { serviceLogger, type ServiceRunContext } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import { createEvent } from '../events/producer.js';
import { classifyThread, getUserEmail } from './classify_thread.js';

// Configuration
const SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const LEGACY_CACHE_DIR = path.join(SYNC_DIR, 'cache');
const CACHE_DIR = path.join(WorkDir, 'inbox_lists');

(function migrateLegacyCacheDir() {
    try {
        if (fs.existsSync(LEGACY_CACHE_DIR) && !fs.existsSync(CACHE_DIR)) {
            fs.renameSync(LEGACY_CACHE_DIR, CACHE_DIR);
            console.log(`[Gmail] Migrated cache from ${LEGACY_CACHE_DIR} → ${CACHE_DIR}`);
        }
    } catch (err) {
        console.warn('[Gmail] Cache directory migration failed:', err);
    }
})();
const SYNC_INTERVAL_MS = 30 * 1000; // Check every 30 seconds
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const MAX_THREADS_IN_DIGEST = 10;
const RECENT_BACKFILL_INTERVAL_MS = 15 * 60 * 1000;
const nhm = new NodeHtmlMarkdown();

// Bump whenever snapshot-building logic changes in a way that should invalidate
// previously cached snapshots (e.g. attachment / recipient parsing fixes). The
// short-circuit in buildAndCacheSnapshot only reuses a cache whose version matches,
// so stale entries are transparently rebuilt on the next sync.
const SNAPSHOT_PARSER_VERSION = 3;

interface SnapshotCacheEntry {
    historyId: string;
    fetchedAt: string;
    parserVersion?: number;
    snapshot: GmailThreadSnapshot;
}

function cachePath(threadId: string): string {
    return path.join(CACHE_DIR, `${encodeURIComponent(threadId)}.json`);
}

function readCachedSnapshot(threadId: string): SnapshotCacheEntry | null {
    try {
        const raw = fs.readFileSync(cachePath(threadId), 'utf-8');
        return JSON.parse(raw) as SnapshotCacheEntry;
    } catch {
        return null;
    }
}

function writeCachedSnapshot(threadId: string, historyId: string, snapshot: GmailThreadSnapshot): void {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        const entry: SnapshotCacheEntry = {
            historyId,
            fetchedAt: new Date().toISOString(),
            parserVersion: SNAPSHOT_PARSER_VERSION,
            snapshot,
        };
        fs.writeFileSync(cachePath(threadId), JSON.stringify(entry), 'utf-8');
    } catch (err) {
        console.warn(`[Gmail cache] write failed for ${threadId}:`, err);
    }
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
        console.warn(`[Gmail cache] height write failed for ${threadId}/${messageId}:`, err);
    }
}

function deleteCachedSnapshot(threadId: string): void {
    try {
        fs.rmSync(cachePath(threadId), { force: true });
    } catch (err) {
        console.warn(`[Gmail cache] delete failed for ${threadId}:`, err);
    }
}

async function getGmailClientOrThrow() {
    const auth = await GoogleClientFactory.getClient();
    if (!auth) throw new Error('Gmail is not connected.');
    return google.gmail({ version: 'v1', auth });
}

export interface ThreadActionResult {
    ok: boolean;
    error?: string;
}

export async function archiveThread(threadId: string): Promise<ThreadActionResult> {
    try {
        const gmailClient = await getGmailClientOrThrow();
        await gmailClient.users.threads.modify({
            userId: 'me',
            id: threadId,
            requestBody: { removeLabelIds: ['INBOX'] },
        });
        deleteCachedSnapshot(threadId);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function trashThread(threadId: string): Promise<ThreadActionResult> {
    try {
        const gmailClient = await getGmailClientOrThrow();
        await gmailClient.users.threads.trash({ userId: 'me', id: threadId });
        deleteCachedSnapshot(threadId);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function markThreadRead(threadId: string): Promise<ThreadActionResult> {
    try {
        const gmailClient = await getGmailClientOrThrow();
        await gmailClient.users.threads.modify({
            userId: 'me',
            id: threadId,
            requestBody: { removeLabelIds: ['UNREAD'] },
        });
        // Update local cache: clear unread on all messages in the thread.
        const cached = readCachedSnapshot(threadId);
        if (cached) {
            for (const m of cached.snapshot.messages) m.unread = false;
            cached.snapshot.unread = false;
            try {
                fs.writeFileSync(cachePath(threadId), JSON.stringify(cached), 'utf-8');
            } catch (err) {
                console.warn(`[Gmail cache] markRead write failed for ${threadId}:`, err);
            }
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

interface SyncedThread {
    threadId: string;
    markdown: string;
}

export interface GmailThreadSnapshot {
    threadId: string;
    threadUrl: string;
    summary?: string;
    subject?: string;
    from?: string;
    to?: string;
    date?: string;
    latest_email?: string;
    past_summary?: string;
    unread?: boolean;
    importance?: 'important' | 'other';
    draft_response?: string;
    gmail_draft?: string;
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
        }>;
        messageIdHeader?: string;
    }>;
}

function summarizeGmailSync(threads: SyncedThread[]): string {
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

async function publishGmailSyncEvent(threads: SyncedThread[]): Promise<void> {
    if (threads.length === 0) return;
    try {
        await createEvent({
            source: 'gmail',
            type: 'email.synced',
            createdAt: new Date().toISOString(),
            payload: summarizeGmailSync(threads),
        });
    } catch (err) {
        console.error('[Gmail] Failed to publish sync event:', err);
    }
}

// --- Wake Signal for Immediate Sync Trigger ---
let wakeResolve: (() => void) | null = null;

export function triggerSync(): void {
    if (wakeResolve) {
        console.log('[Gmail] Triggered - waking up immediately');
        wakeResolve();
        wakeResolve = null;
    }
}

function interruptibleSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            wakeResolve = null;
            resolve();
        }, ms);
        wakeResolve = () => {
            clearTimeout(timeout);
            resolve();
        };
    });
}

// --- Helper Functions ---

function cleanFilename(name: string): string {
    return name.replace(/[\\/*?:":<>|]/g, "").substring(0, 100).trim();
}

function decodeBase64(data: string): string {
    return Buffer.from(data, 'base64').toString('utf-8');
}

function extractBodyParts(payload: gmail.Schema$MessagePart): { text: string; html: string } {
    const out = { text: '', html: '' };
    const walk = (part: gmail.Schema$MessagePart): void => {
        const mime = part.mimeType || '';
        if (mime === 'text/html' && part.body?.data) {
            if (!out.html) out.html = decodeBase64(part.body.data);
            return;
        }
        if (mime === 'text/plain' && part.body?.data) {
            if (!out.text) out.text = decodeBase64(part.body.data);
            return;
        }
        if (part.parts) {
            for (const sub of part.parts) walk(sub);
        }
    };
    walk(payload);
    return out;
}

function getBody(payload: gmail.Schema$MessagePart): string {
    const { text, html } = extractBodyParts(payload);
    if (html) {
        const md = nhm.translate(html);
        return md.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
    }
    if (text) {
        return text.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
    }
    return '';
}

interface ExtractedAttachment {
    filename: string;
    mimeType?: string;
    sizeBytes?: number;
    savedPath: string;
}

/**
 * Walk a message MIME tree and collect "real" attachments — parts with a
 * filename + attachmentId, excluding cid-referenced inline images (those
 * already get baked into bodyHtml as data URLs).
 *
 * Returns workspace-relative paths matching the convention used by
 * saveAttachment / processThread, so the renderer can hand them to
 * shell.openPath via the existing IPC.
 */
function extractAttachments(msgId: string, payload: gmail.Schema$MessagePart, html?: string): ExtractedAttachment[] {
    const out: ExtractedAttachment[] = [];
    const walk = (part: gmail.Schema$MessagePart): void => {
        const filename = part.filename;
        const attId = part.body?.attachmentId;
        if (filename && attId) {
            // Exclude only images that are genuinely inline — i.e. their Content-ID
            // is actually referenced via `cid:` in the HTML body, so inlineCidImages
            // already baked them in as data URLs. Gmail stamps a Content-ID on most
            // parts (including real, separately-attached images like screenshots or
            // scanned docs), so a Content-ID alone must NOT exclude an attachment;
            // otherwise attached images silently disappear from the thread view.
            const cidRaw = part.headers?.find(h => h.name?.toLowerCase() === 'content-id')?.value;
            const cid = cidRaw?.replace(/^<|>$/g, '').trim();
            const mime = part.mimeType || '';
            const referencedInHtml = !!cid && !!html
                && new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(html);
            const isInlineImage = mime.startsWith('image/') && referencedInHtml;
            if (!isInlineImage) {
                const safeName = `${msgId}_${cleanFilename(filename)}`;
                out.push({
                    filename,
                    mimeType: part.mimeType ?? undefined,
                    sizeBytes: typeof part.body?.size === 'number' ? part.body.size : undefined,
                    savedPath: `gmail_sync/attachments/${safeName}`,
                });
            }
        }
        if (part.parts) for (const sub of part.parts) walk(sub);
    };
    walk(payload);
    return out;
}

async function inlineCidImages(
    gmailClient: gmail.Gmail,
    messageId: string,
    payload: gmail.Schema$MessagePart,
    html: string,
): Promise<string> {
    if (!/src\s*=\s*["']?cid:/i.test(html)) return html;

    const inlineParts: Array<{ contentId: string; mimeType: string; attachmentId: string }> = [];
    const collect = (part: gmail.Schema$MessagePart): void => {
        const cidHeader = part.headers?.find(h => h.name?.toLowerCase() === 'content-id')?.value;
        const attachmentId = part.body?.attachmentId;
        const mime = part.mimeType || '';
        if (cidHeader && attachmentId && mime.startsWith('image/')) {
            inlineParts.push({
                contentId: cidHeader.replace(/^<|>$/g, '').trim(),
                mimeType: mime,
                attachmentId,
            });
        }
        if (part.parts) for (const sub of part.parts) collect(sub);
    };
    collect(payload);
    if (inlineParts.length === 0) return html;

    const dataUrls = new Map<string, string>();
    await Promise.all(inlineParts.map(async (part) => {
        try {
            const res = await gmailClient.users.messages.attachments.get({
                userId: 'me',
                messageId,
                id: part.attachmentId,
            });
            const b64 = res.data.data;
            if (!b64) return;
            // Gmail returns base64url; data URLs need standard base64
            const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
            dataUrls.set(part.contentId, `data:${part.mimeType};base64,${normalized}`);
        } catch (err) {
            console.warn(`[Gmail] inline image fetch failed for ${part.contentId}:`, err);
        }
    }));

    let rewritten = html;
    for (const [cid, url] of dataUrls) {
        const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rewritten = rewritten.replace(new RegExp(`cid:${escaped}`, 'gi'), url);
    }
    return rewritten;
}

function normalizeBody(body: string): string {
    return body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

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

        // Gmail plain text drafts often carry older messages as a quoted block.
        // Treat a trailing blockquote as history, but avoid stripping an inline
        // quote the user is actively writing at the top of the reply.
        if (i > 0 && line.trim().startsWith('>') && (lines[i - 1]?.trim() === '' || lines[i - 1]?.trim().startsWith('>'))) {
            return i;
        }
    }
    return -1;
}

export function stripGmailQuotedReplyText(text: string): string {
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

export function stripGmailQuotedReplyHtml(html: string): string {
    const boundary = htmlQuoteBoundaryIndex(html);
    const visible = boundary >= 0 ? html.slice(0, boundary) : html;
    return visible.trim();
}

function textToHtml(text: string): string {
    return text
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
        .join('');
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function sanitizeReplyBodyForGmailReply(bodyHtml: string, bodyText: string): { bodyHtml: string; bodyText: string } {
    const cleanText = stripGmailQuotedReplyText(bodyText);
    const cleanHtml = stripGmailQuotedReplyHtml(bodyHtml);
    const textWasStripped = cleanText !== bodyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const htmlWasStripped = cleanHtml !== bodyHtml.trim();

    return {
        bodyText: cleanText,
        bodyHtml: textWasStripped && !htmlWasStripped ? textToHtml(cleanText) : cleanHtml,
    };
}

function headerValue(headers: gmail.Schema$MessagePartHeader[] | undefined, name: string): string | undefined {
    return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || undefined;
}

export interface RecentThreadInfo {
    threadId: string;
    historyId: string;
    snippet?: string;
}

export type InboxSection = 'important' | 'other';

export interface InboxPageOptions {
    section: InboxSection;
    cursor?: string;
    limit?: number;
}

export interface InboxPageResult {
    threads: GmailThreadSnapshot[];
    nextCursor: string | null;
}

interface IndexedEntry {
    threadId: string;
    dateMs: number;
    snapshot: GmailThreadSnapshot;
}

function snapshotImportance(s: GmailThreadSnapshot): InboxSection {
    return s.importance === 'other' ? 'other' : 'important';
}

function snapshotDateMs(s: GmailThreadSnapshot): number {
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

export function listEverythingElseThreads(opts: { cursor?: string; limit?: number } = {}): InboxPageResult {
    return listInboxPage({ section: 'other', ...opts });
}

export function listInboxPage(opts: InboxPageOptions): InboxPageResult {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 25));
    const cursor = parseCursor(opts.cursor);

    if (!fs.existsSync(CACHE_DIR)) return { threads: [], nextCursor: null };

    let names: string[];
    try {
        names = fs.readdirSync(CACHE_DIR);
    } catch {
        return { threads: [], nextCursor: null };
    }

    const entries: IndexedEntry[] = [];
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const filePath = path.join(CACHE_DIR, name);
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const wrapper = JSON.parse(raw) as SnapshotCacheEntry;
            const snapshot = wrapper.snapshot;
            if (!snapshot) continue;
            if (snapshotImportance(snapshot) !== opts.section) continue;
            entries.push({
                threadId: snapshot.threadId,
                dateMs: snapshotDateMs(snapshot),
                snapshot,
            });
        } catch (err) {
            console.warn(`[Inbox lists] read failed for ${name}:`, err);
        }
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
    };
}

export async function listRecentThreadIds(daysAgo: number = 2): Promise<RecentThreadInfo[]> {
    const auth = await GoogleClientFactory.getClient();
    if (!auth) {
        throw new Error('Gmail is not connected.');
    }

    const gmailClient = google.gmail({ version: 'v1', auth });
    const since = new Date();
    since.setDate(since.getDate() - daysAgo);
    const dateQuery = since.toISOString().split('T')[0].replace(/-/g, '/');

    const results: RecentThreadInfo[] = [];
    let pageToken: string | undefined;
    do {
        const res = await gmailClient.users.threads.list({
            userId: 'me',
            q: `after:${dateQuery}`,
            pageToken,
        });
        const threads = res.data.threads || [];
        for (const thread of threads) {
            if (thread.id && thread.historyId) {
                results.push({
                    threadId: thread.id,
                    historyId: thread.historyId,
                    snippet: thread.snippet || undefined,
                });
            }
        }
        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return results;
}

/**
 * Build a GmailThreadSnapshot from an already-fetched threads.get response,
 * classify it, and write to inbox_lists/. Called by the background sync
 * (processThread) — the only path that materializes snapshots.
 *
 * Returns null when the thread has no visible (non-draft) messages —
 * those shouldn't show up in the inbox.
 */
async function buildAndCacheSnapshot(
    threadId: string,
    threadData: gmail.Schema$Thread,
    gmailClient: gmail.Gmail,
    auth: OAuth2Client,
): Promise<GmailThreadSnapshot | null> {
    const messages = threadData.messages;
    if (!messages || messages.length === 0) return null;

    const cached = readCachedSnapshot(threadId);
    // Short-circuit: if the thread hasn't changed since we last classified it,
    // skip the rebuild + classifier. Saves the cid-image fetches and one LLM
    // call per unchanged thread (matters most during fullSync after a
    // historyId expiry, where the whole window is re-walked).
    // We require `importance` to be present too — pre-classifier cache files
    // would otherwise stick around forever uncategorised.
    if (
        threadData.historyId &&
        cached &&
        cached.historyId === threadData.historyId &&
        cached.parserVersion === SNAPSHOT_PARSER_VERSION &&
        cached.snapshot.importance
    ) {
        return cached.snapshot;
    }
    const heightCarryover = new Map<string, number>();
    if (cached) {
        for (const m of cached.snapshot.messages) {
            if (m.id && typeof m.bodyHeight === 'number') heightCarryover.set(m.id, m.bodyHeight);
        }
    }

    const parsed = await Promise.all(messages.map(async (msg) => {
        const headers = msg.payload?.headers || [];
        const parts = msg.payload ? extractBodyParts(msg.payload) : { text: '', html: '' };
        const body = msg.payload ? normalizeBody(getBody(msg.payload)) : '';
        let bodyHtml: string | undefined;
        if (parts.html && msg.payload && msg.id) {
            try {
                bodyHtml = await inlineCidImages(gmailClient, msg.id, msg.payload, parts.html);
            } catch (err) {
                console.warn(`[Gmail] inline image embed failed for message ${msg.id}:`, err);
                bodyHtml = parts.html;
            }
        }
        const isDraft = msg.labelIds?.includes('DRAFT') ?? false;
        const attachments = msg.payload && msg.id ? extractAttachments(msg.id, msg.payload, parts.html) : [];
        return {
            id: msg.id || undefined,
            from: headerValue(headers, 'From') || 'Unknown',
            to: headerValue(headers, 'To'),
            cc: headerValue(headers, 'Cc'),
            date: headerValue(headers, 'Date'),
            subject: headerValue(headers, 'Subject') || '(No Subject)',
            body,
            bodyHtml,
            unread: msg.labelIds?.includes('UNREAD') ?? false,
            bodyHeight: msg.id ? heightCarryover.get(msg.id) : undefined,
            messageIdHeader: headerValue(headers, 'Message-ID') || headerValue(headers, 'Message-Id') || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
            isDraft,
        };
    }));

    const sentMessages = parsed.filter((m) => !m.isDraft);
    const draftMessages = parsed.filter((m) => m.isDraft);
    const visibleMessages = sentMessages.map((msg) => {
        const rest: Partial<typeof msg> = { ...msg };
        delete rest.isDraft;
        return rest as Omit<typeof msg, 'isDraft'>;
    });
    const latestDraftBody = draftMessages.length > 0
        ? stripGmailQuotedReplyText(draftMessages[draftMessages.length - 1]!.body)
        : '';

    if (visibleMessages.length === 0) return null;

    const latest = visibleMessages[visibleMessages.length - 1]!;
    const earlier = visibleMessages.slice(0, -1);
    const earlierSummary = earlier
        .map((msg) => {
            const date = msg.date ? ` (${msg.date})` : '';
            const body = msg.body.replace(/\s+/g, ' ').slice(0, 500).trim();
            return `${msg.from}${date}: ${body}`;
        })
        .filter(Boolean)
        .join('\n\n');

    const snapshot: GmailThreadSnapshot = {
        threadId,
        threadUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
        subject: latest.subject || visibleMessages[0]?.subject,
        from: latest.from,
        to: latest.to,
        date: latest.date,
        latest_email: latest.body,
        past_summary: earlierSummary || undefined,
        unread: visibleMessages.some((m) => m.unread),
        messages: visibleMessages,
        gmail_draft: latestDraftBody || undefined,
    };

    try {
        const userEmail = await getUserEmail(auth);
        const skipDraft = latestDraftBody.length > 0;
        const classification = await classifyThread(snapshot, userEmail, { skipDraft });
        snapshot.importance = classification.importance;
        if (classification.summary) snapshot.summary = classification.summary;
        if (classification.draftResponse) {
            const draftResponse = stripGmailQuotedReplyText(classification.draftResponse);
            if (draftResponse) snapshot.draft_response = draftResponse;
        }
    } catch (err) {
        console.warn(`[Gmail] classify failed for ${threadId}:`, err);
    }

    if (threadData.historyId) {
        writeCachedSnapshot(threadId, threadData.historyId, snapshot);
    }

    return snapshot;
}

async function saveAttachment(gmail: gmail.Gmail, userId: string, msgId: string, part: gmail.Schema$MessagePart, attachmentsDir: string): Promise<string | null> {
    const filename = part.filename;
    const attId = part.body?.attachmentId;
    if (!filename || !attId) return null;

    const safeName = `${msgId}_${cleanFilename(filename)}`;
    const filePath = path.join(attachmentsDir, safeName);

    if (fs.existsSync(filePath)) return safeName;

    try {
        const res = await gmail.users.messages.attachments.get({
            userId,
            messageId: msgId,
            id: attId
        });

        const data = res.data.data;
        if (data) {
            fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
            console.log(`Saved attachment: ${safeName}`);
            return safeName;
        }
    } catch (e) {
        console.error(`Error saving attachment ${filename}:`, e);
    }
    return null;
}

// --- Sync Logic ---

async function processThread(auth: OAuth2Client, threadId: string, syncDir: string, attachmentsDir: string): Promise<SyncedThread | null> {
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.threads.get({ userId: 'me', id: threadId });
        const thread = res.data;
        const messages = thread.messages;

        if (!messages || messages.length === 0) return null;

        // Skip threads in SPAM or TRASH (Gmail labels them at the message level).
        const isExcluded = messages.some(m => {
            const labels = m.labelIds ?? [];
            return labels.includes('SPAM') || labels.includes('TRASH');
        });
        if (isExcluded) {
            console.log(`Skipping thread ${threadId} (SPAM/TRASH)`);
            return null;
        }

        // Subject from first message
        const firstHeader = messages[0].payload?.headers;
        const subject = firstHeader?.find(h => h.name === 'Subject')?.value || '(No Subject)';

        let mdContent = `# ${subject}\n\n`;
        mdContent += `**Thread ID:** ${threadId}\n`;
        mdContent += `**Message Count:** ${messages.length}\n\n---\n\n`;

        for (const msg of messages) {
            const msgId = msg.id!;
            const headers = msg.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const date = headers.find(h => h.name === 'Date')?.value || 'Unknown';

            mdContent += `### From: ${from}\n`;
            mdContent += `**Date:** ${date}\n\n`;

            if (msg.payload) {
                const body = getBody(msg.payload);
                mdContent += `${body}\n\n`;
            }

            // Attachments
            const parts: gmail.Schema$MessagePart[] = [];
            const traverseParts = (pList: gmail.Schema$MessagePart[]) => {
                for (const p of pList) {
                    parts.push(p);
                    if (p.parts) traverseParts(p.parts);
                }
            };
            if (msg.payload?.parts) traverseParts(msg.payload.parts);

            let attachmentsFound = false;
            for (const part of parts) {
                if (part.filename && part.body?.attachmentId) {
                    const savedName = await saveAttachment(gmail, 'me', msgId, part, attachmentsDir);
                    if (savedName) {
                        if (!attachmentsFound) {
                            mdContent += "**Attachments:**\n";
                            attachmentsFound = true;
                        }
                        mdContent += `- [${part.filename}](attachments/${savedName})\n`;
                    }
                }
            }
            mdContent += "\n---\n\n";
        }

        fs.writeFileSync(path.join(syncDir, `${threadId}.md`), mdContent);
        console.log(`Synced Thread: ${subject} (${threadId})`);

        // Also build + cache the rich snapshot for the inbox view.
        // Reuses the threads.get response — no extra API call.
        try {
            await buildAndCacheSnapshot(threadId, thread, gmail, auth);
        } catch (err) {
            console.warn(`[Gmail] Inbox snapshot build failed for ${threadId}:`, err);
        }

        return { threadId, markdown: mdContent };

    } catch (error) {
        console.error(`Error processing thread ${threadId}:`, error);
        const status = getErrorStatus(error);
        if (status === 404) return null;
        throw error;
    }
}

/**
 * After a sync cycle, prune inbox_lists/ entries for threadIds that are
 * no longer in INBOX (archived/trashed elsewhere). Single threads.list call,
 * keeps the cache in lock-step with Gmail's INBOX label.
 */
async function pruneInboxCache(auth: OAuth2Client): Promise<void> {
    if (!fs.existsSync(CACHE_DIR)) return;
    try {
        const gmailClient = google.gmail({ version: 'v1', auth });
        const inInbox = new Set<string>();
        let pageToken: string | undefined;
        do {
            const res = await gmailClient.users.threads.list({
                userId: 'me',
                labelIds: ['INBOX'],
                maxResults: 500,
                pageToken,
            });
            for (const t of res.data.threads || []) {
                if (t.id) inInbox.add(t.id);
            }
            pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);

        for (const name of fs.readdirSync(CACHE_DIR)) {
            if (!name.endsWith('.json')) continue;
            const threadId = decodeURIComponent(name.replace(/\.json$/, ''));
            if (!inInbox.has(threadId)) {
                try {
                    fs.rmSync(path.join(CACHE_DIR, name), { force: true });
                } catch (err) {
                    console.warn(`[Gmail] prune failed for ${threadId}:`, err);
                }
            }
        }
    } catch (err) {
        console.warn('[Gmail] pruneInboxCache failed:', err);
    }
}

function loadState(stateFile: string): { historyId?: string; last_sync?: string; last_recent_backfill?: string } {
    if (fs.existsSync(stateFile)) {
        return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    }
    return {};
}

function saveState(historyId: string, stateFile: string, extra: { last_recent_backfill?: string } = {}) {
    const previous = loadState(stateFile);
    fs.writeFileSync(stateFile, JSON.stringify({
        historyId,
        last_sync: new Date().toISOString(),
        last_recent_backfill: extra.last_recent_backfill ?? previous.last_recent_backfill,
        ...extra,
    }, null, 2));
}

function getErrorStatus(error: unknown): number | undefined {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status) return status;
    const code = Number((error as { code?: number | string }).code);
    return Number.isFinite(code) ? code : undefined;
}

function recentDateQuery(lookbackDays: number): string {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - lookbackDays);
    return pastDate.toISOString().split('T')[0].replace(/-/g, '/');
}

async function listRecentNonDeletedThreadIds(gmailClient: gmail.Gmail, lookbackDays: number): Promise<RecentThreadInfo[]> {
    const dateQuery = recentDateQuery(lookbackDays);
    const results: RecentThreadInfo[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;

    do {
        const res = await gmailClient.users.threads.list({
            userId: 'me',
            q: `after:${dateQuery} -in:spam -in:trash`,
            maxResults: 500,
            pageToken,
        });
        for (const thread of res.data.threads || []) {
            if (!thread.id || seen.has(thread.id)) continue;
            seen.add(thread.id);
            results.push({
                threadId: thread.id,
                historyId: thread.historyId || '',
                snippet: thread.snippet || undefined,
            });
        }
        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return results;
}

function shouldRunRecentBackfill(stateFile: string): boolean {
    const state = loadState(stateFile);
    if (!state.last_recent_backfill) return true;
    const lastRunMs = new Date(state.last_recent_backfill).getTime();
    if (!Number.isFinite(lastRunMs)) return true;
    return Date.now() - lastRunMs >= RECENT_BACKFILL_INTERVAL_MS;
}

async function backfillMissingRecentThreads(
    auth: OAuth2Client,
    syncDir: string,
    attachmentsDir: string,
    stateFile: string,
    lookbackDays: number,
): Promise<SyncedThread[]> {
    if (!shouldRunRecentBackfill(stateFile)) return [];

    const gmailClient = google.gmail({ version: 'v1', auth });
    const recentThreads = await listRecentNonDeletedThreadIds(gmailClient, lookbackDays);
    const missingThreadIds = recentThreads
        .map((thread) => thread.threadId)
        .filter((threadId) => !fs.existsSync(path.join(syncDir, `${threadId}.md`)));

    const synced: SyncedThread[] = [];
    for (const threadId of missingThreadIds) {
        const result = await processThread(auth, threadId, syncDir, attachmentsDir);
        if (result) synced.push(result);
    }

    const profile = await gmailClient.users.getProfile({ userId: 'me' });
    saveState(profile.data.historyId!, stateFile, { last_recent_backfill: new Date().toISOString() });

    if (missingThreadIds.length > 0) {
        console.log(`Recent Gmail backfill synced ${synced.length}/${missingThreadIds.length} missing thread(s).`);
    }
    return synced;
}

async function fullSync(auth: OAuth2Client, syncDir: string, attachmentsDir: string, stateFile: string, lookbackDays: number) {
    const gmail = google.gmail({ version: 'v1', auth });

    // If the state file holds a last_sync timestamp (e.g. left over from a
    // prior Composio sync, or from a previous successful native sync that
    // we're falling back to after a history.list 404), use that as the
    // floor — but never reach back further than lookbackDays. This caps the
    // window at "1 week at most": if last_sync is within the lookback window
    // we resume from it (a smaller window), otherwise we clamp to lookbackDays
    // ago. Mail older than the cap that arrived during a long offline gap is
    // intentionally skipped rather than backfilled.
    const state = loadState(stateFile);
    const lookbackFloor = new Date();
    lookbackFloor.setDate(lookbackFloor.getDate() - lookbackDays);
    let pastDate: Date;
    if (state.last_sync && new Date(state.last_sync) > lookbackFloor) {
        pastDate = new Date(state.last_sync);
        console.log(`Performing full sync from last_sync=${state.last_sync}...`);
    } else {
        pastDate = lookbackFloor;
        console.log(`Performing full sync of last ${lookbackDays} days...`);
    }

    let run: ServiceRunContext | null = null;
    const ensureRun = async () => {
        if (!run) {
            run = await serviceLogger.startRun({
                service: 'gmail',
                message: 'Syncing Gmail',
                trigger: 'timer',
            });
        }
    };

    try {
        const dateQuery = pastDate.toISOString().split('T')[0].replace(/-/g, '/');

        // Get History ID
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const currentHistoryId = profile.data.historyId!;

        const threadIds: string[] = [];
        let pageToken: string | undefined;
        do {
            const res = await gmail.users.threads.list({
                userId: 'me',
                q: `after:${dateQuery} -in:spam -in:trash`,
                maxResults: 500,
                pageToken
            });

            const threads = res.data.threads;
            if (threads) {
                for (const thread of threads) {
                    if (thread.id) {
                        threadIds.push(thread.id);
                    }
                }
            }
            pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);

        if (threadIds.length === 0) {
            saveState(currentHistoryId, stateFile);
            console.log("Full sync complete. No threads found.");
            return;
        }

        await ensureRun();
        const limitedThreads = limitEventItems(threadIds);
        await serviceLogger.log({
            type: 'changes_identified',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Found ${threadIds.length} thread${threadIds.length === 1 ? '' : 's'} to sync`,
            counts: { threads: threadIds.length },
            items: limitedThreads.items,
            truncated: limitedThreads.truncated,
        });

        const synced: SyncedThread[] = [];
        for (const threadId of threadIds) {
            const result = await processThread(auth, threadId, syncDir, attachmentsDir);
            if (result) synced.push(result);
        }

        await publishGmailSyncEvent(synced);

        saveState(currentHistoryId, stateFile);
        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Gmail sync complete: ${threadIds.length} thread${threadIds.length === 1 ? '' : 's'}`,
            durationMs: Date.now() - run!.startedAt,
            outcome: 'ok',
            summary: { threads: threadIds.length },
        });
        console.log("Full sync complete.");
    } catch (error) {
        console.error("Error during full sync:", error);
        await ensureRun();
        await serviceLogger.log({
            type: 'error',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Gmail sync error',
            error: error instanceof Error ? error.message : String(error),
        });
        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Gmail sync failed',
            durationMs: Date.now() - run!.startedAt,
            outcome: 'error',
        });
        throw error;
    }
}

async function partialSync(auth: OAuth2Client, startHistoryId: string, syncDir: string, attachmentsDir: string, stateFile: string, lookbackDays: number) {
    console.log(`Checking updates since historyId ${startHistoryId}...`);
    const gmail = google.gmail({ version: 'v1', auth });

    let run: ServiceRunContext | null = null;
    const ensureRun = async () => {
        if (!run) {
            run = await serviceLogger.startRun({
                service: 'gmail',
                message: 'Syncing Gmail',
                trigger: 'timer',
            });
        }
    };

    try {
        const changes: gmail.Schema$History[] = [];
        let pageToken: string | undefined;
        do {
            const res = await gmail.users.history.list({
                userId: 'me',
                startHistoryId,
                historyTypes: ['messageAdded'],
                maxResults: 500,
                pageToken,
            });
            if (res.data.history) changes.push(...res.data.history);
            pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);

        if (!changes || changes.length === 0) {
            console.log("No new changes.");
            const backfilled = await backfillMissingRecentThreads(auth, syncDir, attachmentsDir, stateFile, lookbackDays);
            await publishGmailSyncEvent(backfilled);
            const profile = await gmail.users.getProfile({ userId: 'me' });
            saveState(profile.data.historyId!, stateFile);
            return;
        }

        console.log(`Found ${changes.length} history records.`);
        const threadIds = new Set<string>();

        for (const record of changes) {
            if (record.messagesAdded) {
                for (const item of record.messagesAdded) {
                    const labels = item.message?.labelIds ?? [];
                    if (labels.includes('SPAM') || labels.includes('TRASH')) continue;
                    if (item.message?.threadId) {
                        threadIds.add(item.message.threadId);
                    }
                }
            }
        }

        if (threadIds.size === 0) {
            const backfilled = await backfillMissingRecentThreads(auth, syncDir, attachmentsDir, stateFile, lookbackDays);
            await publishGmailSyncEvent(backfilled);
            const profile = await gmail.users.getProfile({ userId: 'me' });
            saveState(profile.data.historyId!, stateFile);
            return;
        }

        await ensureRun();
        const threadIdList = Array.from(threadIds);
        const limitedThreads = limitEventItems(threadIdList);
        await serviceLogger.log({
            type: 'changes_identified',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Found ${threadIdList.length} new thread${threadIdList.length === 1 ? '' : 's'}`,
            counts: { threads: threadIdList.length },
            items: limitedThreads.items,
            truncated: limitedThreads.truncated,
        });

        const synced: SyncedThread[] = [];
        for (const tid of threadIdList) {
            const result = await processThread(auth, tid, syncDir, attachmentsDir);
            if (result) synced.push(result);
        }
        const backfilled = await backfillMissingRecentThreads(auth, syncDir, attachmentsDir, stateFile, lookbackDays);
        synced.push(...backfilled);

        await publishGmailSyncEvent(synced);

        const profile = await gmail.users.getProfile({ userId: 'me' });
        saveState(profile.data.historyId!, stateFile);
        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Gmail sync complete: ${threadIdList.length} thread${threadIdList.length === 1 ? '' : 's'}`,
            durationMs: Date.now() - run!.startedAt,
            outcome: 'ok',
            summary: { threads: threadIdList.length },
        });

    } catch (error: unknown) {
        const e = error as { response?: { status?: number } };
        if (e.response?.status === 404) {
            console.log("History ID expired. Falling back to full sync.");
            await fullSync(auth, syncDir, attachmentsDir, stateFile, lookbackDays);
            return;
        }

        console.error("Error during partial sync:", error);
        await ensureRun();
        await serviceLogger.log({
            type: 'error',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Gmail sync error',
            error: error instanceof Error ? error.message : String(error),
        });
        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Gmail sync failed',
            durationMs: Date.now() - run!.startedAt,
            outcome: 'error',
        });
        // If 401, clear tokens to force re-auth next run
        if (e.response?.status === 401) {
            console.log("401 Unauthorized, clearing cache");
            GoogleClientFactory.clearCache();
        }
    }
}

async function performSync() {
    const LOOKBACK_DAYS = 7; // Default to 1 week
    const ATTACHMENTS_DIR = path.join(SYNC_DIR, 'attachments');
    const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');

    // Ensure directories exist
    if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
    if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) {
            console.log("No valid OAuth credentials available.");
            return;
        }

        console.log("Authorization successful. Starting sync...");

        const state = loadState(STATE_FILE);
        // Backfill case: users who upgraded from a pre-inbox-view build have a
        // stored historyId but no inbox_lists/ cache, so partialSync would only
        // touch *new* threads and the inbox UI would stay empty. Force a one-
        // shot fullSync to populate snapshots for the lookback window. After
        // this runs once, the cache directory is populated and we fall back to
        // partial-sync on subsequent calls.
        const cacheMissing = !fs.existsSync(CACHE_DIR) || fs.readdirSync(CACHE_DIR).length === 0;
        // partialSync replays *every* messageAdded since the stored historyId,
        // regardless of date — so after a long offline gap a still-valid
        // historyId would pull the entire gap (e.g. 3 weeks). To honor the
        // "1 week at most" cap, bypass it when last_sync is older than the
        // lookback window and run a (date-clamped) fullSync instead.
        const gapMs = state.last_sync ? Date.now() - new Date(state.last_sync).getTime() : 0;
        const gapTooLarge = gapMs > LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
        if (!state.historyId) {
            console.log("No history ID found, starting full sync...");
            await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        } else if (cacheMissing) {
            console.log("History ID present but inbox cache empty — running full sync to backfill snapshots...");
            await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        } else if (gapTooLarge) {
            console.log(`Last sync older than ${LOOKBACK_DAYS} days — running full sync clamped to the lookback window instead of partial sync...`);
            await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        } else {
            console.log("History ID found, starting partial sync...");
            await partialSync(auth, state.historyId, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        }

        // Keep inbox_lists/ in lock-step with Gmail's INBOX label —
        // remove cache files for threads that were archived/trashed elsewhere.
        await pruneInboxCache(auth);

        console.log("Sync completed.");
    } catch (error) {
        console.error("Error during sync:", error);
    }
}

// --- Send Reply ---

export interface SendReplyOptions {
    threadId?: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    inReplyTo?: string;
    references?: string;
}

export interface SendReplyResult {
    messageId?: string;
    error?: string;
}

export interface GmailConnectionStatus {
    connected: boolean;
    hasRequiredScope: boolean;
    missingScopes: string[];
    email: string | null;
}

/** The connected Gmail address (cached). Used by the composer to exclude "me" from reply-all. */
export async function getAccountEmail(): Promise<string | null> {
    const auth = await GoogleClientFactory.getClient();
    if (!auth) return null;
    return getUserEmail(auth);
}

export async function getConnectionStatus(): Promise<GmailConnectionStatus> {
    const status = await GoogleClientFactory.getCredentialStatus(REQUIRED_SCOPE);
    let email: string | null = null;
    if (status.connected) {
        try {
            email = await getAccountEmail();
        } catch {
            email = null;
        }
    }
    return {
        connected: status.connected,
        hasRequiredScope: status.hasRequiredScopes,
        missingScopes: status.missingScopes,
        email,
    };
}

function requireSafeHeaderValue(name: string, value: string): string {
    if (/[\r\n]/.test(value)) {
        throw new Error(`${name} cannot contain line breaks.`);
    }
    return value.trim();
}

function encodeRfc2047(text: string): string {
    requireSafeHeaderValue('Subject', text);
    // Only encode if non-ASCII chars present.
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(text)) return text;
    return `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

function encodeMimeBase64(text: string): string {
    return Buffer.from(text, 'utf8')
        .toString('base64')
        .match(/.{1,76}/g)
        ?.join('\r\n') ?? '';
}

export async function sendThreadReply(opts: SendReplyOptions): Promise<SendReplyResult> {
    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) return { error: 'Gmail is not connected.' };

        const gmailClient = google.gmail({ version: 'v1', auth });
        const userEmail = await getUserEmail(auth);
        if (!userEmail) return { error: 'Could not determine your Gmail address.' };

        const safeTo = requireSafeHeaderValue('To', opts.to);
        const safeCc = opts.cc?.trim() ? requireSafeHeaderValue('Cc', opts.cc) : undefined;
        const safeBcc = opts.bcc?.trim() ? requireSafeHeaderValue('Bcc', opts.bcc) : undefined;
        const safeInReplyTo = opts.inReplyTo ? requireSafeHeaderValue('In-Reply-To', opts.inReplyTo) : undefined;
        const safeReferences = opts.references ? requireSafeHeaderValue('References', opts.references) : undefined;
        const replyBody = opts.threadId
            ? sanitizeReplyBodyForGmailReply(opts.bodyHtml, opts.bodyText)
            : { bodyHtml: opts.bodyHtml.trim(), bodyText: opts.bodyText.trim() };
        if (!replyBody.bodyText.trim()) return { error: 'Draft is empty.' };

        const boundary = `b_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const headers: string[] = [];
        headers.push(`From: ${requireSafeHeaderValue('From', userEmail)}`);
        headers.push(`To: ${safeTo}`);
        if (safeCc) headers.push(`Cc: ${safeCc}`);
        if (safeBcc) headers.push(`Bcc: ${safeBcc}`);
        headers.push(`Subject: ${encodeRfc2047(opts.subject)}`);
        if (safeInReplyTo) headers.push(`In-Reply-To: ${safeInReplyTo}`);
        if (safeReferences) headers.push(`References: ${safeReferences}`);
        headers.push('MIME-Version: 1.0');
        headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

        const parts: string[] = [];
        parts.push(`--${boundary}`);
        parts.push('Content-Type: text/plain; charset="UTF-8"');
        parts.push('Content-Transfer-Encoding: base64');
        parts.push('');
        parts.push(encodeMimeBase64(replyBody.bodyText));
        parts.push('');
        parts.push(`--${boundary}`);
        parts.push('Content-Type: text/html; charset="UTF-8"');
        parts.push('Content-Transfer-Encoding: base64');
        parts.push('');
        parts.push(encodeMimeBase64(replyBody.bodyHtml));
        parts.push('');
        parts.push(`--${boundary}--`);

        const message = `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
        const raw = Buffer.from(message, 'utf8')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const requestBody: gmail.Schema$Message = { raw };
        if (opts.threadId) requestBody.threadId = opts.threadId;

        const res = await gmailClient.users.messages.send({
            userId: 'me',
            requestBody,
        });

        if (opts.threadId) {
            // Clean up any Gmail-side drafts in this thread.
            try {
                const drafts = await gmailClient.users.drafts.list({ userId: 'me' });
                const matching = (drafts.data.drafts || []).filter(
                    (d) => d.message?.threadId === opts.threadId && d.id
                );
                await Promise.all(
                    matching.map((d) =>
                        gmailClient.users.drafts.delete({ userId: 'me', id: d.id! })
                    )
                );
            } catch (cleanupErr) {
                console.warn('[Gmail] Draft cleanup after send failed:', cleanupErr);
            }
        }

        // Wake the sync loop so the cache picks up the new message.
        triggerSync();

        return { messageId: res.data.id || undefined };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}

export async function init() {
    console.log("Starting Gmail Sync (TS)...");
    console.log(`Will sync every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            const hasCredentials = await GoogleClientFactory.hasValidCredentials(REQUIRED_SCOPE);
            if (!hasCredentials) {
                console.log("Google OAuth credentials not available or missing required Gmail scope. Sleeping...");
            } else {
                await performSync();
            }
        } catch (error) {
            console.error("Error in main loop:", error);
        }

        // Sleep for N minutes before next check (can be interrupted by triggerSync)
        console.log(`Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
        await interruptibleSleep(SYNC_INTERVAL_MS);
    }
}
