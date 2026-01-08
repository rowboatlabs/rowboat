import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WorkDir } from '../config/config.js';

/**
 * State tracking for knowledge graph processing
 * Uses mtime + hash hybrid approach to detect file changes
 */

const STATE_FILE = path.join(WorkDir, 'knowledge_graph_state.json');

export interface FileState {
    mtime: string; // ISO timestamp of last modification
    hash: string; // Content hash
    lastProcessed: string; // ISO timestamp of when it was processed
}

export interface GraphState {
    processedFiles: Record<string, FileState>; // filepath -> FileState
    lastBuildTime: string; // ISO timestamp of last successful build
}

/**
 * Load the current state from disk
 */
export function loadState(): GraphState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch (error) {
            console.error('Error loading knowledge graph state:', error);
        }
    }

    return {
        processedFiles: {},
        lastBuildTime: new Date(0).toISOString(), // epoch
    };
}

/**
 * Save the current state to disk
 */
export function saveState(state: GraphState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving knowledge graph state:', error);
        throw error;
    }
}

/**
 * Compute hash of file content
 */
export function computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a file has changed since it was last processed
 * Uses mtime for quick check, then hash for verification
 */
export function hasFileChanged(filePath: string, state: GraphState): boolean {
    const fileState = state.processedFiles[filePath];

    // New file - never processed
    if (!fileState) {
        return true;
    }

    // Check mtime first (fast)
    const stats = fs.statSync(filePath);
    const currentMtime = stats.mtime.toISOString();

    // If mtime is the same, file definitely hasn't changed
    if (currentMtime === fileState.mtime) {
        return false;
    }

    // mtime changed - verify with hash to confirm actual content change
    const currentHash = computeFileHash(filePath);
    return currentHash !== fileState.hash;
}

/**
 * Update state after processing a file
 */
export function markFileAsProcessed(filePath: string, state: GraphState): void {
    const stats = fs.statSync(filePath);
    const hash = computeFileHash(filePath);

    state.processedFiles[filePath] = {
        mtime: stats.mtime.toISOString(),
        hash: hash,
        lastProcessed: new Date().toISOString(),
    };
}

/**
 * Get list of files that need processing from a source directory
 * Returns only new or changed files, recursively traversing subdirectories
 */
export function getFilesToProcess(
    sourceDir: string,
    state: GraphState
): string[] {
    if (!fs.existsSync(sourceDir)) {
        return [];
    }

    const filesToProcess: string[] = [];

    // Recursive function to traverse directories
    function traverseDirectory(dir: string) {
        const entries = fs.readdirSync(dir);

        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                // Recurse into subdirectories
                traverseDirectory(fullPath);
            } else if (stat.isFile() && entry.endsWith('.md')) {
                if (hasFileChanged(fullPath, state)) {
                    filesToProcess.push(fullPath);
                }
            }
        }
    }

    traverseDirectory(sourceDir);
    return filesToProcess;
}

/**
 * Reset state - useful for reprocessing everything
 */
export function resetState(): void {
    const emptyState: GraphState = {
        processedFiles: {},
        lastBuildTime: new Date().toISOString(),
    };
    saveState(emptyState);
}
