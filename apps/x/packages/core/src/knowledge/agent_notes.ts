import fs from 'fs';
import path from 'path';
import { generateText } from 'ai';
import { WorkDir } from '../config/config.js';
import container from '../di/container.js';
import type { IModelConfigRepo } from '../models/repo.js';
import { createProvider } from '../models/models.js';
import { isSignedIn } from '../account/account.js';
import { getGatewayProvider } from '../models/gateway.js';
import { serviceLogger } from '../services/service_logger.js';
import { loadUserConfig } from '../pre_built/config.js';
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
const AGENT_NOTES_DIR = path.join(WorkDir, 'knowledge', 'agent-notes');
const STYLE_DIR = path.join(AGENT_NOTES_DIR, 'style');
const INBOX_FILE = path.join(AGENT_NOTES_DIR, 'inbox.md');

const NOTE_FILES = {
    preferences: path.join(AGENT_NOTES_DIR, 'preferences.md'),
    writingStyle: path.join(STYLE_DIR, 'writing.md'),
    emailStyle: path.join(STYLE_DIR, 'email.md'),
    slackStyle: path.join(STYLE_DIR, 'slack.md'),
    documentsStyle: path.join(STYLE_DIR, 'documents.md'),
    people: path.join(AGENT_NOTES_DIR, 'people.md'),
    routines: path.join(AGENT_NOTES_DIR, 'routines.md'),
    user: path.join(AGENT_NOTES_DIR, 'user.md'),
};

const CATEGORY_TO_FILE: Record<string, string[]> = {
    preference: [NOTE_FILES.preferences],
    style: [NOTE_FILES.writingStyle],
    people: [NOTE_FILES.people],
    routine: [NOTE_FILES.routines],
};

// --- LLM helpers ---

async function getModel() {
    const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
    const config = await repo.getConfig();
    const provider = await isSignedIn()
        ? await getGatewayProvider()
        : createProvider(config.provider);
    const modelId = config.knowledgeGraphModel || config.model;
    return provider.languageModel(modelId);
}

