import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage } from '../runs/runs.js';
import { bus } from '../runs/bus.js';
import {
    loadState,
    saveState,
    getFilesToProcess,
    markFileAsProcessed,
    resetState,
    type GraphState,
} from './graph_state.js';

/**
 * Build obsidian-style knowledge graph by running topic extraction
 * and note creation agents sequentially on content files
 */

const NOTES_OUTPUT_DIR = path.join(WorkDir, 'knowledge');
const NOTE_CREATION_AGENT = 'note_creation';

// Configuration for the graph builder service
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes (reduced frequency)
const SOURCE_FOLDERS = [
    'gmail_sync',
    'fireflies_transcripts',
    'granola_notes'  // Corrected from 'granola_meetings'
];
const MAX_CONCURRENT_BATCHES = 1; // Process only 1 batch at a time to avoid overwhelming the agent
const BATCH_DELAY_MS = 5000; // 5 second delay between batches to avoid overwhelming the system

/**
 * Read content for specific files
 */
async function readFileContents(filePaths: string[]): Promise<{ path: string; content: string }[]> {
    const files: { path: string; content: string }[] = [];

    for (const filePath of filePaths) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            files.push({ path: filePath, content });
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
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
 * Run note creation agent on a batch of files to extract entities and create/update notes
 */
async function createNotesFromBatch(files: { path: string; content: string }[], batchNumber: number): Promise<string> {
    // Ensure notes output directory exists
    if (!fs.existsSync(NOTES_OUTPUT_DIR)) {
        fs.mkdirSync(NOTES_OUTPUT_DIR, { recursive: true });
    }

    // Create a run for the note creation agent
    const run = await createRun({
        agentId: NOTE_CREATION_AGENT,
    });

    // Build message with all files in the batch
    let message = `Process the following ${files.length} source files and create/update obsidian notes.\n\n`;
    message += `**Instructions:**\n`;
    message += `- Extract entities (people, organizations, projects, topics) from ALL files below\n`;
    message += `- Create or update notes in "knowledge" directory (workspace-relative paths like "knowledge/People/Name.md")\n`;
    message += `- If the same entity appears in multiple files, merge the information into a single note\n`;
    message += `- Use workspace tools to read existing notes and write updates\n`;
    message += `- Follow the note templates and guidelines in your instructions\n\n`;
    message += `---\n\n`;

    // Add each file's content
    files.forEach((file, idx) => {
        message += `## Source File ${idx + 1}: ${path.basename(file.path)}\n\n`;
        message += file.content;
        message += `\n\n---\n\n`;
    });

    await createMessage(run.id, message);

    // Wait for the run to complete
    await waitForRunCompletion(run.id);

    return run.id;
}

/**
 * Build the knowledge graph from all content files in the specified source directory
 * Only processes new or changed files based on state tracking
 */
export async function buildGraph(sourceDir: string): Promise<void> {
    console.log(`[buildGraph] Starting build for directory: ${sourceDir}`);

    // Load current state
    const state = loadState();
    const previouslyProcessedCount = Object.keys(state.processedFiles).length;
    console.log(`[buildGraph] State loaded. Previously processed: ${previouslyProcessedCount} files`);

    // Get files that need processing (new or changed)
    const filesToProcess = getFilesToProcess(sourceDir, state);

    if (filesToProcess.length === 0) {
        console.log(`[buildGraph] No new or changed files to process in ${path.basename(sourceDir)}`);
        return;
    }

    console.log(`[buildGraph] Found ${filesToProcess.length} new/changed files to process in ${path.basename(sourceDir)}`);

    // Read file contents
    const contentFiles = await readFileContents(filesToProcess);

    if (contentFiles.length === 0) {
        console.log(`No files could be read from ${sourceDir}`);
        return;
    }

    const BATCH_SIZE = 10; // Reduced from 25 to 10 files per agent run for faster processing
    const totalBatches = Math.ceil(contentFiles.length / BATCH_SIZE);

    console.log(`Processing ${contentFiles.length} files in ${totalBatches} batches (${BATCH_SIZE} files per batch)...`);

    // Process files in batches
    const processedFiles: string[] = [];
    for (let i = 0; i < contentFiles.length; i += BATCH_SIZE) {
        const batch = contentFiles.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        try {
            console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);
            await createNotesFromBatch(batch, batchNumber);
            console.log(`Batch ${batchNumber}/${totalBatches} complete`);

            // Add delay between batches to avoid overwhelming the system
            if (i + BATCH_SIZE < contentFiles.length) {
                console.log(`Waiting ${BATCH_DELAY_MS/1000} seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }

            // Mark files in this batch as processed
            for (const file of batch) {
                markFileAsProcessed(file.path, state);
                processedFiles.push(file.path);
            }

            // Save state after each successful batch
            // This ensures partial progress is saved even if later batches fail
            saveState(state);
        } catch (error) {
            console.error(`Error processing batch ${batchNumber}:`, error);
            // Continue with next batch (without saving state for failed batch)
        }
    }

    // Update state with last build time and save
    state.lastBuildTime = new Date().toISOString();
    saveState(state);

    console.log(`Knowledge graph build complete. Processed ${processedFiles.length} files.`);
}

/**
 * Process all configured source directories
 */
async function processAllSources(): Promise<void> {
    console.log('[GraphBuilder] Checking for new content in all sources...');

    let anyFilesProcessed = false;

    for (const folder of SOURCE_FOLDERS) {
        const sourceDir = path.join(WorkDir, folder);

        // Skip if folder doesn't exist
        if (!fs.existsSync(sourceDir)) {
            // Don't log this every time - it's noisy
            continue;
        }

        try {
            // Quick check if there are any files to process before doing the full build
            const state = loadState();
            const filesToProcess = getFilesToProcess(sourceDir, state);

            if (filesToProcess.length > 0) {
                console.log(`[GraphBuilder] Found ${filesToProcess.length} new/changed files in ${folder}`);
                await buildGraph(sourceDir);
                anyFilesProcessed = true;
            }
        } catch (error) {
            console.error(`[GraphBuilder] Error processing ${folder}:`, error);
            // Continue with other folders even if one fails
        }
    }

    if (!anyFilesProcessed) {
        console.log('[GraphBuilder] No new content to process');
    } else {
        console.log('[GraphBuilder] Completed processing all sources');
    }
}

/**
 * Main entry point - runs as independent service monitoring all source folders
 */
export async function init() {
    console.log('[GraphBuilder] Starting Knowledge Graph Builder Service...');
    console.log(`[GraphBuilder] Monitoring folders: ${SOURCE_FOLDERS.join(', ')}`);
    console.log(`[GraphBuilder] Will check for new content every ${SYNC_INTERVAL_MS / 1000} seconds`);

    // Initial run
    await processAllSources();

    // Set up periodic processing
    while (true) {
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));

        try {
            await processAllSources();
        } catch (error) {
            console.error('[GraphBuilder] Error in main loop:', error);
        }
    }
}

/**
 * Reset the knowledge graph state - forces reprocessing of all files on next run
 * Useful for debugging or when you want to rebuild everything from scratch
 */
export function resetGraphState(): void {
    console.log('Resetting knowledge graph state...');
    resetState();
    console.log('State reset complete. All files will be reprocessed on next build.');
}
