import container from '../../di/container.js';
import type { IOAuthRepo } from '../../auth/repo.js';
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
import { gmailEmailProvider } from '../sync_gmail.js';
import { outlookEmailProvider } from '../sync_outlook.js';

// Routes each email operation to whichever provider is connected. The connect
// flow enforces that at most one of Google / Microsoft holds tokens; if both
// somehow do (hand-edited oauth.json), Google wins and we log a warning.

const providers: Record<EmailProviderId, EmailProvider> = {
    google: gmailEmailProvider,
    microsoft: outlookEmailProvider,
};

const NOT_CONNECTED = 'Email is not connected.';

export async function getActiveEmailProviderId(): Promise<EmailProviderId | null> {
    const repo = container.resolve<IOAuthRepo>('oauthRepo');
    const [google, microsoft] = await Promise.all([repo.read('google'), repo.read('microsoft')]);
    const hasGoogle = !!google.tokens;
    const hasMicrosoft = !!microsoft.tokens;
    if (hasGoogle && hasMicrosoft) {
        console.warn('[Email] Both Google and Microsoft hold tokens — using Google. Only one email provider is supported at a time.');
        return 'google';
    }
    if (hasGoogle) return 'google';
    if (hasMicrosoft) return 'microsoft';
    return null;
}

async function getActiveProvider(): Promise<EmailProvider | null> {
    const id = await getActiveEmailProviderId();
    return id ? providers[id] : null;
}

/** Wake the active provider's sync loop. No-op when nothing is connected. */
export async function triggerEmailSync(): Promise<void> {
    const provider = await getActiveProvider();
    provider?.triggerSync();
}

export async function sendThreadReply(opts: SendReplyOptions): Promise<SendReplyResult> {
    const provider = await getActiveProvider();
    if (!provider) return { error: NOT_CONNECTED };
    return provider.sendThreadReply(opts);
}

export async function saveThreadDraft(opts: SaveDraftOptions): Promise<SaveDraftResult> {
    const provider = await getActiveProvider();
    if (!provider) return { error: NOT_CONNECTED };
    return provider.saveThreadDraft(opts);
}

export async function deleteThreadDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
    const provider = await getActiveProvider();
    if (!provider) return { ok: false, error: NOT_CONNECTED };
    return provider.deleteThreadDraft(draftId);
}

export async function listDraftThreads(): Promise<{ threads: EmailThreadSnapshot[]; error?: string }> {
    const provider = await getActiveProvider();
    if (!provider) return { threads: [], error: NOT_CONNECTED };
    return provider.listDraftThreads();
}

export async function searchThreads(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    const provider = await getActiveProvider();
    if (!provider) return { threads: [], error: NOT_CONNECTED };
    return provider.searchThreads(query, opts);
}

export async function archiveThread(threadId: string): Promise<ThreadActionResult> {
    const provider = await getActiveProvider();
    if (!provider) return { ok: false, error: NOT_CONNECTED };
    return provider.archiveThread(threadId);
}

export async function trashThread(threadId: string): Promise<ThreadActionResult> {
    const provider = await getActiveProvider();
    if (!provider) return { ok: false, error: NOT_CONNECTED };
    return provider.trashThread(threadId);
}

export async function markThreadRead(threadId: string, read: boolean = true): Promise<ThreadActionResult> {
    const provider = await getActiveProvider();
    if (!provider) return { ok: false, error: NOT_CONNECTED };
    return provider.markThreadRead(threadId, read);
}

export async function downloadAttachment(args: {
    messageId: string;
    savedPath: string;
    attachmentId?: string;
}): Promise<DownloadAttachmentResult> {
    const provider = await getActiveProvider();
    if (!provider) return { ok: false, error: NOT_CONNECTED };
    return provider.downloadAttachment(args);
}

export async function getAccountEmail(): Promise<string | null> {
    const provider = await getActiveProvider();
    if (!provider) return null;
    return provider.getAccountEmail();
}

export async function getAccountName(): Promise<string | null> {
    const provider = await getActiveProvider();
    if (!provider) return null;
    return provider.getAccountName();
}

export async function getConnectionStatus(): Promise<EmailConnectionStatus> {
    const provider = await getActiveProvider();
    if (!provider) {
        return { connected: false, hasRequiredScope: false, missingScopes: [], email: null };
    }
    return provider.getConnectionStatus();
}

/**
 * Archive every "Everything else" thread of the given category in one sweep.
 * Walks the local cache (never the live mailbox), so it can only touch threads
 * the user can see in the section. Returns per-thread failures rather than
 * aborting: one 404 (thread deleted elsewhere) shouldn't strand the other 80
 * promotions in the inbox.
 */
export async function archiveCategoryThreads(category: string): Promise<{ archived: number; failed: number; error?: string }> {
    const provider = await getActiveProvider();
    if (!provider) return { archived: 0, failed: 0, error: NOT_CONNECTED };
    const targets = listCategoryThreadIds(category);
    let archived = 0;
    let failed = 0;
    for (const threadId of targets) {
        const result = await provider.archiveThread(threadId);
        if (result.ok) archived += 1;
        else failed += 1;
    }
    return { archived, failed };
}

export async function searchSentContacts(query: string, opts: ContactSearchOpts = {}): Promise<Contact[]> {
    const provider = await getActiveProvider();
    if (!provider) return [];
    return provider.searchSentContacts(query, opts);
}

/** Warm the active provider's sent-contacts index (no-op when disconnected). */
export async function warmSentContacts(): Promise<void> {
    const provider = await getActiveProvider();
    provider?.warmSentContacts();
}
