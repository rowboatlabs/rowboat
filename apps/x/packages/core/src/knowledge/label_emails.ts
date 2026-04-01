import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage } from '../runs/runs.js';
import { bus } from '../runs/bus.js';
import { serviceLogger } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import {
    loadLabelingState,
    saveLabelingState,
    markFileAsLabeled,
    type LabelingState,
} from './labeling_state.js';

const SYNC_INTERVAL_MS = 15 * 1000; // 15 seconds
const BATCH_SIZE = 15;
const DEFAULT_CONCURRENCY = 3;
const LABELING_AGENT = 'labeling_agent';
const GMAIL_SYNC_DIR = path.join(WorkDir, 'gmail_sync');
const MAX_CONTENT_LENGTH = 8000;

/**
 * Find email files that haven't been labeled yet
 */
function getUnlabeledEmails(state: LabelingState): string[] {
    if (!fs.existsSync(GMAIL_SYNC_DIR)) {
        return [];
    }

    const unlabeled: string[] = [];

    function traverse(dir: string) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                traverse(fullPath);
            } else if (stat.isFile() && entry.endsWith('.md')) {
                // Skip if already tracked in state
                if (state.processedFiles[fullPath]) {
                    continue;
                }

                // Skip if file already has frontmatter
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    if (content.startsWith('---')) {
                        continue;
                    }
                } catch {
                    continue;
                }

                unlabeled.push(fullPath);
            }
        }
    }

    traverse(GMAIL_SYNC_DIR);
    return unlabeled;
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
 * Label a batch of email files using the labeling agent
 */
async function labelEmailBatch(
    files: { path: string; content: string }[]
): Promise<{ runId: string; filesEdited: Set<string> }> {
    const run = await createRun({
        agentId: LABELING_AGENT,
    });

    let message = `Label the following ${files.length} email files by prepending YAML frontmatter.\n\n`;
    message += `**Important:** Use workspace-relative paths with workspace-edit (e.g. "gmail_sync/email.md", NOT absolute paths).\n\n`;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = path.relative(WorkDir, file.path);
        const truncated = file.content.length > MAX_CONTENT_LENGTH
            ? file.content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[... content truncated, use workspace-readFile for full content ...]'
            : file.content;

        message += `## File ${i + 1}: ${relativePath}\n\n`;
        message += truncated;
        message += `\n\n---\n\n`;
    }

    const filesEdited = new Set<string>();

    const unsubscribe = await bus.subscribe(run.id, async (event) => {
        if (event.type !== 'tool-invocation') {
            return;
        }
        if (event.toolName !== 'workspace-edit') {
            return;
        }
        try {
            const parsed = JSON.parse(event.input) as { path?: string };
            if (typeof parsed.path === 'string') {
                filesEdited.add(parsed.path);
            }
        } catch {
            // ignore parse errors
        }
    });

    await createMessage(run.id, message);
    await waitForRunCompletion(run.id);
    unsubscribe();

    return { runId: run.id, filesEdited };
}

/**
 * Process all unlabeled emails in batches
 */
