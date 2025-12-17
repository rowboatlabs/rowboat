import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { OAuth2Client } from 'google-auth-library';

// Configuration
const DEFAULT_SYNC_DIR = 'synced_emails_ts';
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token_api.json'); // Reuse Python's token
const SYNC_INTERVAL_MS = 60 * 1000;
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const nhm = new NodeHtmlMarkdown();

// --- Auth Functions ---

async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
    try {
        const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf-8');
        const tokenData = JSON.parse(tokenContent);

        const credsContent = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
        const keys = JSON.parse(credsContent);
        const key = keys.installed || keys.web;

        // Manually construct credentials for google.auth.fromJSON
        const credentials = {
            type: 'authorized_user',
            client_id: key.client_id,
            client_secret: key.client_secret,
            refresh_token: tokenData.refresh_token || tokenData.refreshToken, // Handle both cases
            access_token: tokenData.token || tokenData.access_token, // Handle both cases
            expiry_date: tokenData.expiry || tokenData.expiry_date
        };
        return google.auth.fromJSON(credentials) as OAuth2Client;
    } catch (err) {
        console.error("Error loading saved credentials:", err);
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
            await saveCredentials(client); // Save refreshed token
            return client;
        } catch (e) {
            console.error("Failed to refresh token:", e);
            // Fall through to full re-auth if refresh fails
            fs.existsSync(TOKEN_PATH) && fs.unlinkSync(TOKEN_PATH);
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

// --- Helper Functions ---

function cleanFilename(name: string): string {
    return name.replace(/[\\/*?:":<>|]/g, "").substring(0, 100).trim();
}

function decodeBase64(data: string): string {
    return Buffer.from(data, 'base64').toString('utf-8');
}

function getBody(payload: any): string {
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
                let md = nhm.translate(html);
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
             let md = nhm.translate(data);
             body += md.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
        } else {
             body += data.split('\n').filter((line: string) => !line.trim().startsWith('>')).join('\n');
        }
    }
    return body;
}

async function saveAttachment(gmail: any, userId: string, msgId: string, part: any, attachmentsDir: string): Promise<string | null> {
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

async function processThread(auth: OAuth2Client, threadId: string, syncDir: string, attachmentsDir: string) {
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.threads.get({ userId: 'me', id: threadId });
        const thread = res.data;
        const messages = thread.messages;

        if (!messages || messages.length === 0) return;

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

            const body = getBody(msg.payload);
            mdContent += `${body}\n\n`;

            // Attachments
            const parts: any[] = [];
            const traverseParts = (pList: any[]) => {
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

    } catch (error) {
        console.error(`Error processing thread ${threadId}:`, error);
    }
}

function loadState(stateFile: string): { historyId?: string } {
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
    console.log(`Performing full sync of last ${lookbackDays} days...`);
    const gmail = google.gmail({ version: 'v1', auth });
    
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - lookbackDays);
    const dateQuery = pastDate.toISOString().split('T')[0].replace(/-/g, '/');
    
    // Get History ID
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const currentHistoryId = profile.data.historyId!;

    let pageToken: string | undefined;
    do {
        const res: any = await gmail.users.threads.list({
            userId: 'me',
            q: `after:${dateQuery}`,
            pageToken
        });
        
        const threads = res.data.threads;
        if (threads) {
            for (const thread of threads) {
                await processThread(auth, thread.id!, syncDir, attachmentsDir);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    saveState(currentHistoryId, stateFile);
    console.log("Full sync complete.");
}

async function partialSync(auth: OAuth2Client, startHistoryId: string, syncDir: string, attachmentsDir: string, stateFile: string, lookbackDays: number) {
    console.log(`Checking updates since historyId ${startHistoryId}...`);
    const gmail = google.gmail({ version: 'v1', auth });

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

        for (const tid of threadIds) {
            await processThread(auth, tid, syncDir, attachmentsDir);
        }

        const profile = await gmail.users.getProfile({ userId: 'me' });
        saveState(profile.data.historyId!, stateFile);

    } catch (error: any) {
        if (error.response?.status === 404) {
            console.log("History ID expired. Falling back to full sync.");
            await fullSync(auth, syncDir, attachmentsDir, stateFile, lookbackDays);
        } else {
            console.error("Error during partial sync:", error);
            // If 401, remove token to force re-auth next run
            if (error.response?.status === 401 && fs.existsSync(TOKEN_PATH)) {
                console.log("401 Unauthorized. Deleting token to force re-authentication.");
                fs.unlinkSync(TOKEN_PATH);
            }
        }
    }
}

async function main() {
    console.log("Starting Gmail Sync (TS)...");
    const syncDirArg = process.argv[2];
    const lookbackDaysArg = process.argv[3];

    const SYNC_DIR = syncDirArg || DEFAULT_SYNC_DIR;
    const LOOKBACK_DAYS = lookbackDaysArg ? parseInt(lookbackDaysArg, 10) : 7; // Default to 7 days

    if (isNaN(LOOKBACK_DAYS) || LOOKBACK_DAYS <= 0) {
        console.error("Error: Lookback days must be a positive number.");
        process.exit(1);
    }

    const ATTACHMENTS_DIR = path.join(SYNC_DIR, 'attachments');
    const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');

    // Ensure directories exist
    if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
    if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    try {
        const auth = await authorize();
        console.log("Authorization successful.");
        
        while (true) {
            const state = loadState(STATE_FILE);
            if (!state.historyId) {
                console.log("No history ID found, starting full sync...");
                await fullSync(auth, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
            } else {
                console.log("History ID found, starting partial sync...");
                await partialSync(auth, state.historyId, SYNC_DIR, ATTACHMENTS_DIR, STATE_FILE, LOOKBACK_DAYS);
            }
            
            console.log(`Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
        }
    } catch (error) {
        console.error("Fatal error in main loop:", error);
    }
}

main().catch(console.error);
