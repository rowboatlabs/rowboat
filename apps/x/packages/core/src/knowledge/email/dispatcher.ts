import type {
    Contact,
    ContactSearchOpts,
    DownloadAttachmentResult,
    EmailConnectionStatus,
    EmailProvider,
    EmailProviderId,
    SaveDraftOptions,
    SaveDraftResult,
    SearchResult,
    SendReplyOptions,
    SendReplyResult,
    ThreadActionResult,
} from './provider.js';
import type { EmailThreadSnapshot } from './store.js';
import { listCategoryThreadIds } from './store.js';
import { getActiveEmailProviderId } from './active-provider.js';
import { gmailEmailProvider } from '../sync_gmail.js';
import { outlookEmailProvider } from '../sync_outlook.js';

// Routes each email operation to whichever provider is connected (see
// active-provider.ts for the single source of that fact).

const providers: Record<EmailProviderId, EmailProvider> = {
    google: gmailEmailProvider,
    microsoft: outlookEmailProvider,
};

const NOT_CONNECTED = 'Email is not connected.';

// The active provider is resolved per call, not cached: the user can connect
// or disconnect an account at any point in the session, and a stale provider
// would route operations to a dead (or wrong) mailbox.
async function withProvider<T>(notConnected: T, run: (provider: EmailProvider) => T | Promise<T>): Promise<T> {
    const id = await getActiveEmailProviderId();
    if (!id) return notConnected;
    return run(providers[id]);
}

/** Wake the active provider's sync loop. No-op when nothing is connected. */
export function triggerEmailSync(): Promise<void> {
    return withProvider(undefined, (provider) => provider.triggerSync());
}

export function sendThreadReply(opts: SendReplyOptions): Promise<SendReplyResult> {
    return withProvider({ error: NOT_CONNECTED }, (provider) => provider.sendThreadReply(opts));
}

export function saveThreadDraft(opts: SaveDraftOptions): Promise<SaveDraftResult> {
    return withProvider({ error: NOT_CONNECTED }, (provider) => provider.saveThreadDraft(opts));
}

export function deleteThreadDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
    return withProvider({ ok: false, error: NOT_CONNECTED }, (provider) => provider.deleteThreadDraft(draftId));
}

export function listDraftThreads(): Promise<{ threads: EmailThreadSnapshot[]; error?: string }> {
    return withProvider({ threads: [], error: NOT_CONNECTED }, (provider) => provider.listDraftThreads());
}

export function searchThreads(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    return withProvider<SearchResult>({ threads: [], error: NOT_CONNECTED }, (provider) => provider.searchThreads(query, opts));
}

export function archiveThread(threadId: string): Promise<ThreadActionResult> {
    return withProvider({ ok: false, error: NOT_CONNECTED }, (provider) => provider.archiveThread(threadId));
}

export function trashThread(threadId: string): Promise<ThreadActionResult> {
    return withProvider({ ok: false, error: NOT_CONNECTED }, (provider) => provider.trashThread(threadId));
}

export function markThreadRead(threadId: string, read: boolean = true): Promise<ThreadActionResult> {
    return withProvider({ ok: false, error: NOT_CONNECTED }, (provider) => provider.markThreadRead(threadId, read));
}

export function downloadAttachment(args: {
    messageId: string;
    savedPath: string;
    attachmentId?: string;
}): Promise<DownloadAttachmentResult> {
    return withProvider({ ok: false, error: NOT_CONNECTED }, (provider) => provider.downloadAttachment(args));
}

export function getAccountEmail(): Promise<string | null> {
    return withProvider<string | null>(null, (provider) => provider.getAccountEmail());
}

export function getAccountName(): Promise<string | null> {
    return withProvider<string | null>(null, (provider) => provider.getAccountName());
}

export function getConnectionStatus(): Promise<EmailConnectionStatus> {
    return withProvider<EmailConnectionStatus>(
        { connected: false, hasRequiredScope: false, missingScopes: [], email: null },
        (provider) => provider.getConnectionStatus(),
    );
}

/**
 * Archive every "Everything else" thread of the given category in one sweep.
 * Walks the local cache (never the live mailbox), so it can only touch threads
 * the user can see in the section. Returns per-thread failures rather than
 * aborting: one 404 (thread deleted elsewhere) shouldn't strand the other 80
 * promotions in the inbox.
 */
export function archiveCategoryThreads(category: string): Promise<{ archived: number; failed: number; error?: string }> {
    return withProvider<{ archived: number; failed: number; error?: string }>({ archived: 0, failed: 0, error: NOT_CONNECTED }, async (provider) => {
        const targets = listCategoryThreadIds(category);
        let archived = 0;
        let failed = 0;
        for (const threadId of targets) {
            const result = await provider.archiveThread(threadId);
            if (result.ok) archived += 1;
            else failed += 1;
        }
        return { archived, failed };
    });
}

export function searchSentContacts(query: string, opts: ContactSearchOpts = {}): Promise<Contact[]> {
    return withProvider<Contact[]>([], (provider) => provider.searchSentContacts(query, opts));
}

/** Warm the active provider's sent-contacts index (no-op when disconnected). */
export function warmSentContacts(): Promise<void> {
    return withProvider(undefined, (provider) => provider.warmSentContacts());
}
