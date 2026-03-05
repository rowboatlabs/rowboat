import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CronExpressionParser } from 'cron-parser';
import { generateText } from 'ai';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage, fetchRun } from '../runs/runs.js';
import { bus } from '../runs/bus.js';
import container from '../di/container.js';
import type { IModelConfigRepo } from '../models/repo.js';
import { createProvider } from '../models/models.js';

const SYNC_INTERVAL_MS = 15 * 1000; // 15 seconds
const INLINE_TASK_AGENT = 'inline_task_agent';
const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');


// ---------------------------------------------------------------------------
// Minimal frontmatter helpers (duplicated from renderer to avoid cross-package
// dependency — can be moved to shared later).
// ---------------------------------------------------------------------------

function splitFrontmatter(content: string): { raw: string | null; body: string } {
    if (!content.startsWith('---')) {
        return { raw: null, body: content };
    }
    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) {
        return { raw: null, body: content };
    }
    const closingEnd = endIndex + 4;
    const raw = content.slice(0, closingEnd);
    let body = content.slice(closingEnd);
    if (body.startsWith('\n')) {
        body = body.slice(1);
    }
    return { raw, body };
}

function joinFrontmatter(raw: string | null, body: string): string {
    if (!raw) return body;
    return raw + '\n' + body;
}

function extractAllFrontmatterValues(raw: string | null): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    if (!raw) return result;

    const lines = raw.split('\n');
    let currentKey: string | null = null;

    for (const line of lines) {
        if (line === '---' || line.trim() === '') {
            currentKey = null;
            continue;
        }
        const topMatch = line.match(/^(\w[\w\s]*\w|\w+):\s*(.*)$/);
        if (topMatch) {
            const key = topMatch[1];
            const value = topMatch[2].trim();
            if (value) {
                result[key] = value;
                currentKey = null;
            } else {
                currentKey = key;
                result[key] = [];
            }
            continue;
        }
        if (currentKey) {
            const itemMatch = line.match(/^\s+-\s+(.+)$/);
            if (itemMatch) {
                const arr = result[currentKey];
                if (Array.isArray(arr)) {
                    arr.push(itemMatch[1].trim());
                }
            }
        }
    }
    return result;
}

function buildFrontmatter(fields: Record<string, string | string[]>): string | null {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
        if (Array.isArray(value)) {
            if (value.length === 0) continue;
            lines.push(`${key}:`);
            for (const item of value) {
                if (item.trim()) lines.push(`  - ${item.trim()}`);
            }
        } else {
            const trimmed = (value ?? '').trim();
            if (!trimmed) continue;
            lines.push(`${key}: ${trimmed}`);
        }
    }
    if (lines.length === 0) return null;
    return `---\n${lines.join('\n')}\n---`;
}

// ---------------------------------------------------------------------------
// Schedule types
// ---------------------------------------------------------------------------

type InlineTaskSchedule =
    | { type: 'cron'; expression: string }
    | { type: 'window'; cron: string; startTime: string; endTime: string }
    | { type: 'once'; runAt: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashInstruction(instruction: string): string {
    return crypto.createHash('sha256').update(instruction).digest('hex').slice(0, 8);
}

function scanDirectoryRecursive(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const files: string[] = [];
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            files.push(...scanDirectoryRecursive(fullPath));
        } else if (stat.isFile() && entry.endsWith('.md')) {
            files.push(fullPath);
        }
    }
    return files;
}

/**
 * Wait for a run to complete by listening for run-processing-end event
 */
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

/**
 * Extract the assistant's final text response from a run's log.
 */
async function extractAgentResponse(runId: string): Promise<string | null> {
    const run = await fetchRun(runId);
    // Walk backwards through the log to find the last assistant message
    for (let i = run.log.length - 1; i >= 0; i--) {
        const event = run.log[i];
        if (event.type === 'message' && event.message.role === 'assistant') {
            const content = event.message.content;
            if (typeof content === 'string') {
                return content;
            }
            // Content may be an array of parts — concatenate text parts
            if (Array.isArray(content)) {
                const text = content
                    .filter((p) => p.type === 'text')
                    .map((p) => (p as { type: 'text'; text: string }).text)
                    .join('');
                return text || null;
            }
        }
    }
    return null;
}