export async function processUnlabeledEmails(concurrency: number = DEFAULT_CONCURRENCY): Promise<void> {
    console.log('[EmailLabeling] Checking for unlabeled emails...');

    const state = loadLabelingState();
    const unlabeled = getUnlabeledEmails(state);

    if (unlabeled.length === 0) {
        console.log('[EmailLabeling] No unlabeled emails found');
        return;
    }

    console.log(`[EmailLabeling] Found ${unlabeled.length} unlabeled emails (concurrency: ${concurrency})`);

    const run = await serviceLogger.startRun({
        service: 'email_labeling',
        message: `Labeling ${unlabeled.length} email${unlabeled.length === 1 ? '' : 's'}`,
        trigger: 'timer',
    });

    const relativeFiles = unlabeled.map(f => path.relative(WorkDir, f));
    const limitedFiles = limitEventItems(relativeFiles);
    await serviceLogger.log({
        type: 'changes_identified',
        service: run.service,
        runId: run.runId,
        level: 'info',
        message: `Found ${unlabeled.length} unlabeled email${unlabeled.length === 1 ? '' : 's'}`,
        counts: { emails: unlabeled.length },
        items: limitedFiles.items,
        truncated: limitedFiles.truncated,
    });

    // Build all batches upfront
    const batches: { batchNumber: number; files: { path: string; content: string }[] }[] = [];
    for (let i = 0; i < unlabeled.length; i += BATCH_SIZE) {
        const batchPaths = unlabeled.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const files: { path: string; content: string }[] = [];
        for (const filePath of batchPaths) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                files.push({ path: filePath, content });
            } catch (error) {
                console.error(`[EmailLabeling] Error reading ${filePath}:`, error);
            }
        }
        if (files.length > 0) {
            batches.push({ batchNumber, files });
        }
    }

    const totalBatches = batches.length;
    let totalEdited = 0;
    let hadError = false;

    // Process batches with concurrency limit
    for (let i = 0; i < batches.length; i += concurrency) {
        const chunk = batches.slice(i, i + concurrency);

        const promises = chunk.map(async ({ batchNumber, files }) => {
            try {
                console.log(`[EmailLabeling] Processing batch ${batchNumber}/${totalBatches} (${files.length} files)`);
                await serviceLogger.log({
                    type: 'progress',
                    service: run.service,
                    runId: run.runId,
                    level: 'info',
                    message: `Processing batch ${batchNumber}/${totalBatches} (${files.length} files)`,
                    step: 'batch',
                    current: batchNumber,
                    total: totalBatches,
                    details: { filesInBatch: files.length },
                });

                const result = await labelEmailBatch(files);

                // Only mark files that were actually edited by the agent
                for (const file of files) {
                    const relativePath = path.relative(WorkDir, file.path);
                    if (result.filesEdited.has(relativePath)) {
                        markFileAsLabeled(file.path, state);
                    }
                }

                console.log(`[EmailLabeling] Batch ${batchNumber}/${totalBatches} complete, ${result.filesEdited.size} files edited`);
                return result.filesEdited.size;
            } catch (error) {
                hadError = true;
                console.error(`[EmailLabeling] Error processing batch ${batchNumber}:`, error);
                await serviceLogger.log({
                    type: 'error',
                    service: run.service,
                    runId: run.runId,
                    level: 'error',
                    message: `Error processing batch ${batchNumber}`,
                    error: error instanceof Error ? error.message : String(error),
                    context: { batchNumber },
                });
                return 0;
            }
        });

        const results = await Promise.all(promises);
        totalEdited += results.reduce((sum, n) => sum + n, 0);

        // Save state after each concurrent chunk completes
        saveLabelingState(state);
    }

    state.lastRunTime = new Date().toISOString();
    saveLabelingState(state);

    await serviceLogger.log({
        type: 'run_complete',
        service: run.service,
        runId: run.runId,
        level: hadError ? 'error' : 'info',
        message: `Email labeling complete: ${totalEdited} files labeled`,
        durationMs: Date.now() - run.startedAt,
        outcome: hadError ? 'error' : 'ok',
        summary: {
            totalEmails: unlabeled.length,
            filesLabeled: totalEdited,
        },
    });

    console.log(`[EmailLabeling] Done. ${totalEdited} emails labeled.`);
}

/**
 * Main entry point - runs as independent polling service
 */
export async function init() {
    console.log('[EmailLabeling] Starting Email Labeling Service...');
    console.log(`[EmailLabeling] Will check for unlabeled emails every ${SYNC_INTERVAL_MS / 1000} seconds`);

    // Initial run
    await processUnlabeledEmails();

    // Periodic polling
    while (true) {
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));

        try {
            await processUnlabeledEmails();
        } catch (error) {
            console.error('[EmailLabeling] Error in main loop:', error);
        }
    }
}
