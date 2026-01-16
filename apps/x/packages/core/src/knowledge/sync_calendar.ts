import fs from 'fs';
import path from 'path';
import { google, calendar_v3 as cal, drive_v3 as drive } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { WorkDir } from '../config/config.js';
import { GoogleClientFactory } from './google-client-factory.js';

// Configuration
const SYNC_DIR = path.join(WorkDir, 'calendar_sync');
const SYNC_INTERVAL_MS = 60 * 1000; // Check every minute
const LOOKBACK_DAYS = 14;
const REQUIRED_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
];

const nhm = new NodeHtmlMarkdown();

// --- Helper Functions ---

function cleanFilename(name: string): string {
    return name.replace(/[\\/*?:"<>|]/g, "").replace(/\s+/g, "_").substring(0, 100).trim();
}

// --- Sync Logic ---

function cleanUpOldFiles(currentEventIds: Set<string>, syncDir: string) {
    if (!fs.existsSync(syncDir)) return;

    const files = fs.readdirSync(syncDir);
    for (const filename of files) {
        if (filename === 'sync_state.json') continue;

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
            } catch (e) {
                console.error(`Error deleting file ${filename}:`, e);
            }
        }
    }
}

async function saveEvent(event: cal.Schema$Event, syncDir: string): Promise<boolean> {
    const eventId = event.id;
    if (!eventId) return false;

    const filePath = path.join(syncDir, `${eventId}.json`);

    try {
        fs.writeFileSync(filePath, JSON.stringify(event, null, 2));
        return true;
    } catch (e) {
        console.error(`Error saving event ${eventId}:`, e);
        return false;
    }
}

async function processAttachments(drive: drive.Drive, event: cal.Schema$Event, syncDir: string) {
    if (!event.attachments || event.attachments.length === 0) return;

    const eventId = event.id;
    const eventTitle = event.summary || 'Untitled';
    const eventDate = event.start?.dateTime || event.start?.date || 'Unknown';
    const organizer = event.organizer?.email || 'Unknown';

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
                console.log(`Synced Note: ${att.title} for event ${eventTitle}`);
            } catch (e) {
                console.error(`Failed to download note ${att.title}:`, e);
            }
        }
    }
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
                    await saveEvent(event, syncDir);
                    await processAttachments(drive, event, syncDir);
                    currentEventIds.add(event.id);
                }
            }
        }

        cleanUpOldFiles(currentEventIds, syncDir);

    } catch (error) {
        console.error("An error occurred during calendar sync:", error);
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
    console.log(`Will check for credentials every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            // Check if credentials are available with required scopes
            const hasCredentials = await GoogleClientFactory.hasValidCredentials(REQUIRED_SCOPES);

            if (!hasCredentials) {
                console.log("Google OAuth credentials not available or missing required Calendar/Drive scopes. Sleeping...");
            } else {
                // Perform one sync
                await performSync(SYNC_DIR, LOOKBACK_DAYS);
            }
        } catch (error) {
            console.error("Error in main loop:", error);
        }

        // Sleep for N minutes before next check
        console.log(`Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
    }
}