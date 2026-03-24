import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage } from '../runs/runs.js';
import { bus } from '../runs/bus.js';
import { serviceLogger } from '../services/service_logger.js';
import { loadUserConfig, updateUserEmail } from '../config/user_config.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { useComposioForGoogle, executeAction } from '../composio/client.js';
import { composioAccountsRepo } from '../composio/repo.js';
import {
    loadAgentNotesState,
    saveAgentNotesState,
    markEmailProcessed,
    markRunProcessed,
    type AgentNotesState,
} from './agent_notes_state.js';

const SYNC_INTERVAL_MS = 10 * 1000; // 10 seconds (for testing)
const EMAIL_BATCH_SIZE = 5;
const RUNS_BATCH_SIZE = 5;
const GMAIL_SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const RUNS_DIR = path.join(WorkDir, 'runs');
const AGENT_NOTES_DIR = path.join(WorkDir, 'knowledge', 'Agent Notes');
const INBOX_FILE = path.join(AGENT_NOTES_DIR, 'inbox.md');
const AGENT_ID = 'agent_notes_agent';

// --- File helpers ---

function ensureAgentNotesDir(): void {
    if (!fs.existsSync(AGENT_NOTES_DIR)) {
        fs.mkdirSync(AGENT_NOTES_DIR, { recursive: true });
    }
}

// --- Email scanning ---

function findUserSentEmails(
    state: AgentNotesState,
    userEmail: string,
    limit: number,
): string[] {
    if (!fs.existsSync(GMAIL_SYNC_DIR)) {
        return [];
    }

    const results: { path: string; mtime: number }[] = [];
    const userEmailLower = userEmail.toLowerCase();

    function traverse(dir: string) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                if (entry !== 'attachments') {
                    traverse(fullPath);
                }
            } else if (stat.isFile() && entry.endsWith('.md')) {
                if (state.processedEmails[fullPath]) {
                    continue;
                }

                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const fromLines = content.match(/^### From:.*$/gm);
                    if (fromLines?.some(line => line.toLowerCase().includes(userEmailLower))) {
                        results.push({ path: fullPath, mtime: stat.mtimeMs });
                    }
                } catch {
                    continue;
                }
            }
        }
    }

    traverse(GMAIL_SYNC_DIR);

    results.sort((a, b) => b.mtime - a.mtime);
    return results.slice(0, limit).map(r => r.path);
}

function extractUserPartsFromEmail(content: string, userEmail: string): string | null {
    const userEmailLower = userEmail.toLowerCase();
    const sections = content.split(/^---$/m);
    const userSections: string[] = [];

    for (const section of sections) {
        const fromMatch = section.match(/^### From:.*$/m);
        if (fromMatch && fromMatch[0].toLowerCase().includes(userEmailLower)) {
            userSections.push(section.trim());
        }
    }

    return userSections.length > 0 ? userSections.join('\n\n---\n\n') : null;
}

// --- Inbox reading ---

function readInbox(): string[] {
    if (!fs.existsSync(INBOX_FILE)) {
        return [];
    }
    const content = fs.readFileSync(INBOX_FILE, 'utf-8').trim();
    if (!content) {
        return [];
    }
    return content.split('\n').filter(l => l.trim());
}

function clearInbox(): void {
    if (fs.existsSync(INBOX_FILE)) {
        fs.writeFileSync(INBOX_FILE, '');
    }
}

// --- Copilot run scanning ---

function findNewCopilotRuns(state: AgentNotesState): string[] {
    if (!fs.existsSync(RUNS_DIR)) {
        return [];
    }

    const results: string[] = [];
    const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
        if (state.processedRuns[file]) {
            continue;
        }

        try {
            const fullPath = path.join(RUNS_DIR, file);
            const fd = fs.openSync(fullPath, 'r');
            const buf = Buffer.alloc(512);
            const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
            fs.closeSync(fd);

            const firstLine = buf.subarray(0, bytesRead).toString('utf-8').split('\n')[0];
            const event = JSON.parse(firstLine);
            if (event.agentName === 'copilot') {
                results.push(file);
            }
        } catch {
            continue;
        }
    }

    results.sort();
    return results;
}

function extractConversationMessages(runFilePath: string): { role: string; text: string }[] {
    const messages: { role: string; text: string }[] = [];
    try {
        const content = fs.readFileSync(runFilePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                if (event.type !== 'message') continue;

                const msg = event.message;
                if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;

                let text = '';
                if (typeof msg.content === 'string') {
                    text = msg.content.trim();
                } else if (Array.isArray(msg.content)) {
                    text = msg.content
                        .filter((p: { type: string }) => p.type === 'text')
                        .map((p: { text: string }) => p.text)
                        .join('\n')
                        .trim();
                }

                if (text) {
                    messages.push({ role: msg.role, text });
                }
            } catch {
                continue;
            }
        }
    } catch {
        // ignore
    }
    return messages;
}

// --- Wait for agent run completion ---

async function waitForRunCompletion(runId: string): Promise<void> {
    return new Promise(async (resolve) => {
        const unsubscribe = await bus.subscribe('*', async (event) => {
            if (event.type === 'run-processing-end' && event.runId === runId) {
                unsubscribe();
                resolve();
            }
        });
    });
}

// --- User email resolution ---

