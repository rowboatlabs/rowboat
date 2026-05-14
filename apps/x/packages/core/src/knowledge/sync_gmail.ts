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
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_THREADS_IN_DIGEST = 10;
const nhm = new NodeHtmlMarkdown();

interface SnapshotCacheEntry {
    historyId: string;
    fetchedAt: string;
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

export async function fetchThreadSnapshot(threadId: string, expectedHistoryId?: string): Promise<GmailThreadSnapshot | null> {
    const cached = readCachedSnapshot(threadId);
    if (expectedHistoryId && cached && cached.historyId === expectedHistoryId) {
        return cached.snapshot;
    }
    const heightCarryover = new Map<string, number>();
    if (cached) {
        for (const m of cached.snapshot.messages) {
            if (m.id && typeof m.bodyHeight === 'number') heightCarryover.set(m.id, m.bodyHeight);
        }
    }

    const auth = await GoogleClientFactory.getClient();
    if (!auth) {
        throw new Error('Gmail is not connected.');
    }

    const gmailClient = google.gmail({ version: 'v1', auth });
    const res = await gmailClient.users.threads.get({ userId: 'me', id: threadId });
    const messages = res.data.messages;
    if (!messages || messages.length === 0) return null;

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
            isDraft,
        };
    }));

    const sentMessages = parsed.filter((m) => !m.isDraft);
    const draftMessages = parsed.filter((m) => m.isDraft);
    // Drop the isDraft helper field from outgoing messages — it's internal.
    const visibleMessages = sentMessages.map(({ isDraft: _isDraft, ...rest }) => rest);
    const latestDraftBody = draftMessages.length > 0
        ? draftMessages[draftMessages.length - 1]!.body.trim()
        : '';

    // A thread with no sent messages (only a draft) shouldn't show up in the inbox —
    // skip caching it. Once the user actually sends, the thread reappears with a real message.
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
        // If the user already has a Gmail-side draft going, skip the AI draft generation —
        // the renderer will prefer the Gmail draft anyway, and we save an LLM call.
        const skipDraft = latestDraftBody.length > 0;
        const classification = await classifyThread(snapshot, userEmail, { skipDraft });
        snapshot.importance = classification.importance;
        if (classification.summary) snapshot.summary = classification.summary;
        if (classification.draftResponse) snapshot.draft_response = classification.draftResponse;
    } catch (err) {
        console.warn(`[Gmail] classify failed for ${threadId}:`, err);
    }

    if (res.data.historyId) {
        writeCachedSnapshot(threadId, res.data.historyId, snapshot);
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

        return { threadId, markdown: mdContent };

    } catch (error) {
        console.error(`Error processing thread ${threadId}:`, error);
        return null;
    }
}

function loadState(stateFile: string): { historyId?: string; last_sync?: string } {
    if (fs.existsSync(stateFile)) {
        return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    }
    return {};
}

function saveState(historyId: string, stateFile: string) {
    fs.writeFileSync(stateFile, JSON.stringify({
        historyId,
        last_sync: new Date().toISOString()
    }, null, 2));
}

async function fullSync(auth: OAuth2Client, syncDir: string, attachmentsDir: string, stateFile: string, lookbackDays: number) {
    const gmail = google.gmail({ version: 'v1', auth });

    // If the state file holds a last_sync timestamp (e.g. left over from a
    // prior Composio sync, or from a previous successful native sync that
    // we're falling back to after a history.list 404), use that as the
    // floor instead of the default lookback. Carries forward Composio's
    // last_sync on first migration so we don't refetch the last 7 days.
    const state = loadState(stateFile);
    let pastDate: Date;
    if (state.last_sync) {
        pastDate = new Date(state.last_sync);
        console.log(`Performing full sync from last_sync=${state.last_sync}...`);
    } else {
        pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - lookbackDays);
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
                q: `after:${dateQuery}`,
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
        const res = await gmail.users.history.list({
            userId: 'me',
            startHistoryId,
            historyTypes: ['messageAdded']
        });

        const changes = res.data.history;
        if (!changes || changes.length === 0) {
            console.log("No new changes.");
            const profile = await gmail.users.getProfile({ userId: 'me' });
            saveState(profile.data.historyId!, stateFile);
            return;
        }

        console.log(`Found ${changes.length} history records.`);
        const threadIds = new Set<string>();

        for (const record of changes) {
            if (record.messagesAdded) {
                for (const item of record.messagesAdded) {
                    if (item.message?.threadId) {
                        threadIds.add(item.message.threadId);
                    }
                }
            }
        }

        if (threadIds.size === 0) {
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
        if (!state.historyId) {
            console.log("No history ID found, starting full sync...");
            await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        } else {
            console.log("History ID found, starting partial sync...");
            await partialSync(auth, state.historyId, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        }

        console.log("Sync completed.");
    } catch (error) {
        console.error("Error during sync:", error);
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
