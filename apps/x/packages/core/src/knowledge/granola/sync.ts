import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { WorkDir } from '../../config/config.js';
import container from '../../di/container.js';
import { IGranolaConfigRepo } from './repo.js';
import {
    GetDocumentsResponse,
    SyncState,
    Document,
} from './types.js';

// --- Configuration ---

const GRANOLA_CLIENT_VERSION = '6.462.1';
const GRANOLA_API_BASE = 'https://api.granola.ai';
const GRANOLA_CONFIG_PATH = path.join(homedir(), 'Library', 'Application Support', 'Granola', 'supabase.json');
const SYNC_DIR = path.join(WorkDir, 'granola_notes');
const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const API_DELAY_MS = 1000; // 1 second delay between API calls
const RATE_LIMIT_RETRY_DELAY_MS = 60 * 1000; // Wait 1 minute on rate limit
const MAX_RETRIES = 3; // Maximum retries for rate-limited requests
const MAX_BATCH_SIZE = 10; // Process max 10 documents per folder per sync

// --- Wake Signal for Immediate Sync Trigger ---
let wakeResolve: (() => void) | null = null;

export function triggerSync(): void {
    if (wakeResolve) {
        console.log('[Granola] Triggered - waking up immediately');
        wakeResolve();
        wakeResolve = null;
    }
}

function interruptibleSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            wakeResolve = null;
            resolve();
        }, ms);
        wakeResolve = () => {
            clearTimeout(timeout);
            resolve();
        };
    });
}

// --- Token Extraction ---

interface WorkosTokens {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
}

interface SupabaseJson {
    workos_tokens?: string; // JSON string containing WorkosTokens
}

function extractAccessToken(): string | null {
    try {
        if (!fs.existsSync(GRANOLA_CONFIG_PATH)) {
            console.log('[Granola] supabase.json not found at:', GRANOLA_CONFIG_PATH);
            return null;
        }

        const content = fs.readFileSync(GRANOLA_CONFIG_PATH, 'utf-8');
        const supabaseJson: SupabaseJson = JSON.parse(content);

        if (!supabaseJson.workos_tokens) {
            console.log('[Granola] workos_tokens not found in supabase.json');
            return null;
        }

        // workos_tokens is a JSON string that needs to be parsed
        const tokens: WorkosTokens = JSON.parse(supabaseJson.workos_tokens);
        
        if (!tokens.access_token) {
            console.log('[Granola] access_token not found in workos_tokens');
            return null;
        }

        return tokens.access_token;
    } catch (error) {
        console.error('[Granola] Error extracting access token:', error);
        return null;
    }
}

// --- Helper Functions ---

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callWithRateLimit<T>(
    operation: () => Promise<T>,
    operationName: string
): Promise<T | null> {
    let retries = 0;
    let delay = RATE_LIMIT_RETRY_DELAY_MS;

    while (retries < MAX_RETRIES) {
        try {
            const result = await operation();
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Check if it's a rate limit error (429 Too Many Requests)
            if (errorMessage.includes('429') ||
                errorMessage.includes('Too Many Requests') ||
                errorMessage.includes('too many requests') ||
                errorMessage.includes('rate limit')) {

                retries++;
                console.log(`[Granola] Rate limit hit for ${operationName}. Retry ${retries}/${MAX_RETRIES} in ${delay/1000}s...`);

                if (retries >= MAX_RETRIES) {
                    console.error(`[Granola] Max retries reached for ${operationName}. Skipping.`);
                    return null;
                }

                await sleep(delay);
                delay *= 2; // Exponential backoff
            } else {
                // Not a rate limit error, throw it
                throw error;
            }
        }
    }

    return null;
}

// --- API Client ---

function getHeaders(accessToken: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': `Granola/${GRANOLA_CLIENT_VERSION}`,
        'X-Client-Version': GRANOLA_CLIENT_VERSION,
    };
}