async function ensureUserEmail(): Promise<string | null> {
    const existing = loadUserConfig();
    if (existing?.email) {
        return existing.email;
    }

    // Try Composio (used when signed in or composio configured)
    try {
        if (await useComposioForGoogle()) {
            const account = composioAccountsRepo.getAccount('gmail');
            if (account && account.status === 'ACTIVE') {
                const result = await executeAction('GMAIL_GET_PROFILE', {
                    connected_account_id: account.id,
                    user_id: 'rowboat-user',
                    version: 'latest',
                    arguments: { user_id: 'me' },
                });
                const email = (result.data as Record<string, unknown>)?.emailAddress as string | undefined;
                if (email) {
                    updateUserEmail(email);
                    console.log(`[AgentNotes] Auto-populated user email via Composio: ${email}`);
                    return email;
                }
            }
        }
    } catch (error) {
        console.log('[AgentNotes] Could not fetch email via Composio:', error instanceof Error ? error.message : error);
    }

    // Try direct Google OAuth
    try {
        const auth = await GoogleClientFactory.getClient();
        if (auth) {
            const gmail = google.gmail({ version: 'v1', auth });
            const profile = await gmail.users.getProfile({ userId: 'me' });
            if (profile.data.emailAddress) {
                updateUserEmail(profile.data.emailAddress);
                console.log(`[AgentNotes] Auto-populated user email: ${profile.data.emailAddress}`);
                return profile.data.emailAddress;
            }
        }
    } catch (error) {
        console.log('[AgentNotes] Could not fetch Gmail profile for user email:', error instanceof Error ? error.message : error);
    }

    return null;
}

// --- Main processing ---

async function processAgentNotes(): Promise<void> {
    ensureAgentNotesDir();
    const state = loadAgentNotesState();
    const userEmail = await ensureUserEmail();

    // Collect all source material
    const messageParts: string[] = [];

    // 1. Emails (only if we have user email)
    const emailPaths = userEmail
        ? findUserSentEmails(state, userEmail, EMAIL_BATCH_SIZE)
        : [];
    if (emailPaths.length > 0) {
        messageParts.push(`## Emails sent by the user\n`);
        for (const p of emailPaths) {
            const content = fs.readFileSync(p, 'utf-8');
            const userParts = extractUserPartsFromEmail(content, userEmail!);
            if (userParts) {
                messageParts.push(`---\n${userParts}\n---\n`);
            }
        }
    }

    // 2. Inbox entries
    const inboxEntries = readInbox();
    if (inboxEntries.length > 0) {
        messageParts.push(`## Notes from the assistant (save-to-memory inbox)\n`);
        messageParts.push(inboxEntries.join('\n'));
    }

    // 3. Copilot conversations
    const newRuns = findNewCopilotRuns(state);
    const runsToProcess = newRuns.slice(-RUNS_BATCH_SIZE);
    if (runsToProcess.length > 0) {
        let conversationText = '';
        for (const runFile of runsToProcess) {
            const messages = extractConversationMessages(path.join(RUNS_DIR, runFile));
            if (messages.length === 0) continue;
            conversationText += `\n--- Conversation ---\n`;
            for (const msg of messages) {
                conversationText += `${msg.role}: ${msg.text}\n\n`;
            }
        }
        if (conversationText.trim()) {
            messageParts.push(`## Recent copilot conversations\n${conversationText}`);
        }
    }

    // Nothing to process
    if (messageParts.length === 0) {
        return;
    }

    const serviceRun = await serviceLogger.startRun({
        service: 'agent_notes',
        message: 'Processing agent notes',
        trigger: 'timer',
    });

    try {
        const timestamp = new Date().toISOString();
        const message = `Current timestamp: ${timestamp}\n\nProcess the following source material and update the Agent Notes folder accordingly.\n\n${messageParts.join('\n\n')}`;

        const agentRun = await createRun({ agentId: AGENT_ID });
        await createMessage(agentRun.id, message);
        await waitForRunCompletion(agentRun.id);

        // Mark everything as processed
        for (const p of emailPaths) {
            markEmailProcessed(p, state);
        }
        for (const r of newRuns) {
            markRunProcessed(r, state);
        }
        if (inboxEntries.length > 0) {
            clearInbox();
        }

        state.lastRunTime = new Date().toISOString();
        saveAgentNotesState(state);

        await serviceLogger.log({
            type: 'run_complete',
            service: serviceRun.service,
            runId: serviceRun.runId,
            level: 'info',
            message: 'Agent notes processing complete',
            durationMs: Date.now() - serviceRun.startedAt,
            outcome: 'ok',
            summary: {
                emails: emailPaths.length,
                inboxEntries: inboxEntries.length,
                copilotRuns: runsToProcess.length,
            },
        });
    } catch (error) {
        console.error('[AgentNotes] Error processing:', error);
        await serviceLogger.log({
            type: 'error',
            service: serviceRun.service,
            runId: serviceRun.runId,
            level: 'error',
            message: 'Error processing agent notes',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

// --- Entry point ---

export async function init() {
    console.log('[AgentNotes] Starting Agent Notes Service...');
    console.log(`[AgentNotes] Will process every ${SYNC_INTERVAL_MS / 1000} seconds`);

    // Initial run
    await processAgentNotes();

    // Periodic polling
    while (true) {
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
        try {
            await processAgentNotes();
        } catch (error) {
            console.error('[AgentNotes] Error in main loop:', error);
        }
    }
}
