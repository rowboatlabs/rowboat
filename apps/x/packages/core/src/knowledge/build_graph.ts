import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { getKgModel } from '../models/defaults.js';
import { runHeadlessAgent, toolInputPaths } from '../agents/headless-app.js';
import { getErrorDetails } from '../agents/utils.js';
import { serviceLogger, type ServiceRunContext } from '../services/service_logger.js';
import {
    loadState,
    saveState,
    getFilesToProcess,
    markFileAsProcessed,
    resetState,
    type GraphState,
} from './graph_state.js';
import { buildKnowledgeIndex, formatIndexForPrompt } from './knowledge_index.js';
import { limitEventItems } from './limit_event_items.js';
import { commitAll } from './version_history.js';
import { getTagDefinitions } from './tag_system.js';
import { knowledgeSourcesRepo } from './sources/repo.js';
import { syncSlackKnowledgeSources } from './sources/sync_slack.js';
import type { KnowledgeSourceConfig } from './sources/types.js';
import { loadUserConfig } from '../config/user_config.js';

/**
 * Build obsidian-style knowledge graph by running topic extraction
 * and note creation agents sequentially on content files
 */

const NOTES_OUTPUT_DIR = path.join(WorkDir, 'knowledge');
const NOTE_CREATION_AGENT = 'note_creation';
const SUGGESTED_TOPICS_REL_PATH = 'suggested-topics.md';
const SUGGESTED_TOPICS_PATH = path.join(WorkDir, 'suggested-topics.md');
const LEGACY_SUGGESTED_TOPICS_REL_PATH = 'config/suggested-topics.md';
const LEGACY_SUGGESTED_TOPICS_PATH = path.join(WorkDir, 'config', 'suggested-topics.md');
const LEGACY_SUGGESTED_TOPICS_KNOWLEDGE_REL_PATH = 'knowledge/Notes/Suggested Topics.md';
const LEGACY_SUGGESTED_TOPICS_KNOWLEDGE_PATH = path.join(WorkDir, 'knowledge', 'Notes', 'Suggested Topics.md');

// Configuration for the graph builder service
const SYNC_INTERVAL_MS = 15 * 1000; // 15 seconds
function getEnabledFileSources(): KnowledgeSourceConfig[] {
    return knowledgeSourcesRepo
        .listEnabledSources()
        .filter(source => source.provider !== 'voice_memo');
}

// Voice memos are now created directly in knowledge/Voice Memos/<date>/
const VOICE_MEMOS_KNOWLEDGE_DIR = path.join(NOTES_OUTPUT_DIR, 'Voice Memos');

/**
 * Check if email frontmatter contains any noise/skip filter tags.
 * Returns true if the email should be skipped.
 */
