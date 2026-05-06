import fs from 'fs';
import path from 'path';
import { google, gmail_v1 as gmail } from 'googleapis';
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { OAuth2Client } from 'google-auth-library';
import { WorkDir } from '../config/config.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { serviceLogger, type ServiceRunContext } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import { createEvent } from './track/events.js';

// Configuration
const SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_THREADS_IN_DIGEST = 10;
const nhm = new NodeHtmlMarkdown();

interface SyncedThread {
    threadId: string;
    markdown: string;
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

function getBody(payload: gmail.Schema$MessagePart): string {
    let body = "";
    if (payload.parts) {
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                const text = decodeBase64(part.body.data);
                // Strip quoted lines
                const cleanLines = text.split('\n').filter((line: string) => !line.trim().startsWith('>'));
                body += cleanLines.join('\n');
            } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
                const html = decodeBase64(part.body.data);
                const md = nhm.translate(html);
                // Simple quote stripping for MD
                const cleanLines = md.split('\n').filter((line: string) => !line.trim().startsWith('>'));
                body += cleanLines.join('\n');
            } else if (part.parts) {
                body += getBody(part);
            }
        }
    } else if (payload.body && payload.body.data) {
        const data = decodeBase64(payload.body.data);
        if (payload.mimeType === 'text/html') {
            const md = nhm.translate(data);
            body += md.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
        } else {
            body += data.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
        }
    }
    return body;
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