interface InlineTask {
    instruction: string;
    hash: string;
    schedule: InlineTaskSchedule | null;
    /** Line index of the opening ```tell-rowboat fence in the body */
    startLine: number;
    /** Line index of the closing ``` fence */
    endLine: number;
}

/**
 * Parse the rowboat_tasks frontmatter into a hash→lastRunAt map.
 * Supports both formats:
 *   - New: hash: "ISO timestamp" (value is a timestamp string)
 *   - Old: flat list of hashes (value is just the hash itself in an array)
 */
function parseTaskRecords(fields: Record<string, string | string[]>): Record<string, string | null> {
    const records: Record<string, string | null> = {};
    const raw = fields['rowboat_tasks'];
    if (!raw) return records;

    if (Array.isArray(raw)) {
        // Old format: list of hashes, or new format as key: value lines
        // In the old format, each entry is just a hash string
        // In the new key-value format parsed as list, entries look like "hash: timestamp"
        for (const entry of raw) {
            const kvMatch = entry.match(/^([a-f0-9]+):\s*"?(.+?)"?$/);
            if (kvMatch) {
                // New format: "a1b2c3d4: 2026-03-05T08:00:00"
                records[kvMatch[1]] = kvMatch[2];
            } else if (/^[a-f0-9]+$/.test(entry.trim())) {
                // Old format: just a hash
                records[entry.trim()] = null;
            }
        }
    } else if (typeof raw === 'string') {
        // Single value — old format (just a hash) or new key:value
        const kvMatch = raw.match(/^([a-f0-9]+):\s*"?(.+?)"?$/);
        if (kvMatch) {
            records[kvMatch[1]] = kvMatch[2];
        } else if (/^[a-f0-9]+$/.test(raw.trim())) {
            records[raw.trim()] = null;
        }
    }
    return records;
}

/**
 * Build rowboat_tasks frontmatter lines from the records map.
 * Stored as a list:
 *   rowboat_tasks:
 *     - a1b2c3d4: "2026-03-05T08:00:00"
 */
function buildTaskRecordsList(records: Record<string, string | null>): string[] {
    const list: string[] = [];
    for (const [hash, timestamp] of Object.entries(records)) {
        if (timestamp) {
            list.push(`${hash}: "${timestamp}"`);
        } else {
            // Legacy entry — store hash with current time
            list.push(`${hash}: "${new Date().toISOString()}"`);
        }
    }
    return list;
}

/**
 * Parse the schedule JSON from a `schedule: {...}` line.
 */
function parseScheduleLine(line: string): InlineTaskSchedule | null {
    const match = line.match(/^schedule:\s*(.+)$/);
    if (!match) return null;
    try {
        const obj = JSON.parse(match[1]);
        if (obj && typeof obj === 'object' && obj.type) {
            return obj as InlineTaskSchedule;
        }
    } catch {
        // Invalid JSON
    }
    return null;
}

/**
 * Determine if a scheduled task is due to run.
 */
function isScheduledTaskDue(schedule: InlineTaskSchedule, lastRunAt: string | null): boolean {
    const now = new Date();

    switch (schedule.type) {
        case 'cron': {
            if (!lastRunAt) return true; // Never run → due
            try {
                const lastRun = new Date(lastRunAt);
                const interval = CronExpressionParser.parse(schedule.expression, {
                    currentDate: lastRun,
                });
                const nextRun = interval.next().toDate();
                return now >= nextRun;
            } catch {
                return false;
            }
        }
        case 'window': {
            if (!lastRunAt) return true;
            try {
                const lastRun = new Date(lastRunAt);
                const interval = CronExpressionParser.parse(schedule.cron, {
                    currentDate: lastRun,
                });
                const nextDate = interval.next().toDate();

                // Check if we're within the time window
                const [startHour, startMin] = schedule.startTime.split(':').map(Number);
                const [endHour, endMin] = schedule.endTime.split(':').map(Number);
                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;
                const nowMinutes = now.getHours() * 60 + now.getMinutes();

                // The cron date must have passed and we need to be in the time window
                return now >= nextDate && nowMinutes >= startMinutes && nowMinutes <= endMinutes;
            } catch {
                return false;
            }
        }
        case 'once': {
            if (lastRunAt) return false; // Already ran
            const runAt = new Date(schedule.runAt);
            return now >= runAt;
        }
    }
}

