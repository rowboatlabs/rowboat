import fs from 'fs';
import path from 'path';
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { WorkDir } from '../config/config.js';
import { executeAction } from '../composio/client.js';
import { composioAccountsRepo } from '../composio/repo.js';

// Configuration
const SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const LOOKBACK_DAYS = 7;

const nhm = new NodeHtmlMarkdown();

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

// --- State Management ---

interface SyncState {
    last_sync: string; // ISO string — human-readable, source of truth
}

function loadState(stateFile: string): SyncState | null {
    if (fs.existsSync(stateFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            if (data.last_sync) {
                return { last_sync: data.last_sync };
            }
        } catch (e) {
            console.error('[Gmail] Failed to load state:', e);
        }
    }
    return null;
}

function saveState(stateFile: string, lastSync: string): void {
    const state: SyncState = {
        last_sync: lastSync,
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/**
 * Try to parse a date string into a Date. Returns null if unparseable.
 */
function tryParseDate(dateStr: string): Date | null {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function toEpochSeconds(isoString: string): number {
    return Math.floor(new Date(isoString).getTime() / 1000);
}

// --- Message Parsing ---

interface ParsedMessage {
    from: string;
    date: string;
    subject: string;
    body: string;
}

function parseMessageData(messageData: Record<string, unknown>): ParsedMessage {
    const headers = messageData.payload && typeof messageData.payload === 'object'
        ? (messageData.payload as Record<string, unknown>).headers as Array<{ name: string; value: string }> | undefined
        : undefined;

    const from = headers?.find(h => h.name === 'From')?.value || String(messageData.from || messageData.sender || 'Unknown');
    const date = headers?.find(h => h.name === 'Date')?.value || String(messageData.date || messageData.internalDate || 'Unknown');
    const subject = headers?.find(h => h.name === 'Subject')?.value || String(messageData.subject || '(No Subject)');

    let body = '';

    // Try to extract body from payload structure (Gmail API format)
    if (messageData.payload && typeof messageData.payload === 'object') {
        body = extractBodyFromPayload(messageData.payload as Record<string, unknown>);
    }

    // Fallback: try snippet or body fields
    if (!body) {
        if (typeof messageData.body === 'string') {
            body = messageData.body;
        } else if (typeof messageData.snippet === 'string') {
            body = messageData.snippet;
        } else if (typeof messageData.text === 'string') {
            body = messageData.text;
        }
    }

    // Convert HTML to markdown if body looks like HTML
    if (body && (body.includes('<html') || body.includes('<div') || body.includes('<p'))) {
        body = nhm.translate(body);
    }

    // Strip quoted lines
    if (body) {
        body = body.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
    }

    return { from, date, subject, body };
}

function extractBodyFromPayload(payload: Record<string, unknown>): string {
    const parts = payload.parts as Array<Record<string, unknown>> | undefined;

    if (parts) {
        for (const part of parts) {
            const mimeType = part.mimeType as string | undefined;
            const bodyData = part.body && typeof part.body === 'object'
                ? (part.body as Record<string, unknown>).data as string | undefined
                : undefined;

            if ((mimeType === 'text/plain' || mimeType === 'text/html') && bodyData) {
                const decoded = Buffer.from(bodyData, 'base64').toString('utf-8');
                if (mimeType === 'text/html') {
                    return nhm.translate(decoded);
                }
                return decoded;
            }

            // Recurse into nested parts
            if (part.parts) {
                const result = extractBodyFromPayload(part as Record<string, unknown>);
                if (result) return result;
            }
        }
    }

    // Single-part message
    const bodyData = payload.body && typeof payload.body === 'object'
        ? (payload.body as Record<string, unknown>).data as string | undefined
        : undefined;

    if (bodyData) {
        const decoded = Buffer.from(bodyData, 'base64').toString('utf-8');
        const mimeType = payload.mimeType as string | undefined;
        if (mimeType === 'text/html') {
            return nhm.translate(decoded);
        }
        return decoded;
    }

    return '';
}

// --- Sync Logic ---

/**
 * Process a thread and write its .md file.
 * Returns the newest message date (as ISO string) found in the thread, or null.
 */
async function processThread(connectedAccountId: string, threadId: string, syncDir: string): Promise<string | null> {
    let threadResult;
    try {
        threadResult = await executeAction(
            'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
            connectedAccountId,
            { thread_id: threadId, user_id: 'me' }
        );
    } catch (error) {
        console.warn(`[Gmail] Skipping thread ${threadId} (fetch failed):`, error instanceof Error ? error.message : error);
        return null;
    }

    if (!threadResult.success || !threadResult.data) {
        console.error(`[Gmail] Failed to fetch thread ${threadId}:`, threadResult.error);
        return null;
    }

    const data = threadResult.data as Record<string, unknown>;
    const messages = data.messages as Array<Record<string, unknown>> | undefined;

    let newestDate: Date | null = null;

    if (!messages || messages.length === 0) {
        // Single message response
        const parsed = parseMessageData(data);
        const mdContent = `# ${parsed.subject}\n\n` +
            `**Thread ID:** ${threadId}\n` +
            `**Message Count:** 1\n\n---\n\n` +
            `### From: ${parsed.from}\n` +
            `**Date:** ${parsed.date}\n\n` +
            `${parsed.body}\n\n---\n\n`;

        fs.writeFileSync(path.join(syncDir, `${cleanFilename(threadId)}.md`), mdContent);
        console.log(`[Gmail] Synced Thread: ${parsed.subject} (${threadId})`);
        newestDate = tryParseDate(parsed.date);
    } else {
        // Multi-message thread
        const firstParsed = parseMessageData(messages[0]);
        let mdContent = `# ${firstParsed.subject}\n\n`;
        mdContent += `**Thread ID:** ${threadId}\n`;
        mdContent += `**Message Count:** ${messages.length}\n\n---\n\n`;

        for (const msg of messages) {
            const parsed = parseMessageData(msg);
            mdContent += `### From: ${parsed.from}\n`;
            mdContent += `**Date:** ${parsed.date}\n\n`;
            mdContent += `${parsed.body}\n\n`;
            mdContent += `---\n\n`;

            const msgDate = tryParseDate(parsed.date);
            if (msgDate && (!newestDate || msgDate > newestDate)) {
                newestDate = msgDate;
            }
        }

        fs.writeFileSync(path.join(syncDir, `${cleanFilename(threadId)}.md`), mdContent);
        console.log(`[Gmail] Synced Thread: ${firstParsed.subject} (${threadId})`);
    }

    if (!newestDate) return null;
    // Add 1 second so the `after:` query (epoch-second granularity) excludes this email next sync
    return new Date(newestDate.getTime() + 1000).toISOString();
}

async function performSync() {
    const ATTACHMENTS_DIR = path.join(SYNC_DIR, 'attachments');
    const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');

    // Ensure directories exist
    if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
    if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    const account = composioAccountsRepo.getAccount('gmail');
    if (!account || account.status !== 'ACTIVE') {
        console.log('[Gmail] Gmail not connected via Composio. Skipping sync.');
        return;
    }

    const connectedAccountId = account.id;

    // Determine query timestamp
    const state = loadState(STATE_FILE);
    let afterEpochSeconds: number;

    if (state) {
        afterEpochSeconds = toEpochSeconds(state.last_sync);
        console.log(`[Gmail] Syncing messages since ${state.last_sync}...`);
    } else {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - LOOKBACK_DAYS);
        afterEpochSeconds = Math.floor(pastDate.getTime() / 1000);
        console.log(`[Gmail] First sync - fetching last ${LOOKBACK_DAYS} days...`);
    }

    try {
        // List threads since last sync (lightweight - returns IDs only)
        const allThreadIds: string[] = [];
        let pageToken: string | undefined;

        do {
            const params: Record<string, unknown> = {
                query: `after:${afterEpochSeconds}`,
                max_results: 20,
                user_id: 'me',
            };
            if (pageToken) {
                params.page_token = pageToken;
            }

            const result = await executeAction(
                'GMAIL_LIST_THREADS',
                connectedAccountId,
                params
            );

            if (!result.success || !result.data) {
                console.error('[Gmail] Failed to list threads:', result.error);
                return;
            }

            const data = result.data as Record<string, unknown>;
            const threads = data.threads as Array<Record<string, unknown>> | undefined;

            if (threads && threads.length > 0) {
                for (const thread of threads) {
                    const threadId = thread.id as string | undefined;
                    if (threadId) {
                        allThreadIds.push(threadId);
                    }
                }
            }

            pageToken = data.nextPageToken as string | undefined;
        } while (pageToken);

        if (allThreadIds.length === 0) {
            console.log('[Gmail] No new threads.');
            return;
        }

        console.log(`[Gmail] Found ${allThreadIds.length} threads to sync.`);

        // Reverse so we process oldest first. Gmail returns newest first,
        // so processing in reverse lets the high-water mark advance
        // chronologically — safe to save state after each thread.
        allThreadIds.reverse();

        // Process each thread, saving state after each one with the
        // newest email date seen so far (high-water mark).
        let highWaterMark: string | null = state?.last_sync ?? null;
        let processedCount = 0;
        for (const threadId of allThreadIds) {
            try {
                const newestInThread = await processThread(connectedAccountId, threadId, SYNC_DIR);
                processedCount++;

                // Advance high-water mark if this thread has a newer email
                if (newestInThread) {
                    if (!highWaterMark || new Date(newestInThread) > new Date(highWaterMark)) {
                        highWaterMark = newestInThread;
                    }
                    saveState(STATE_FILE, highWaterMark);
                }
            } catch (error) {
                console.error(`[Gmail] Error processing thread ${threadId}, skipping:`, error);
            }
        }

        console.log(`[Gmail] Sync completed. Processed ${processedCount}/${allThreadIds.length} threads.`);

    } catch (error) {
        console.error('[Gmail] Error during sync:', error);
    }
}

export async function init() {
    console.log('[Gmail] Starting Gmail Sync (Composio)...');
    console.log(`[Gmail] Will sync every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            const isConnected = composioAccountsRepo.isConnected('gmail');

            if (!isConnected) {
                console.log('[Gmail] Gmail not connected via Composio. Sleeping...');
            } else {
                await performSync();
            }
        } catch (error) {
            console.error('[Gmail] Error in main loop:', error);
        }

        console.log(`[Gmail] Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
        await interruptibleSleep(SYNC_INTERVAL_MS);
    }
}
