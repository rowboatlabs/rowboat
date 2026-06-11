import {
    listInboxPage,
    getThreadSnapshot,
    fetchThreadLive,
    searchThreadsLive,
    triggerSync,
    getConnectionStatus,
    stripGmailQuotedReplyText,
    type GmailThreadSnapshot,
    type GmailConnectionStatus,
    type InboxSection,
} from "../../knowledge/sync_gmail.js";
import { composioAccountsRepo } from "../../composio/repo.js";

// Execute bodies for the native gmail-* builtin tools (registered in
// builtin-tools.ts). All payloads are trimmed to be LLM-friendly: plain-text
// bodies only, capped sizes, and the cached per-thread classification
// (summary + importance) surfaced so the model doesn't re-summarize.

const SNIPPET_CHARS = 300;
const BODY_CHARS = 4000;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_READ_MESSAGES = 10;
const CONNECTION_MEMO_MS = 30_000;

let connectionMemo: { at: number; status: GmailConnectionStatus } | null = null;

async function checkConnection(): Promise<GmailConnectionStatus> {
    const now = Date.now();
    if (connectionMemo && now - connectionMemo.at < CONNECTION_MEMO_MS) {
        return connectionMemo.status;
    }
    const status = await getConnectionStatus();
    connectionMemo = { at: now, status };
    return status;
}

interface NotConnectedPayload {
    connected: false;
    error: string;
    action: string;
    composioFallback: boolean;
}

function notConnectedPayload(status: GmailConnectionStatus): NotConnectedPayload {
    const composioFallback = composioAccountsRepo.isConnected('gmail');
    return {
        connected: false,
        error: status.connected
            ? `Google is connected but missing required Gmail scopes: ${status.missingScopes.join(', ')}.`
            : 'Gmail is not connected natively.',
        action: 'Ask the user to connect (or re-connect) their Google account in Settings.',
        composioFallback,
    };
}

async function requireConnection(): Promise<NotConnectedPayload | null> {
    try {
        const status = await checkConnection();
        if (!status.connected || !status.hasRequiredScope) return notConnectedPayload(status);
        return null;
    } catch (err) {
        return {
            connected: false,
            error: `Failed to check Gmail connection: ${err instanceof Error ? err.message : String(err)}`,
            action: 'Ask the user to connect their Google account in Settings.',
            composioFallback: composioAccountsRepo.isConnected('gmail'),
        };
    }
}

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function latestSnippet(snapshot: GmailThreadSnapshot): string | undefined {
    const latest = snapshot.messages[snapshot.messages.length - 1];
    const body = latest?.body;
    if (!body) return undefined;
    const collapsed = collapseWhitespace(stripGmailQuotedReplyText(body));
    return collapsed.length > SNIPPET_CHARS ? `${collapsed.slice(0, SNIPPET_CHARS)}…` : collapsed;
}

interface ThreadRow {
    threadId: string;
    subject?: string;
    from?: string;
    to?: string;
    date?: string;
    unread?: boolean;
    importance?: 'important' | 'other';
    summary?: string;
    messageCount: number;
    latestSnippet?: string;
}

function toThreadRow(snapshot: GmailThreadSnapshot): ThreadRow {
    return {
        threadId: snapshot.threadId,
        subject: snapshot.subject,
        from: snapshot.from,
        to: snapshot.to,
        date: snapshot.date,
        unread: snapshot.unread,
        importance: snapshot.importance,
        summary: snapshot.summary,
        messageCount: snapshot.messages.length,
        latestSnippet: snapshot.summary ? undefined : latestSnippet(snapshot),
    };
}

function trimBody(body: string | undefined): string {
    if (!body) return '';
    const stripped = stripGmailQuotedReplyText(body);
    return stripped.length > BODY_CHARS ? `${stripped.slice(0, BODY_CHARS)}\n[truncated]` : stripped;
}

