import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WorkDir } from '../config/config.js';
import { getMaxEmails } from '../config/gmail_sync_config.js';
import { OutlookClientFactory, GraphError } from './outlook-client-factory.js';
import { serviceLogger, type ServiceRunContext } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import { classifyThread } from './classify_thread.js';
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
    stampClassificationFrontmatter,
    notifyNewEmailThreads,
    publishEmailSyncEvent,
    emailMarkdownPath,
    cleanFilename,
    normalizeBody,
    htmlToMarkdownBody,
    plainTextBody,
    stripQuotedReplyText,
    sanitizeReplyBody,
    parseAddressList,
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
import { searchSentContacts, warmSentContacts } from './outlook_sent_contacts.js';

// Outlook / Microsoft 365 mail backend. Mirrors sync_gmail.ts: a 30s poll
// loop keeps the shared snapshot cache (inbox_lists/) and markdown mirror
// (gmail_sync/ — the generic email artifact dir) in step with the mailbox via
// Microsoft Graph. Threads are Graph "conversations": Graph has no
// first-class thread fetch, so snapshots are built by grouping messages on
// conversationId and fetching each conversation with a $filter query.

// Configuration
const SYNC_INTERVAL_MS = 30 * 1000;
const REQUIRED_SCOPE = 'https://graph.microsoft.com/Mail.ReadWrite';
const RECENT_BACKFILL_INTERVAL_MS = 15 * 60 * 1000;
const STATE_DIR = path.join(WorkDir, 'outlook_sync');
const STATE_FILE = path.join(STATE_DIR, 'sync_state.json');
const ATTACHMENTS_DIR = path.join(SYNC_DIR, 'attachments');
const LOOKBACK_DAYS = 7;
// Graph rejects simple attachment POSTs above ~3 MB; larger files go through
// an upload session with chunked PUTs.
const SIMPLE_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024 - (4 * 1024 * 1024) % 327680; // multiple of 320 KiB

// --- Graph wire types (only the fields we select) ---

interface GraphEmailAddress {
    name?: string;
    address?: string;
}

interface GraphRecipient {
    emailAddress?: GraphEmailAddress;
}

interface GraphItemBody {
    contentType?: 'text' | 'html';
    content?: string;
}

interface GraphMessage {
    id?: string;
    conversationId?: string;
    parentFolderId?: string;
    isRead?: boolean;
    isDraft?: boolean;
    receivedDateTime?: string;
    lastModifiedDateTime?: string;
    subject?: string;
    from?: GraphRecipient;
    toRecipients?: GraphRecipient[];
    ccRecipients?: GraphRecipient[];
    internetMessageId?: string;
    hasAttachments?: boolean;
    body?: GraphItemBody;
    /** Plain-text preview of the body — what Outlook's own list rows show. */
    bodyPreview?: string;
    webLink?: string;
    '@removed'?: { reason?: string };
}

interface GraphAttachment {
    '@odata.type'?: string;
    id?: string;
    name?: string;
    contentType?: string;
    size?: number;
    isInline?: boolean;
    contentId?: string;
    contentBytes?: string;
}

interface GraphListResponse<T> {
    value?: T[];
    '@odata.nextLink'?: string;
    '@odata.deltaLink'?: string;
}

const MESSAGE_SELECT = 'id,conversationId,parentFolderId,isRead,isDraft,receivedDateTime,lastModifiedDateTime,subject,from,toRecipients,ccRecipients,internetMessageId,hasAttachments,body,bodyPreview,webLink';
const LIST_SELECT = 'id,conversationId,parentFolderId,isRead,isDraft,receivedDateTime,lastModifiedDateTime,subject';
const HTML_BODY_PREFER = 'outlook.body-content-type="html"';

// --- Wake Signal for Immediate Sync Trigger ---
let wakeResolve: (() => void) | null = null;

