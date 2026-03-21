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

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const EMAIL_BATCH_SIZE = 5;
const GMAIL_SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const RUNS_DIR = path.join(WorkDir, 'runs');
const AGENT_NOTES_DIR = path.join(WorkDir, 'knowledge', 'agent-notes');
const STYLE_DIR = path.join(AGENT_NOTES_DIR, 'style');

const NOTE_FILES = {
    preferences: path.join(AGENT_NOTES_DIR, 'preferences.md'),
    writingStyle: path.join(STYLE_DIR, 'writing.md'),
    emailStyle: path.join(STYLE_DIR, 'email.md'),
    slackStyle: path.join(STYLE_DIR, 'slack.md'),
    documentsStyle: path.join(STYLE_DIR, 'documents.md'),
    people: path.join(AGENT_NOTES_DIR, 'people.md'),
    routines: path.join(AGENT_NOTES_DIR, 'routines.md'),
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
                    // Check if any From header contains the user's email
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

    // Sort by mtime descending (newest first), return up to limit
    results.sort((a, b) => b.mtime - a.mtime);
    return results.slice(0, limit).map(r => r.path);
}

function extractUserPartsFromEmail(content: string, userEmail: string): string | null {
    const userEmailLower = userEmail.toLowerCase();
    // Split by message separator
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

// --- Run scanning ---

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

    // Sort chronologically (filenames are timestamps)
    results.sort();
    return results;
}

function extractUserMessages(runFilePath: string): string[] {
    const messages: string[] = [];
    try {
        const content = fs.readFileSync(runFilePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                if (event.type === 'message' && event.message?.role === 'user') {
                    const msgContent = event.message.content;
                    if (typeof msgContent === 'string' && msgContent.trim()) {
                        messages.push(msgContent.trim());
                    } else if (Array.isArray(msgContent)) {
                        // Handle array content format (text parts)
                        const text = msgContent
                            .filter((p: { type: string }) => p.type === 'text')
                            .map((p: { text: string }) => p.text)
                            .join('\n');
                        if (text.trim()) {
                            messages.push(text.trim());
                        }
                    }
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
    // Build source content from user-sent email parts
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

// --- Copilot run processing ---

async function updateFromCopilotRuns(runFiles: string[]): Promise<void> {
    // Collect user messages from all new runs
    let allUserMessages: string[] = [];
    for (const runFile of runFiles) {
        const msgs = extractUserMessages(path.join(RUNS_DIR, runFile));
        allUserMessages.push(...msgs);
    }

    if (allUserMessages.length === 0) {
        return;
    }

    // Cap to avoid massive prompts
    if (allUserMessages.length > 20) {
        allUserMessages = allUserMessages.slice(-20);
    }

    const sourceContent = `User messages from recent AI assistant conversations:\n\n${allUserMessages.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}`;

    // Update preferences
    await updateNoteFile(
        NOTE_FILES.preferences,
        'Hard rules and explicit preferences the user has stated — always loaded for context',
        sourceContent,
    );

    // Update people context
    await updateNoteFile(
        NOTE_FILES.people,
        'Per-person relationship context, tone preferences, and interaction notes',
        sourceContent,
    );

    // Update routines
    await updateNoteFile(
        NOTE_FILES.routines,
        'Scheduling patterns, workflow habits, recurring tasks',
        sourceContent,
    );
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
    let runsProcessed = 0;

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
                total: 2,
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

    // --- Chat Run Learning ---
    try {
        const newRuns = findNewCopilotRuns(state);
        if (newRuns.length > 0) {
            console.log(`[AgentNotes] Found ${newRuns.length} new copilot runs`);
            await serviceLogger.log({
                type: 'progress',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: `Analyzing ${newRuns.length} copilot runs`,
                step: 'chat_runs',
                current: 2,
                total: 2,
            });

            await updateFromCopilotRuns(newRuns);

            for (const r of newRuns) {
                markRunProcessed(r, state);
            }
            saveAgentNotesState(state);
            runsProcessed = newRuns.length;
        }
    } catch (error) {
        hadError = true;
        console.error('[AgentNotes] Error processing runs:', error);
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
        summary: { emailsProcessed, runsProcessed },
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
