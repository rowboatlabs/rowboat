import fs from 'fs';
import path from 'path';
import { google, calendar_v3 as cal, drive_v3 as drive } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { WorkDir } from '../config/config.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { serviceLogger } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import { createEvent } from './track/events.js';

const MAX_EVENTS_IN_DIGEST = 50;
const MAX_DESCRIPTION_CHARS = 500;

type AnyEvent = Record<string, unknown> | cal.Schema$Event;

function getStr(obj: unknown, key: string): string | undefined {
    if (obj && typeof obj === 'object' && key in obj) {
        const v = (obj as Record<string, unknown>)[key];
        return typeof v === 'string' ? v : undefined;
    }
    return undefined;
}

function formatEventTime(event: AnyEvent): string {
    const start = (event as Record<string, unknown>).start as Record<string, unknown> | undefined;
    const end = (event as Record<string, unknown>).end as Record<string, unknown> | undefined;
    const startStr = getStr(start, 'dateTime') ?? getStr(start, 'date') ?? 'unknown';
    const endStr = getStr(end, 'dateTime') ?? getStr(end, 'date') ?? 'unknown';
    return `${startStr} → ${endStr}`;
}

function formatEventBlock(event: AnyEvent, label: 'NEW' | 'UPDATED'): string {
    const id = getStr(event, 'id') ?? '(unknown id)';
    const title = getStr(event, 'summary') ?? '(no title)';
    const time = formatEventTime(event);
    const organizer = getStr((event as Record<string, unknown>).organizer, 'email') ?? 'unknown';
    const location = getStr(event, 'location') ?? '';
    const rawDescription = getStr(event, 'description') ?? '';
    const description = rawDescription.length > MAX_DESCRIPTION_CHARS
        ? rawDescription.slice(0, MAX_DESCRIPTION_CHARS) + '…(truncated)'
        : rawDescription;

    const attendeesRaw = (event as Record<string, unknown>).attendees;
    let attendeesLine = '';
    if (Array.isArray(attendeesRaw) && attendeesRaw.length > 0) {
        const emails = attendeesRaw
            .map(a => getStr(a, 'email'))
            .filter((e): e is string => !!e);
        if (emails.length > 0) {
            attendeesLine = `**Attendees:** ${emails.join(', ')}\n`;
        }
    }

    return [
        `### [${label}] ${title}`,
        `**ID:** ${id}`,
        `**Time:** ${time}`,
        `**Organizer:** ${organizer}`,
        location ? `**Location:** ${location}` : '',
        attendeesLine.trimEnd(),
        description ? `\n${description}` : '',
    ].filter(Boolean).join('\n');
}

function summarizeCalendarSync(
    newEvents: AnyEvent[],
    updatedEvents: AnyEvent[],
    deletedEventIds: string[],
): string {
    const totalChanges = newEvents.length + updatedEvents.length + deletedEventIds.length;
    const lines: string[] = [
        `# Calendar sync update`,
        ``,
        `${newEvents.length} new, ${updatedEvents.length} updated, ${deletedEventIds.length} deleted.`,
        ``,
    ];

    const allChanges: Array<{ event: AnyEvent; label: 'NEW' | 'UPDATED' }> = [
        ...newEvents.map(e => ({ event: e, label: 'NEW' as const })),
        ...updatedEvents.map(e => ({ event: e, label: 'UPDATED' as const })),
    ];

    const shown = allChanges.slice(0, MAX_EVENTS_IN_DIGEST);
    const hidden = allChanges.length - shown.length;

    if (shown.length > 0) {
        lines.push(`## Changed events`, ``);
        for (const { event, label } of shown) {
            lines.push(formatEventBlock(event, label), ``);
        }
        if (hidden > 0) {
            lines.push(`_…and ${hidden} more change(s) omitted from digest._`, ``);
        }
    }

    if (deletedEventIds.length > 0) {
        lines.push(`## Deleted event IDs`, ``);
        for (const id of deletedEventIds.slice(0, MAX_EVENTS_IN_DIGEST)) {
            lines.push(`- ${id}`);
        }
        if (deletedEventIds.length > MAX_EVENTS_IN_DIGEST) {
            lines.push(`- _…and ${deletedEventIds.length - MAX_EVENTS_IN_DIGEST} more_`);
        }
        lines.push(``);
    }

    if (totalChanges === 0) {
        lines.push(`(no changes — should not be emitted)`);
    }

    return lines.join('\n');
}