/**
 * Find ```tell-rowboat code blocks in a note body and return tasks that are pending execution.
 */
function findPendingTasks(body: string, taskRecords: Record<string, string | null>): InlineTask[] {
    const tasks: InlineTask[] = [];
    const lines = body.split('\n');
    let i = 0;
    while (i < lines.length) {
        if (lines[i].trim() === '```tell-rowboat') {
            const startLine = i;
            i++;
            const contentLines: string[] = [];
            while (i < lines.length && lines[i].trim() !== '```') {
                contentLines.push(lines[i]);
                i++;
            }
            const endLine = i; // line with closing ```

            // Separate instruction lines from schedule line
            let schedule: InlineTaskSchedule | null = null;
            const instructionLines: string[] = [];
            for (const cl of contentLines) {
                const parsed = parseScheduleLine(cl.trim());
                if (parsed) {
                    schedule = parsed;
                } else {
                    instructionLines.push(cl);
                }
            }

            const rawInstruction = instructionLines.join('\n').trim();
            // Strip leading @rowboat prefix if present
            const instruction = rawInstruction.replace(/^@rowboat:?\s*/, '');
            if (instruction) {
                const hash = hashInstruction(instruction);
                const lastRunAt = taskRecords[hash] ?? null;

                if (schedule) {
                    // Scheduled task — check if due
                    if (isScheduledTaskDue(schedule, lastRunAt)) {
                        tasks.push({ instruction, hash, schedule, startLine, endLine });
                    }
                } else {
                    // One-time task — pending if not in records
                    if (!(hash in taskRecords)) {
                        tasks.push({ instruction, hash, schedule: null, startLine, endLine });
                    }
                }
            }
        }
        i++;
    }
    return tasks;
}

/**
 * Insert the agent result below the tell-rowboat code block in the body.
 * Returns the updated body string.
 */
function insertResultBelow(body: string, endLine: number, result: string): string {
    const lines = body.split('\n');
    // Insert a blank line + result after the closing ``` fence
    lines.splice(endLine + 1, 0, '', result);
    return lines.join('\n');
}

/**
 * Mark a completed one-time task by adding a ✓ prefix to the @rowboat instruction line.
 */