export function triggerSync(): void {
    if (wakeResolve) {
        console.log('[Outlook] Triggered - waking up immediately');
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

// --- Helpers ---

function shortHash(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function formatAddress(r: GraphRecipient | undefined): string {
    const name = r?.emailAddress?.name?.trim();
    const address = r?.emailAddress?.address?.trim();
    if (!address) return name || '';
    // `Name <email>` — the RFC 2822 shape the composer's parseAddressList and
    // the contact indexers expect.
    return name && name !== address ? `${name} <${address}>` : address;
}

function formatAddressList(rs: GraphRecipient[] | undefined): string | undefined {
    const formatted = (rs ?? []).map(formatAddress).filter(Boolean);
    return formatted.length > 0 ? formatted.join(', ') : undefined;
}

function toGraphRecipients(header: string | undefined): GraphRecipient[] {
    if (!header?.trim()) return [];
    return parseAddressList(header).map(({ name, email }) => ({
        emailAddress: { address: email, ...(name ? { name } : {}) },
    }));
}

/** Escape a value for a Graph $filter string literal (single quotes double). */
function filterLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

async function graphGetAllPages<T>(firstUrl: string, headers?: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    while (url) {
        const page: GraphListResponse<T> = await OutlookClientFactory.graphFetch<GraphListResponse<T>>(url, { headers });
        out.push(...(page.value ?? []));
        url = page['@odata.nextLink'];
    }
    return out;
}

// Well-known folder ids, resolved once per process. Used to drop junk/deleted
// messages client-side — Graph cannot $filter on "not in folder".
let folderIdsPromise: Promise<Record<string, string>> | null = null;

function getFolderIds(): Promise<Record<string, string>> {
    if (!folderIdsPromise) {
        folderIdsPromise = (async () => {
            const names = ['inbox', 'archive', 'deleteditems', 'junkemail', 'drafts', 'sentitems'];
            const out: Record<string, string> = {};
            for (const name of names) {
                try {
                    const folder = await OutlookClientFactory.graphFetch<{ id?: string }>(`/me/mailFolders/${name}?$select=id`);
                    if (folder?.id) out[name] = folder.id;
                } catch (err) {
                    // Not all mailboxes expose every well-known folder (archive
                    // is missing until first used); tolerate gaps.
                    console.warn(`[Outlook] folder id lookup failed for ${name}:`, err);
                }
            }
            return out;
        })().catch((err) => {
            folderIdsPromise = null;
            throw err;
        });
    }
    return folderIdsPromise;
}

async function excludedFolderIds(): Promise<Set<string>> {
    const folders = await getFolderIds();
    return new Set([folders.deleteditems, folders.junkemail].filter(Boolean));
}

/**
 * Fetch every message of a conversation (all folders) with full bodies,
 * excluding junk/deleted, sorted oldest-first. Graph rejects $orderby combined
 * with a conversationId $filter, so sorting happens client-side.
 */
async function fetchConversationMessages(conversationId: string): Promise<GraphMessage[]> {
    const filter = encodeURIComponent(`conversationId eq '${filterLiteral(conversationId)}'`);
    const messages = await graphGetAllPages<GraphMessage>(
        `/me/messages?$filter=${filter}&$top=100&$select=${MESSAGE_SELECT}`,
        { Prefer: HTML_BODY_PREFER },
    );
    const excluded = await excludedFolderIds();
    return messages
        .filter((m) => !m.parentFolderId || !excluded.has(m.parentFolderId))
        .sort((a, b) => Date.parse(a.receivedDateTime ?? '') - Date.parse(b.receivedDateTime ?? ''));
}

// --- Attachments ---

function attachmentDiskName(messageId: string, name: string): string {
    // Graph immutable ids run to 140+ characters — hash them so the filename
    // stays well under path limits. The full id lives on the attachment record.
    return `${shortHash(messageId)}_${cleanFilename(name || 'attachment')}`;
}

async function listAttachmentMetadata(messageId: string): Promise<GraphAttachment[]> {
    return graphGetAllPages<GraphAttachment>(
        `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline,contentId`,
    );
}

async function fetchAttachmentBytes(messageId: string, attachmentId: string): Promise<string | null> {
    const att = await OutlookClientFactory.graphFetch<GraphAttachment>(
        `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return att?.contentBytes ?? null;
}

async function saveAttachmentToDisk(messageId: string, att: GraphAttachment): Promise<string | null> {
    if (!att.id || !att.name) return null;
    const diskName = attachmentDiskName(messageId, att.name);
    const filePath = path.join(ATTACHMENTS_DIR, diskName);
    if (fs.existsSync(filePath)) return diskName;
    try {
        const bytes = await fetchAttachmentBytes(messageId, att.id);
        if (!bytes) return null;
        fs.writeFileSync(filePath, Buffer.from(bytes, 'base64'));
        console.log(`[Outlook] Saved attachment: ${diskName}`);
        return diskName;
    } catch (err) {
        console.error(`[Outlook] Error saving attachment ${att.name}:`, err);
        return null;
    }
}

/** Substitute `cid:` references in the HTML body with data URLs. */
function inlineCidImages(html: string, inlineAtts: Array<{ contentId: string; contentType: string; bytes: string }>): string {
    let rewritten = html;
    for (const att of inlineAtts) {
        const escaped = att.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rewritten = rewritten.replace(new RegExp(`cid:${escaped}`, 'gi'), `data:${att.contentType};base64,${att.bytes}`);
    }
    return rewritten;
}

// --- Snapshot building ---

/** Opaque freshness token for a conversation — the Outlook stand-in for Gmail's historyId. */
function conversationFingerprint(messages: GraphMessage[]): string {
    return shortHash(messages.map((m) => `${m.id}:${m.lastModifiedDateTime}`).join('|'));
}

interface ParsedConversation {
    snapshot: EmailThreadSnapshot;
    fingerprint: string;
}

/**
 * Parse a conversation's messages into a snapshot WITHOUT AI classification or
 * caching — the shared core of buildAndCacheSnapshot, also used by search.
 * Returns null when there are no visible (non-draft) messages. When
 * `downloadAttachments` is set, real attachments are also saved to disk (the
 * background sync does this; search builds snapshots lazily instead).
 */
async function parseConversationSnapshot(
    conversationId: string,
    messages: GraphMessage[],
    opts: { downloadAttachments?: boolean } = {},
): Promise<ParsedConversation | null> {
    if (messages.length === 0) return null;

    const cached = readCachedSnapshot(conversationId);
    const heightCarryover = new Map<string, number>();
    if (cached) {
        for (const m of cached.snapshot.messages) {
            if (m.id && typeof m.bodyHeight === 'number') heightCarryover.set(m.id, m.bodyHeight);
        }
    }

    const parsed: EmailThreadSnapshot['messages'] = [];
    const drafts: Array<{ body: string }> = [];
    for (const msg of messages) {
        const isHtml = msg.body?.contentType !== 'text';
        const rawContent = msg.body?.content ?? '';
        const bodyMd = normalizeBody(isHtml ? htmlToMarkdownBody(rawContent) : plainTextBody(rawContent));

        if (msg.isDraft) {
            drafts.push({ body: bodyMd });
            continue;
        }

        let bodyHtml = isHtml && rawContent ? rawContent : undefined;
        let attachments: NonNullable<EmailThreadSnapshot['messages'][number]['attachments']> = [];
        if (msg.hasAttachments && msg.id) {
            try {
                const metadata = await listAttachmentMetadata(msg.id);

                // Inline images referenced via cid: get baked into the HTML.
                if (bodyHtml && /src\s*=\s*["']?cid:/i.test(bodyHtml)) {
                    const inline = metadata.filter((a) => a.isInline && a.contentId && a.id && (a.contentType ?? '').startsWith('image/'));
                    const withBytes: Array<{ contentId: string; contentType: string; bytes: string }> = [];
                    for (const att of inline) {
                        try {
                            const bytes = await fetchAttachmentBytes(msg.id, att.id!);
                            if (bytes) withBytes.push({ contentId: att.contentId!, contentType: att.contentType || 'image/png', bytes });
                        } catch (err) {
                            console.warn(`[Outlook] inline image fetch failed for ${att.contentId}:`, err);
                        }
                    }
                    if (withBytes.length > 0) bodyHtml = inlineCidImages(bodyHtml, withBytes);
                }

                // Real attachments: everything except inline images that are
                // actually referenced in the HTML body.
                for (const att of metadata) {
                    if (!att.id || !att.name) continue;
                    const cid = att.contentId?.replace(/^<|>$/g, '').trim();
                    const referencedInHtml = !!cid && !!bodyHtml
                        && new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(bodyHtml);
                    const isInlineImage = (att.contentType ?? '').startsWith('image/') && att.isInline && referencedInHtml;
                    if (isInlineImage) continue;
                    if (opts.downloadAttachments) {
                        await saveAttachmentToDisk(msg.id, att);
                    }
                    attachments.push({
                        filename: att.name,
                        mimeType: att.contentType ?? undefined,
                        sizeBytes: typeof att.size === 'number' ? att.size : undefined,
                        savedPath: `gmail_sync/attachments/${attachmentDiskName(msg.id, att.name)}`,
                        messageId: msg.id,
                        attachmentId: att.id,
                    });
                }
            } catch (err) {
                console.warn(`[Outlook] attachment listing failed for ${msg.id}:`, err);
                attachments = [];
            }
        }

        parsed.push({
            id: msg.id,
            from: formatAddress(msg.from) || 'Unknown',
            to: formatAddressList(msg.toRecipients),
            cc: formatAddressList(msg.ccRecipients),
            date: msg.receivedDateTime,
            subject: msg.subject || '(No Subject)',
            body: bodyMd,
            bodyHtml,
            unread: msg.isRead === false,
            bodyHeight: msg.id ? heightCarryover.get(msg.id) : undefined,
            messageIdHeader: msg.internetMessageId ?? undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
        });
    }

    if (parsed.length === 0) return null;

    const latestDraftBody = drafts.length > 0
        ? stripQuotedReplyText(drafts[drafts.length - 1]!.body)
        : '';

    const latest = parsed[parsed.length - 1]!;
    const earlier = parsed.slice(0, -1);
    const earlierSummary = earlier
        .map((msg) => {
            const date = msg.date ? ` (${msg.date})` : '';
            const body = (msg.body ?? '').replace(/\s+/g, ' ').slice(0, 500).trim();
            return `${msg.from}${date}: ${body}`;
        })
        .filter(Boolean)
        .join('\n\n');

    const latestWithLink = [...messages].reverse().find((m) => !m.isDraft && m.webLink);
    // Provider-native preview for the list row: the latest non-draft
    // message's bodyPreview (already plain text).
    const latestPreview = [...messages].reverse()
        .find((m) => !m.isDraft && m.bodyPreview?.trim())?.bodyPreview;
    const snapshot: EmailThreadSnapshot = {
        threadId: conversationId,
        threadUrl: latestWithLink?.webLink || 'https://outlook.office.com/mail/',
        subject: latest.subject || parsed[0]?.subject,
        from: latest.from,
        to: latest.to,
        date: latest.date,
        latest_email: latest.body,
        past_summary: earlierSummary || undefined,
        preview: latestPreview?.trim() || undefined,
        unread: parsed.some((m) => m.unread),
        messages: parsed,
        gmail_draft: latestDraftBody || undefined,
    };
    return { snapshot, fingerprint: conversationFingerprint(messages) };
}

let cachedAccountEmail: string | null = null;
let cachedAccountName: string | null = null;

async function fetchProfile(): Promise<void> {
    const me = await OutlookClientFactory.graphFetch<{ mail?: string; userPrincipalName?: string; displayName?: string }>(
        '/me?$select=mail,userPrincipalName,displayName',
    );
    cachedAccountEmail = (me?.mail || me?.userPrincipalName || '').toLowerCase() || null;
    cachedAccountName = me?.displayName || null;
}

/** The connected Outlook address (cached). */
export async function getAccountEmail(): Promise<string | null> {
    if (cachedAccountEmail) return cachedAccountEmail;
    try {
        if (!(await OutlookClientFactory.getAccessToken())) return null;
        await fetchProfile();
    } catch (err) {
        console.warn('[Outlook] getAccountEmail failed:', err);
    }
    return cachedAccountEmail;
}

/** The connected account's display name (cached). */
export async function getAccountName(): Promise<string | null> {
    if (cachedAccountName) return cachedAccountName;
    try {
        if (!(await OutlookClientFactory.getAccessToken())) return null;
        await fetchProfile();
    } catch (err) {
        console.warn('[Outlook] getAccountName failed:', err);
    }
    return cachedAccountName;
}

export async function getConnectionStatus(): Promise<EmailConnectionStatus> {
    const status = await OutlookClientFactory.getCredentialStatus(REQUIRED_SCOPE);
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

/**
 * Build a snapshot from already-fetched conversation messages, classify it,
 * and write to inbox_lists/. Mirrors sync_gmail's buildAndCacheSnapshot,
 * including the unchanged-fingerprint short-circuit and sticky user verdicts.
 */
async function buildAndCacheSnapshot(conversationId: string, messages: GraphMessage[]): Promise<EmailThreadSnapshot | null> {
    const fingerprint = conversationFingerprint(messages);
    const cached = readCachedSnapshot(conversationId);
    if (
        cached &&
        cached.historyId === fingerprint &&
        cached.parserVersion === SNAPSHOT_PARSER_VERSION &&
        cached.snapshot.importance
    ) {
        stampClassificationFrontmatter(conversationId, cached.snapshot);
        return cached.snapshot;
    }

    const parsed = await parseConversationSnapshot(conversationId, messages, { downloadAttachments: true });
    if (!parsed) return null;
    const { snapshot } = parsed;

    const userOverride = cached?.snapshot.importanceSource === 'user'
        ? cached.snapshot.importance
        : undefined;
    const userCategoryOverride = cached?.snapshot.categorySource === 'user'
        ? cached.snapshot.category
        : undefined;

    try {
        const userEmail = await getAccountEmail();
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
        console.warn(`[Outlook] classify failed for ${conversationId}:`, err);
    }

    if (userOverride) {
        snapshot.importance = userOverride;
        snapshot.importanceSource = 'user';
    }
    if (userCategoryOverride) {
        snapshot.category = userCategoryOverride;
        snapshot.categorySource = 'user';
    }

    writeCachedSnapshot(conversationId, fingerprint, snapshot, 'outlook');
    stampClassificationFrontmatter(conversationId, snapshot);
    return snapshot;
}

/**
 * Fetch a conversation, write its markdown mirror, and build+classify+cache
 * its snapshot — the Outlook mirror of sync_gmail's processThread.
 */
async function processConversation(conversationId: string): Promise<SyncedThread | null> {
    try {
        const messages = await fetchConversationMessages(conversationId);
        if (messages.length === 0) return null;

        // Exclude unsent drafts — a draft rendered as a normal message block
        // reads as a sent reply downstream, which is wrong.
        const sentOnly = messages.filter((m) => !m.isDraft);
        if (sentOnly.length === 0) return null;

        const subject = sentOnly[0]?.subject || '(No Subject)';
        let mdContent = `# ${subject}\n\n`;
        mdContent += `**Thread ID:** ${conversationId}\n`;
        mdContent += `**Message Count:** ${sentOnly.length}\n\n---\n\n`;

        for (const msg of sentOnly) {
            const isHtml = msg.body?.contentType !== 'text';
            const rawContent = msg.body?.content ?? '';
            const body = normalizeBody(isHtml ? htmlToMarkdownBody(rawContent) : plainTextBody(rawContent));
            mdContent += `### From: ${formatAddress(msg.from) || 'Unknown'}\n`;
            mdContent += `**Date:** ${msg.receivedDateTime || 'Unknown'}\n\n`;
            mdContent += `${body}\n\n`;

            if (msg.hasAttachments && msg.id) {
                try {
                    const metadata = await listAttachmentMetadata(msg.id);
                    let attachmentsFound = false;
                    for (const att of metadata) {
                        if (att.isInline) continue;
                        const savedName = await saveAttachmentToDisk(msg.id, att);
                        if (savedName) {
                            if (!attachmentsFound) {
                                mdContent += '**Attachments:**\n';
                                attachmentsFound = true;
                            }
                            mdContent += `- [${att.name}](attachments/${savedName})\n`;
                        }
                    }
                } catch (err) {
                    console.warn(`[Outlook] attachment sync failed for ${msg.id}:`, err);
                }
            }
            mdContent += '\n---\n\n';
        }

        fs.writeFileSync(emailMarkdownPath(conversationId), mdContent);
        console.log(`[Outlook] Synced conversation: ${subject}`);

        try {
            await buildAndCacheSnapshot(conversationId, messages);
        } catch (err) {
            console.warn(`[Outlook] Inbox snapshot build failed for ${conversationId}:`, err);
        }

        return { threadId: conversationId, markdown: mdContent };
    } catch (error) {
        console.error(`[Outlook] Error processing conversation ${conversationId}:`, error);
        if (error instanceof GraphError && error.status === 404) return null;
        throw error;
    }
}

// --- Sync state ---

interface OutlookSyncState {
    deltaLink?: string;
    last_sync?: string;
    last_recent_backfill?: string;
}

function loadState(): OutlookSyncState {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as OutlookSyncState;
        }
    } catch { /* corrupted state — treat as fresh */ }
    return {};
}

function saveState(state: OutlookSyncState): void {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * A fresh inbox delta link WITHOUT enumerating current state —
 * `$deltatoken=latest` yields a link representing "now".
 */
async function fetchLatestDeltaLink(): Promise<string | undefined> {
    try {
        const res = await OutlookClientFactory.graphFetch<GraphListResponse<GraphMessage>>(
            '/me/mailFolders/inbox/messages/delta?$deltatoken=latest',
        );
        return res['@odata.deltaLink'];
    } catch (err) {
        console.warn('[Outlook] failed to obtain delta link:', err);
        return undefined;
    }
}

// --- Sync passes ---

async function fullSync(): Promise<void> {
    const maxEmails = getMaxEmails();
    console.log(`[Outlook] Performing full sync of the newest ${maxEmails} messages...`);

    let run: ServiceRunContext | null = null;
    const ensureRun = async () => {
        if (!run) {
            run = await serviceLogger.startRun({
                service: 'outlook',
                message: 'Syncing Outlook',
                trigger: 'timer',
            });
        }
    };

    try {
        const excluded = await excludedFolderIds();

        // Newest-first page walk until we have maxEmails messages; drafts and
        // junk/deleted are dropped client-side (Graph can't filter "not in
        // folder", and a $filter would disable $orderby).
        const collected: GraphMessage[] = [];
        let url: string | undefined = `/me/messages?$top=100&$select=${LIST_SELECT}&$orderby=receivedDateTime desc`;
        while (url && collected.length < maxEmails) {
            const page: GraphListResponse<GraphMessage> = await OutlookClientFactory.graphFetch<GraphListResponse<GraphMessage>>(url);
            for (const msg of page.value ?? []) {
                if (msg.isDraft) continue;
                if (msg.parentFolderId && excluded.has(msg.parentFolderId)) continue;
                collected.push(msg);
                if (collected.length >= maxEmails) break;
            }
            url = page['@odata.nextLink'];
        }

        // Group by conversation, keeping newest-first order of first sight.
        const conversationIds: string[] = [];
        const seen = new Set<string>();
        for (const msg of collected) {
            const cid = msg.conversationId;
            if (!cid || seen.has(cid)) continue;
            seen.add(cid);
            conversationIds.push(cid);
        }

        if (conversationIds.length === 0) {
            saveState({ ...loadState(), deltaLink: await fetchLatestDeltaLink(), last_sync: new Date().toISOString() });
            console.log('[Outlook] Full sync complete. No conversations found.');
            return;
        }

        await ensureRun();
        const limited = limitEventItems(conversationIds);
        await serviceLogger.log({
            type: 'changes_identified',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Found ${conversationIds.length} conversation${conversationIds.length === 1 ? '' : 's'} to sync`,
            counts: { threads: conversationIds.length },
            items: limited.items,
            truncated: limited.truncated,
        });

        const synced: SyncedThread[] = [];
        for (const conversationId of conversationIds) {
            const result = await processConversation(conversationId);
            if (result) synced.push(result);
        }

        await publishEmailSyncEvent(synced);
        saveState({ ...loadState(), deltaLink: await fetchLatestDeltaLink(), last_sync: new Date().toISOString() });

        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Outlook sync complete: ${conversationIds.length} conversation${conversationIds.length === 1 ? '' : 's'}`,
            durationMs: Date.now() - run!.startedAt,
            outcome: 'ok',
            summary: { threads: conversationIds.length },
        });
        console.log('[Outlook] Full sync complete.');
    } catch (error) {
        console.error('[Outlook] Error during full sync:', error);
        await ensureRun();
        await serviceLogger.log({
            type: 'error',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Outlook sync error',
            error: error instanceof Error ? error.message : String(error),
        });
        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Outlook sync failed',
            durationMs: Date.now() - run!.startedAt,
            outcome: 'error',
        });
        throw error;
    }
}

