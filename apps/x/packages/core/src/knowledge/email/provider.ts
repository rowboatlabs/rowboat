import type { EmailThreadSnapshot } from './store.js';

// The per-provider email operations. One implementation per connected mail
// backend (Gmail via the Gmail API, Outlook via Microsoft Graph); the
// dispatcher routes each call to whichever provider is connected. Everything
// cache-only (inbox listing, importance/category overrides, body heights)
// lives in store.ts instead and needs no provider.

export type EmailProviderId = 'google' | 'microsoft';

export interface ThreadActionResult {
    ok: boolean;
    error?: string;
}

export interface SendReplyOptions {
    threadId?: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    /**
     * RFC 2822 reply-chain headers. Used by the Gmail path to hand-build the
     * MIME message; the Outlook path ignores them (Exchange threads replies
     * server-side via createReply).
     */
    inReplyTo?: string;
    references?: string;
    /** Files to attach. contentBase64 is the raw (unwrapped) base64 of the file bytes. */
    attachments?: Array<{ filename: string; mimeType: string; contentBase64: string }>;
}

export interface SendReplyResult {
    messageId?: string;
    error?: string;
}

export interface SaveDraftOptions extends Omit<SendReplyOptions, 'to'> {
    /** Recipient may be blank while a draft is still being written. */
    to?: string;
    /** Existing provider-side draft to update; omitted on first save (creates a new one). */
    draftId?: string;
}

export interface SaveDraftResult {
    /** The provider-side draft id, to be passed back on subsequent saves. */
    draftId?: string;
    error?: string;
}

export interface DownloadAttachmentResult {
    ok: boolean;
    error?: string;
}

export interface SearchResult {
    threads: EmailThreadSnapshot[];
    error?: string;
}

export interface EmailConnectionStatus {
    connected: boolean;
    hasRequiredScope: boolean;
    missingScopes: string[];
    email: string | null;
}

export interface Contact {
    name: string;
    email: string;
    count: number;
    lastSeenMs: number;
}

export interface ContactSearchOpts {
    limit?: number;
    excludeEmails?: string[];
}

export interface EmailProvider {
    id: EmailProviderId;
    /** Wake the provider's background sync loop for an immediate pass. */
    triggerSync(): void;
    sendThreadReply(opts: SendReplyOptions): Promise<SendReplyResult>;
    saveThreadDraft(opts: SaveDraftOptions): Promise<SaveDraftResult>;
    deleteThreadDraft(draftId: string): Promise<{ ok: boolean; error?: string }>;
    listDraftThreads(): Promise<{ threads: EmailThreadSnapshot[]; error?: string }>;
    searchThreads(query: string, opts?: { limit?: number }): Promise<SearchResult>;
    archiveThread(threadId: string): Promise<ThreadActionResult>;
    trashThread(threadId: string): Promise<ThreadActionResult>;
    markThreadRead(threadId: string, read?: boolean): Promise<ThreadActionResult>;
    downloadAttachment(args: {
        messageId: string;
        savedPath: string;
        attachmentId?: string;
    }): Promise<DownloadAttachmentResult>;
    getAccountEmail(): Promise<string | null>;
    getAccountName(): Promise<string | null>;
    getConnectionStatus(): Promise<EmailConnectionStatus>;
    /** Typeahead over the user's sent-mail recipients (provider-maintained local index). */
    searchSentContacts(query: string, opts?: ContactSearchOpts): Promise<Contact[]>;
    /** Kick off a background refresh of the sent-contacts index. */
    warmSentContacts(): void;
}
