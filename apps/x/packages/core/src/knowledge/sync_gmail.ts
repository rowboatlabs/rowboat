import fs from 'fs';
import path from 'path';
import { gmail_v1 as gmail } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { WorkDir } from '../config/config.js';
import { getMaxEmails } from '../config/gmail_sync_config.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { gmailCooldownInfo, gmailQuotaTight, gmailRateLimitCooldownMs } from './gmail-rate-limit.js';
import { serviceLogger, type ServiceRunContext } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import { formatTimestampForModel } from '@x/shared/dist/time.js';
import { classifyThread, getUserEmail } from './classify_thread.js';
import {
    SYNC_DIR,
    CACHE_DIR,
    SNAPSHOT_PARSER_VERSION,
    type EmailThreadSnapshot,
    type SyncedThread,
    readCachedSnapshot,
    writeCachedSnapshot,
    deleteCachedSnapshot,
    readSearchSnapshot,
    writeSearchSnapshot,
    mirrorThreadReadState,
    mirrorThreadDraft,
    listCachedThreadIds,
    stampClassificationFrontmatter,
    notifyNewEmailThreads,
    publishEmailSyncEvent,
    cleanFilename,
    normalizeBody,
    htmlToMarkdownBody,
    plainTextBody,
    stripQuotedReplyText,
    sanitizeReplyBody,
    decodeHtmlEntities,
    escapeHtml,
    textToHtml,
} from './email/store.js';
import type {
    EmailProvider,
    ThreadActionResult,
    SendReplyOptions,
    SendReplyResult,
    SaveDraftOptions,
    SaveDraftResult,
    DownloadAttachmentResult,
    SearchResult,
    EmailConnectionStatus,
} from './email/provider.js';
import { searchSentContacts, warmSentContacts } from './gmail_sent_contacts.js';

// Back-compat re-exports: this module historically owned the whole email
// store. The provider-independent pieces now live in email/store.ts; existing
// importers (tests, classify_thread, gmail_contacts, composio-handler) keep
// working through these aliases.
export {
    setThreadImportance,
    setThreadCategory,
    saveMessageBodyHeight,
    listImportantThreads,
    listEverythingElseThreads,
    listInboxPage,
    stampClassificationFrontmatter,
    NEW_EMAIL_MAX_AGE_MS,
    isEmailTooOldToNotify,
    stripQuotedReplyText as stripGmailQuotedReplyText,
    stripQuotedReplyHtml as stripGmailQuotedReplyHtml,
    sanitizeReplyBody as sanitizeReplyBodyForGmailReply,
} from './email/store.js';
export type {
    EmailThreadSnapshot as GmailThreadSnapshot,
    InboxSection,
    InboxPageOptions,
    InboxPageResult,
} from './email/store.js';
export type {
    ThreadActionResult,
    SendReplyOptions,
    SendReplyResult,
    SaveDraftOptions,
    SaveDraftResult,
    DownloadAttachmentResult,
    SearchResult,
    EmailConnectionStatus as GmailConnectionStatus,
} from './email/provider.js';

// Configuration
const SYNC_INTERVAL_MS = 30 * 1000; // Check every 30 seconds
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const RECENT_BACKFILL_INTERVAL_MS = 15 * 60 * 1000;