async function publishCalendarSyncEvent(
    newEvents: AnyEvent[],
    updatedEvents: AnyEvent[],
    deletedEventIds: string[],
): Promise<void> {
    if (newEvents.length === 0 && updatedEvents.length === 0 && deletedEventIds.length === 0) {
        return;
    }
    try {
        await createEvent({
            source: 'calendar',
            type: 'calendar.synced',
            createdAt: new Date().toISOString(),
            payload: summarizeCalendarSync(newEvents, updatedEvents, deletedEventIds),
        });
    } catch (err) {
        console.error('[Calendar] Failed to publish sync event:', err);
    }
}

// Configuration
const SYNC_DIR = path.join(WorkDir, 'calendar_sync');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const LOOKBACK_DAYS = 7;
const REQUIRED_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
];
const nhm = new NodeHtmlMarkdown();

// --- Wake Signal for Immediate Sync Trigger ---
let wakeResolve: (() => void) | null = null;

export function triggerSync(): void {
    if (wakeResolve) {
        console.log('[Calendar] Triggered - waking up immediately');
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
    return name.replace(/[\\/*?:"<>|]/g, "").replace(/\s+/g, "_").substring(0, 100).trim();
}

// --- Sync Logic ---

function cleanUpOldFiles(currentEventIds: Set<string>, syncDir: string): string[] {
    if (!fs.existsSync(syncDir)) return [];

    const files = fs.readdirSync(syncDir);
    const deleted: string[] = [];
    for (const filename of files) {
        if (filename === 'sync_state.json' || filename === 'composio_state.json') continue;

        // We expect files like:
        // {eventId}.json
        // {eventId}_doc_{docId}.md

        let eventId: string | null = null;

        if (filename.endsWith('.json')) {
            eventId = filename.replace('.json', '');
        } else if (filename.endsWith('.md')) {
            // Try to extract eventId from prefix
            // Assuming eventId doesn't contain underscores usually, but if it does, this split might be fragile.
            // Google Calendar IDs are usually alphanumeric.
            // Let's rely on the delimiter we use: "_doc_"
            const parts = filename.split('_doc_');
            if (parts.length > 1) {
                eventId = parts[0];
            }
        }

        if (eventId && !currentEventIds.has(eventId)) {
            try {
                fs.unlinkSync(path.join(syncDir, filename));
                console.log(`Removed old/out-of-window file: ${filename}`);
                deleted.push(filename);
            } catch (e) {
                console.error(`Error deleting file ${filename}:`, e);
            }
        }
    }
    return deleted;
}

async function saveEvent(event: cal.Schema$Event, syncDir: string): Promise<{ changed: boolean; isNew: boolean; title: string }> {
    const eventId = event.id;
    if (!eventId) return { changed: false, isNew: false, title: 'Unknown' };

    const filePath = path.join(syncDir, `${eventId}.json`);
    const content = JSON.stringify(event, null, 2);
    const exists = fs.existsSync(filePath);

    try {
        if (exists) {
            const existing = fs.readFileSync(filePath, 'utf-8');
            if (existing === content) {
                return { changed: false, isNew: false, title: event.summary || eventId };
            }
        }

        fs.writeFileSync(filePath, content);
        return { changed: true, isNew: !exists, title: event.summary || eventId };
    } catch (e) {
        console.error(`Error saving event ${eventId}:`, e);
        return { changed: false, isNew: false, title: event.summary || eventId };
    }
}

async function processAttachments(drive: drive.Drive, event: cal.Schema$Event, syncDir: string): Promise<number> {
    if (!event.attachments || event.attachments.length === 0) return 0;

    const eventId = event.id;
    const eventTitle = event.summary || 'Untitled';
    const eventDate = event.start?.dateTime || event.start?.date || 'Unknown';
    const organizer = event.organizer?.email || 'Unknown';

    let savedCount = 0;

    for (const att of event.attachments) {
        // We only care about Google Docs
        if (att.mimeType === 'application/vnd.google-apps.document') {
            const fileId = att.fileId;
            const safeTitle = cleanFilename(att.title || 'Untitled');
            // Unique filename linked to event
            const filename = `${eventId}_doc_${safeTitle}.md`;
            const filePath = path.join(syncDir, filename);

            // Simple cache check: if file exists, skip.
            // Ideally we check modifiedTime, but that requires an extra API call per file.
            // Given the loop interval, we can just check existence to save quota.
            // If user updates notes, they might want them re-synced.
            // For now, let's just check existence. To be smarter, we'd need a state file or check API.
            if (fs.existsSync(filePath)) continue;

            try {
                const res = await drive.files.export({
                    fileId: fileId ?? '',
                    mimeType: 'text/html'
                });

                const html = res.data as string;
                const md = nhm.translate(html);

                const frontmatter = [
                    `# ${att.title}`,
                    `**Event:** ${eventTitle}`,
                    `**Date:** ${eventDate}`,
                    `**Organizer:** ${organizer}`,
                    `**Link:** ${att.fileUrl}`,
                    `---`,
                    ``
                ].join('\n');

                fs.writeFileSync(filePath, frontmatter + md);
                savedCount++;
                console.log(`Synced Note: ${att.title} for event ${eventTitle}`);
            } catch (e) {
                console.error(`Failed to download note ${att.title}:`, e);
            }
        }
    }
    return savedCount;
}

async function syncCalendarWindow(auth: OAuth2Client, syncDir: string, lookbackDays: number) {
    // Calculate window
    const now = new Date();
    const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
    const twoWeeksForwardMs = 14 * 24 * 60 * 60 * 1000;

    const timeMin = new Date(now.getTime() - lookbackMs).toISOString();
    const timeMax = new Date(now.getTime() + twoWeeksForwardMs).toISOString();

    console.log(`Syncing calendar from ${timeMin} to ${timeMax} (lookback: ${lookbackDays} days)...`);

    const calendar = google.calendar({ version: 'v3', auth });
    const drive = google.drive({ version: 'v3', auth });

    let runId: string | null = null;
    let runStartedAt = 0;
    let newCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let attachmentCount = 0;
    const changedTitles: string[] = [];
    const newEvents: AnyEvent[] = [];
    const updatedEvents: AnyEvent[] = [];

    const ensureRun = async () => {
        if (!runId) {
            const run = await serviceLogger.startRun({
                service: 'calendar',
                message: 'Syncing calendar',
                trigger: 'timer',
            });
            runId = run.runId;
            runStartedAt = run.startedAt;
        }
    };

    try {
        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime'
        });

        const events = res.data.items || [];
        const currentEventIds = new Set<string>();

        if (events.length === 0) {
            console.log("No events found in this window.");
        } else {
            console.log(`Found ${events.length} events.`);
            for (const event of events) {
                if (event.id) {
                    const result = await saveEvent(event, syncDir);
                    const attachmentsSaved = await processAttachments(drive, event, syncDir);
                    currentEventIds.add(event.id);

                    if (result.changed) {
                        await ensureRun();
                        changedTitles.push(result.title);
                        if (result.isNew) {
                            newCount++;
                            newEvents.push(event);
                        } else {
                            updatedCount++;
                            updatedEvents.push(event);
                        }
                    }

                    if (attachmentsSaved > 0) {
                        await ensureRun();
                        attachmentCount += attachmentsSaved;
                    }
                }
            }
        }

        const deletedFiles = cleanUpOldFiles(currentEventIds, syncDir);
        if (deletedFiles.length > 0) {
            await ensureRun();
            deletedCount = deletedFiles.length;
        }

        // Publish a single bundled event capturing all changes from this sync.
        await publishCalendarSyncEvent(newEvents, updatedEvents, deletedFiles);

        if (runId) {
            const totalChanges = newCount + updatedCount + deletedCount + attachmentCount;
            const limitedTitles = limitEventItems(changedTitles);
            await serviceLogger.log({
                type: 'changes_identified',
                service: 'calendar',
                runId,
                level: 'info',
                message: `Calendar updates: ${totalChanges} change${totalChanges === 1 ? '' : 's'}`,
                counts: {
                    newEvents: newCount,
                    updatedEvents: updatedCount,
                    deletedFiles: deletedCount,
                    attachments: attachmentCount,
                },
                items: limitedTitles.items,
                truncated: limitedTitles.truncated,
            });
            await serviceLogger.log({
                type: 'run_complete',
                service: 'calendar',
                runId,
                level: 'info',
                message: `Calendar sync complete: ${totalChanges} change${totalChanges === 1 ? '' : 's'}`,
                durationMs: Date.now() - runStartedAt,
                outcome: 'ok',
                summary: {
                    newEvents: newCount,
                    updatedEvents: updatedCount,
                    deletedFiles: deletedCount,
                    attachments: attachmentCount,
                },
            });
        }

    } catch (error) {
        console.error("An error occurred during calendar sync:", error);
        if (runId) {
            await serviceLogger.log({
                type: 'error',
                service: 'calendar',
                runId,
                level: 'error',
                message: 'Calendar sync error',
                error: error instanceof Error ? error.message : String(error),
            });
            await serviceLogger.log({
                type: 'run_complete',
                service: 'calendar',
                runId,
                level: 'error',
                message: 'Calendar sync failed',
                durationMs: Date.now() - runStartedAt,
                outcome: 'error',
            });
        }
        // If 401, clear tokens to force re-auth next run
        const e = error as { response?: { status?: number } };
        if (e.response?.status === 401) {
            console.log("401 Unauthorized, clearing cache");
            GoogleClientFactory.clearCache();
        }
        throw error; // Re-throw to be handled by performSync
    }
}

async function performSync(syncDir: string, lookbackDays: number) {
    try {

        if (!fs.existsSync(SYNC_DIR)) {
            fs.mkdirSync(SYNC_DIR, { recursive: true });
        }

        const auth = await GoogleClientFactory.getClient();
        if (!auth) {
            console.log("No valid OAuth credentials available.");
            return;
        }

        console.log("Authorization successful. Starting sync...");
        await syncCalendarWindow(auth, syncDir, lookbackDays);
        console.log("Sync completed.");
    } catch (error) {
        console.error("Error during sync:", error);
        // If 401, clear tokens to force re-auth next run
        const e = error as { response?: { status?: number } };
        if (e.response?.status === 401) {
            console.log("401 Unauthorized, clearing cache");
            GoogleClientFactory.clearCache();
        }
    }
}

export async function init() {
    console.log("Starting Google Calendar & Notes Sync (TS)...");
    console.log(`Will sync every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            const hasCredentials = await GoogleClientFactory.hasValidCredentials(REQUIRED_SCOPES);
            if (!hasCredentials) {
                console.log("Google OAuth credentials not available or missing required Calendar/Drive scopes. Sleeping...");
            } else {
                await performSync(SYNC_DIR, LOOKBACK_DAYS);
            }
        } catch (error) {
            console.error("Error in main loop:", error);
        }

        // Sleep for N minutes before next check (can be interrupted by triggerSync)
        console.log(`Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
        await interruptibleSleep(SYNC_INTERVAL_MS);
    }
}
