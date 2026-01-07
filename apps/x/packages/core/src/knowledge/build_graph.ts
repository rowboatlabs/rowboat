import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage } from '../runs/runs.js';
import { bus } from '../runs/bus.js';

/**
 * Build obsidian-style knowledge graph by running topic extraction
 * and note creation agents sequentially on content files
 */

const NOTES_OUTPUT_DIR = path.join(WorkDir, 'notes');
const NOTE_CREATION_AGENT = 'note_creation';

/**
 * Read all markdown files from the specified source directory
 */
async function getContentFiles(sourceDir: string): Promise<{ path: string; content: string }[]> {
    if (!fs.existsSync(sourceDir)) {
        console.log(`Knowledge source directory not found: ${sourceDir}`);
        return [];
    }

    const files: { path: string; content: string }[] = [];
    const entries = fs.readdirSync(sourceDir);

    for (const entry of entries) {
        const fullPath = path.join(sourceDir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isFile() && entry.endsWith('.md')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            files.push({ path: fullPath, content });
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
    message += `- Create or update notes in "notes" directory (workspace-relative paths like "notes/People/Name.md")\n`;
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
 */
export async function buildGraph(sourceDir: string): Promise<void> {
    const contentFiles = await getContentFiles(sourceDir);

    if (contentFiles.length === 0) {
        console.log(`No files found in ${sourceDir}`);
        return;
    }

    const BATCH_SIZE = 10; // Process 10 emails per agent run
    const totalBatches = Math.ceil(contentFiles.length / BATCH_SIZE);

    console.log(`Processing ${contentFiles.length} files from ${path.basename(sourceDir)} in ${totalBatches} batches (${BATCH_SIZE} files per batch)...`);

    // Process files in batches
    for (let i = 0; i < contentFiles.length; i += BATCH_SIZE) {
        const batch = contentFiles.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        try {
            console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);
            await createNotesFromBatch(batch, batchNumber);
            console.log(`Batch ${batchNumber}/${totalBatches} complete`);
        } catch (error) {
            console.error(`Error processing batch ${batchNumber}:`, error);
            // Continue with next batch
        }
    }

    console.log('Knowledge graph build complete');
}

/**
 * Main entry point - processes gmail_sync directory by default
 */
export async function init() {
    const defaultSourceDir = path.join(WorkDir, 'gmail_sync');
    await buildGraph(defaultSourceDir);
}
