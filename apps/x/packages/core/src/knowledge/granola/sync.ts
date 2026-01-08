import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { WorkDir } from '../../config/config.js';
import { buildGraph } from '../build_graph.js';
import container from '../../di/container.js';
import { IGranolaConfigRepo } from './repo.js';
import {
    GetWorkspacesResponse,
    GetDocumentListsResponse,
    GetDocumentsBatchResponse,
    SyncState,
    Document,
} from './types.js';

// --- Configuration ---

const GRANOLA_CLIENT_VERSION = '6.462.1';
const GRANOLA_API_BASE = 'https://api.granola.ai';
const GRANOLA_CONFIG_PATH = path.join(homedir(), 'Library', 'Application Support', 'Granola', 'supabase.json');
const SYNC_DIR = path.join(WorkDir, 'granola_notes');
const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');
const SYNC_INTERVAL_MS = 60 * 1000; // Check every minute

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
): Promise<T | null> {
    try {
        const response = await fetch(`${GRANOLA_API_BASE}${endpoint}`, {
            method: 'POST',
            headers: getHeaders(accessToken),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            console.error(`[Granola] API error ${response.status}: ${response.statusText}`);
            return null;
        }

        return await response.json() as T;
    } catch (error) {
        console.error(`[Granola] API call failed for ${endpoint}:`, error);
        return null;
    }
}

async function getWorkspaces(accessToken: string) {
    const response = await apiCall<unknown>('/v1/get-workspaces', accessToken);
    if (!response) return null;
    
    try {
        return GetWorkspacesResponse.parse(response);
    } catch (error) {
        console.error('[Granola] Failed to parse workspaces response:', error);
        return null;
    }
}

async function getDocumentLists(accessToken: string) {
    const response = await apiCall<unknown>('/v2/get-document-lists', accessToken);
    if (!response) return null;
    
    try {
        return GetDocumentListsResponse.parse(response);
    } catch (error) {
        console.error('[Granola] Failed to parse document lists response:', error);
        return null;
    }
}

async function getDocumentsBatch(accessToken: string, documentIds: string[]) {
    if (documentIds.length === 0) return { docs: [] };
    
    const response = await apiCall<unknown>('/v1/get-documents-batch', accessToken, {
        document_ids: documentIds,
        include_last_viewed_panel: true,
    });
    if (!response) return null;
    
    try {
        return GetDocumentsBatchResponse.parse(response);
    } catch (error) {
        console.error('[Granola] Failed to parse documents batch response:', error);
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
    
    // Use notes_markdown if available, otherwise notes_plain
    if (doc.notes_markdown) {
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
    
    // Get workspaces
    const workspacesResponse = await getWorkspaces(accessToken);
    if (!workspacesResponse) {
        console.log('[Granola] Failed to fetch workspaces');
        return;
    }
    
    console.log(`[Granola] Found ${workspacesResponse.workspaces.length} workspaces`);
    
    // Build workspace lookup
    const workspaceMap = new Map<string, { slug: string; displayName: string }>();
    for (const ws of workspacesResponse.workspaces) {
        workspaceMap.set(ws.workspace.workspace_id, {
            slug: ws.workspace.slug,
            displayName: ws.workspace.display_name,
        });
    }
    
    // Get document lists (folders)
    const listsResponse = await getDocumentLists(accessToken);
    if (!listsResponse) {
        console.log('[Granola] Failed to fetch document lists');
        return;
    }
    
    console.log(`[Granola] Found ${listsResponse.lists.length} folders`);
    
    let newCount = 0;
    let updatedCount = 0;
    
    // Process each folder
    for (const list of listsResponse.lists) {
        const folderName = cleanFilename(list.title);
        const folderPath = path.join(SYNC_DIR, folderName);
        
        // Get document IDs from the list
        const docIds = list.documents.map(d => d.id);
        
        if (docIds.length === 0) {
            console.log(`[Granola] Folder "${list.title}" is empty, skipping`);
            continue;
        }
        
        console.log(`[Granola] Processing folder "${list.title}" with ${docIds.length} documents`);
        
        // Fetch full documents
        const docsResponse = await getDocumentsBatch(accessToken, docIds);
        if (!docsResponse) {
            console.log(`[Granola] Failed to fetch documents for folder "${list.title}"`);
            continue;
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
            
            // Ensure folder exists
            ensureDir(folderPath);
            
            // Convert to markdown and save
            const markdown = documentToMarkdown(doc);
            const docTitle = doc.title || 'Untitled';
            const filename = `${doc.id}_${cleanFilename(docTitle)}.md`;
            const filePath = path.join(folderPath, filename);
            
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
    }
    
    // Save state
    state.lastSyncDate = new Date().toISOString();
    saveState(state);
    
    console.log(`[Granola] Sync complete: ${newCount} new, ${updatedCount} updated`);
    
    // Build knowledge graph if there were changes
    if (newCount > 0 || updatedCount > 0) {
        console.log('[Granola] Starting knowledge graph build...');
        try {
            await buildGraph(SYNC_DIR);
        } catch (error) {
            console.error('[Granola] Error building knowledge graph:', error);
        }
    }
}

// --- Main Loop ---

export async function init(): Promise<void> {
    console.log('[Granola] Starting Granola Sync...');
    console.log(`[Granola] Will check every ${SYNC_INTERVAL_MS / 1000} seconds.`);
    console.log(`[Granola] Notes will be saved to: ${SYNC_DIR}`);
    
    while (true) {
        try {
            await syncNotes();
        } catch (error) {
            console.error('[Granola] Error in sync loop:', error);
        }
        
        // Sleep before next check
        console.log(`[Granola] Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
    }
}

