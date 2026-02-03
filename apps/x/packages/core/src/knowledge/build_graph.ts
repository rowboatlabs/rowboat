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

// Voice memos are handled separately - they get moved to knowledge/Voice Memos/<date>/
const VOICE_MEMOS_DIR = path.join(WorkDir, 'voice_memos');
const VOICE_MEMOS_KNOWLEDGE_DIR = path.join(NOTES_OUTPUT_DIR, 'Voice Memos');

/**
 * Extract date from voice memo filename
 * Filename format: voice-memo-2026-02-03T04-56-53-182Z.txt
 * Returns date string like "2026-02-03"
 */
function extractDateFromVoiceMemoFilename(filename: string): string {
    // Match the date pattern: YYYY-MM-DD from voice-memo-YYYY-MM-DDTHH-MM-SS-MMMZ
    const match = filename.match(/voice-memo-(\d{4}-\d{2}-\d{2})T/);
    if (match) {
        return match[1];
    }
    // Fallback to current date if pattern doesn't match
    return new Date().toISOString().split('T')[0];
}

/**
 * Move voice memo transcripts to knowledge/Voice Memos/<date>/
 * Returns info about moved files for processing.
 */
function moveVoiceMemosToKnowledge(state: GraphState): { sourcePath: string; targetPath: string }[] {
    if (!fs.existsSync(VOICE_MEMOS_DIR)) {
        return [];
    }

    const movedFiles: { sourcePath: string; targetPath: string }[] = [];
    const entries = fs.readdirSync(VOICE_MEMOS_DIR);

    for (const entry of entries) {
        // Only process .txt transcript files
        if (!entry.endsWith('.txt')) {
            continue;
        }

        const sourcePath = path.join(VOICE_MEMOS_DIR, entry);

        // Skip if already processed (check by source path)
        if (state.processedFiles[sourcePath]) {
            continue;
        }

        // Extract date and create target directory
        const date = extractDateFromVoiceMemoFilename(entry);
        const targetDir = path.join(VOICE_MEMOS_KNOWLEDGE_DIR, date);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Convert .txt to .md and create a proper markdown file
        const baseName = entry.replace('.txt', '');
        const targetPath = path.join(targetDir, `${baseName}.md`);

        // Read original content and wrap in markdown format
        const originalContent = fs.readFileSync(sourcePath, 'utf-8');

        // Create a relative path for linking (from knowledge/ root)
        const relativePath = `Voice Memos/${date}/${baseName}`;

        const mdContent = `# Voice Memo - ${date}

**Type:** voice memo
**Recorded:** ${date}
**Path:** ${relativePath}

## Transcript

${originalContent}
`;

        // Write to knowledge directory
        fs.writeFileSync(targetPath, mdContent);
        console.log(`[VoiceMemos] Moved transcript to ${targetPath}`);

        // Delete the original .txt file (it's been moved)
        fs.unlinkSync(sourcePath);

        movedFiles.push({ sourcePath, targetPath });
    }

    return movedFiles;
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
 * Process voice memos and run entity extraction on them
 */
async function processVoiceMemosForKnowledge(): Promise<boolean> {
    const state = loadState();

    // Move voice memos to knowledge directory
    const movedFiles = moveVoiceMemosToKnowledge(state);

    if (movedFiles.length === 0) {
        return false;
    }

    console.log(`[VoiceMemos] Processing ${movedFiles.length} voice memo transcripts for entity extraction...`);

    // Read the moved files
    const targetPaths = movedFiles.map(f => f.targetPath);
    const contentFiles = await readFileContents(targetPaths);

    if (contentFiles.length === 0) {
        return false;
    }

    // Process in batches like other sources
    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(contentFiles.length / BATCH_SIZE);

    for (let i = 0; i < contentFiles.length; i += BATCH_SIZE) {
        const batch = contentFiles.slice(i, i + BATCH_SIZE);
        const batchMovedFiles = movedFiles.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        try {
            // Build knowledge index
            console.log(`[VoiceMemos] Building knowledge index for batch ${batchNumber}...`);
            const index = buildKnowledgeIndex();
            const indexForPrompt = formatIndexForPrompt(index);

            console.log(`[VoiceMemos] Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);
            await createNotesFromBatch(batch, batchNumber, indexForPrompt);
            console.log(`[VoiceMemos] Batch ${batchNumber}/${totalBatches} complete`);

            // Mark files as processed using SOURCE path as key (to prevent reprocessing)
            for (const { sourcePath, targetPath } of batchMovedFiles) {
                markFileAsProcessed(targetPath, state);
                // Also track by source path so we don't reprocess if a new file with same name appears
                state.processedFiles[sourcePath] = state.processedFiles[targetPath];
            }

            // Save state after each batch
            saveState(state);
        } catch (error) {
            console.error(`[VoiceMemos] Error processing batch ${batchNumber}:`, error);
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
    console.log(`[GraphBuilder] Monitoring folders: ${SOURCE_FOLDERS.join(', ')}, voice_memos`);
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