async function apiCall<T>(
    endpoint: string,
    accessToken: string,
    body: Record<string, unknown> = {}
): Promise<T> {
    console.log(`[Granola] API call: ${endpoint}`);
    const response = await fetch(`${GRANOLA_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: getHeaders(accessToken),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'no body');
        console.error(`[Granola] API error ${response.status}: ${response.statusText} - ${errorText.slice(0, 200)}`);
        // Throw error with status code so rate limit handler can detect 429
        throw new Error(`${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as T;
    console.log(`[Granola] API success: ${endpoint}`);
    return data;
}

async function getDocuments(accessToken: string, limit: number, offset: number) {
    const response = await callWithRateLimit(
        () => apiCall<unknown>('/v2/get-documents', accessToken, {
            limit,
            offset,
            include_last_viewed_panel: true,
        }),
        'get-documents'
    );
    if (!response) return null;

    try {
        const parsed = GetDocumentsResponse.parse(response);
        console.log(`[Granola] Fetched ${parsed.docs.length} documents (offset: ${offset})`);
        return parsed;
    } catch (error) {
        console.error('[Granola] Failed to parse documents response:', error);
        console.error('[Granola] Raw response:', JSON.stringify(response, null, 2).slice(0, 1000));
        return null;
    }
}

// --- State Management ---

function loadState(): SyncState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const content = fs.readFileSync(STATE_FILE, 'utf-8');
            return SyncState.parse(JSON.parse(content));
        } catch {
            return { lastSyncDate: '', syncedDocs: {} };
        }
    }
    return { lastSyncDate: '', syncedDocs: {} };
}

