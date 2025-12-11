import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { OAuth2Client } from 'google-auth-library';

// Configuration
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token_calendar.json');
const SYNC_INTERVAL_MS = 60 * 1000;
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// --- Auth Functions ---

async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
    try {
        const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf-8');
        const tokenData = JSON.parse(tokenContent);

        const credsContent = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
        const keys = JSON.parse(credsContent);
        const key = keys.installed || keys.web;

        const credentials = {
            type: 'authorized_user',
            client_id: key.client_id,
            client_secret: key.client_secret,
            refresh_token: tokenData.refresh_token || tokenData.refreshToken,
            access_token: tokenData.token || tokenData.access_token,
            expiry_date: tokenData.expiry || tokenData.expiry_date
        };
        return google.auth.fromJSON(credentials) as OAuth2Client;
    } catch (err) {
        // console.error("Error loading saved credentials:", err); // Optional: silence if just not found
        return null;
    }
}

async function saveCredentials(client: OAuth2Client) {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
        access_token: client.credentials.access_token,
        expiry_date: client.credentials.expiry_date,
    }, null, 2);
    fs.writeFileSync(TOKEN_PATH, payload);
}

async function authorize(): Promise<OAuth2Client> {
    let client = await loadSavedCredentialsIfExist();
    if (client && client.credentials && client.credentials.expiry_date && client.credentials.expiry_date > Date.now()) {
        console.log("Using existing valid token.");
        return client;
    }

    if (client && client.credentials && (!client.credentials.expiry_date || client.credentials.expiry_date <= Date.now()) && client.credentials.refresh_token) {
        console.log("Refreshing expired token...");
        try {
            await client.refreshAccessToken();
            await saveCredentials(client);
            return client;
        } catch (e) {
            console.error("Failed to refresh token:", e);
            if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
        }
    }

    console.log("Performing new OAuth authentication...");
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    }) as any;
    if (client && client.credentials) {
        await saveCredentials(client);
    }
    return client!;
}

// --- Sync Logic ---

function cleanUpOldFiles(currentEventIds: Set<string>, syncDir: string) {
    if (!fs.existsSync(syncDir)) return;

    const files = fs.readdirSync(syncDir);
    for (const filename of files) {
        if (!filename.endsWith('.json') || filename === 'sync_state.json') continue;

        const eventId = filename.replace('.json', '');
        if (!currentEventIds.has(eventId)) {
            try {
                fs.unlinkSync(path.join(syncDir, filename));
                console.log(`Removed old/out-of-window event: ${eventId}`);
            } catch (e) {
                console.error(`Error deleting file ${filename}:`, e);
            }
        }
    }
}

async function saveEvent(event: any, syncDir: string): Promise<boolean> {
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

async function syncCalendarWindow(auth: OAuth2Client, syncDir: string, lookbackDays: number) {
    // Calculate window: -lookbackDays to +2 weeks
    const now = new Date();
    const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
    const twoWeeksForwardMs = 14 * 24 * 60 * 60 * 1000; // Remaining constant as per original python script

    const timeMin = new Date(now.getTime() - lookbackMs).toISOString();
    const timeMax = new Date(now.getTime() + twoWeeksForwardMs).toISOString();

    console.log(`Syncing calendar from ${timeMin} to ${timeMax} (lookback: ${lookbackDays} days)...`);

    const calendar = google.calendar({ version: 'v3', auth });

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
                    currentEventIds.add(event.id);
                }
            }
        }

        cleanUpOldFiles(currentEventIds, syncDir);

    } catch (error) {
        console.error("An error occurred during calendar sync:", error);
    }
}

async function main() {
    console.log("Starting Google Calendar Sync (TS)...");
    
    const syncDirArg = process.argv[2];
    const lookbackDaysArg = process.argv[3];

    const SYNC_DIR = syncDirArg || 'synced_calendar_events';
    const LOOKBACK_DAYS = lookbackDaysArg ? parseInt(lookbackDaysArg, 10) : 14; // Default to 14 days

    if (isNaN(LOOKBACK_DAYS) || LOOKBACK_DAYS <= 0) {
        console.error("Error: Lookback days must be a positive number.");
        process.exit(1);
    }

    if (!fs.existsSync(SYNC_DIR)) {
        fs.mkdirSync(SYNC_DIR, { recursive: true });
    }

    try {
        const auth = await authorize();
        console.log("Authorization successful.");

        while (true) {
            await syncCalendarWindow(auth, SYNC_DIR, LOOKBACK_DAYS);
            console.log(`Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
        }
    } catch (error) {
        console.error("Fatal error in main loop:", error);
    }
}

main().catch(console.error);