async function getGmailClientOrThrow() {
    const auth = await GoogleClientFactory.getClient();
    if (!auth) throw new Error('Gmail is not connected.');
    return GoogleClientFactory.gmailClient(auth);
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

export async function markThreadRead(threadId: string, read: boolean = true): Promise<ThreadActionResult> {
    try {
        const gmailClient = await getGmailClientOrThrow();
        await gmailClient.users.threads.modify({
            userId: 'me',
            id: threadId,
            requestBody: read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] },
        });
        // Mirror the new read state onto every message in the cached thread.
        mirrorThreadReadState(threadId, read);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

function notifyNewEmails(threads: SyncedThread[]): void {
    notifyNewEmailThreads(threads.map((t) => t.threadId));
}

async function publishGmailSyncEvent(threads: SyncedThread[]): Promise<void> {
    await publishEmailSyncEvent(threads);
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
    if (html) return htmlToMarkdownBody(html);
    if (text) return plainTextBody(text);
    return '';
}

interface ExtractedAttachment {
    filename: string;
    mimeType?: string;
    sizeBytes?: number;
    savedPath: string;
    // Gmail identifiers needed to fetch the attachment on demand (e.g. when a
    // search result's attachment hasn't been downloaded to disk yet).
    messageId?: string;
    attachmentId?: string;
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
                    messageId: msgId,
                    attachmentId: attId,
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

function headerValue(headers: gmail.Schema$MessagePartHeader[] | undefined, name: string): string | undefined {
    return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || undefined;
}

export interface RecentThreadInfo {
    threadId: string;
    historyId: string;
    snippet?: string;
}

export async function listRecentThreadIds(daysAgo: number = 2): Promise<RecentThreadInfo[]> {
    const auth = await GoogleClientFactory.getClient();
    if (!auth) {
        throw new Error('Gmail is not connected.');
    }

    const gmailClient = GoogleClientFactory.gmailClient(auth);
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
 * Build a EmailThreadSnapshot from an already-fetched threads.get response,
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
): Promise<EmailThreadSnapshot | null> {
    const messages = threadData.messages;
    if (!messages || messages.length === 0) return null;

    const cached = readCachedSnapshot(threadId);
    // Short-circuit: if the thread hasn't changed since we last classified it,
    // skip the rebuild + classifier. Saves the cid-image fetches and one LLM
    // call per unchanged thread (matters most during fullSync after a
    // historyId expiry, where the whole window is re-walked).
    // We require `importance` to be present too — pre-classifier cache files
    // would otherwise stick around forever uncategorised. Deliberately NOT
    // requiring `category` here: a fullSync rewalk re-visits every cached
    // thread, and requiring it would turn that walk into one sequential LLM
    // call per pre-existing thread. Old caches gain category/knowledge via
    // the budgeted sweep instead (sweepUnclassifiedMarkdown).
    if (
        threadData.historyId &&
        cached &&
        cached.historyId === threadData.historyId &&
        cached.parserVersion === SNAPSHOT_PARSER_VERSION &&
        cached.snapshot.importance
    ) {
        // processThread may have just rewritten the markdown mirror (which
        // drops its frontmatter) — re-stamp from the cached verdict.
        stampClassificationFrontmatter(threadId, cached.snapshot);
        return cached.snapshot;
    }
    const snapshot = await parseThreadSnapshot(threadId, threadData, gmailClient);
    if (!snapshot) return null;

    // The user's explicit verdicts on this thread are sticky — carry them over
    // and skip nothing else (summary/draft still refresh below).
    const userOverride = cached?.snapshot.importanceSource === 'user'
        ? cached.snapshot.importance
        : undefined;
    const userCategoryOverride = cached?.snapshot.categorySource === 'user'
        ? cached.snapshot.category
        : undefined;

    try {
        const userEmail = await getUserEmail(auth);
        const skipDraft = (snapshot.gmail_draft?.length ?? 0) > 0;
        const classification = await classifyThread(snapshot, userEmail, { skipDraft });
        snapshot.importance = classification.importance;
        if (classification.category) snapshot.category = classification.category;
        if (classification.knowledge) snapshot.knowledge = classification.knowledge;
        if (classification.summary) snapshot.summary = classification.summary;
        if (classification.draftResponse) {
            const draftResponse = stripQuotedReplyText(classification.draftResponse);
            if (draftResponse) snapshot.draft_response = draftResponse;
        }
    } catch (err) {
        console.warn(`[Gmail] classify failed for ${threadId}:`, err);
    }

    if (userOverride) {
        snapshot.importance = userOverride;
        snapshot.importanceSource = 'user';
    }
    if (userCategoryOverride) {
        snapshot.category = userCategoryOverride;
        snapshot.categorySource = 'user';
    }

    if (threadData.historyId) {
        writeCachedSnapshot(threadId, threadData.historyId, snapshot, 'gmail');
    }
    stampClassificationFrontmatter(threadId, snapshot);

    return snapshot;
}

/**
 * Parse a threads.get response into a snapshot WITHOUT AI classification or
 * caching — the shared core of buildAndCacheSnapshot, also used by search (which
 * doesn't need importance/summary). Returns null when there are no visible
 * (non-draft) messages.
 */
async function parseThreadSnapshot(
    threadId: string,
    threadData: gmail.Schema$Thread,
    gmailClient: gmail.Gmail,
): Promise<EmailThreadSnapshot | null> {
    const messages = threadData.messages;
    if (!messages || messages.length === 0) return null;

    const cached = readCachedSnapshot(threadId);
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
        ? stripQuotedReplyText(draftMessages[draftMessages.length - 1]!.body)
        : '';

    if (visibleMessages.length === 0) return null;

    // Provider-native preview for the list row: the latest non-draft
    // message's snippet (clean text, entity-encoded by the API).
    const latestSnippet = [...messages].reverse()
        .find((m) => !(m.labelIds?.includes('DRAFT')) && m.snippet?.trim())?.snippet;

    const latest = visibleMessages[visibleMessages.length - 1]!;
    const earlier = visibleMessages.slice(0, -1);
    const earlierSummary = earlier
        .map((msg) => {
            const date = msg.date ? ` (${formatTimestampForModel(msg.date)})` : '';
            const body = msg.body.replace(/\s+/g, ' ').slice(0, 500).trim();
            return `${msg.from}${date}: ${body}`;
        })
        .filter(Boolean)
        .join('\n\n');

    return {
        threadId,
        threadUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
        subject: latest.subject || visibleMessages[0]?.subject,
        from: latest.from,
        to: latest.to,
        date: latest.date,
        latest_email: latest.body,
        past_summary: earlierSummary || undefined,
        preview: latestSnippet ? decodeHtmlEntities(latestSnippet).trim() || undefined : undefined,
        unread: visibleMessages.some((m) => m.unread),
        messages: visibleMessages,
        gmail_draft: latestDraftBody || undefined,
    };
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

/**
 * Ensure an attachment referenced by a snapshot exists on disk, downloading it
 * on demand when it doesn't. Inbox attachments are saved during sync, but
 * search results build snapshots without downloading, so opening one of their
 * attachments needs this. `savedPath` is the workspace-relative path stored on
 * the attachment; `attachmentId` (when supplied) is tried first, falling back
 * to re-fetching the message and locating the part by filename — attachment ids
 * can go stale on a cached snapshot, whereas the file name is stable.
 */
export async function downloadAttachment(args: {
    messageId: string;
    savedPath: string;
    attachmentId?: string;
}): Promise<DownloadAttachmentResult> {
    try {
        const { messageId, savedPath, attachmentId } = args;
        if (!messageId || !savedPath) return { ok: false, error: 'Missing attachment reference.' };

        const absPath = path.join(WorkDir, savedPath);
        if (fs.existsSync(absPath)) return { ok: true };

        const gmailClient = await getGmailClientOrThrow();
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const fetchData = async (attId: string): Promise<string | null> => {
            const res = await gmailClient.users.messages.attachments.get({
                userId: 'me',
                messageId,
                id: attId,
            });
            return res.data.data ?? null;
        };

        let data: string | null = null;
        if (attachmentId) {
            try {
                data = await fetchData(attachmentId);
            } catch (err) {
                console.warn(`[Gmail] attachment fetch by id failed for ${messageId}, retrying by filename:`, err);
            }
        }

        if (!data) {
            // Re-fetch the message and locate the attachment part whose derived
            // saved name matches the requested savedPath.
            const wanted = path.basename(savedPath);
            const msg = await gmailClient.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
            let foundAttId: string | undefined;
            const walk = (part: gmail.Schema$MessagePart): void => {
                if (foundAttId) return;
                const fn = part.filename;
                const attId = part.body?.attachmentId;
                if (fn && attId && `${messageId}_${cleanFilename(fn)}` === wanted) {
                    foundAttId = attId;
                    return;
                }
                if (part.parts) for (const sub of part.parts) walk(sub);
            };
            if (msg.data.payload) walk(msg.data.payload);
            if (!foundAttId) return { ok: false, error: 'Attachment not found in message.' };
            data = await fetchData(foundAttId);
        }

        if (!data) return { ok: false, error: 'Attachment had no data.' };
        fs.writeFileSync(absPath, Buffer.from(data, 'base64'));
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// --- Sync Logic ---

async function processThread(auth: OAuth2Client, threadId: string, syncDir: string, attachmentsDir: string): Promise<SyncedThread | null> {
    const gmail = GoogleClientFactory.gmailClient(auth);
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

        // Exclude unsent drafts — same rule as the incremental append path.
        // A draft rendered as a normal "### From:" block reads as a sent reply
        // downstream (email reply gate, "how the user responded"), which is
        // wrong: drafts are unsent and often half-written.
        const sentOnly = messages.filter(m => !(m.labelIds ?? []).includes('DRAFT'));
        if (sentOnly.length === 0) {
            return null;
        }

        let mdContent = `# ${subject}\n\n`;
        mdContent += `**Thread ID:** ${threadId}\n`;
        mdContent += `**Message Count:** ${sentOnly.length}\n\n---\n\n`;

        for (const msg of sentOnly) {
            const msgId = msg.id!;
            const headers = msg.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const date = headers.find(h => h.name === 'Date')?.value || 'Unknown';

            mdContent += `### From: ${from}\n`;
            mdContent += `**Date:** ${formatTimestampForModel(date)}\n\n`;

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
        const gmailClient = GoogleClientFactory.gmailClient(auth);
        const inInbox = new Set<string>();
        // threads.list returns a per-thread snippet for free — used below to
        // backfill `preview` on cache entries written before the field existed.
        const snippetByThread = new Map<string, string>();
        let pageToken: string | undefined;
        do {
            const res = await gmailClient.users.threads.list({
                userId: 'me',
                labelIds: ['INBOX'],
                maxResults: 500,
                pageToken,
            });
            for (const t of res.data.threads || []) {
                if (!t.id) continue;
                inInbox.add(t.id);
                if (t.snippet) snippetByThread.set(t.id, t.snippet);
            }
            pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);

        for (const name of fs.readdirSync(CACHE_DIR)) {
            if (!name.endsWith('.json')) continue;
            const threadId = decodeURIComponent(name.replace(/\.json$/, ''));
            // Entries stamped by another provider are leftovers from a previous
            // connection (ids are provider-specific and would 404 here).
            const entry = readCachedSnapshot(threadId);
            const foreign = (entry?.provider ?? 'gmail') !== 'gmail';
            if (foreign || !inInbox.has(threadId)) {
                try {
                    fs.rmSync(path.join(CACHE_DIR, name), { force: true });
                } catch (err) {
                    console.warn(`[Gmail] prune failed for ${threadId}:`, err);
                }
                continue;
            }
            // One-time preview backfill: only entries missing the field are
            // touched, so this converges and then no-ops.
            const snip = snippetByThread.get(threadId);
            if (entry && snip && !entry.snapshot.preview) {
                const preview = decodeHtmlEntities(snip).trim();
                if (preview) {
                    entry.snapshot.preview = preview;
                    writeCachedSnapshot(threadId, entry.historyId, entry.snapshot, 'gmail');
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

/** Recent threads still carrying the INBOX label — the set the inbox cache
 *  should contain for the lookback window. The date query matches messages,
 *  so an old thread with a recent reply is included (unlike a bare
 *  newest-N threads.list, which orders by thread creation). */
async function listRecentInboxThreadIds(gmailClient: gmail.Gmail, lookbackDays: number): Promise<string[]> {
    const dateQuery = recentDateQuery(lookbackDays);
    const ids: string[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;

    do {
        const res = await gmailClient.users.threads.list({
            userId: 'me',
            labelIds: ['INBOX'],
            q: `after:${dateQuery}`,
            maxResults: 500,
            pageToken,
        });
        for (const thread of res.data.threads || []) {
            if (!thread.id || seen.has(thread.id)) continue;
            seen.add(thread.id);
            ids.push(thread.id);
        }
        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return ids;
}

async function backfillMissingRecentThreads(
    auth: OAuth2Client,
    syncDir: string,
    attachmentsDir: string,
    stateFile: string,
    lookbackDays: number,
    opts: { force?: boolean } = {},
): Promise<SyncedThread[]> {
    if (!opts.force && (gmailQuotaTight() || !shouldRunRecentBackfill(stateFile))) return [];

    const gmailClient = GoogleClientFactory.gmailClient(auth);
    const recentThreads = await listRecentNonDeletedThreadIds(gmailClient, lookbackDays);
    const missingThreadIds = new Set(
        recentThreads
            .map((thread) => thread.threadId)
            .filter((threadId) => !fs.existsSync(path.join(syncDir, `${threadId}.md`))),
    );

    // A markdown mirror alone doesn't mean the thread is synced: disconnect
    // wipes the inbox cache but keeps gmail_sync/, and a cache-rebuilding full
    // sync misses old threads with new replies entirely. So a recent thread
    // still in INBOX with no cache entry counts as missing too. Scoped to
    // INBOX so archived threads (deliberately uncached — caching would
    // resurrect them in the inbox UI) aren't re-processed every pass.
    const cached = new Set(listCachedThreadIds());
    for (const threadId of await listRecentInboxThreadIds(gmailClient, lookbackDays)) {
        if (!cached.has(threadId)) missingThreadIds.add(threadId);
    }

    const synced: SyncedThread[] = [];
    for (const threadId of missingThreadIds) {
        const result = await processThread(auth, threadId, syncDir, attachmentsDir);
        if (result) synced.push(result);
    }

    // Advance the history watermark only on the timer-driven pass. A forced
    // pass runs right after a full sync, whose deliberately-early historyId
    // (captured before listing) must survive so the next partial sync replays
    // anything that arrived while the full sync was processing.
    if (opts.force) {
        const state = loadState(stateFile);
        if (state.historyId) {
            saveState(state.historyId, stateFile, { last_recent_backfill: new Date().toISOString() });
        }
    } else {
        const profile = await gmailClient.users.getProfile({ userId: 'me' });
        saveState(profile.data.historyId!, stateFile, { last_recent_backfill: new Date().toISOString() });
    }

    if (missingThreadIds.size > 0) {
        console.log(`Recent Gmail backfill synced ${synced.length}/${missingThreadIds.size} missing thread(s).`);
    }
    return synced;
}

async function fullSync(auth: OAuth2Client, syncDir: string, attachmentsDir: string, stateFile: string, lookbackDays: number, opts: { ignoreLastSync?: boolean } = {}) {
    const gmail = GoogleClientFactory.gmailClient(auth);

    // The onboarding / recovery fetch is bounded by a COUNT of the most recent
    // threads (maxEmails, configurable — default 500), not by a fixed date
    // window. So a fresh account pulls its newest `maxEmails` emails even when
    // they span more than a week.
    //
    // When we can resume after a previous successful sync (a last_sync within
    // the lookback window — e.g. the history.list 404 fallback, or a prior
    // Composio sync), we still floor the query at last_sync so only genuinely
    // new mail is re-walked, and the count cap acts purely as a safety bound.
    // With no resumable last_sync (first connect, or a gap longer than the
    // lookback window) we drop the date floor entirely and just take the newest
    // `maxEmails` threads.
    //
    // ignoreLastSync: the caller needs the whole window re-walked even though
    // last_sync is recent — the cache-backfill case, where inbox_lists/ was
    // wiped (disconnect) but sync_state.json survived. Resuming from last_sync
    // there would only re-list mail newer than the wipe, so the old inbox
    // would never come back.
    const maxEmails = getMaxEmails();
    const state = loadState(stateFile);
    const lookbackFloor = new Date();
    lookbackFloor.setDate(lookbackFloor.getDate() - lookbackDays);
    const resumeFrom = !opts.ignoreLastSync && state.last_sync && new Date(state.last_sync) > lookbackFloor
        ? new Date(state.last_sync)
        : null;
    if (resumeFrom) {
        console.log(`Performing full sync from last_sync=${state.last_sync} (max ${maxEmails} threads)...`);
    } else {
        console.log(`Performing full sync of the newest ${maxEmails} threads...`);
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
        const baseQuery = '-in:spam -in:trash';
        const q = resumeFrom
            ? `after:${resumeFrom.toISOString().split('T')[0].replace(/-/g, '/')} ${baseQuery}`
            : baseQuery;

        // Get History ID
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const currentHistoryId = profile.data.historyId!;

        // Gmail returns threads newest-first, so paginating until we've collected
        // maxEmails ids yields the most recent maxEmails threads.
        const threadIds: string[] = [];
        let pageToken: string | undefined;
        do {
            const res = await gmail.users.threads.list({
                userId: 'me',
                q,
                maxResults: Math.min(500, maxEmails),
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
        } while (pageToken && threadIds.length < maxEmails);

        if (threadIds.length > maxEmails) threadIds.length = maxEmails;

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
    const gmail = GoogleClientFactory.gmailClient(auth);

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
        // Threads that gained a message someone else sent. The user's own
        // outbound mail (SENT — e.g. a reply fired off from their phone or
        // Gmail web) must still sync the thread, but it is not a "new email":
        // notifying for it pings the user about their own message, and the
        // notification's deep link goes nowhere useful when the thread only
        // lives in their Sent folder.
        const inboundThreadIds = new Set<string>();

        for (const record of changes) {
            if (record.messagesAdded) {
                for (const item of record.messagesAdded) {
                    const labels = item.message?.labelIds ?? [];
                    if (labels.includes('SPAM') || labels.includes('TRASH')) continue;
                    // Drafts are not incoming mail: every composer autosave
                    // (ours or another Gmail client's) adds a DRAFT message.
                    // Processing it would leak unsent draft bodies into
                    // gmail_sync/ markdown + knowledge events, fire "New
                    // email" notifications, and re-run the LLM classifier per
                    // autosave. The Drafts view reads live via gmail:getDrafts
                    // instead.
                    if (labels.includes('DRAFT')) continue;
                    if (item.message?.threadId) {
                        threadIds.add(item.message.threadId);
                        if (!labels.includes('SENT')) {
                            inboundThreadIds.add(item.message.threadId);
                        }
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
        // Notify for the history-derived new threads only — before the older
        // backfilled threads are merged in below, so backfill stays silent —
        // and only for threads with genuinely inbound mail (see inboundThreadIds).
        notifyNewEmails(synced.filter((t) => inboundThreadIds.has(t.threadId)));
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

// Threads the sweep failed on (deleted in Gmail, persistent classify failure).
// In-memory so they retry on the next app launch but don't burn an LLM call
// every 30s tick in the meantime.
const sweepSkip = new Set<string>();

/**
 * Classify-and-stamp any gmail_sync markdown that has no frontmatter yet.
 * Covers three cases the main sync path can miss:
 *  - a classify call failed mid-sync (fail-open importance, no verdict)
 *  - files from before the unified classifier that the old labeling agent
 *    never got to
 *  - threads whose inbox cache was pruned (archived) before a verdict landed
 *
 * The knowledge-graph builder holds unstamped files indefinitely, so without
 * this sweep those emails would silently never produce knowledge notes.
 * LLM work is bounded per tick; cache-backed stamps are free and unbounded.
 */
async function sweepUnclassifiedMarkdown(auth: OAuth2Client, llmBudget: number = 15): Promise<void> {
    if (!fs.existsSync(SYNC_DIR)) return;
    let names: string[];
    try {
        names = fs.readdirSync(SYNC_DIR);
    } catch {
        return;
    }
    const gmailClient = GoogleClientFactory.gmailClient(auth);
    let classified = 0;
    let stamped = 0;
    for (const name of names) {
        if (!name.endsWith('.md')) continue;
        const threadId = name.slice(0, -3);
        if (sweepSkip.has(threadId)) continue;
        let content: string;
        try {
            content = fs.readFileSync(path.join(SYNC_DIR, name), 'utf-8');
        } catch {
            continue;
        }
        // Anything with frontmatter is either already stamped or carries the
        // legacy labeling-agent verdict the graph builder still understands.
        if (content.startsWith('---')) continue;

        const cached = readCachedSnapshot(threadId)?.snapshot;
        if (cached?.category && cached.knowledge) {
            stampClassificationFrontmatter(threadId, cached);
            stamped += 1;
            continue;
        }

        if (classified >= llmBudget) continue;
        classified += 1;
        try {
            const res = await gmailClient.users.threads.get({ userId: 'me', id: threadId });
            if (cached) {
                // In the inbox — reuse the full path (classify, cache, stamp).
                await buildAndCacheSnapshot(threadId, res.data, gmailClient, auth);
                if (!readCachedSnapshot(threadId)?.snapshot.category) sweepSkip.add(threadId);
            } else {
                // Not in the inbox cache (archived/pruned). Classify and stamp
                // only — writing the cache would resurrect the thread in the
                // inbox UI.
                const snapshot = await parseThreadSnapshot(threadId, res.data, gmailClient);
                if (!snapshot) {
                    sweepSkip.add(threadId);
                    continue;
                }
                const userEmail = await getUserEmail(auth);
                const classification = await classifyThread(snapshot, userEmail, { skipDraft: true });
                snapshot.importance = classification.importance;
                if (classification.category) snapshot.category = classification.category;
                if (classification.knowledge) snapshot.knowledge = classification.knowledge;
                stampClassificationFrontmatter(threadId, snapshot);
                if (!classification.category) sweepSkip.add(threadId);
            }
        } catch (err) {
            console.warn(`[Gmail] classification sweep failed for ${threadId}:`, err);
            sweepSkip.add(threadId);
        }
    }

    // Enrich pre-upgrade inbox caches (importance but no category) so old
    // threads get chips and a knowledge verdict. The cached snapshot already
    // holds the messages — no Gmail fetch needed. Deliberately does NOT
    // re-stamp markdown that carries legacy labels: frontmatter — rewriting
    // those files would make the graph builder reprocess emails it already
    // extracted (mtime+hash change detection).
    if (classified < llmBudget && fs.existsSync(CACHE_DIR)) {
        let cacheNames: string[] = [];
        try {
            cacheNames = fs.readdirSync(CACHE_DIR);
        } catch { /* ignore */ }
        const userEmail = await getUserEmail(auth);
        for (const name of cacheNames) {
            if (classified >= llmBudget) break;
            if (!name.endsWith('.json')) continue;
            const threadId = decodeURIComponent(name.replace(/\.json$/, ''));
            if (sweepSkip.has(threadId)) continue;
            const entry = readCachedSnapshot(threadId);
            if (!entry || !entry.snapshot.importance || entry.snapshot.category) continue;
            classified += 1;
            try {
                const classification = await classifyThread(entry.snapshot, userEmail, { skipDraft: true });
                if (!classification.category || !classification.knowledge) {
                    sweepSkip.add(threadId);
                    continue;
                }
                entry.snapshot.category = classification.category;
                entry.snapshot.knowledge = classification.knowledge;
                // The user's sticky verdict (and the previously shown one) win —
                // this pass is about adding the missing fields, not re-judging.
                writeCachedSnapshot(threadId, entry.historyId, entry.snapshot, 'gmail');
                const mdPath = path.join(SYNC_DIR, `${threadId}.md`);
                let mdContent: string | null = null;
                try {
                    mdContent = fs.readFileSync(mdPath, 'utf-8');
                } catch { /* no markdown mirror */ }
                if (mdContent !== null && !mdContent.startsWith('---')) {
                    stampClassificationFrontmatter(threadId, entry.snapshot);
                }
            } catch (err) {
                console.warn(`[Gmail] cache enrichment failed for ${threadId}:`, err);
                sweepSkip.add(threadId);
            }
        }
    }

    if (classified > 0 || stamped > 0) {
        console.log(`[Gmail] classification sweep: ${classified} classified, ${stamped} stamped from cache`);
    }
}

// One Sync Activity notice per rate-limit episode, deduped on the lockout
// deadline — without it the cooldown silences the feed mid-lockout, which
// reads as sync having given up. A progress event on a synthetic run: a
// run_complete would wrongly clear the sidebar's red failed state (any
// non-error outcome clears it) while Gmail is still locked out.
let lastCooldownNoticeUntil = 0;
// True after a failed pass until the next successful one (drives the
// recovery event in performSync).
let syncDegraded = false;
async function logRateLimitCooldownNotice(cooldownMs: number): Promise<void> {
    const until = Date.now() + cooldownMs;
    if (Math.abs(until - lastCooldownNoticeUntil) < 5_000) return;
    lastCooldownNoticeUntil = until;
    const at = new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const info = gmailCooldownInfo();
    try {
        await serviceLogger.log({
            type: 'progress',
            service: 'gmail',
            runId: 'gmail_rate_limit_notice',
            level: 'warn',
            message: `Rate limited by Gmail — next sync attempt at ${at}`,
            // Which cooldown fired matters when reading field reports: 'gmail'
            // means we honored a deadline Gmail named; 'default' means the
            // error carried none (or we failed to parse it) and the fallback
            // ladder chose the wait.
            details: { source: info?.source ?? 'default', until: new Date(until).toISOString() },
        });
    } catch {
        // Best-effort: the caller's console log still records the skip.
    }
}

async function performSync() {
    const LOOKBACK_DAYS = 7; // Default to 1 week
    const ATTACHMENTS_DIR = path.join(SYNC_DIR, 'attachments');
    const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');

    // Ensure directories exist
    if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
    if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    // Stand down while Gmail's rate-limit lockout is active — every pass
    // attempted before the deadline fails anyway, and its partial progress
    // is exactly what kept the quota permanently tripped.
    const cooldownMs = gmailRateLimitCooldownMs();
    if (cooldownMs > 0) {
        console.log(`[Gmail] rate-limit cooldown active — skipping sync for another ${Math.ceil(cooldownMs / 1000)}s`);
        await logRateLimitCooldownNotice(cooldownMs);
        return;
    }

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
        // regardless of date/count — so after a long offline gap a still-valid
        // historyId would pull the entire gap (e.g. 3 weeks). When last_sync is
        // older than the lookback window, bypass it and run fullSync instead,
        // which is count-bounded (the newest maxEmails threads).
        const gapMs = state.last_sync ? Date.now() - new Date(state.last_sync).getTime() : 0;
        const gapTooLarge = gapMs > LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
        let ranFullSync = true;
        if (!state.historyId) {
            console.log("No history ID found, starting full sync...");
            await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        } else if (cacheMissing) {
            // ignoreLastSync: after a disconnect→reconnect, purgeEmailCaches()
            // wiped inbox_lists/ but sync_state.json (inside gmail_sync/, kept
            // as knowledge source material) survived with a recent last_sync.
            // Resuming from it would only re-list brand-new mail, so the old
            // inbox would never be backfilled.
            console.log("History ID present but inbox cache empty — running full sync to backfill snapshots...");
            await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS, { ignoreLastSync: true });
        } else if (gapTooLarge) {
            console.log(`Last sync older than ${LOOKBACK_DAYS} days — running count-bounded full sync instead of partial sync...`);
            await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
        } else {
            console.log("History ID found, starting partial sync...");
            await partialSync(auth, state.historyId, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
            ranFullSync = false;
        }

        // A full sync lists the newest N threads, but threads.list orders by
        // thread CREATION date — an old thread whose latest reply arrived an
        // hour ago is invisible to it. Run the recent-window backfill
        // immediately (its date query matches messages, so it catches those)
        // instead of waiting out the 15-minute timer.
        if (ranFullSync) {
            const backfilled = await backfillMissingRecentThreads(
                auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS, { force: true },
            );
            await publishGmailSyncEvent(backfilled);
        }

        // Quota-tight (a cooldown armed mid-pass, or the grace right after a
        // lockout): skip the heavy maintenance passes so the first passes back
        // are the lean core sync, not a burst that re-trips the limit.
        if (!gmailQuotaTight()) {
            // Keep inbox_lists/ in lock-step with Gmail's INBOX label —
            // remove cache files for threads that were archived/trashed elsewhere.
            await pruneInboxCache(auth);

            // Backfill classification verdicts onto any markdown the main sync
            // paths missed — the knowledge graph holds unstamped files forever.
            await sweepUnclassifiedMarkdown(auth);
        }

        // A pass succeeded after one or more failed ones: emit a run so the
        // sidebar's red "failed" state clears. Quiet successful ticks emit no
        // events by design, so without this the red state lingered until new
        // mail happened to arrive.
        if (syncDegraded) {
            syncDegraded = false;
            const run = await serviceLogger.startRun({ service: 'gmail', message: 'Syncing Gmail', trigger: 'timer' });
            await serviceLogger.log({
                type: 'run_complete',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: 'Gmail sync recovered',
                durationMs: Date.now() - run.startedAt,
                outcome: 'ok',
            });
        }

        console.log("Sync completed.");
    } catch (error) {
        syncDegraded = true;
        console.error("Error during sync:", error);
    }
}

// --- Send Reply ---
// (SendReplyOptions / SaveDraftOptions / result types live in email/provider.ts
// and are re-exported above for back-compat.)

/** The connected Gmail address (cached). Used by the composer to exclude "me" from reply-all. */
export async function getAccountEmail(): Promise<string | null> {
    const auth = await GoogleClientFactory.getClient();
    if (!auth) return null;
    return getUserEmail(auth);
}

let cachedAccountName: string | null | undefined;

/**
 * The connected account's display name, parsed from the `From` header of a
 * recent SENT message (which is the user themselves). Cached for the process
 * lifetime. Uses only the existing gmail.modify scope — no profile/userinfo
 * scope, so it never triggers a re-consent. Used by the composer to sign off
 * AI-generated emails with the real name.
 */
export async function getAccountName(): Promise<string | null> {
    if (cachedAccountName !== undefined) return cachedAccountName;
    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) return null;
        const gmailClient = GoogleClientFactory.gmailClient(auth);
        const list = await gmailClient.users.messages.list({ userId: 'me', labelIds: ['SENT'], maxResults: 1 });
        const id = list.data.messages?.[0]?.id;
        if (!id) {
            cachedAccountName = null;
            return null;
        }
        const msg = await gmailClient.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From'],
        });
        const from = msg.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
        // Pull the display name out of `"Name" <email>` / `Name <email>`.
        const name = from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim() || null;
        cachedAccountName = name;
        return name;
    } catch (err) {
        console.warn('[Gmail] getAccountName failed:', err);
        return null;
    }
}

export async function getConnectionStatus(): Promise<EmailConnectionStatus> {
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

// Re-wrap an already-base64 string into 76-char lines (RFC 2045) and strip any
// whitespace the renderer may have included.
function wrapBase64(base64: string): string {
    return base64.replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') ?? '';
}

// Quote a filename for a MIME header, dropping characters that would break it.
function sanitizeAttachmentName(name: string): string {
    return (name || 'attachment').replace(/[\r\n"\\]/g, '_').trim() || 'attachment';
}

// `From:` header value for outgoing mail: `Name <email>` when the account's
// display name is known, bare address otherwise (matching what Gmail's own
// clients send, so recipients see a name instead of a raw address).
export function formatFromHeader(name: string | null, email: string): string {
    const cleanEmail = requireSafeHeaderValue('From', email);
    const cleanName = name?.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanName) return cleanEmail;
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(cleanName)) return `"${cleanName}" <${cleanEmail}>`;
    // RFC 2047 encoded-words must not be wrapped in a quoted-string.
    return `=?UTF-8?B?${Buffer.from(cleanName).toString('base64')}?= <${cleanEmail}>`;
}

// Drop inline images we embedded as data: URIs for display (see
// inlineCidImages) before quoting a message back out — mailing megabytes of
// base64 back to the recipient helps no one, and Gmail hides data: images
// anyway. Remote http(s) images are kept, matching Gmail's own quoting.
function stripDataUriImages(html: string): string {
    return html.replace(/<img\b[^>]*\bsrc\s*=\s*["']data:[^"']*["'][^>]*>/gi, '');
}

/**
 * The quoted conversation trail ("On <date>, <sender> wrote:" + blockquote)
 * appended below a threaded reply. Every mail client includes this trail on
 * reply; without it the sent email carries none of the conversation it
 * belongs to. Quotes the message being replied to (whose own body nests the
 * earlier history, so the full chain survives).
 */
export function buildQuotedReplyTrailFromMessages(
    messages: EmailThreadSnapshot['messages'],
    inReplyTo?: string,
): { text: string; html: string } | null {
    const visible = messages.filter((m) => !m.isDraft);
    if (visible.length === 0) return null;
    const quoted = (inReplyTo && visible.find((m) => m.messageIdHeader === inReplyTo))
        || visible[visible.length - 1]!;

    const quotedText = (quoted.body || '').trim();
    const quotedHtml = stripDataUriImages((quoted.bodyHtml || '').trim());
    if (!quotedText && !quotedHtml) return null;

    // Ends in "wrote:" so our own quote-boundary detection (and every mail
    // client's) recognizes it when this reply is itself replied to.
    const attribution = `On ${(quoted.date || 'an earlier date').trim()}, ${(quoted.from || 'unknown sender').trim()} wrote:`;
    const text = [
        attribution,
        ...(quotedText || '(no text version)').split('\n').map((line) => `> ${line}`),
    ].join('\n');
    const html = `<br /><div class="gmail_quote gmail_quote_container">`
        + `<div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}<br /></div>`
        + `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">`
        + (quotedHtml || textToHtml(quotedText))
        + `</blockquote></div>`;
    return { text, html };
}

/**
 * Trail for a threaded send, built from the locally cached thread snapshot
 * (inbox cache first, then the search index). Returns null when the thread
 * isn't cached — the send still goes out, just without a trail.
 */
function buildQuotedReplyTrail(
    threadId: string,
    inReplyTo?: string,
): { text: string; html: string } | null {
    const snapshot = readCachedSnapshot(threadId)?.snapshot
        ?? readSearchSnapshot(threadId)?.snapshot;
    if (!snapshot?.messages) return null;
    return buildQuotedReplyTrailFromMessages(snapshot.messages, inReplyTo);
}

// Build the raw (base64url) RFC 2822 message shared by both send and draft-save.
// Recipient headers are omitted when blank, so an in-progress draft with no
// `To` yet still produces a valid message. `isEmpty` lets callers reject a
// whitespace-only body without re-parsing the result. `quotedTrail` (send only
// — drafts stay trail-less so the composer reopens just the user's words) is
// appended below the sanitized body in both MIME parts.
function buildRawMimeMessage(
    opts: SaveDraftOptions,
    fromHeader: string,
    quotedTrail?: { text: string; html: string } | null,
): { raw: string; isEmpty: boolean } {
    const safeTo = opts.to?.trim() ? requireSafeHeaderValue('To', opts.to) : undefined;
    const safeCc = opts.cc?.trim() ? requireSafeHeaderValue('Cc', opts.cc) : undefined;
    const safeBcc = opts.bcc?.trim() ? requireSafeHeaderValue('Bcc', opts.bcc) : undefined;
    const safeInReplyTo = opts.inReplyTo ? requireSafeHeaderValue('In-Reply-To', opts.inReplyTo) : undefined;
    const safeReferences = opts.references ? requireSafeHeaderValue('References', opts.references) : undefined;
    const replyBody = opts.threadId
        ? sanitizeReplyBody(opts.bodyHtml, opts.bodyText)
        : { bodyHtml: opts.bodyHtml.trim(), bodyText: opts.bodyText.trim() };
    const isEmpty = !replyBody.bodyText.trim();

    // The user's words first, the quoted conversation below — the layout every
    // mail client produces on reply.
    const outText = quotedTrail && !isEmpty
        ? `${replyBody.bodyText}\n\n${quotedTrail.text}`
        : replyBody.bodyText;
    const outHtml = quotedTrail && !isEmpty
        ? `${replyBody.bodyHtml}${quotedTrail.html}`
        : replyBody.bodyHtml;

    const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const altBoundary = `alt_${seed}`;
    const attachments = (opts.attachments ?? []).filter((a) => a.contentBase64);

    const headers: string[] = [];
    headers.push(`From: ${requireSafeHeaderValue('From', fromHeader)}`);
    if (safeTo) headers.push(`To: ${safeTo}`);
    if (safeCc) headers.push(`Cc: ${safeCc}`);
    if (safeBcc) headers.push(`Bcc: ${safeBcc}`);
    headers.push(`Subject: ${encodeRfc2047(opts.subject)}`);
    if (safeInReplyTo) headers.push(`In-Reply-To: ${safeInReplyTo}`);
    if (safeReferences) headers.push(`References: ${safeReferences}`);
    headers.push('MIME-Version: 1.0');

    // The text+html body as a self-contained multipart/alternative block.
    const altParts: string[] = [];
    altParts.push(`--${altBoundary}`);
    altParts.push('Content-Type: text/plain; charset="UTF-8"');
    altParts.push('Content-Transfer-Encoding: base64');
    altParts.push('');
    altParts.push(encodeMimeBase64(outText));
    altParts.push('');
    altParts.push(`--${altBoundary}`);
    altParts.push('Content-Type: text/html; charset="UTF-8"');
    altParts.push('Content-Transfer-Encoding: base64');
    altParts.push('');
    altParts.push(encodeMimeBase64(outHtml));
    altParts.push('');
    altParts.push(`--${altBoundary}--`);

    let body: string;
    if (attachments.length) {
        // Wrap the alternative body plus each attachment in a multipart/mixed.
        const mixedBoundary = `mixed_${seed}`;
        headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
        const mixed: string[] = [];
        mixed.push(`--${mixedBoundary}`);
        mixed.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
        mixed.push('');
        mixed.push(altParts.join('\r\n'));
        for (const att of attachments) {
            const name = sanitizeAttachmentName(att.filename);
            const mime = sanitizeAttachmentName(att.mimeType) || 'application/octet-stream';
            mixed.push(`--${mixedBoundary}`);
            mixed.push(`Content-Type: ${mime}; name="${name}"`);
            mixed.push('Content-Transfer-Encoding: base64');
            mixed.push(`Content-Disposition: attachment; filename="${name}"`);
            mixed.push('');
            mixed.push(wrapBase64(att.contentBase64));
            mixed.push('');
        }
        mixed.push(`--${mixedBoundary}--`);
        body = mixed.join('\r\n');
    } else {
        headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
        body = altParts.join('\r\n');
    }

    const message = `${headers.join('\r\n')}\r\n\r\n${body}`;
    const raw = Buffer.from(message, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return { raw, isEmpty };
}

export async function sendThreadReply(opts: SendReplyOptions): Promise<SendReplyResult> {
    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) return { error: 'Gmail is not connected.' };

        const gmailClient = GoogleClientFactory.gmailClient(auth);
        const userEmail = await getUserEmail(auth);
        if (!userEmail) return { error: 'Could not determine your Gmail address.' };

        if (!opts.to?.trim()) return { error: 'Add at least one recipient.' };
        const fromHeader = formatFromHeader(await getAccountName(), userEmail);
        const quotedTrail = opts.threadId
            ? buildQuotedReplyTrail(opts.threadId, opts.inReplyTo)
            : null;
        const built = buildRawMimeMessage(opts, fromHeader, quotedTrail);
        if (built.isEmpty) return { error: 'Draft is empty.' };

        const requestBody: gmail.Schema$Message = { raw: built.raw };
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

/**
 * Save the composer's contents as a Gmail draft. Drafts created here live in the
 * user's real Gmail account, so they show up in the Drafts folder of every Gmail
 * client and sync back down via the normal history sync (the `gmail_draft` field).
 *
 * Passing `draftId` updates that existing draft in place. If it's omitted but a
 * draft already exists for `threadId` (e.g. a reply opened in a new session),
 * that draft is reused instead of creating a duplicate. A stale `draftId`
 * (deleted/sent elsewhere) falls back to creating a fresh draft.
 */
export async function saveThreadDraft(opts: SaveDraftOptions): Promise<SaveDraftResult> {
    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) return { error: 'Gmail is not connected.' };

        const gmailClient = GoogleClientFactory.gmailClient(auth);
        const userEmail = await getUserEmail(auth);
        if (!userEmail) return { error: 'Could not determine your Gmail address.' };

        const built = buildRawMimeMessage(opts, formatFromHeader(await getAccountName(), userEmail));
        if (built.isEmpty) return { error: 'Draft is empty.' };

        const message: gmail.Schema$Message = { raw: built.raw };
        if (opts.threadId) message.threadId = opts.threadId;

        // Resolve which draft to update: explicit id wins; otherwise reuse an
        // existing draft on the same thread so replies don't pile up duplicates.
        let draftId = opts.draftId;
        if (!draftId && opts.threadId) {
            try {
                const drafts = await gmailClient.users.drafts.list({ userId: 'me' });
                const existing = (drafts.data.drafts || []).find(
                    (d) => d.message?.threadId === opts.threadId && d.id
                );
                if (existing?.id) draftId = existing.id;
            } catch {
                // Listing failed — fall through and create a new draft.
            }
        }

        let res;
        if (draftId) {
            try {
                res = await gmailClient.users.drafts.update({
                    userId: 'me',
                    id: draftId,
                    requestBody: { message },
                });
            } catch (err) {
                const code = (err as { code?: number })?.code
                    ?? (err as { response?: { status?: number } })?.response?.status;
                // Recreate only when the draft is actually gone (deleted or
                // already sent). A transient failure (timeout, 5xx) must NOT
                // fall back to create — the original draft still exists, so
                // that would silently pile up duplicates in Gmail.
                if (code !== 404 && code !== 410) throw err;
                res = await gmailClient.users.drafts.create({ userId: 'me', requestBody: { message } });
            }
        } else {
            res = await gmailClient.users.drafts.create({ userId: 'me', requestBody: { message } });
        }

        // Mirror the draft body onto the thread's cached snapshot so reopening
        // the reply composer shows the autosaved text. Surgical, like
        // markThreadRead — draft messages are filtered out of the history sync
        // (see partialSync), so no sync pass will refresh this, and waking the
        // whole sync loop per autosave (md/event writes + LLM reclassification)
        // is exactly what we're avoiding.
        if (opts.threadId) {
            mirrorThreadDraft(opts.threadId, opts.bodyText);
        }

        return { draftId: res.data.id || undefined };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}

/** Delete a Gmail draft by id. A missing draft is treated as success. */
export async function deleteThreadDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) return { ok: false, error: 'Gmail is not connected.' };

        const gmailClient = GoogleClientFactory.gmailClient(auth);
        await gmailClient.users.drafts.delete({ userId: 'me', id: draftId });
        triggerSync();
        return { ok: true };
    } catch (err) {
        const code = (err as { code?: number; response?: { status?: number } })?.code
            ?? (err as { response?: { status?: number } })?.response?.status;
        // Already gone (sent/deleted) — nothing to do.
        if (code === 404 || code === 410) return { ok: true };
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// In-memory cache of built draft snapshots, keyed by draftId and validated by
// the draft's underlying message id. Gmail assigns a fresh message id whenever a
// draft is updated (locally via saveThreadDraft or in another client), so an
// unchanged message id means the parsed snapshot can be reused — we skip the
// per-draft drafts.get + body parse, mirroring listInboxPage's mtime cache.
interface DraftCacheEntry {
    messageId: string;
    snapshot: EmailThreadSnapshot;
}
const draftListCache = new Map<string, DraftCacheEntry>();

// Fetch one draft and parse it into a lightweight snapshot for the Drafts view.
async function buildDraftSnapshot(
    gmailClient: gmail.Gmail,
    draftId: string,
): Promise<EmailThreadSnapshot | null> {
    const full = await gmailClient.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
    const msg = full.data.message;
    if (!msg) return null;

    const headers = msg.payload?.headers || [];
    const parts = msg.payload ? extractBodyParts(msg.payload) : { text: '', html: '' };
    const rawBody = msg.payload ? normalizeBody(getBody(msg.payload)) : '';
    const body = stripQuotedReplyText(rawBody);
    const subject = headerValue(headers, 'Subject') || '';
    const from = headerValue(headers, 'From') || '';
    const to = headerValue(headers, 'To') || '';
    const cc = headerValue(headers, 'Cc') || '';
    const date = headerValue(headers, 'Date') || '';
    const threadId = msg.threadId || draftId;
    const messageIdHeader =
        headerValue(headers, 'Message-ID') || headerValue(headers, 'Message-Id') || undefined;
    // The reply chain the draft already carries. The composer must reuse these
    // on send — this pseudo-thread has no other messages to rebuild them from,
    // and deriving them from the draft itself would self-reference a
    // Message-ID that never gets delivered (breaking recipients' threading).
    const inReplyToHeader = headerValue(headers, 'In-Reply-To') || undefined;
    const referencesHeader = headerValue(headers, 'References') || undefined;

    return {
        threadId,
        threadUrl: `https://mail.google.com/mail/u/0/#drafts?compose=${draftId}`,
        subject,
        from,
        to,
        date,
        latest_email: body,
        gmail_draft: body || undefined,
        draftId,
        unread: false,
        messages: [{
            id: msg.id || undefined,
            from,
            to,
            cc: cc || undefined,
            date,
            subject,
            body,
            bodyHtml: parts.html || undefined,
            messageIdHeader,
            isDraft: true,
            inReplyToHeader,
            referencesHeader,
        }],
    };
}

/**
 * List the account's Gmail drafts (reply drafts and standalone new-message
 * drafts) as lightweight thread snapshots for the Drafts view. Drafts aren't
 * part of the INBOX snapshot cache, so we read them from the Gmail API — but a
 * cheap drafts.list (ids only) lets us reuse already-parsed snapshots for
 * unchanged drafts and only drafts.get the new/edited ones. No AI
 * classification; recipients/subject/body come straight off the draft message.
 */
export async function listDraftThreads(): Promise<{ threads: EmailThreadSnapshot[]; error?: string }> {
    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) {
            draftListCache.clear();
            return { threads: [], error: 'Gmail is not connected.' };
        }

        const gmailClient = GoogleClientFactory.gmailClient(auth);
        const list = await gmailClient.users.drafts.list({ userId: 'me', maxResults: 50 });
        const drafts = list.data.drafts || [];

        const seen = new Set<string>();
        const built = await Promise.all(drafts.map(async (d) => {
            if (!d.id) return null;
            seen.add(d.id);
            const messageId = d.message?.id || '';
            const cached = draftListCache.get(d.id);
            // Reuse the cached snapshot when the draft's message id is unchanged.
            if (cached && messageId && cached.messageId === messageId) {
                return cached.snapshot;
            }
            try {
                const snapshot = await buildDraftSnapshot(gmailClient, d.id);
                if (snapshot) draftListCache.set(d.id, { messageId, snapshot });
                return snapshot;
            } catch (err) {
                console.warn('[Gmail] draft fetch failed:', err);
                // Fall back to a stale cached copy if we have one.
                return cached?.snapshot ?? null;
            }
        }));

        // Evict cache entries for drafts that no longer exist (sent/deleted).
        for (const key of draftListCache.keys()) {
            if (!seen.has(key)) draftListCache.delete(key);
        }

        const threads = built.filter((s): s is EmailThreadSnapshot => s !== null);
        // Newest first.
        threads.sort((a, b) => {
            const da = a.date ? Date.parse(a.date) : 0;
            const db = b.date ? Date.parse(b.date) : 0;
            return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
        });
        return { threads };
    } catch (err) {
        return { threads: [], error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Full-text search across the ENTIRE Gmail mailbox (not just locally-synced
 * mail) using Gmail's `q` query. Each matching thread is parsed into a snapshot
 * and written to the local search index so repeat searches — and opening a
 * result — are instant. Reuses the inbox cache when a thread is already synced
 * there. No AI classification.
 */
export async function searchThreads(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    const q = query.trim();
    if (!q) return { threads: [] };
    try {
        const auth = await GoogleClientFactory.getClient();
        if (!auth) return { threads: [], error: 'Gmail is not connected.' };

        const gmailClient = GoogleClientFactory.gmailClient(auth);
        // Generous cap so the index isn't artificially small (Gmail allows 500).
        const limit = Math.max(1, Math.min(200, opts.limit ?? 100));
        const list = await gmailClient.users.threads.list({ userId: 'me', q, maxResults: limit });
        const ids = (list.data.threads || [])
            .map((t) => t.id)
            .filter((id): id is string => Boolean(id));

        const built = await Promise.all(ids.map(async (threadId) => {
            // Prefer the inbox snapshot (kept fresh by sync), then the search index.
            const inboxCached = readCachedSnapshot(threadId);
            if (inboxCached?.snapshot) return inboxCached.snapshot;
            const indexed = readSearchSnapshot(threadId);
            if (indexed?.snapshot) return indexed.snapshot;
            try {
                const threadData = await gmailClient.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
                const snapshot = await parseThreadSnapshot(threadId, threadData.data, gmailClient);
                if (snapshot) writeSearchSnapshot(threadId, threadData.data.historyId || '', snapshot, 'gmail');
                return snapshot;
            } catch (err) {
                console.warn(`[Gmail search] fetch failed for ${threadId}:`, err);
                return null;
            }
        }));

        const threads = built.filter((s): s is EmailThreadSnapshot => s !== null);
        // Newest first.
        threads.sort((a, b) => {
            const da = a.date ? Date.parse(a.date) : 0;
            const db = b.date ? Date.parse(b.date) : 0;
            return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
        });
        return { threads };
    } catch (err) {
        return { threads: [], error: err instanceof Error ? err.message : String(err) };
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

        // Sleep before the next check (can be interrupted by triggerSync).
        // An active rate-limit cooldown stretches the sleep to Gmail's own
        // deadline; performSync guards again in case a trigger wakes us early.
        const cooldownMs = gmailRateLimitCooldownMs();
        if (cooldownMs > 0) await logRateLimitCooldownNotice(cooldownMs);
        const sleepMs = Math.max(SYNC_INTERVAL_MS, cooldownMs > 0 ? cooldownMs + 1_000 : 0);
        console.log(`Sleeping for ${Math.round(sleepMs / 1000)} seconds...`);
        await interruptibleSleep(sleepMs);
    }
}

/** The Gmail implementation of the provider-agnostic email interface. */
export const gmailEmailProvider: EmailProvider = {
    id: 'google',
    triggerSync,
    sendThreadReply,
    saveThreadDraft,
    deleteThreadDraft,
    listDraftThreads,
    searchThreads,
    archiveThread,
    trashThread,
    markThreadRead,
    downloadAttachment,
    getAccountEmail,
    getAccountName,
    getConnectionStatus,
    searchSentContacts,
    warmSentContacts,
};