function shouldRunRecentBackfill(state: OutlookSyncState): boolean {
    if (!state.last_recent_backfill) return true;
    const lastRunMs = new Date(state.last_recent_backfill).getTime();
    if (!Number.isFinite(lastRunMs)) return true;
    return Date.now() - lastRunMs >= RECENT_BACKFILL_INTERVAL_MS;
}

/**
 * The inbox delta only covers the inbox folder; conversations that live
 * entirely elsewhere (e.g. mail auto-filed by rules) would never get a
 * markdown mirror. Every 15 minutes, list recent messages across the whole
 * mailbox and process conversations whose mirror is missing.
 */
async function backfillMissingRecentConversations(lookbackDays: number): Promise<SyncedThread[]> {
    const state = loadState();
    if (!shouldRunRecentBackfill(state)) return [];

    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
    const excluded = await excludedFolderIds();
    const messages = await graphGetAllPages<GraphMessage>(
        `/me/messages?$filter=${filter}&$top=100&$select=${LIST_SELECT}`,
    );

    const missing: string[] = [];
    const seen = new Set<string>();
    for (const msg of messages) {
        const cid = msg.conversationId;
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        if (msg.isDraft) continue;
        if (msg.parentFolderId && excluded.has(msg.parentFolderId)) continue;
        if (!fs.existsSync(emailMarkdownPath(cid))) missing.push(cid);
    }

    const synced: SyncedThread[] = [];
    for (const conversationId of missing) {
        const result = await processConversation(conversationId);
        if (result) synced.push(result);
    }

    saveState({ ...loadState(), last_recent_backfill: new Date().toISOString() });
    if (missing.length > 0) {
        console.log(`[Outlook] Recent backfill synced ${synced.length}/${missing.length} missing conversation(s).`);
    }
    return synced;
}