function stripCodeFences(text: string): string {
    return text
        .replace(/^```(?:markdown|md)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
}

// --- File helpers ---

function ensureAgentNotesDir(): void {
    for (const dir of [AGENT_NOTES_DIR, STYLE_DIR]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

function readNoteFile(filePath: string): string {
    try {
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
    } catch { /* ignore */ }
    return '';
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

// --- Inbox processing ---

interface InboxEntry {
    timestamp: string;
    category: string;
    note: string;
}

function readInbox(): InboxEntry[] {
    const content = readNoteFile(INBOX_FILE);
    if (!content.trim()) {
        return [];
    }

    const entries: InboxEntry[] = [];
    const lines = content.split('\n').filter(l => l.trim());

    for (const line of lines) {
        const match = line.match(/^- \[([^\]]+)\] \[([^\]]+)\] (.+)$/);
        if (match) {
            entries.push({
                timestamp: match[1],
                category: match[2],
                note: match[3],
            });
        }
    }

    return entries;
}

function clearInbox(): void {
    if (fs.existsSync(INBOX_FILE)) {
        fs.writeFileSync(INBOX_FILE, '');
    }
}

// --- Note file updates (single LLM call per file) ---

async function updateNoteFile(
    filePath: string,
    noteDescription: string,
    sourceContent: string,
): Promise<void> {
    const model = await getModel();
    const existing = readNoteFile(filePath);

    const system = `You maintain a personal knowledge file about a user. Your job is to update this file by integrating new source material.

Rules:
- Preserve all existing content that is still relevant
- Add new insights from the source material
- Deduplicate: if an insight is already captured, do not add it again
- Refine existing observations when new evidence supports a more nuanced version
- Keep the file well-organized with clear markdown headings and bullet points
- Be concise — prefer bullet points over paragraphs
- If the file is empty, create initial structure appropriate for: ${noteDescription}
- Output ONLY the complete updated file content, no commentary or explanation`;

    const prompt = `## Current file content:
${existing || '(empty — this is a new file)'}

## New source material to integrate:
${sourceContent}

Return the complete updated file:`;

    const result = await generateText({ model, system, prompt });
    const text = stripCodeFences(result.text);
    fs.writeFileSync(filePath, text);
}

// --- Email style processing ---

async function updateEmailStyle(
    emailFiles: { path: string; content: string }[],
    userName: string,
    userEmail: string,
): Promise<void> {
    let sourceContent = `Emails written by ${userName}:\n\n`;
    for (const file of emailFiles) {
        const userParts = extractUserPartsFromEmail(file.content, userEmail);
        if (userParts) {
            sourceContent += `---\n${userParts}\n---\n\n`;
        }
    }

    await updateNoteFile(
        NOTE_FILES.emailStyle,
        'Email writing style patterns — voice, tone, formatting, sign-offs, bucketed by recipient context. Include concrete examples.',
        sourceContent,
    );

    await updateNoteFile(
        NOTE_FILES.writingStyle,
        'General voice and tone patterns across all writing',
        sourceContent,
    );
}

// --- Inbox processing ---

async function processInbox(entries: InboxEntry[]): Promise<number> {
    if (entries.length === 0) {
        return 0;
    }

    // Group entries by category
    const grouped = new Map<string, InboxEntry[]>();
    for (const entry of entries) {
        const category = entry.category;
        if (!grouped.has(category)) {
            grouped.set(category, []);
        }
        grouped.get(category)!.push(entry);
    }

    // Update each relevant note file
    for (const [category, categoryEntries] of grouped) {
        const targetFiles = CATEGORY_TO_FILE[category];
        if (!targetFiles) {
            console.log(`[AgentNotes] Unknown category: ${category}, skipping`);
            continue;
        }

        const sourceContent = `Observations from conversations:\n\n${categoryEntries.map(e => `- ${e.note}`).join('\n')}`;

        for (const targetFile of targetFiles) {
            const description = targetFile === NOTE_FILES.preferences
                ? 'Hard rules and explicit preferences — always loaded for context'
                : targetFile === NOTE_FILES.writingStyle
                ? 'General voice and tone patterns across all writing'
                : targetFile === NOTE_FILES.people
                ? 'Per-person relationship context, tone preferences, and interaction notes'
                : 'Scheduling patterns, workflow habits, recurring tasks';

            await updateNoteFile(targetFile, description, sourceContent);
        }
    }

    return entries.length;
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

    // Sort chronologically (filenames are timestamps), newest last
    results.sort();
    return results;
}

/**
 * Extract only user and assistant text messages from a run file.
 * Skips tool calls, tool results, system messages, and any non-text content.
 */
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
                    // Only extract text parts, skip tool-call parts
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

/**
 * Process copilot runs and append new facts to user.md.
 * Each fact is a timestamped line. The LLM decides what's new vs already known.
 */
async function updateUserNotes(runFiles: string[]): Promise<number> {
    if (runFiles.length === 0) {
        return 0;
    }

    // Collect conversations from runs (limit to RUNS_BATCH_SIZE)
    const runsToProcess = runFiles.slice(-RUNS_BATCH_SIZE);
    let conversationText = '';

    for (const runFile of runsToProcess) {
        const messages = extractConversationMessages(path.join(RUNS_DIR, runFile));
        if (messages.length === 0) continue;

        conversationText += `\n--- Conversation ---\n`;
        for (const msg of messages) {
            conversationText += `${msg.role}: ${msg.text}\n\n`;
        }
    }

    if (!conversationText.trim()) {
        return 0;
    }

    const model = await getModel();
    const existing = readNoteFile(NOTE_FILES.user);
    const timestamp = new Date().toISOString();

    const system = `You analyze conversations between a user and their AI assistant to learn facts about the user.

Your job: extract any new, non-trivial facts about the user that are worth remembering long-term.

Examples of good facts:
- Working on Project X, an AI assistant product
- Team is 4 people, co-founder is Ramnique
- Preparing for Series A fundraise
- Based in Bangalore, India
- Prefers to work late evenings
- Has a meeting with Brad from Smash Capital next week

Examples of things NOT to extract:
- Ephemeral task details ("user asked to draft an email")
- Facts the assistant already knows from tools/knowledge graph
- Obvious or trivial observations ("user uses a computer")

Output format: Return ONLY new facts as a bullet list, one per line. Each line should be:
- [${timestamp}] The fact

If there are no new facts worth noting, return exactly: NO_NEW_FACTS

IMPORTANT: Check the existing user notes below. Do NOT repeat facts that are already captured there (even if worded differently).`;

    const prompt = `## Existing user notes:
${existing || '(none yet)'}

## Recent conversations to analyze:
${conversationText}

Extract new facts (or return NO_NEW_FACTS):`;

    const result = await generateText({ model, system, prompt });
    const text = stripCodeFences(result.text).trim();

    if (text === 'NO_NEW_FACTS' || !text) {
        return 0;
    }

    // Append new facts to user.md
    const header = existing ? '' : '# User\n\n';
    const newContent = existing
        ? existing.trimEnd() + '\n' + text + '\n'
        : header + text + '\n';
    fs.writeFileSync(NOTE_FILES.user, newContent);

    // Count lines added
    return text.split('\n').filter(l => l.trim().startsWith('-')).length;
}

// --- Main processing ---

async function processAgentNotes(): Promise<void> {
    const userConfig = loadUserConfig();
    if (!userConfig) {
        console.log('[AgentNotes] No user config found, skipping');
        return;
    }

    ensureAgentNotesDir();
    const state = loadAgentNotesState();

    const run = await serviceLogger.startRun({
        service: 'agent_notes',
        message: 'Processing agent notes',
        trigger: 'timer',
    });

    let hadError = false;
    let emailsProcessed = 0;
    let inboxProcessed = 0;
    let userFactsAdded = 0;

    // --- Email Style Learning ---
    try {
        const emailPaths = findUserSentEmails(state, userConfig.email, EMAIL_BATCH_SIZE);
        if (emailPaths.length > 0) {
            console.log(`[AgentNotes] Found ${emailPaths.length} new emails with user content`);
            await serviceLogger.log({
                type: 'progress',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: `Analyzing ${emailPaths.length} emails for style`,
                step: 'email_style',
                current: 1,
                total: 3,
            });

            const emailFiles = emailPaths.map(p => ({
                path: p,
                content: fs.readFileSync(p, 'utf-8'),
            }));

            await updateEmailStyle(emailFiles, userConfig.name, userConfig.email);

            for (const p of emailPaths) {
                markEmailProcessed(p, state);
            }
            saveAgentNotesState(state);
            emailsProcessed = emailPaths.length;
        }
    } catch (error) {
        hadError = true;
        console.error('[AgentNotes] Error processing emails:', error);
        await serviceLogger.log({
            type: 'error',
            service: run.service,
            runId: run.runId,
            level: 'error',
            message: 'Error processing email style',
            error: error instanceof Error ? error.message : String(error),
        });
    }

    // --- Inbox Processing ---
    try {
        const entries = readInbox();
        if (entries.length > 0) {
            console.log(`[AgentNotes] Found ${entries.length} inbox entries`);
            await serviceLogger.log({
                type: 'progress',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: `Processing ${entries.length} inbox entries`,
                step: 'inbox',
                current: 2,
                total: 3,
            });

            inboxProcessed = await processInbox(entries);
            clearInbox();
        }
    } catch (error) {
        hadError = true;
        console.error('[AgentNotes] Error processing inbox:', error);
        await serviceLogger.log({
            type: 'error',
            service: run.service,
            runId: run.runId,
            level: 'error',
            message: 'Error processing inbox',
            error: error instanceof Error ? error.message : String(error),
        });
    }

    // --- Copilot Run Learning (user.md) ---
    try {
        const newRuns = findNewCopilotRuns(state);
        if (newRuns.length > 0) {
            console.log(`[AgentNotes] Found ${newRuns.length} new copilot runs`);
            await serviceLogger.log({
                type: 'progress',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: `Analyzing ${newRuns.length} copilot runs for user facts`,
                step: 'copilot_runs',
                current: 3,
                total: 3,
            });

            userFactsAdded = await updateUserNotes(newRuns);

            for (const r of newRuns) {
                markRunProcessed(r, state);
            }
            saveAgentNotesState(state);
        }
    } catch (error) {
        hadError = true;
        console.error('[AgentNotes] Error processing copilot runs:', error);
        await serviceLogger.log({
            type: 'error',
            service: run.service,
            runId: run.runId,
            level: 'error',
            message: 'Error processing copilot runs',
            error: error instanceof Error ? error.message : String(error),
        });
    }

    state.lastRunTime = new Date().toISOString();
    saveAgentNotesState(state);

    await serviceLogger.log({
        type: 'run_complete',
        service: run.service,
        runId: run.runId,
        level: hadError ? 'error' : 'info',
        message: 'Agent notes processing complete',
        durationMs: Date.now() - run.startedAt,
        outcome: hadError ? 'error' : 'ok',
        summary: { emailsProcessed, inboxProcessed, userFactsAdded },
    });
}

// --- Entry point ---

export async function init() {
    console.log('[AgentNotes] Starting Agent Notes Service...');
    console.log(`[AgentNotes] Will process every ${SYNC_INTERVAL_MS / 60000} minutes`);

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