function markBlockDone(body: string, startLine: number, endLine: number): string {
    const lines = body.split('\n');
    for (let i = startLine + 1; i < endLine; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('schedule:') || line.includes('✓')) continue;
        if (line.trim()) {
            lines[i] = line.replace('@rowboat', '✓ @rowboat');
            break;
        }
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main processing
// ---------------------------------------------------------------------------

async function processInlineTasks(): Promise<void> {
    console.log('[InlineTasks] Checking for tell-rowboat blocks...');

    if (!fs.existsSync(KNOWLEDGE_DIR)) {
        console.log('[InlineTasks] Knowledge directory not found');
        return;
    }

    const allFiles = scanDirectoryRecursive(KNOWLEDGE_DIR);
    let totalProcessed = 0;

    for (const filePath of allFiles) {
        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }

        // Quick check — skip files with no tell-rowboat block
        if (!content.includes('```tell-rowboat')) continue;

        const { raw, body } = splitFrontmatter(content);
        const fields = extractAllFrontmatterValues(raw);

        // Parse task records (hash → lastRunAt)
        const taskRecords = parseTaskRecords(fields);

        const tasks = findPendingTasks(body, taskRecords);
        if (tasks.length === 0) continue;

        const relativePath = path.relative(WorkDir, filePath);
        console.log(`[InlineTasks] Found ${tasks.length} pending task(s) in ${relativePath}`);

        // Process tasks one at a time, bottom-up so line indices stay valid
        // (inserting content shifts lines below, so process from bottom to top)
        const sortedTasks = [...tasks].sort((a, b) => b.endLine - a.endLine);

        let currentBody = body;

        for (const task of sortedTasks) {
            console.log(`[InlineTasks] Running task: "${task.instruction.slice(0, 80)}..." (${task.hash})`);

            try {
                const run = await createRun({ agentId: INLINE_TASK_AGENT });

                const message = [
                    `Execute the following instruction from the note "${relativePath}":`,
                    '',
                    `**Instruction:** ${task.instruction}`,
                    '',
                    '**Full note content for context:**',
                    '```markdown',
                    content,
                    '```',
                ].join('\n');

                await createMessage(run.id, message);
                await waitForRunCompletion(run.id);

                const result = await extractAgentResponse(run.id);
                if (result) {
                    // Strike through one-time tasks so user knows it's done
                    if (!task.schedule) {
                        currentBody = markBlockDone(currentBody, task.startLine, task.endLine);
                    }
                    currentBody = insertResultBelow(currentBody, task.endLine, result);
                    // Record with current timestamp
                    taskRecords[task.hash] = new Date().toISOString();
                    totalProcessed++;
                    console.log(`[InlineTasks] Task ${task.hash} completed`);
                } else {
                    console.warn(`[InlineTasks] No response from agent for task ${task.hash}`);
                }
            } catch (error) {
                console.error(`[InlineTasks] Error processing task ${task.hash}:`, error);
            }
        }

        // Update frontmatter with task records
        fields['rowboat_tasks'] = buildTaskRecordsList(taskRecords);
        const newRaw = buildFrontmatter(fields);
        const newContent = joinFrontmatter(newRaw, currentBody);

        try {
            fs.writeFileSync(filePath, newContent, 'utf-8');
            console.log(`[InlineTasks] Updated ${relativePath}`);
        } catch (error) {
            console.error(`[InlineTasks] Error writing ${relativePath}:`, error);
        }
    }

    if (totalProcessed > 0) {
        console.log(`[InlineTasks] Done. Processed ${totalProcessed} task(s).`);
    } else {
        console.log('[InlineTasks] No pending tasks found');
    }
}

/**
 * Classify whether an instruction contains a scheduling intent using the user's configured LLM.
 * Returns a schedule object or null for one-time tasks.
 */
export async function classifySchedule(instruction: string): Promise<InlineTaskSchedule | null> {
    const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
    const config = await repo.getConfig();
    const provider = createProvider(config.provider);
    const model = provider.languageModel(config.model);

    const systemPrompt = `You classify whether a user instruction contains a scheduling intent.

If the instruction implies a recurring or future-scheduled task, return a JSON object with the schedule.
If the instruction is a one-time immediate task, return null.

Schedule types:
1. "cron" — recurring schedule. Return: {"type":"cron","expression":"<cron expression>"}
   Use standard 5-field cron (minute hour day-of-month month day-of-week).
   Examples: "every morning at 8am" → "0 8 * * *", "every Monday at 9am" → "0 9 * * 1"

2. "window" — recurring with a time window. Return: {"type":"window","cron":"<cron for the day pattern>","startTime":"HH:MM","endTime":"HH:MM"}
   Use when the user specifies a range like "between 8am and 10am".

3. "once" — run once at a specific future time. Return: {"type":"once","runAt":"<ISO 8601 datetime>"}
   Use when the user says "tomorrow at 3pm", "next Friday", etc.

Current date/time: ${new Date().toISOString()}

Respond with ONLY valid JSON: either a schedule object or null. No other text.`;

    try {
        const result = await generateText({
            model,
            system: systemPrompt,
            prompt: instruction,
        });

        const text = result.text.trim();
        if (text === 'null' || text === '') {
            return null;
        }

        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || !parsed.type) {
            return null;
        }

        return parsed as InlineTaskSchedule;
    } catch (error) {
        console.error('[classifySchedule] Error:', error);
        return null;
    }
}

/**
 * Main entry point — runs as independent polling service
 */
export async function init() {
    console.log('[InlineTasks] Starting Inline Task Service...');
    console.log(`[InlineTasks] Will check for tell-rowboat blocks every ${SYNC_INTERVAL_MS / 1000} seconds`);

    // Initial run
    await processInlineTasks();

    // Periodic polling
    while (true) {
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));

        try {
            await processInlineTasks();
        } catch (error) {
            console.error('[InlineTasks] Error in main loop:', error);
        }
    }
}