function hasNoiseLabels(content: string): boolean {
    if (!content.startsWith('---')) return false;

    const endIdx = content.indexOf('---', 3);
    if (endIdx === -1) return false;

    const frontmatter = content.slice(3, endIdx);

    const noiseTags = new Set(
        getTagDefinitions()
            .filter(t => t.type === 'noise')
            .map(t => t.tag)
    );

    // Match list items under filter: key
    const filterMatch = frontmatter.match(/filter:\s*\n((?:\s+-\s+.+\n?)*)/);
    if (filterMatch) {
        const filterLines = filterMatch[1].match(/^\s+-\s+(.+)$/gm);
        if (filterLines) {
            for (const line of filterLines) {
                const tag = line.replace(/^\s+-\s+/, '').trim().replace(/['"]/g, '');
                if (noiseTags.has(tag)) return true;
            }
        }
    }

    // Match inline array like filter: ['cold-outreach'] or filter: [cold-outreach]
    const inlineMatch = frontmatter.match(/filter:\s*\[([^\]]*)\]/);
    if (inlineMatch && inlineMatch[1].trim()) {
        const tags = inlineMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
        for (const tag of tags) {
            if (noiseTags.has(tag)) return true;
        }
    }

    return false;
}


function ensureSuggestedTopicsFileLocation(): string {
    if (fs.existsSync(SUGGESTED_TOPICS_PATH)) {
        return SUGGESTED_TOPICS_PATH;
    }

    const legacyCandidates: Array<{ absPath: string; relPath: string }> = [
        { absPath: LEGACY_SUGGESTED_TOPICS_PATH, relPath: LEGACY_SUGGESTED_TOPICS_REL_PATH },
        { absPath: LEGACY_SUGGESTED_TOPICS_KNOWLEDGE_PATH, relPath: LEGACY_SUGGESTED_TOPICS_KNOWLEDGE_REL_PATH },
    ];

    for (const legacy of legacyCandidates) {
        if (!fs.existsSync(legacy.absPath)) {
            continue;
        }

        try {
            fs.renameSync(legacy.absPath, SUGGESTED_TOPICS_PATH);
            console.log(`[buildGraph] Moved suggested topics file from ${legacy.relPath} to ${SUGGESTED_TOPICS_REL_PATH}`);
            return SUGGESTED_TOPICS_PATH;
        } catch (error) {
            console.error(`[buildGraph] Failed to move suggested topics file from ${legacy.relPath} to ${SUGGESTED_TOPICS_REL_PATH}:`, error);
            return legacy.absPath;
        }
    }

    return SUGGESTED_TOPICS_PATH;
}

function readSuggestedTopicsFile(): string {
    try {
        const suggestedTopicsPath = ensureSuggestedTopicsFileLocation();
        if (!fs.existsSync(suggestedTopicsPath)) {
            return '_No existing suggested topics file._';
        }

        const content = fs.readFileSync(suggestedTopicsPath, 'utf-8').trim();
        return content.length > 0 ? content : '_Existing suggested topics file is empty._';
    } catch (error) {
        console.error(`[buildGraph] Error reading suggested topics file:`, error);
        return '_Failed to read existing suggested topics file._';
    }
}

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

// Free-mail providers: a shared domain here does NOT mean two people are colleagues.
const FREE_MAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
    'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'hey.com', 'fastmail.com',
]);

/**
 * Build the "Owner of this memory" block injected into every note-creation /
 * curation run. The whole prompt's identity logic (self-exclusion, email reply
 * gate, first-person perspective, outbound-email handling) depends on the
 * agent knowing exactly who the user is — never make it guess from headers.
 */
export function buildOwnerBlock(): string {
    const user = loadUserConfig();
    const email = user?.email ?? '';
    const domainFromEmail = email.includes('@') ? email.split('@')[1].toLowerCase() : '';
    const domain = (user?.domain ?? domainFromEmail).toLowerCase();
    const isFreeMail = FREE_MAIL_DOMAINS.has(domain);

    // Optional profile lines from Agent Notes/user.md (e.g. role, company) —
    // gives the agent context like "the owner runs Rowboat" so it correctly
    // reads outbound product email as the owner's own actions.
    let profileLines = '';
    try {
        const userNotesPath = path.join(NOTES_OUTPUT_DIR, 'Agent Notes', 'user.md');
        if (fs.existsSync(userNotesPath)) {
            const lines = fs.readFileSync(userNotesPath, 'utf-8')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.startsWith('- '))
                // Strip "[timestamp]" prefixes for compactness
                .map(l => l.replace(/^- \[[^\]]*\]\s*/, '- '))
                .slice(0, 6);
            if (lines.length > 0) profileLines = lines.join('\n');
        }
    } catch {
        // profile lines are best-effort
    }

    let block = `# Owner Of This Memory (authoritative — do not infer identity from email headers)\n\n`;
    block += `- **Name:** ${user?.name || '(not set — resolve from the email address below when needed)'}\n`;
    block += `- **Email:** ${email || '(not set)'}\n`;
    block += `- **Email domain:** ${domain || '(not set)'}${isFreeMail ? ' (personal free-mail domain — do NOT treat same-domain senders as the owner\'s colleagues)' : ' (company domain — same-domain senders are the owner\'s teammates)'}\n`;
    if (profileLines) {
        block += `- **Profile:**\n${profileLines.split('\n').map(l => `  ${l}`).join('\n')}\n`;
    }
    block += `\nEvery note is written from this person's first-person perspective: "I"/"me"/"my" = the owner above. `;
    block += `Messages sent FROM the owner's address are the owner's own actions (including outbound sales/marketing/product email from their company). `;
    block += `Never create a People note for the owner, and never describe the owner in third person. Apply the "Owner Identity" rules in your instructions.\n`;
    return block;
}

