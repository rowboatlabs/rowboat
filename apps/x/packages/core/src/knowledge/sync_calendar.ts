import fs from 'fs';
import path from 'path';
import { google, calendar_v3 as cal, drive_v3 as drive } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { NodeHtmlMarkdown } from 'node-html-markdown'
import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { getProviderConfig } from '../auth/providers.js';
import { createOAuthService } from '../auth/oauth.js';
import { WorkDir } from '../config/config.js';
import { OAuthTokens } from 'packages/shared/dist/auth.js';

// Configuration
const SYNC_DIR = path.join(WorkDir, 'calendar_sync');
const SYNC_INTERVAL_MS = 60 * 1000; // Check every minute
const LOOKBACK_DAYS = 14;
const REQUIRED_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
];
const PROVIDER_NAME = 'google';

const nhm = new NodeHtmlMarkdown();

// --- Auth Functions ---

/**
 * Get OAuth repository from DI container
 */
function getOAuthRepo(): IOAuthRepo {
    return container.resolve<IOAuthRepo>('oauthRepo');
}

/**
 * Check if all required scopes are present in the granted scopes
 */
function hasRequiredScopes(grantedScopes?: string[]): boolean {
    if (!grantedScopes || grantedScopes.length === 0) {
        return false;
    }
    // Check if all required scopes are present
    return REQUIRED_SCOPES.every(scope => grantedScopes.includes(scope));
}

/**
 * Convert OAuthTokens to OAuth2Client for use with googleapis
 */
async function createOAuth2Client(): Promise<OAuth2Client | null> {
    const oauthRepo = getOAuthRepo();
    const tokens = await oauthRepo.getTokens(PROVIDER_NAME);

    if (!tokens) {
        return null;
    }

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expires_at <= now) {
        // Token expired, try to refresh
        if (!tokens.refresh_token) {
            console.log("Token expired and no refresh token available.");
            return null;
        }

        try {
            const oauthService = createOAuthService(PROVIDER_NAME);
            const existingScopes = tokens.scopes;
            const refreshedTokens = await oauthService.refreshAccessToken(tokens.refresh_token, existingScopes);
            await oauthRepo.saveTokens(PROVIDER_NAME, refreshedTokens);

            // Use refreshed tokens
            return createClientFromTokens(refreshedTokens);
        } catch (error) {
            console.error("Failed to refresh token:", error);
            return null;
        }
    }

    return createClientFromTokens(tokens);
}

/**
 * Create OAuth2Client from OAuthTokens
 */
function createClientFromTokens(tokens: OAuthTokens): OAuth2Client {
    const providerConfig = getProviderConfig(PROVIDER_NAME);

    // Create OAuth2Client directly (PKCE flow doesn't use client secret)
    const client = new OAuth2Client(
        providerConfig.clientId,
        undefined, // client_secret not needed for PKCE
        undefined  // redirect_uri not needed for token usage
    );

    // Set credentials
    client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || undefined,
        expiry_date: tokens.expires_at * 1000, // Convert from seconds to milliseconds
        scope: tokens.scopes?.join(' ') || undefined,
    });

    return client;
}

/**
 * Check if Google OAuth credentials are available with required scopes
 */
async function hasValidCredentials(): Promise<boolean> {
    const oauthRepo = getOAuthRepo();
    const isConnected = await oauthRepo.isConnected(PROVIDER_NAME);

    if (!isConnected) {
        return false;
    }

    const tokens = await oauthRepo.getTokens(PROVIDER_NAME);
    if (!tokens) {
        return false;
    }

    // Check if all required scopes are present
    return hasRequiredScopes(tokens.scopes);
}

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
            console.log("401 Unauthorized. Clearing tokens to force re-authentication.");
            const oauthRepo = getOAuthRepo();
            await oauthRepo.clearTokens(PROVIDER_NAME);
        }
        throw error; // Re-throw to be handled by performSync
    }
}

async function performSync(syncDir: string, lookbackDays: number) {
    try {

        if (!fs.existsSync(SYNC_DIR)) {
            fs.mkdirSync(SYNC_DIR, { recursive: true });
        }

        const auth = await createOAuth2Client();
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
            console.log("401 Unauthorized. Clearing tokens to force re-authentication.");
            const oauthRepo = getOAuthRepo();
            await oauthRepo.clearTokens(PROVIDER_NAME);
        }
    }
}

export async function init() {
    console.log("Starting Google Calendar & Notes Sync (TS)...");
    console.log(`Will check for credentials every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            // Check if credentials are available with required scopes
            const hasCredentials = await hasValidCredentials();

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