function saveState(state: SyncState): void {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Helpers ---

function cleanFilename(name: string): string {
    return name.replace(/[\\/*?:"<>|]/g, '_').substring(0, 100).trim();
}

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

interface ProseMirrorNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: ProseMirrorNode[];
    text?: string;
}

function convertProseMirrorToMarkdown(content: ProseMirrorNode | undefined): string {
    if (!content || typeof content !== 'object' || !content.content) {
        return '';
    }

    function processNode(node: ProseMirrorNode): string {
        if (!node || typeof node !== 'object') {
            return '';
        }

        const nodeType = node.type || '';
        const children = node.content || [];
        const text = node.text || '';

        if (nodeType === 'heading') {
            const level = (node.attrs?.level as number) || 1;
            const headingText = children.map(processNode).join('');
            return `${'#'.repeat(level)} ${headingText}\n\n`;
        }

        if (nodeType === 'paragraph') {
            const paraText = children.map(processNode).join('');
            return `${paraText}\n\n`;
        }

        if (nodeType === 'bulletList') {
            const items: string[] = [];
            for (const item of children) {
                if (item.type === 'listItem') {
                    const itemContent = (item.content || []).map(processNode).join('').trim();
                    items.push(`- ${itemContent}`);
                }
            }
            return items.join('\n') + '\n\n';
        }

        if (nodeType === 'orderedList') {
            const items: string[] = [];
            let num = 1;
            for (const item of children) {
                if (item.type === 'listItem') {
                    const itemContent = (item.content || []).map(processNode).join('').trim();
                    items.push(`${num}. ${itemContent}`);
                    num++;
                }
            }
            return items.join('\n') + '\n\n';
        }

        if (nodeType === 'text') {
            return text;
        }

        if (nodeType === 'hardBreak') {
            return '\n';
        }

        // For other node types, recursively process children
        return children.map(processNode).join('');
    }

    return processNode(content);
}

function documentToMarkdown(doc: Document): string {
    const title = doc.title || 'Untitled';
    const createdAt = doc.created_at;
    const updatedAt = doc.updated_at || doc.created_at;

    let md = `---\n`;
    md += `granola_id: ${doc.id}\n`;
    md += `title: "${title.replace(/"/g, '\\"')}"\n`;
    md += `created_at: ${createdAt}\n`;
    md += `updated_at: ${updatedAt}\n`;
    md += `---\n\n`;

    // Try last_viewed_panel content first (ProseMirror format)
    const lastViewedContent = doc.last_viewed_panel?.content;
    if (lastViewedContent && typeof lastViewedContent === 'object' && lastViewedContent.type === 'doc') {
        md += convertProseMirrorToMarkdown(lastViewedContent as ProseMirrorNode);
    } else if (doc.notes && typeof doc.notes === 'object' && doc.notes.type === 'doc') {
        // Fall back to notes field (also ProseMirror format)
        md += convertProseMirrorToMarkdown(doc.notes as ProseMirrorNode);
    } else if (doc.notes_markdown) {
        md += doc.notes_markdown;
    } else if (doc.notes_plain) {
        md += doc.notes_plain;
    }

    return md;
}

// --- Sync Logic ---

async function syncNotes(): Promise<void> {
    console.log('[Granola] Starting sync...');
    
    // Check if enabled
    const granolaRepo = container.resolve<IGranolaConfigRepo>('granolaConfigRepo');
    const config = await granolaRepo.getConfig();
    if (!config.enabled) {
        console.log('[Granola] Sync disabled in config');
        return;
    }
    
    // Extract access token
    const accessToken = extractAccessToken();
    if (!accessToken) {
        console.log('[Granola] No access token available');
        return;
    }
    
    // Ensure sync directory exists
    ensureDir(SYNC_DIR);
    
    // Load state
    const state = loadState();
    
    let newCount = 0;
    let updatedCount = 0;
    let offset = 0;
    let hasMore = true;

    // Fetch documents with pagination
    while (hasMore) {
        // Delay before API call (except first)
        if (offset > 0) {
            await sleep(API_DELAY_MS);
        }

        const docsResponse = await getDocuments(accessToken, MAX_BATCH_SIZE, offset);
        if (!docsResponse) {
            console.log('[Granola] Failed to fetch documents');
            break;
        }

        if (docsResponse.docs.length === 0) {
            console.log('[Granola] No more documents to fetch');
            hasMore = false;
            break;
        }

        // Process each document
        for (const doc of docsResponse.docs) {
            const docUpdatedAt = doc.updated_at || doc.created_at;
            const lastSyncedAt = state.syncedDocs[doc.id];

            // Check if needs sync (new or updated)
            const needsSync = !lastSyncedAt || lastSyncedAt !== docUpdatedAt;

            if (!needsSync) {
                continue;
            }

            // Convert to markdown and save
            const markdown = documentToMarkdown(doc);
            const docTitle = doc.title || 'Untitled';
            const filename = `${doc.id}_${cleanFilename(docTitle)}.md`;
            const filePath = path.join(SYNC_DIR, filename);

            fs.writeFileSync(filePath, markdown);

            if (lastSyncedAt) {
                console.log(`[Granola] Updated: ${filename}`);
                updatedCount++;
            } else {
                console.log(`[Granola] Saved: ${filename}`);
                newCount++;
            }

            // Update state
            state.syncedDocs[doc.id] = docUpdatedAt;
        }

        // Move to next page
        offset += docsResponse.docs.length;

        // Stop if we got fewer docs than requested (last page)
        if (docsResponse.docs.length < MAX_BATCH_SIZE) {
            hasMore = false;
        }
    }

    // Save state
    state.lastSyncDate = new Date().toISOString();
    saveState(state);
    
    console.log(`[Granola] Sync complete: ${newCount} new, ${updatedCount} updated`);
    
    // Build knowledge graph if there were changes
    if (newCount > 0 || updatedCount > 0) {
        // Graph building is now handled by the independent graph builder service
    }
}

// --- Main Loop ---

export async function init(): Promise<void> {
    console.log('[Granola] Starting Granola Sync...');
    console.log(`[Granola] Will sync every ${SYNC_INTERVAL_MS / 60000} minutes.`);
    console.log(`[Granola] Notes will be saved to: ${SYNC_DIR}`);

    while (true) {
        try {
            await syncNotes();
        } catch (error) {
            console.error('[Granola] Error in sync loop:', error);
        }

        // Sleep before next check (can be interrupted by triggerSync)
        console.log(`[Granola] Sleeping for ${SYNC_INTERVAL_MS / 60000} minutes...`);
        await interruptibleSleep(SYNC_INTERVAL_MS);
    }
}