/**
 * Compute the Email Reply Gate mechanically and stamp the verdict on each email
 * source. The gate ("cold inbound never creates notes") is the single most
 * important selectivity rule, and leaving it to the model's judgment proved
 * unreliable — 7 of 14 notes in one test corpus came from unanswered cold
 * outreach. Code decides "did the user's side ever send a message in this
 * thread"; the model only decides what the reply *means*.
 */
export function emailReplyGateBanner(filePath: string, content: string): string | null {
    // Only email sources have the ### From: thread structure.
    if (!filePath.split(path.sep).includes('gmail_sync')) return null;
    const user = loadUserConfig();
    if (!user?.email) return null;
    const email = user.email.toLowerCase();
    const domainRaw = (user.domain ?? email.split('@')[1] ?? '').toLowerCase();
    // On a free-mail domain, same-domain senders are strangers, not teammates.
    const teamDomain = domainRaw && !FREE_MAIL_DOMAINS.has(domainRaw) ? '@' + domainRaw : null;
    const froms = [...content.matchAll(/^### From: (.+)$/gm)].map(m => m[1].toLowerCase());
    if (froms.length === 0) return null;
    const replied = froms.some(f => f.includes(email) || (teamDomain !== null && f.includes(teamDomain)));
    return replied
        ? `> **REPLY-GATE (computed by the system, authoritative): the user HAS sent a message in this thread.** New People/Organization notes are allowed IF the user's reply shows real engagement AND the other gates pass. A decline, brush-off, or unsubscribe-style reply ("not interested", "please remove me", a bare "no thanks") is NOT engagement — treat those threads like purely inbound ones.`
        : `> **REPLY-GATE (computed by the system, authoritative): the user has NOT sent any message in this thread — purely inbound.** You MUST NOT create any new People or Organization note from this file, no matter how important the sender sounds. Allowed: updating notes that already exist, and suggestion cards in suggested-topics.md. Sole exception: a calendar invite for a real 1:1/small-group meeting scheduled with the user by name.`;
}

/**
 * Run note creation agent on a batch of files to extract entities and create/update notes
 */
async function createNotesFromBatch(
    files: { path: string; content: string }[],
    batchNumber: number,
    knowledgeIndex: string
): Promise<{ runId: string; notesCreated: Set<string>; notesModified: Set<string> }> {
    // Ensure notes output directory exists
    if (!fs.existsSync(NOTES_OUTPUT_DIR)) {
        fs.mkdirSync(NOTES_OUTPUT_DIR, { recursive: true });
    }

    const suggestedTopicsContent = readSuggestedTopicsFile();

    // Build message with owner identity, index, and all files in the batch
    let message = `Process the following ${files.length} source files and create/update obsidian notes.\n\n`;
    message += buildOwnerBlock();
    message += `\n---\n\n`;
    message += `**Instructions:**\n`;
    message += `- Use the KNOWLEDGE BASE INDEX below to resolve entities - DO NOT grep/search for existing notes\n`;
    message += `- Extract entities (people, organizations, projects, topics) from ALL files below\n`;
    message += `- The source files below are INDEPENDENT — they are batched only for efficiency. Two entities are related ONLY if they co-occur within the same single source file (or in an existing note). NEVER link entities just because they appear in this batch (see "Source Scoping" in your instructions)\n`;
    message += `- Create or update notes in "knowledge" directory (workspace-relative paths like "knowledge/People/Name.md")\n`;
    message += `- You may also create or update "${SUGGESTED_TOPICS_REL_PATH}" to maintain curated suggested-topic cards\n`;
    message += `- If the SAME entity appears in multiple files, merge the information into a single note (this is identity, not a relationship — do not link different entities across files)\n`;
    message += `- Use file tools to read existing notes or "${SUGGESTED_TOPICS_REL_PATH}" (when you need full content) and write updates\n`;
    message += `- Follow the note templates and guidelines in your instructions\n\n`;

    // Add the knowledge base index
    message += `---\n\n`;
    message += knowledgeIndex;
    message += `\n---\n\n`;

    message += `# Current Suggested Topics File\n\n`;
    message += `Path: ${SUGGESTED_TOPICS_REL_PATH}\n\n`;
    message += suggestedTopicsContent;
    message += `\n\n---\n\n`;

    // Add each file's content
    message += `# Source Files to Process\n\n`;
    files.forEach((file, idx) => {
        // Pass workspace-relative path so the agent can link back to meeting notes
        const relativePath = path.relative(WorkDir, file.path);
        message += `## Source File ${idx + 1}: ${relativePath}\n\n`;
        const gateBanner = emailReplyGateBanner(file.path, file.content);
        if (gateBanner) {
            message += gateBanner + `\n\n`;
        }
        message += file.content;
        message += `\n\n---\n\n`;
    });

    // Recency-position reminder: small models weight the end of the prompt
    // heavily, and the identity rules are the ones that corrupt the graph
    // when missed. Repeat the critical three right before generation.
    const user = loadUserConfig();
    if (user?.email) {
        const ownerLabel = user.name ? `${user.name} <${user.email}>` : user.email;
        message += `**FINAL REMINDER — the owner of this memory is ${ownerLabel}.** `;
        message += `(1) Never create or update a People note for them; in prose they are "I", never their name. `;
        message += `(2) Emails FROM ${user.email} are the owner's own actions ("I emailed…"), not an external contact. `;
        message += `(3) No placeholder text ("Unknown"/"-") and no links between entities that didn't co-occur in one source file.\n`;
    }

    const { turnId, state } = await runHeadlessAgent({
        agentId: NOTE_CREATION_AGENT,
        message,
        model: await getKgModel(),
        throwOnError: true,
    });

    // Created/modified paths come from the durable turn state instead of
    // streaming bus subscriptions.
    const notesCreated = toolInputPaths(state, ["file-writeText"]);
    const notesModified = toolInputPaths(state, ["file-editText"]);

    return { runId: turnId, notesCreated, notesModified };
}

/**
 * Build the knowledge graph from all content files in the specified source directory
 * Only processes new or changed files based on state tracking
 */
type BatchResult = {
    processedFiles: string[];
    notesCreated: Set<string>;
    notesModified: Set<string>;
    hadError: boolean;
};

async function buildGraphWithFiles(
    sourceDir: string,
    filesToProcess: string[],
    state: GraphState,
    run?: ServiceRunContext
): Promise<BatchResult> {
    console.log(`[buildGraph] Starting build for directory: ${sourceDir}`);

    if (filesToProcess.length === 0) {
        console.log(`[buildGraph] No new or changed files to process in ${path.basename(sourceDir)}`);
        return { processedFiles: [], notesCreated: new Set(), notesModified: new Set(), hadError: false };
    }

    console.log(`[buildGraph] Found ${filesToProcess.length} new/changed files to process in ${path.basename(sourceDir)}`);

    // Read file contents
    const contentFiles = await readFileContents(filesToProcess);

    if (contentFiles.length === 0) {
        console.log(`No files could be read from ${sourceDir}`);
        return { processedFiles: [], notesCreated: new Set(), notesModified: new Set(), hadError: false };
    }

    const BATCH_SIZE = 1; // One source file per agent run — prevents cross-file entity contamination in the graph
    const totalBatches = Math.ceil(contentFiles.length / BATCH_SIZE);

    console.log(`Processing ${contentFiles.length} files in ${totalBatches} batches (${BATCH_SIZE} files per batch)...`);

    const processedFiles: string[] = [];
    const notesCreated = new Set<string>();
    const notesModified = new Set<string>();
    let hadError = false;

    // Process files in batches
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
            if (run) {
                await serviceLogger.log({
                    type: 'progress',
                    service: run.service,
                    runId: run.runId,
                    level: 'info',
                    message: `Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)`,
                    step: 'batch',
                    current: batchNumber,
                    total: totalBatches,
                    details: { filesInBatch: batch.length },
                });
            }
            const agentStartTime = Date.now();
            const batchResult = await createNotesFromBatch(batch, batchNumber, indexForPrompt);
            const agentDuration = ((Date.now() - agentStartTime) / 1000).toFixed(2);
            console.log(`Batch ${batchNumber}/${totalBatches} complete in ${agentDuration}s`);

            for (const note of batchResult.notesCreated) {
                notesCreated.add(note);
            }
            for (const note of batchResult.notesModified) {
                notesModified.add(note);
            }

            // Mark files in this batch as processed
            for (const file of batch) {
                markFileAsProcessed(file.path, state);
                processedFiles.push(file.path);
            }

            // Save state after each successful batch
            // This ensures partial progress is saved even if later batches fail
            saveState(state);

            // Commit knowledge changes to version history
            try {
                await commitAll('Knowledge update', 'Rowboat');
            } catch (err) {
                console.error(`[GraphBuilder] Failed to commit version history:`, err);
            }
        } catch (error) {
            hadError = true;
            console.error(`Error processing batch ${batchNumber}:`, error);
            if (run) {
                await serviceLogger.log({
                    type: 'error',
                    service: run.service,
                    runId: run.runId,
                    level: 'error',
                    message: `Error processing batch ${batchNumber}`,
                    error: getErrorDetails(error),
                    context: { batchNumber },
                });
            }
            // Continue with next batch (without saving state for failed batch)
        }
    }

    // Update state with last build time and save
    state.lastBuildTime = new Date().toISOString();
    saveState(state);

    console.log(`Knowledge graph build complete. Processed ${processedFiles.length} files.`);
    return { processedFiles, notesCreated, notesModified, hadError };
}

