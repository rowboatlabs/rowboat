import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { autoConfigureStrictnessIfNeeded } from '../config/strictness_analyzer.js';
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
import { buildKnowledgeIndex, formatIndexForPrompt } from './knowledge_index.js';

/**
 * Build obsidian-style knowledge graph by running topic extraction
 * and note creation agents sequentially on content files
 */

const NOTES_OUTPUT_DIR = path.join(WorkDir, 'knowledge');
const NOTE_CREATION_AGENT = 'note_creation';

// Configuration for the graph builder service
const SYNC_INTERVAL_MS = 30 * 1000; // Check every 30 seconds
const SOURCE_FOLDERS = [
    'gmail_sync',
    'fireflies_transcripts',
    'granola_notes',
];

// Voice memos are now created directly in knowledge/Voice Memos/<date>/
const VOICE_MEMOS_KNOWLEDGE_DIR = path.join(NOTES_OUTPUT_DIR, 'Voice Memos');

/**
 * Get unprocessed voice memo files from knowledge/Voice Memos/
 * Voice memos are created directly in this directory by the UI.
 * Returns paths to files that need entity extraction.
 */
function getUnprocessedVoiceMemos(state: GraphState): string[] {
    console.log(`[GraphBuilder] Checking directory: ${VOICE_MEMOS_KNOWLEDGE_DIR}`);

    if (!fs.existsSync(VOICE_MEMOS_KNOWLEDGE_DIR)) {
        console.log(`[GraphBuilder] Directory does not exist`);
        return [];
    }

    const unprocessedFiles: string[] = [];

    // Scan date folders (e.g., 2026-02-03)
    const dateFolders = fs.readdirSync(VOICE_MEMOS_KNOWLEDGE_DIR);
    console.log(`[GraphBuilder] Found ${dateFolders.length} date folders: ${dateFolders.join(', ')}`);

    for (const dateFolder of dateFolders) {
        const dateFolderPath = path.join(VOICE_MEMOS_KNOWLEDGE_DIR, dateFolder);

        // Skip if not a directory
        try {
            if (!fs.statSync(dateFolderPath).isDirectory()) {
                continue;
            }
        } catch (err) {
            console.log(`[GraphBuilder] Error checking ${dateFolderPath}:`, err);
            continue;
        }

        // Scan markdown files in this date folder
        const files = fs.readdirSync(dateFolderPath);
        console.log(`[GraphBuilder] Found ${files.length} files in ${dateFolder}: ${files.join(', ')}`);

        for (const file of files) {
            // Only process voice memo markdown files
            if (!file.endsWith('.md') || !file.startsWith('voice-memo-')) {
                console.log(`[GraphBuilder] Skipping ${file} - not a voice memo file`);
                continue;
            }

            const filePath = path.join(dateFolderPath, file);

            // Skip if already processed
            if (state.processedFiles[filePath]) {
                console.log(`[GraphBuilder] Skipping ${file} - already processed`);
                continue;
            }

            // Check if the file has actual content (not still recording/transcribing)
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                // Skip files that are still recording or transcribing
                if (content.includes('*Recording in progress...*')) {
                    console.log(`[GraphBuilder] Skipping ${file} - still recording`);
                    continue;
                }
                if (content.includes('*Transcribing...*')) {
                    console.log(`[GraphBuilder] Skipping ${file} - still transcribing`);
                    continue;
                }
                if (content.includes('*Transcription failed')) {
                    console.log(`[GraphBuilder] Skipping ${file} - transcription failed`);
                    continue;
                }
                console.log(`[GraphBuilder] Found unprocessed voice memo: ${file}`);
                unprocessedFiles.push(filePath);
            } catch (err) {
                console.log(`[GraphBuilder] Error reading ${file}:`, err);
                continue;
            }
        }
    }

    console.log(`[GraphBuilder] Total unprocessed files: ${unprocessedFiles.length}`);
    return unprocessedFiles;
}

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
async function createNotesFromBatch(files: { path: string; content: string }[], batchNumber: number, knowledgeIndex: string): Promise<string> {
    // Ensure notes output directory exists
    if (!fs.existsSync(NOTES_OUTPUT_DIR)) {
        fs.mkdirSync(NOTES_OUTPUT_DIR, { recursive: true });
    }

    // Create a run for the note creation agent
    const run = await createRun({
        agentId: NOTE_CREATION_AGENT,
    });

    // Build message with index and all files in the batch
    let message = `Process the following ${files.length} source files and create/update obsidian notes.\n\n`;
    message += `**Instructions:**\n`;
    message += `- Use the KNOWLEDGE BASE INDEX below to resolve entities - DO NOT grep/search for existing notes\n`;
    message += `- Extract entities (people, organizations, projects, topics) from ALL files below\n`;
    message += `- Create or update notes in "knowledge" directory (workspace-relative paths like "knowledge/People/Name.md")\n`;
    message += `- If the same entity appears in multiple files, merge the information into a single note\n`;
    message += `- Use workspace tools to read existing notes (when you need full content) and write updates\n`;
    message += `- Follow the note templates and guidelines in your instructions\n\n`;

    // Add the knowledge base index
    message += `---\n\n`;
    message += knowledgeIndex;
    message += `\n---\n\n`;

    // Add each file's content
    message += `# Source Files to Process\n\n`;
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
            // Build fresh index before each batch to include notes from previous batches
            console.log(`Building knowledge index for batch ${batchNumber}...`);
            const indexStartTime = Date.now();
            const index = buildKnowledgeIndex();
            const indexForPrompt = formatIndexForPrompt(index);
            const indexDuration = ((Date.now() - indexStartTime) / 1000).toFixed(2);
            console.log(`Index built in ${indexDuration}s: ${index.people.length} people, ${index.organizations.length} orgs, ${index.projects.length} projects, ${index.topics.length} topics, ${index.other.length} other`);

            console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);
            const agentStartTime = Date.now();
            await createNotesFromBatch(batch, batchNumber, indexForPrompt);
            const agentDuration = ((Date.now() - agentStartTime) / 1000).toFixed(2);
            console.log(`Batch ${batchNumber}/${totalBatches} complete in ${agentDuration}s`);

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
 * Process voice memos from knowledge/Voice Memos/ and run entity extraction on them
 * Voice memos are now created directly in the knowledge directory by the UI.
 */