export interface GmailListThreadsInput {
    section?: InboxSection;
    cursor?: string;
    limit?: number;
    sync?: boolean;
}

export async function gmailListThreads(input: GmailListThreadsInput) {
    const notConnected = await requireConnection();
    if (notConnected) return notConnected;

    if (input.sync) triggerSync();

    const { threads, nextCursor } = listInboxPage({
        section: input.section ?? 'important',
        cursor: input.cursor,
        limit: Math.max(1, Math.min(50, input.limit ?? DEFAULT_LIST_LIMIT)),
    });

    if (threads.length === 0) {
        return {
            connected: true,
            threads: [],
            nextCursor: null,
            note: input.sync
                ? 'A re-sync was just triggered — fresh data lands shortly; retry in a moment.'
                : 'No synced threads in this section yet. Sync may still be running — retry with sync:true or in a moment.',
        };
    }

    return {
        connected: true,
        threads: threads.map(toThreadRow),
        nextCursor,
        hint: 'Each thread carries a cached LLM summary + importance — compose inbox overviews from these. Use gmail-readThread only when the user drills into one thread.',
    };
}

export interface GmailReadThreadInput {
    threadId: string;
    maxMessages?: number;
}

export async function gmailReadThread(input: GmailReadThreadInput) {
    const notConnected = await requireConnection();
    if (notConnected) return notConnected;

    let snapshot = getThreadSnapshot(input.threadId);
    let source: 'cache' | 'live' = 'cache';
    if (!snapshot) {
        try {
            snapshot = await fetchThreadLive(input.threadId);
            source = 'live';
        } catch (err) {
            return {
                connected: true,
                error: `Failed to fetch thread ${input.threadId}: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
    if (!snapshot) {
        return { connected: true, error: `Thread ${input.threadId} was not found (or has no visible messages).` };
    }

    const maxMessages = Math.max(1, Math.min(25, input.maxMessages ?? DEFAULT_READ_MESSAGES));
    const omittedOlderMessages = Math.max(0, snapshot.messages.length - maxMessages);
    const messages = snapshot.messages.slice(-maxMessages).map((m) => ({
        from: m.from,
        to: m.to,
        cc: m.cc,
        date: m.date,
        subject: m.subject,
        body: trimBody(m.body),
        unread: m.unread,
        attachments: m.attachments?.map((a) => ({
            filename: a.filename,
            sizeBytes: a.sizeBytes,
            savedPath: a.savedPath,
        })),
    }));

    return {
        connected: true,
        source,
        threadId: snapshot.threadId,
        threadUrl: snapshot.threadUrl,
        subject: snapshot.subject,
        importance: snapshot.importance,
        summary: snapshot.summary,
        draft_response: snapshot.draft_response,
        omittedOlderMessages,
        messages,
    };
}

export interface GmailSearchEmailsInput {
    query: string;
    maxResults?: number;
}

export async function gmailSearchEmails(input: GmailSearchEmailsInput) {
    const notConnected = await requireConnection();
    if (notConnected) return notConnected;

    let results;
    try {
        results = await searchThreadsLive(input.query, Math.max(1, Math.min(25, input.maxResults ?? 10)));
    } catch (err) {
        return {
            connected: true,
            threads: [],
            error: `Gmail search failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    return {
        connected: true,
        threads: results.map((r) => r.snapshot
            ? { source: 'cache' as const, ...toThreadRow(r.snapshot) }
            : {
                source: 'live' as const,
                threadId: r.threadId,
                subject: r.subject,
                from: r.from,
                to: r.to,
                date: r.date,
                latestSnippet: r.snippet,
                messageCount: 0,
            }),
        hint: 'Follow up with gmail-readThread({ threadId }) to read full message bodies.',
    };
}

export async function gmailCheckConnection() {
    try {
        const status = await checkConnection();
        if (!status.connected || !status.hasRequiredScope) return notConnectedPayload(status);
        return { connected: true, email: status.email };
    } catch (err) {
        return {
            connected: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