async function deltaSync(deltaLink: string): Promise<void> {
    let run: ServiceRunContext | null = null;
    const ensureRun = async () => {
        if (!run) {
            run = await serviceLogger.startRun({
                service: 'outlook',
                message: 'Syncing Outlook',
                trigger: 'timer',
            });
        }
    };

    try {
        // Replay the delta chain: changed/new inbox messages since last tick.
        const touched = new Set<string>();
        let url: string | undefined = deltaLink;
        let newDeltaLink: string | undefined;
        while (url) {
            const page: GraphListResponse<GraphMessage> = await OutlookClientFactory.graphFetch<GraphListResponse<GraphMessage>>(url);
            for (const msg of page.value ?? []) {
                if (msg['@removed']) continue; // prune keeps the cache in step
                // Drafts are not incoming mail: composer autosaves must not
                // leak into markdown/events or re-run the classifier.
                if (msg.isDraft) continue;
                if (msg.conversationId) touched.add(msg.conversationId);
            }
            newDeltaLink = page['@odata.deltaLink'] ?? newDeltaLink;
            url = page['@odata.nextLink'];
        }

        if (touched.size === 0) {
            const backfilled = await backfillMissingRecentConversations(2);
            await publishEmailSyncEvent(backfilled);
            saveState({ ...loadState(), deltaLink: newDeltaLink ?? deltaLink, last_sync: new Date().toISOString() });
            return;
        }

        await ensureRun();
        const conversationIds = Array.from(touched);
        const limited = limitEventItems(conversationIds);
        await serviceLogger.log({
            type: 'changes_identified',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Found ${conversationIds.length} changed conversation${conversationIds.length === 1 ? '' : 's'}`,
            counts: { threads: conversationIds.length },
            items: limited.items,
            truncated: limited.truncated,
        });

        const synced: SyncedThread[] = [];
        for (const conversationId of conversationIds) {
            const result = await processConversation(conversationId);
            if (result) synced.push(result);
        }
        // Notify for the delta-derived threads only — the older backfilled
        // threads merged below stay silent.
        notifyNewEmailThreads(synced.map((t) => t.threadId));
        const backfilled = await backfillMissingRecentConversations(2);
        synced.push(...backfilled);

        await publishEmailSyncEvent(synced);
        saveState({ ...loadState(), deltaLink: newDeltaLink ?? deltaLink, last_sync: new Date().toISOString() });

        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'info',
            message: `Outlook sync complete: ${conversationIds.length} conversation${conversationIds.length === 1 ? '' : 's'}`,
            durationMs: Date.now() - run!.startedAt,
            outcome: 'ok',
            summary: { threads: conversationIds.length },
        });
    } catch (error) {
        if (error instanceof GraphError && (error.status === 410 || error.status === 404)) {
            // Delta token expired — clear it and rebuild via full sync.
            console.log('[Outlook] Delta link expired. Falling back to full sync.');
            saveState({ ...loadState(), deltaLink: undefined });
            await fullSync();
            return;
        }
        console.error('[Outlook] Error during delta sync:', error);
        await ensureRun();
        await serviceLogger.log({
            type: 'error',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Outlook sync error',
            error: error instanceof Error ? error.message : String(error),
        });
        await serviceLogger.log({
            type: 'run_complete',
            service: run!.service,
            runId: run!.runId,
            level: 'error',
            message: 'Outlook sync failed',
            durationMs: Date.now() - run!.startedAt,
            outcome: 'error',
        });
    }
}

/**
 * Keep inbox_lists/ in lock-step with the Outlook inbox: drop cache entries
 * for conversations no longer present there (archived/deleted elsewhere) and
 * entries stamped by another provider (leftovers from a previous connection).
 */
async function pruneInboxCache(): Promise<void> {
    if (!fs.existsSync(CACHE_DIR)) return;
    try {
        const inInbox = new Set<string>();
        // Latest message preview per conversation — used below to backfill
        // `preview` on cache entries written before the field existed.
        const previewByConv = new Map<string, { dateMs: number; preview: string }>();
        const messages = await graphGetAllPages<GraphMessage>(
            '/me/mailFolders/inbox/messages?$select=conversationId,receivedDateTime,bodyPreview&$top=500',
        );
        for (const msg of messages) {
            const cid = msg.conversationId;
            if (!cid) continue;
            inInbox.add(cid);
            const preview = msg.bodyPreview?.trim();
            if (!preview) continue;
            const dateMs = Date.parse(msg.receivedDateTime ?? '') || 0;
            const prev = previewByConv.get(cid);
            if (!prev || dateMs >= prev.dateMs) previewByConv.set(cid, { dateMs, preview });
        }

        for (const name of fs.readdirSync(CACHE_DIR)) {
            if (!name.endsWith('.json')) continue;
            const threadId = decodeURIComponent(name.replace(/\.json$/, ''));
            const entry = readCachedSnapshot(threadId);
            const foreign = (entry?.provider ?? 'gmail') !== 'outlook';
            if (foreign || !inInbox.has(threadId)) {
                try {
                    fs.rmSync(path.join(CACHE_DIR, name), { force: true });
                } catch (err) {
                    console.warn(`[Outlook] prune failed for ${threadId}:`, err);
                }
                continue;
            }
            // One-time preview backfill: only entries missing the field are
            // touched, so this converges and then no-ops.
            const preview = previewByConv.get(threadId)?.preview;
            if (entry && preview && !entry.snapshot.preview) {
                entry.snapshot.preview = preview;
                writeCachedSnapshot(threadId, entry.historyId, entry.snapshot, 'outlook');
            }
        }
    } catch (err) {
        console.warn('[Outlook] pruneInboxCache failed:', err);
    }
}

// Conversations the sweep failed on — retried next app launch, not every tick.
const sweepSkip = new Set<string>();

/**
 * Classify-and-stamp any inbox cache entries that carry importance but no
 * category yet (classifier failure mid-sync), plus stamp markdown from cached
 * verdicts. The knowledge-graph builder holds unstamped files indefinitely.
 * LLM work is bounded per tick.
 */
async function sweepUnclassifiedSnapshots(llmBudget: number = 15): Promise<void> {
    if (!fs.existsSync(CACHE_DIR)) return;
    let names: string[];
    try {
        names = fs.readdirSync(CACHE_DIR);
    } catch {
        return;
    }
    const userEmail = await getAccountEmail();
    let classified = 0;
    let stamped = 0;
    for (const name of names) {
        if (classified >= llmBudget) break;
        if (!name.endsWith('.json')) continue;
        const threadId = decodeURIComponent(name.replace(/\.json$/, ''));
        if (sweepSkip.has(threadId)) continue;
        const entry = readCachedSnapshot(threadId);
        if (!entry || entry.provider !== 'outlook') continue;

        if (entry.snapshot.category && entry.snapshot.knowledge) {
            stampClassificationFrontmatter(threadId, entry.snapshot);
            stamped += 1;
            continue;
        }
        if (!entry.snapshot.importance || entry.snapshot.category) continue;

        classified += 1;
        try {
            const classification = await classifyThread(entry.snapshot, userEmail, { skipDraft: true });
            if (!classification.category || !classification.knowledge) {
                sweepSkip.add(threadId);
                continue;
            }
            entry.snapshot.category = classification.category;
            entry.snapshot.knowledge = classification.knowledge;
            writeCachedSnapshot(threadId, entry.historyId, entry.snapshot, 'outlook');
            stampClassificationFrontmatter(threadId, entry.snapshot);
        } catch (err) {
            console.warn(`[Outlook] classification sweep failed for ${threadId}:`, err);
            sweepSkip.add(threadId);
        }
    }
    if (classified > 0 || stamped > 0) {
        console.log(`[Outlook] classification sweep: ${classified} classified, ${stamped} stamped from cache`);
    }
}

async function performSync(): Promise<void> {
    if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
    if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    try {
        const state = loadState();
        const cacheMissing = !fs.existsSync(CACHE_DIR) || fs.readdirSync(CACHE_DIR).length === 0;
        const gapMs = state.last_sync ? Date.now() - new Date(state.last_sync).getTime() : 0;
        const gapTooLarge = gapMs > LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

        if (!state.deltaLink) {
            console.log('[Outlook] No delta link found, starting full sync...');
            await fullSync();
        } else if (cacheMissing) {
            console.log('[Outlook] Delta link present but inbox cache empty — running full sync to backfill snapshots...');
            await fullSync();
        } else if (gapTooLarge) {
            console.log(`[Outlook] Last sync older than ${LOOKBACK_DAYS} days — running count-bounded full sync instead of delta replay...`);
            saveState({ ...loadState(), deltaLink: undefined });
            await fullSync();
        } else {
            await deltaSync(state.deltaLink);
        }

        await pruneInboxCache();
        await sweepUnclassifiedSnapshots();

        console.log('[Outlook] Sync completed.');
    } catch (error) {
        console.error('[Outlook] Error during sync:', error);
    }
}

// --- Thread actions ---

interface ConversationMessageRef {
    id: string;
    parentFolderId?: string;
    isRead?: boolean;
    isDraft?: boolean;
}

async function fetchConversationMessageRefs(conversationId: string): Promise<ConversationMessageRef[]> {
    const filter = encodeURIComponent(`conversationId eq '${filterLiteral(conversationId)}'`);
    const messages = await graphGetAllPages<GraphMessage>(
        `/me/messages?$filter=${filter}&$top=100&$select=id,parentFolderId,isRead,isDraft`,
    );
    return messages.filter((m): m is GraphMessage & { id: string } => !!m.id);
}

export async function archiveThread(threadId: string): Promise<ThreadActionResult> {
    try {
        const folders = await getFolderIds();
        const refs = await fetchConversationMessageRefs(threadId);
        const inInbox = refs.filter((m) => folders.inbox && m.parentFolderId === folders.inbox);
        for (const msg of inInbox) {
            await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(msg.id)}/move`, {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'archive' }),
            });
        }
        deleteCachedSnapshot(threadId);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function trashThread(threadId: string): Promise<ThreadActionResult> {
    try {
        const folders = await getFolderIds();
        const refs = await fetchConversationMessageRefs(threadId);
        const targets = refs.filter((m) => !folders.deleteditems || m.parentFolderId !== folders.deleteditems);
        for (const msg of targets) {
            await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(msg.id)}/move`, {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'deleteditems' }),
            });
        }
        deleteCachedSnapshot(threadId);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function markThreadRead(threadId: string, read: boolean = true): Promise<ThreadActionResult> {
    try {
        const refs = await fetchConversationMessageRefs(threadId);
        const targets = refs.filter((m) => !m.isDraft && (m.isRead ?? false) !== read);
        for (const msg of targets) {
            await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(msg.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ isRead: read }),
            });
        }
        mirrorThreadReadState(threadId, read);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Ensure an attachment referenced by a snapshot exists on disk, downloading it
 * on demand. Tries the stored attachment id first, falling back to matching by
 * the derived filename — ids on a cached snapshot can go stale, the name is
 * stable.
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

        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let data: string | null = null;
        if (attachmentId) {
            try {
                data = await fetchAttachmentBytes(messageId, attachmentId);
            } catch (err) {
                console.warn(`[Outlook] attachment fetch by id failed for ${messageId}, retrying by filename:`, err);
            }
        }

        if (!data) {
            const wanted = path.basename(savedPath);
            const metadata = await listAttachmentMetadata(messageId);
            const match = metadata.find((att) => att.id && att.name && attachmentDiskName(messageId, att.name) === wanted);
            if (!match?.id) return { ok: false, error: 'Attachment not found in message.' };
            data = await fetchAttachmentBytes(messageId, match.id);
        }

        if (!data) return { ok: false, error: 'Attachment had no data.' };
        fs.writeFileSync(absPath, Buffer.from(data, 'base64'));
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Full-text search across the ENTIRE mailbox via Graph $search (KQL: from:,
 * subject:, received>=, hasattachment:true, quoted phrases). $search cannot be
 * combined with $orderby/$filter and caps at 250 results — sorted client-side.
 * Matching conversations are parsed into snapshots and written to the local
 * search index so repeat searches and opens are instant.
 */
export async function searchThreads(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    const q = query.trim();
    if (!q) return { threads: [] };
    try {
        if (!(await OutlookClientFactory.getAccessToken())) {
            return { threads: [], error: 'Outlook is not connected.' };
        }
        const limit = Math.max(1, Math.min(200, opts.limit ?? 100));
        const search = encodeURIComponent(`"${q.replace(/"/g, '\\"')}"`);
        const res = await OutlookClientFactory.graphFetch<GraphListResponse<GraphMessage>>(
            `/me/messages?$search=${search}&$top=${Math.min(limit, 250)}&$select=id,conversationId,receivedDateTime`,
        );

        const conversationIds: string[] = [];
        const seen = new Set<string>();
        for (const msg of res.value ?? []) {
            const cid = msg.conversationId;
            if (!cid || seen.has(cid)) continue;
            seen.add(cid);
            conversationIds.push(cid);
        }

        const built = await Promise.all(conversationIds.map(async (conversationId) => {
            // Prefer the inbox snapshot (kept fresh by sync), then the search index.
            const inboxCached = readCachedSnapshot(conversationId);
            if (inboxCached?.snapshot && inboxCached.provider === 'outlook') return inboxCached.snapshot;
            const indexed = readSearchSnapshot(conversationId);
            if (indexed?.snapshot && indexed.provider === 'outlook') return indexed.snapshot;
            try {
                const messages = await fetchConversationMessages(conversationId);
                const parsed = await parseConversationSnapshot(conversationId, messages);
                if (parsed) writeSearchSnapshot(conversationId, parsed.fingerprint, parsed.snapshot, 'outlook');
                return parsed?.snapshot ?? null;
            } catch (err) {
                console.warn(`[Outlook search] fetch failed for ${conversationId}:`, err);
                return null;
            }
        }));

        const threads = built.filter((s): s is EmailThreadSnapshot => s !== null);
        threads.sort((a, b) => {
            const da = a.date ? Date.parse(a.date) : 0;
            const db = b.date ? Date.parse(b.date) : 0;
            return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
        });
        return { threads: threads.slice(0, limit) };
    } catch (err) {
        return { threads: [], error: err instanceof Error ? err.message : String(err) };
    }
}

