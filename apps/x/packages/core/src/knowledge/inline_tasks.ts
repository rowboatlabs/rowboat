import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage, fetchRun } from '../runs/runs.js';
import { bus } from '../runs/bus.js';

const SYNC_INTERVAL_MS = 60 * 1000; // 60 seconds
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
    /** Line index of the opening ```tell-rowboat fence in the body */
    startLine: number;
    /** Line index of the closing ``` fence */
    endLine: number;
}

/**
 * Find ```tell-rowboat code blocks in a note body and return tasks not yet completed.
 */
function findPendingTasks(body: string, completedHashes: string[]): InlineTask[] {
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
            const rawInstruction = contentLines.join('\n').trim();
            // Strip leading @rowboat prefix if present
            const instruction = rawInstruction.replace(/^@rowboat:?\s*/, '');
            if (instruction) {
                const hash = hashInstruction(instruction);
                if (!completedHashes.includes(hash)) {
                    tasks.push({ instruction, hash, startLine, endLine });
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

        // Get completed task hashes
        const completedRaw = fields['rowboat_tasks'];
        const completedHashes: string[] = Array.isArray(completedRaw)
            ? completedRaw
            : completedRaw
                ? [completedRaw]
                : [];

        const tasks = findPendingTasks(body, completedHashes);
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
                    currentBody = insertResultBelow(currentBody, task.endLine, result);
                    completedHashes.push(task.hash);
                    totalProcessed++;
                    console.log(`[InlineTasks] Task ${task.hash} completed`);
                } else {
                    console.warn(`[InlineTasks] No response from agent for task ${task.hash}`);
                }
            } catch (error) {
                console.error(`[InlineTasks] Error processing task ${task.hash}:`, error);
            }
        }

        // Update frontmatter with completed hashes
        fields['rowboat_tasks'] = completedHashes;
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