async function processVoiceMemosForKnowledge(): Promise<boolean> {
    console.log(`[GraphBuilder] Starting voice memo processing...`);
    const state = loadState();

    // Get unprocessed voice memos from knowledge/Voice Memos/
    const unprocessedFiles = getUnprocessedVoiceMemos(state);

    if (unprocessedFiles.length === 0) {
        console.log(`[GraphBuilder] No unprocessed voice memos found`);
        return false;
    }

    console.log(`[GraphBuilder] Processing ${unprocessedFiles.length} voice memo transcripts for entity extraction...`);
    console.log(`[GraphBuilder] Files to process: ${unprocessedFiles.map(f => path.basename(f)).join(', ')}`);

    // Read the files
    const contentFiles = await readFileContents(unprocessedFiles);

    if (contentFiles.length === 0) {
        return false;
    }

    // Process in batches like other sources
    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(contentFiles.length / BATCH_SIZE);

    for (let i = 0; i < contentFiles.length; i += BATCH_SIZE) {
        const batch = contentFiles.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        try {
            // Build knowledge index
            console.log(`[GraphBuilder] Building knowledge index for batch ${batchNumber}...`);
            const index = buildKnowledgeIndex();
            const indexForPrompt = formatIndexForPrompt(index);

            console.log(`[GraphBuilder] Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);
            await createNotesFromBatch(batch, batchNumber, indexForPrompt);
            console.log(`[GraphBuilder] Batch ${batchNumber}/${totalBatches} complete`);

            // Mark files as processed
            for (const file of batch) {
                markFileAsProcessed(file.path, state);
            }

            // Save state after each batch
            saveState(state);
        } catch (error) {
            console.error(`[GraphBuilder] Error processing batch ${batchNumber}:`, error);
        }
    }

    // Update last build time
    state.lastBuildTime = new Date().toISOString();
    saveState(state);

    return true;
}

/**
 * Process all configured source directories
 */
async function processAllSources(): Promise<void> {
    console.log('[GraphBuilder] Checking for new content in all sources...');

    // Auto-configure strictness on first run if not already done
    autoConfigureStrictnessIfNeeded();

    let anyFilesProcessed = false;

    // Process voice memos first (they get moved to knowledge/)
    try {
        const voiceMemosProcessed = await processVoiceMemosForKnowledge();
        if (voiceMemosProcessed) {
            anyFilesProcessed = true;
        }
    } catch (error) {
        console.error('[GraphBuilder] Error processing voice memos:', error);
    }

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
    console.log(`[GraphBuilder] Monitoring folders: ${SOURCE_FOLDERS.join(', ')}, knowledge/Voice Memos`);
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