// --- Compose: drafts + send ---

interface DraftBody {
    subject: string;
    bodyHtml: string;
    bodyText: string;
    to?: string;
    cc?: string;
    bcc?: string;
    isEmpty: boolean;
}

function buildDraftBody(opts: SaveDraftOptions): DraftBody {
    const replyBody = opts.threadId
        ? sanitizeReplyBody(opts.bodyHtml, opts.bodyText)
        : { bodyHtml: opts.bodyHtml.trim(), bodyText: opts.bodyText.trim() };
    return {
        subject: opts.subject,
        bodyHtml: replyBody.bodyHtml,
        bodyText: replyBody.bodyText,
        to: opts.to,
        cc: opts.cc,
        bcc: opts.bcc,
        isEmpty: !replyBody.bodyText.trim(),
    };
}

function draftPatchPayload(body: DraftBody): Record<string, unknown> {
    return {
        subject: body.subject,
        body: { contentType: 'html', content: body.bodyHtml || `<p>${body.bodyText}</p>` },
        toRecipients: toGraphRecipients(body.to),
        ccRecipients: toGraphRecipients(body.cc),
        bccRecipients: toGraphRecipients(body.bcc),
    };
}

async function uploadLargeAttachment(
    draftId: string,
    att: { filename: string; mimeType: string; contentBase64: string },
    bytes: Buffer,
): Promise<void> {
    const session = await OutlookClientFactory.graphFetch<{ uploadUrl?: string }>(
        `/me/messages/${encodeURIComponent(draftId)}/attachments/createUploadSession`,
        {
            method: 'POST',
            body: JSON.stringify({
                AttachmentItem: {
                    attachmentType: 'file',
                    name: att.filename,
                    contentType: att.mimeType || 'application/octet-stream',
                    size: bytes.length,
                },
            }),
        },
    );
    if (!session?.uploadUrl) throw new Error('Failed to create attachment upload session.');

    // Upload-session PUTs go to a pre-authenticated URL — no Authorization
    // header, plain fetch.
    for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, Math.min(offset + UPLOAD_CHUNK_BYTES, bytes.length));
        const res = await fetch(session.uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': String(chunk.length),
                'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${bytes.length}`,
            },
            body: new Uint8Array(chunk),
        });
        if (!res.ok && res.status !== 201 && res.status !== 200) {
            throw new Error(`Attachment upload failed (${res.status}).`);
        }
    }
}