export async function buildGraph(sourceDir: string): Promise<void> {
    console.log(`[buildGraph] Starting build for directory: ${sourceDir}`);

    // Load current state
    const state = loadState();
    const previouslyProcessedCount = Object.keys(state.processedFiles).length;
    console.log(`[buildGraph] State loaded. Previously processed: ${previouslyProcessedCount} files`);

    // Get files that need processing (new or changed)
    let filesToProcess = getFilesToProcess(sourceDir, state);

    // For gmail_sync, only process emails that have been labeled AND don't have noise filter tags
    if (sourceDir.endsWith('gmail_sync')) {
        filesToProcess = filesToProcess.filter(filePath => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                if (!content.startsWith('---')) return false;
                if (hasNoiseLabels(content)) {
                    console.log(`[buildGraph] Skipping noise email: ${path.basename(filePath)}`);
                    markFileAsProcessed(filePath, state);
                    return false;
                }
                return true;
            } catch {
                return false;
            }
        });
        saveState(state);
    }

    if (filesToProcess.length === 0) {
        console.log(`[buildGraph] No new or changed files to process in ${path.basename(sourceDir)}`);
        return;
    }

    await buildGraphWithFiles(sourceDir, filesToProcess, state);
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

    const run = await serviceLogger.startRun({
        service: 'voice_memo',
        message: `Processing ${unprocessedFiles.length} voice memo${unprocessedFiles.length === 1 ? '' : 's'}`,
        trigger: 'timer',
    });

    const relativeVoiceMemos = unprocessedFiles.map(filePath => path.relative(WorkDir, filePath));
    const limitedVoiceMemos = limitEventItems(relativeVoiceMemos);
    await serviceLogger.log({
        type: 'changes_identified',
        service: run.service,
        runId: run.runId,
        level: 'info',
        message: `Found ${unprocessedFiles.length} new voice memo${unprocessedFiles.length === 1 ? '' : 's'}`,
        counts: { voiceMemos: unprocessedFiles.length },
        items: limitedVoiceMemos.items,
        truncated: limitedVoiceMemos.truncated,
    });

    // Read the files
    const contentFiles = await readFileContents(unprocessedFiles);

    if (contentFiles.length === 0) {
        await serviceLogger.log({
            type: 'run_complete',
            service: run.service,
            runId: run.runId,
            level: 'info',
            message: 'No voice memos could be read',
            durationMs: Date.now() - run.startedAt,
            outcome: 'error',
            summary: { processedFiles: 0 },
        });
        return false;
    }

    // Process in batches like other sources
    const BATCH_SIZE = 1; // One source file per agent run — prevents cross-file entity contamination in the graph
    const totalBatches = Math.ceil(contentFiles.length / BATCH_SIZE);

    const notesCreated = new Set<string>();
    const notesModified = new Set<string>();
    let hadError = false;

    for (let i = 0; i < contentFiles.length; i += BATCH_SIZE) {
        const batch = contentFiles.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        try {
            // Build knowledge index
            console.log(`[GraphBuilder] Building knowledge index for batch ${batchNumber}...`);
            const index = buildKnowledgeIndex();
            const indexForPrompt = formatIndexForPrompt(index);

            console.log(`[GraphBuilder] Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);
            await serviceLogger.log({
                type: 'progress',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: `Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)`,
                step: 'batch',
                current: batchNumber,
                total: totalBatches,
                details: { filesInBatch: batch.length },
            });
            const batchResult = await createNotesFromBatch(batch, batchNumber, indexForPrompt);
            console.log(`[GraphBuilder] Batch ${batchNumber}/${totalBatches} complete`);

            for (const note of batchResult.notesCreated) {
                notesCreated.add(note);
            }
            for (const note of batchResult.notesModified) {
                notesModified.add(note);
            }

            // Mark files as processed
            for (const file of batch) {
                markFileAsProcessed(file.path, state);
            }

            // Save state after each batch
            saveState(state);

            // Commit knowledge changes to version history
            try {
                await commitAll('Knowledge update', 'Rowboat');
            } catch (err) {
                console.error(`[GraphBuilder] Failed to commit version history:`, err);
            }
        } catch (error) {
            hadError = true;
            console.error(`[GraphBuilder] Error processing batch ${batchNumber}:`, error);
            await serviceLogger.log({
                type: 'error',
                service: run.service,
                runId: run.runId,
                level: 'error',
                message: `Error processing voice memo batch ${batchNumber}`,
                error: getErrorDetails(error),
                context: { batchNumber },
            });
        }
    }

    // Update last build time
    state.lastBuildTime = new Date().toISOString();
    saveState(state);

    await serviceLogger.log({
        type: 'run_complete',
        service: run.service,
        runId: run.runId,
        level: hadError ? 'error' : 'info',
        message: `Voice memos processed: ${contentFiles.length} files, ${notesCreated.size} created, ${notesModified.size} updated`,
        durationMs: Date.now() - run.startedAt,
        outcome: hadError ? 'error' : 'ok',
        summary: {
            processedFiles: contentFiles.length,
            notesCreated: notesCreated.size,
            notesModified: notesModified.size,
        },
    });

    return true;
}

/**
 * Process all configured source directories
 */
export async function processAllSources(): Promise<void> {
    console.log('[GraphBuilder] Checking for new content in all sources...');


    let anyFilesProcessed = false;

    try {
        const slackFiles = await syncSlackKnowledgeSources();
        if (slackFiles.length > 0) {
            console.log(`[GraphBuilder] Slack sync wrote ${slackFiles.length} artifact files`);
        }
    } catch (error) {
        console.error('[GraphBuilder] Error syncing Slack knowledge sources:', error);
    }

    // Process voice memos first (they get moved to knowledge/)
    try {
        const voiceMemosProcessed = await processVoiceMemosForKnowledge();
        if (voiceMemosProcessed) {
            anyFilesProcessed = true;
        }
    } catch (error) {
        console.error('[GraphBuilder] Error processing voice memos:', error);
    }

    const state = loadState();
    const folderChanges: { source: KnowledgeSourceConfig; sourceDir: string; files: string[] }[] = [];
    const countsByFolder: Record<string, number> = {};
    const allFiles: string[] = [];
    const fileSources = getEnabledFileSources();

    for (const source of fileSources) {
        const sourceDir = path.join(WorkDir, source.artifactDir);

        // Skip if folder doesn't exist
        if (!fs.existsSync(sourceDir)) {
            // Don't log this every time - it's noisy
            continue;
        }

        try {
            let filesToProcess = getFilesToProcess(sourceDir, state);

            // For gmail_sync, only process emails that have been labeled AND don't have noise filter tags
            if (source.provider === 'gmail') {
                filesToProcess = filesToProcess.filter(filePath => {
                    try {
                        const content = fs.readFileSync(filePath, 'utf-8');
                        if (!content.startsWith('---')) return false;
                        if (hasNoiseLabels(content)) {
                            console.log(`[GraphBuilder] Skipping noise email: ${path.basename(filePath)}`);
                            markFileAsProcessed(filePath, state);
                            return false;
                        }
                        return true;
                    } catch {
                        return false;
                    }
                });
                saveState(state);
            }

            if (filesToProcess.length > 0) {
                console.log(`[GraphBuilder] Found ${filesToProcess.length} new/changed files in ${source.id}`);
                folderChanges.push({ source, sourceDir, files: filesToProcess });
                countsByFolder[source.id] = filesToProcess.length;
                allFiles.push(...filesToProcess);
            }
        } catch (error) {
            console.error(`[GraphBuilder] Error processing ${source.id}:`, error);
            // Continue with other folders even if one fails
        }
    }

    if (allFiles.length > 0) {
        const run = await serviceLogger.startRun({
            service: 'graph',
            message: 'Syncing knowledge graph',
            trigger: 'timer',
            config: { sources: fileSources.map(source => source.id) },
        });

        const relativeFiles = allFiles.map(filePath => path.relative(WorkDir, filePath));
        const limitedFiles = limitEventItems(relativeFiles);
        const foldersList = Object.keys(countsByFolder).join(', ');
        const folderMessage = foldersList ? ` across ${foldersList}` : '';

        await serviceLogger.log({
            type: 'changes_identified',
            service: run.service,
            runId: run.runId,
            level: 'info',
            message: `Found ${allFiles.length} changed file${allFiles.length === 1 ? '' : 's'}${folderMessage}`,
            counts: countsByFolder,
            items: limitedFiles.items,
            truncated: limitedFiles.truncated,
        });

        const notesCreated = new Set<string>();
        const notesModified = new Set<string>();
        const processedFiles: string[] = [];
        let hadError = false;

        for (const entry of folderChanges) {
            const result = await buildGraphWithFiles(entry.sourceDir, entry.files, state, run);
            result.processedFiles.forEach(file => processedFiles.push(file));
            result.notesCreated.forEach(note => notesCreated.add(note));
            result.notesModified.forEach(note => notesModified.add(note));
            if (result.hadError) {
                hadError = true;
            }
        }

        await serviceLogger.log({
            type: 'run_complete',
            service: run.service,
            runId: run.runId,
            level: hadError ? 'error' : 'info',
            message: `Graph sync complete: ${processedFiles.length} files, ${notesCreated.size} created, ${notesModified.size} updated`,
            durationMs: Date.now() - run.startedAt,
            outcome: hadError ? 'error' : 'ok',
            summary: {
                processedFiles: processedFiles.length,
                notesCreated: notesCreated.size,
                notesModified: notesModified.size,
            },
        });

        anyFilesProcessed = true;
    }

    if (!anyFilesProcessed) {
        console.log('[GraphBuilder] No new content to process');
    } else {
        console.log('[GraphBuilder] Completed processing all sources');
    }
}

// ── Curation ("gardener") pass ───────────────────────────────────────────────
// note_creation only appends; without periodic consolidation, notes bloat and
// rot (duplicate activity, stale open items, frontmatter drift, patterns never
// promoted to facts). Daily, rewrite the notes that need it — one at a time —
// with the note_curation agent. This is the graph's compounding loop.

const CURATION_AGENT = 'note_curation';
const CURATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const CURATION_MAX_NOTES_PER_RUN = 8;
const CURATION_ENTITY_FOLDERS = ['People', 'Organizations', 'Projects', 'Topics'];
// A note qualifies when it has accumulated enough activity to be worth a pass,
// and has been modified since it was last curated (with a cooldown so we don't
// re-curate on every small append).
const CURATION_MIN_ACTIVITY_LINES = 8;
const CURATION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function countActivityEntries(content: string): number {
    // Activity/Timeline/Log entries all start with a bolded date bullet or header
    const matches = content.match(/^-?\s*\*\*\d{4}-\d{2}(-\d{2})?\*\*/gm);
    return matches ? matches.length : 0;
}

function parseCuratedAt(content: string): Date | null {
    const m = content.match(/^curated_at:\s*"?([^"\n]+)"?\s*$/m);
    if (!m) return null;
    const d = new Date(m[1].trim());
    return isNaN(d.getTime()) ? null : d;
}

function findCurationCandidates(): { path: string; activityCount: number }[] {
    const candidates: { path: string; activityCount: number; mtime: number }[] = [];
    for (const folder of CURATION_ENTITY_FOLDERS) {
        const dir = path.join(NOTES_OUTPUT_DIR, folder);
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
            if (!entry.endsWith('.md')) continue;
            const filePath = path.join(dir, entry);
            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) continue;
                const content = fs.readFileSync(filePath, 'utf-8');
                const activityCount = countActivityEntries(content);
                if (activityCount < CURATION_MIN_ACTIVITY_LINES) continue;
                const curatedAt = parseCuratedAt(content);
                if (curatedAt) {
                    const modifiedSinceCuration = stat.mtime.getTime() > curatedAt.getTime();
                    const cooledDown = Date.now() - curatedAt.getTime() > CURATION_COOLDOWN_MS;
                    if (!modifiedSinceCuration || !cooledDown) continue;
                }
                candidates.push({ path: filePath, activityCount, mtime: stat.mtime.getTime() });
            } catch {
                // unreadable note — skip
            }
        }
    }
    // Most-bloated first
    candidates.sort((a, b) => b.activityCount - a.activityCount);
    return candidates.slice(0, CURATION_MAX_NOTES_PER_RUN);
}

export async function curateNotes(): Promise<void> {
    const state = loadState();
    const last = state.lastCurationTime ? new Date(state.lastCurationTime).getTime() : 0;
    if (Date.now() - last < CURATION_INTERVAL_MS) return;

    const candidates = findCurationCandidates();
    // Stamp the attempt time even when there is nothing to do, so we only scan daily.
    state.lastCurationTime = new Date().toISOString();
    saveState(state);
    if (candidates.length === 0) {
        console.log('[GraphBuilder] Curation: no notes need consolidation');
        return;
    }

    console.log(`[GraphBuilder] Curation: consolidating ${candidates.length} note(s)`);
    const run = await serviceLogger.startRun({
        service: 'graph',
        message: `Curating ${candidates.length} knowledge note${candidates.length === 1 ? '' : 's'}`,
        trigger: 'timer',
    });

    let curated = 0;
    let hadError = false;
    for (const candidate of candidates) {
        const relPath = path.relative(WorkDir, candidate.path);
        try {
            const content = fs.readFileSync(candidate.path, 'utf-8');
            let message = buildOwnerBlock();
            message += `\n---\n\n`;
            message += `Curate the following knowledge note per your instructions. Rewrite it in place with a single file-writeText to the SAME path.\n\n`;
            message += `**Note path:** ${relPath}\n\n`;
            message += `**Current content:**\n\n${content}\n`;
            await runHeadlessAgent({
                agentId: CURATION_AGENT,
                message,
                model: await getKgModel(),
                throwOnError: true,
            });
            curated++;
            await serviceLogger.log({
                type: 'progress',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: `Curated ${relPath}`,
                step: 'curate',
                current: curated,
                total: candidates.length,
            });
        } catch (error) {
            hadError = true;
            console.error(`[GraphBuilder] Curation failed for ${relPath}:`, error);
            await serviceLogger.log({
                type: 'error',
                service: run.service,
                runId: run.runId,
                level: 'error',
                message: `Curation failed for ${relPath}`,
                error: getErrorDetails(error),
            });
        }
    }

    try {
        await commitAll('Knowledge curation', 'Rowboat');
    } catch (err) {
        console.error('[GraphBuilder] Failed to commit curation to version history:', err);
    }

    await serviceLogger.log({
        type: 'run_complete',
        service: run.service,
        runId: run.runId,
        level: hadError ? 'error' : 'info',
        message: `Curation complete: ${curated}/${candidates.length} notes consolidated`,
        durationMs: Date.now() - run.startedAt,
        outcome: hadError ? 'error' : 'ok',
        summary: { notesCurated: curated },
    });
}

/**
 * Main entry point - runs as independent service monitoring all source folders
 */
export async function init() {
    console.log('[GraphBuilder] Starting Knowledge Graph Builder Service...');
    const sourceFolders = getEnabledFileSources().map(source => source.artifactDir);
    console.log(`[GraphBuilder] Monitoring folders: ${sourceFolders.join(', ')}, knowledge/Voice Memos`);
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

        try {
            await curateNotes(); // no-ops unless the daily interval has elapsed
        } catch (error) {
            console.error('[GraphBuilder] Error in curation pass:', error);
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
