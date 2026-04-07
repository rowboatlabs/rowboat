import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage } from '../runs/runs.js';
import { bus } from '../runs/bus.js';
import { serviceLogger } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import {
    loadNoteTaggingState,
    saveNoteTaggingState,
    markNoteAsTagged,
    type NoteTaggingState,
} from './note_tagging_state.js';
import { getNoteTypeDefinitions } from './note_system.js';

const SYNC_INTERVAL_MS = 15 * 1000; // 15 seconds
const BATCH_SIZE = 15;
const NOTE_TAGGING_AGENT = 'note_tagging_agent';
const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const MAX_CONTENT_LENGTH = 8000;

/**
 * Find knowledge notes that haven't been tagged yet
 */
function getUntaggedNotes(state: NoteTaggingState): string[] {
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
        return [];
    }

    const untagged: string[] = [];
    const noteFolders = getNoteTypeDefinitions().map(d => d.folder);

    function scanDir(dir: string) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                scanDir(fullPath);
                continue;
            }

            if (!stat.isFile() || !entry.endsWith('.md')) {
                continue;
            }

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

            untagged.push(fullPath);
        }
    }

    for (const folder of noteFolders) {
        const folderPath = path.join(KNOWLEDGE_DIR, folder);
        if (!fs.existsSync(folderPath)) {
            continue;
        }
        scanDir(folderPath);
    }

    return untagged;
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
 * Tag a batch of note files using the tagging agent
 */
async function tagNoteBatch(
    files: { path: string; content: string }[]
): Promise<{ runId: string; filesEdited: Set<string> }> {
    const run = await createRun({
        agentId: NOTE_TAGGING_AGENT,
    });

    let message = `Tag the following ${files.length} knowledge notes by prepending YAML frontmatter with appropriate tags.\n\n`;
    message += `**Important:** Use workspace-relative paths with workspace-edit (e.g. "knowledge/People/Sarah Chen.md", NOT absolute paths).\n\n`;

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
 * Process all untagged notes in batches
 */
export async function processUntaggedNotes(): Promise<void> {
    console.log('[NoteTagging] Checking for untagged notes...');

    const state = loadNoteTaggingState();
    const untagged = getUntaggedNotes(state);

    if (untagged.length === 0) {
        console.log('[NoteTagging] No untagged notes found');
        return;
    }

    console.log(`[NoteTagging] Found ${untagged.length} untagged notes`);

    const run = await serviceLogger.startRun({
        service: 'note_tagging',
        message: `Tagging ${untagged.length} note${untagged.length === 1 ? '' : 's'}`,
        trigger: 'timer',
    });

    const relativeFiles = untagged.map(f => path.relative(WorkDir, f));
    const limitedFiles = limitEventItems(relativeFiles);
    await serviceLogger.log({
        type: 'changes_identified',
        service: run.service,
        runId: run.runId,
        level: 'info',
        message: `Found ${untagged.length} untagged note${untagged.length === 1 ? '' : 's'}`,
        counts: { notes: untagged.length },
        items: limitedFiles.items,
        truncated: limitedFiles.truncated,
    });

    const totalBatches = Math.ceil(untagged.length / BATCH_SIZE);
    let totalEdited = 0;
    let hadError = false;

    for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
        const batchPaths = untagged.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        try {
            const files: { path: string; content: string }[] = [];
            for (const filePath of batchPaths) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    files.push({ path: filePath, content });
                } catch (error) {
                    console.error(`[NoteTagging] Error reading ${filePath}:`, error);
                }
            }

            if (files.length === 0) {
                continue;
            }

            console.log(`[NoteTagging] Processing batch ${batchNumber}/${totalBatches} (${files.length} files)`);
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

            const result = await tagNoteBatch(files);
            totalEdited += result.filesEdited.size;

            // Only mark files that were actually edited by the agent
            for (const file of files) {
                const relativePath = path.relative(WorkDir, file.path);
                if (result.filesEdited.has(relativePath)) {
                    markNoteAsTagged(file.path, state);
                }
            }

            saveNoteTaggingState(state);
            console.log(`[NoteTagging] Batch ${batchNumber}/${totalBatches} complete, ${result.filesEdited.size} files tagged`);
        } catch (error) {
            hadError = true;
            console.error(`[NoteTagging] Error processing batch ${batchNumber}:`, error);
            await serviceLogger.log({
                type: 'error',
                service: run.service,
                runId: run.runId,
                level: 'error',
                message: `Error processing batch ${batchNumber}`,
                error: error instanceof Error ? error.message : String(error),
                context: { batchNumber },
            });
        }
    }

    state.lastRunTime = new Date().toISOString();
    saveNoteTaggingState(state);

    await serviceLogger.log({
        type: 'run_complete',
        service: run.service,
        runId: run.runId,
        level: hadError ? 'error' : 'info',
        message: `Note tagging complete: ${totalEdited} notes tagged`,
        durationMs: Date.now() - run.startedAt,
        outcome: hadError ? 'error' : 'ok',
        summary: {
            totalNotes: untagged.length,
            notesTagged: totalEdited,
        },
    });

    console.log(`[NoteTagging] Done. ${totalEdited} notes tagged.`);
}

/**
 * Main entry point - runs as independent polling service
 */
export async function init() {
    console.log('[NoteTagging] Starting Note Tagging Service...');
    console.log(`[NoteTagging] Will check for untagged notes every ${SYNC_INTERVAL_MS / 1000} seconds`);

    // Initial run
    await processUntaggedNotes();

    // Periodic polling
    while (true) {
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));

        try {
            await processUntaggedNotes();
        } catch (error) {
            console.error('[NoteTagging] Error in main loop:', error);
        }
    }
}