async function addAttachmentsToDraft(
    draftId: string,
    attachments: Array<{ filename: string; mimeType: string; contentBase64: string }>,
): Promise<void> {
    for (const att of attachments) {
        if (!att.contentBase64) continue;
        const bytes = Buffer.from(att.contentBase64.replace(/\s+/g, ''), 'base64');
        if (bytes.length > SIMPLE_ATTACHMENT_MAX_BYTES) {
            await uploadLargeAttachment(draftId, att, bytes);
        } else {
            await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draftId)}/attachments`, {
                method: 'POST',
                body: JSON.stringify({
                    '@odata.type': '#microsoft.graph.fileAttachment',
                    name: att.filename || 'attachment',
                    contentType: att.mimeType || 'application/octet-stream',
                    contentBytes: att.contentBase64.replace(/\s+/g, ''),
                }),
            });
        }
    }
}

/** Latest non-draft message id of a conversation — the reply target. */
async function resolveReplyTargetId(threadId: string): Promise<string | null> {
    const cached = readCachedSnapshot(threadId);
    if (cached?.provider === 'outlook') {
        const last = [...cached.snapshot.messages].reverse().find((m) => m.id);
        if (last?.id) return last.id;
    }
    const refs = await fetchConversationMessageRefs(threadId);
    const nonDrafts = refs.filter((m) => !m.isDraft);
    return nonDrafts.length > 0 ? nonDrafts[nonDrafts.length - 1]!.id : null;
}

/**
 * Create a reply draft on the conversation's latest message. Exchange builds
 * the threading headers (In-Reply-To/References/conversationIndex) server-side
 * — never hand-build them. Recipients/subject/body are PATCHed over the
 * server-seeded draft, so reply vs reply-all makes no difference here.
 */
async function createConversationDraft(threadId: string): Promise<string | null> {
    const targetId = await resolveReplyTargetId(threadId);
    if (!targetId) return null;
    try {
        const draft = await OutlookClientFactory.graphFetch<GraphMessage>(
            `/me/messages/${encodeURIComponent(targetId)}/createReply`,
            { method: 'POST' },
        );
        return draft?.id ?? null;
    } catch (err) {
        console.warn(`[Outlook] createReply failed for ${threadId}:`, err);
        return null;
    }
}

async function findExistingConversationDraftId(threadId: string): Promise<string | null> {
    try {
        const filter = encodeURIComponent(`conversationId eq '${filterLiteral(threadId)}'`);
        const drafts = await OutlookClientFactory.graphFetch<GraphListResponse<GraphMessage>>(
            `/me/mailFolders/drafts/messages?$filter=${filter}&$select=id`,
        );
        return drafts.value?.[0]?.id ?? null;
    } catch {
        return null;
    }
}

async function deleteConversationDrafts(threadId: string): Promise<void> {
    try {
        const filter = encodeURIComponent(`conversationId eq '${filterLiteral(threadId)}'`);
        const drafts = await OutlookClientFactory.graphFetch<GraphListResponse<GraphMessage>>(
            `/me/mailFolders/drafts/messages?$filter=${filter}&$select=id`,
        );
        for (const draft of drafts.value ?? []) {
            if (!draft.id) continue;
            try {
                await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
            } catch (err) {
                console.warn('[Outlook] Draft cleanup after send failed:', err);
            }
        }
    } catch (err) {
        console.warn('[Outlook] Draft cleanup after send failed:', err);
    }
}

export async function sendThreadReply(opts: SendReplyOptions): Promise<SendReplyResult> {
    try {
        if (!(await OutlookClientFactory.getAccessToken())) return { error: 'Outlook is not connected.' };
        if (!opts.to?.trim()) return { error: 'Add at least one recipient.' };

        const body = buildDraftBody(opts);
        if (body.isEmpty) return { error: 'Draft is empty.' };

        // One code path for replies and new mail: create a draft, PATCH the
        // content, attach files (upload sessions above 3 MB), then send.
        let draftId: string | null = null;
        if (opts.threadId) {
            draftId = await findExistingConversationDraftId(opts.threadId)
                ?? await createConversationDraft(opts.threadId);
        }
        if (!draftId) {
            const created = await OutlookClientFactory.graphFetch<GraphMessage>('/me/messages', {
                method: 'POST',
                body: JSON.stringify(draftPatchPayload(body)),
            });
            draftId = created?.id ?? null;
            if (!draftId) return { error: 'Failed to create outgoing message.' };
        } else {
            await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draftId)}`, {
                method: 'PATCH',
                body: JSON.stringify(draftPatchPayload(body)),
            });
        }

        const attachments = (opts.attachments ?? []).filter((a) => a.contentBase64);
        if (attachments.length > 0) {
            await syncDraftAttachments(draftId, attachments);
        }

        await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draftId)}/send`, { method: 'POST' });

        if (opts.threadId) {
            await deleteConversationDrafts(opts.threadId);
        }

        // Wake the sync loop so the cache picks up the new message.
        triggerSync();

        // /send returns 202 with no body; the draft id is the best stable
        // reference we have (callers only check truthiness).
        return { messageId: draftId };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Make the draft's attachments match the composer's set. Compares by
 * (name, size) and only deletes+re-adds when they differ — an unchanged set
 * (the common autosave case) costs one metadata GET, not a re-upload.
 */
async function syncDraftAttachments(
    draftId: string,
    attachments: Array<{ filename: string; mimeType: string; contentBase64: string }>,
): Promise<void> {
    const existing = await graphGetAllPages<GraphAttachment>(
        `/me/messages/${encodeURIComponent(draftId)}/attachments?$select=id,name,size`,
    );
    const wanted = attachments.map((a) => {
        const bytes = Buffer.from(a.contentBase64.replace(/\s+/g, ''), 'base64');
        return `${a.filename}|${bytes.length}`;
    }).sort();
    const have = existing.map((a) => `${a.name}|${a.size ?? 0}`).sort();
    if (wanted.length === have.length && wanted.every((w, i) => w === have[i])) return;

    for (const att of existing) {
        if (!att.id) continue;
        try {
            await OutlookClientFactory.graphFetch(
                `/me/messages/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(att.id)}`,
                { method: 'DELETE' },
            );
        } catch (err) {
            console.warn('[Outlook] stale draft attachment delete failed:', err);
        }
    }
    await addAttachmentsToDraft(draftId, attachments);
}

/**
 * Save the composer's contents as an Outlook draft. Drafts live in the user's
 * real mailbox, so they show up in every Outlook client. Passing `draftId`
 * updates in place; a stale id (deleted/sent elsewhere) falls back to
 * creating a fresh draft; a missing id with a `threadId` reuses that
 * conversation's existing draft so autosaves don't pile up duplicates.
 */
export async function saveThreadDraft(opts: SaveDraftOptions): Promise<SaveDraftResult> {
    try {
        if (!(await OutlookClientFactory.getAccessToken())) return { error: 'Outlook is not connected.' };

        const body = buildDraftBody(opts);
        if (body.isEmpty) return { error: 'Draft is empty.' };

        let draftId = opts.draftId ?? null;
        const payload = draftPatchPayload(body);

        if (draftId) {
            try {
                await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draftId)}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });
            } catch (err) {
                // Recreate only when the draft is actually gone. A transient
                // failure must NOT fall back to create — that would silently
                // pile up duplicates.
                const status = err instanceof GraphError ? err.status : undefined;
                if (status !== 404 && status !== 410) throw err;
                draftId = null;
            }
        }

        if (!draftId) {
            if (opts.threadId) {
                draftId = await findExistingConversationDraftId(opts.threadId);
                if (draftId) {
                    await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draftId)}`, {
                        method: 'PATCH',
                        body: JSON.stringify(payload),
                    });
                } else {
                    draftId = await createConversationDraft(opts.threadId);
                    if (draftId) {
                        await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draftId)}`, {
                            method: 'PATCH',
                            body: JSON.stringify(payload),
                        });
                    }
                }
            }
            if (!draftId) {
                const created = await OutlookClientFactory.graphFetch<GraphMessage>('/me/messages', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
                draftId = created?.id ?? null;
            }
        }
        if (!draftId) return { error: 'Failed to save draft.' };

        await syncDraftAttachments(draftId, (opts.attachments ?? []).filter((a) => a.contentBase64));

        if (opts.threadId) {
            mirrorThreadDraft(opts.threadId, opts.bodyText);
        }

        return { draftId };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}

/** Delete an Outlook draft by id. A missing draft is treated as success. */
export async function deleteThreadDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        if (!(await OutlookClientFactory.getAccessToken())) return { ok: false, error: 'Outlook is not connected.' };
        await OutlookClientFactory.graphFetch(`/me/messages/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
        triggerSync();
        return { ok: true };
    } catch (err) {
        const status = err instanceof GraphError ? err.status : undefined;
        if (status === 404 || status === 410) return { ok: true };
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// In-memory cache of built draft snapshots, keyed by draft id and validated by
// lastModifiedDateTime — unchanged drafts skip the body parse.
interface DraftCacheEntry {
    lastModified: string;
    snapshot: EmailThreadSnapshot;
}
const draftListCache = new Map<string, DraftCacheEntry>();

/**
 * List the account's drafts as lightweight thread snapshots for the Drafts
 * view. `inReplyToHeader`/`referencesHeader` stay unset — the Outlook send
 * path threads server-side via createReply and never needs them.
 */
export async function listDraftThreads(): Promise<{ threads: EmailThreadSnapshot[]; error?: string }> {
    try {
        if (!(await OutlookClientFactory.getAccessToken())) {
            draftListCache.clear();
            return { threads: [], error: 'Outlook is not connected.' };
        }

        const drafts = await OutlookClientFactory.graphFetch<GraphListResponse<GraphMessage>>(
            `/me/mailFolders/drafts/messages?$top=50&$select=${MESSAGE_SELECT}`,
            { headers: { Prefer: HTML_BODY_PREFER } },
        );

        const seen = new Set<string>();
        const threads: EmailThreadSnapshot[] = [];
        for (const msg of drafts.value ?? []) {
            if (!msg.id) continue;
            seen.add(msg.id);
            const lastModified = msg.lastModifiedDateTime ?? '';
            const cached = draftListCache.get(msg.id);
            if (cached && lastModified && cached.lastModified === lastModified) {
                threads.push(cached.snapshot);
                continue;
            }

            const isHtml = msg.body?.contentType !== 'text';
            const rawContent = msg.body?.content ?? '';
            const body = stripQuotedReplyText(normalizeBody(isHtml ? htmlToMarkdownBody(rawContent) : plainTextBody(rawContent)));
            const snapshot: EmailThreadSnapshot = {
                threadId: msg.conversationId || msg.id,
                threadUrl: msg.webLink || 'https://outlook.office.com/mail/drafts',
                subject: msg.subject || '',
                from: formatAddress(msg.from) || '',
                to: formatAddressList(msg.toRecipients) || '',
                date: msg.lastModifiedDateTime || msg.receivedDateTime || '',
                latest_email: body,
                gmail_draft: body || undefined,
                draftId: msg.id,
                unread: false,
                messages: [{
                    id: msg.id,
                    from: formatAddress(msg.from) || '',
                    to: formatAddressList(msg.toRecipients) || '',
                    cc: formatAddressList(msg.ccRecipients),
                    date: msg.lastModifiedDateTime || msg.receivedDateTime || '',
                    subject: msg.subject || '',
                    body,
                    bodyHtml: isHtml && rawContent ? rawContent : undefined,
                    messageIdHeader: msg.internetMessageId ?? undefined,
                    isDraft: true,
                }],
            };
            if (lastModified) draftListCache.set(msg.id, { lastModified, snapshot });
            threads.push(snapshot);
        }

        for (const key of draftListCache.keys()) {
            if (!seen.has(key)) draftListCache.delete(key);
        }

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
    console.log('Starting Outlook Sync (TS)...');
    console.log(`Will sync every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            const hasCredentials = await OutlookClientFactory.hasValidCredentials(REQUIRED_SCOPE);
            if (!hasCredentials) {
                console.log('Microsoft OAuth credentials not available or missing required Mail scope. Sleeping...');
            } else {
                await performSync();
            }
        } catch (error) {
            console.error('[Outlook] Error in main loop:', error);
        }

        await interruptibleSleep(SYNC_INTERVAL_MS);
    }
}

/** The Outlook implementation of the provider-agnostic email interface. */
export const outlookEmailProvider: EmailProvider = {
    id: 'microsoft',
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
