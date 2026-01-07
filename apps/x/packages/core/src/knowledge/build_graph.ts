import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage } from '../runs/runs.js';
import { bus } from '../runs/bus.js';

/**
 * Build obsidian-style knowledge graph by running topic extraction
 * and note creation agents sequentially on content files
 */

const KNOWLEDGE_SOURCE_DIR = path.join(WorkDir, 'gmail_sync');
const NOTES_OUTPUT_DIR = path.join(WorkDir, 'notes');
const NOTE_CREATION_AGENT = 'note_creation';

/**
 * Read all markdown files from the knowledge source directory
 */
async function getContentFiles(): Promise<{ path: string; content: string }[]> {
    if (!fs.existsSync(KNOWLEDGE_SOURCE_DIR)) {
        console.log(`Knowledge source directory not found: ${KNOWLEDGE_SOURCE_DIR}`);
        return [];
    }

    const files: { path: string; content: string }[] = [];
    const entries = fs.readdirSync(KNOWLEDGE_SOURCE_DIR);

    for (const entry of entries) {
        const fullPath = path.join(KNOWLEDGE_SOURCE_DIR, entry);
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
 * Run note creation agent on content to extract entities and create/update notes
 */
async function createNotes(content: string, sourceFile: string): Promise<string> {
    // Ensure notes output directory exists
    if (!fs.existsSync(NOTES_OUTPUT_DIR)) {
        fs.mkdirSync(NOTES_OUTPUT_DIR, { recursive: true });
    }

    // Create a run for the note creation agent
    const run = await createRun({
        agentId: NOTE_CREATION_AGENT,
    });

    // Pass the content and source file info to the agent
    const message = `Process the following source file and create/update obsidian notes.

**Source file:** ${path.basename(sourceFile)}

**Instructions:**
- Extract entities (people, organizations, projects, topics)
- Create or update notes in "notes" directory (workspace-relative paths like "notes/People/Name.md")
- Use workspace tools to read existing notes and write updates
- Follow the note templates and guidelines in your instructions

**Content:**
${content}`;

    await createMessage(run.id, message);

    // Wait for the run to complete
    await waitForRunCompletion(run.id);

    return run.id;
}

/**
 * Build the knowledge graph from all content files
 */
export async function buildGraph(): Promise<void> {
    const contentFiles = await getContentFiles();

    if (contentFiles.length === 0) {
        return;
    }

    console.log(`Processing ${contentFiles.length} files for knowledge graph...`);

    // Process each file with the note creation agent
    // The agent will extract entities and create/update notes
    for (const file of contentFiles) {
        try {
            console.log(`Processing ${path.basename(file.path)}...`);
            await createNotes(file.content, file.path);
        } catch (error) {
            console.error(`Error processing ${path.basename(file.path)}:`, error);
            // Continue with next file
        }
    }

    console.log('Knowledge graph build complete');
}

/**
 * Main entry point
 */
export async function init() {
    await buildGraph();
}
