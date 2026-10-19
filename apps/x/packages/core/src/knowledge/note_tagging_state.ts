import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

const STATE_FILE = path.join(WorkDir, 'note_tagging_state.json');

export interface NoteTaggingState {
    processedFiles: Record<string, { taggedAt: string }>;
    failedFiles?: Record<string, {
        failedAt: string;
        retryCount: number;
        nextRetryAt: number;
        lastModifiedMs: number;
    }>;
    lastRunTime: string;
}

export function loadNoteTaggingState(): NoteTaggingState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            if (!state.failedFiles) {
                state.failedFiles = {};
            }
            return state;
        } catch (error) {
            console.error('Error loading note tagging state:', error);
        }
    }

    return {
        processedFiles: {},
        failedFiles: {},
        lastRunTime: new Date(0).toISOString(),
    };
}

export function saveNoteTaggingState(state: NoteTaggingState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving note tagging state:', error);
        throw error;
    }
}

export function markNoteAsTagged(filePath: string, state: NoteTaggingState): void {
    state.processedFiles[filePath] = {
        taggedAt: new Date().toISOString(),
    };
}

export function resetNoteTaggingState(): void {
    const emptyState: NoteTaggingState = {
        processedFiles: {},
        failedFiles: {},
        lastRunTime: new Date().toISOString(),
    };
    saveNoteTaggingState(emptyState);
}

const BASE_DELAY_MS = 60 * 1000; // 1 minute

export function markNoteAsFailed(filePath: string, state: NoteTaggingState, mtimeMs: number): void {
    if (!state.failedFiles) {
        state.failedFiles = {};
    }
    
    const existing = state.failedFiles[filePath];
    const retryCount = existing ? existing.retryCount + 1 : 1;
    
    // Exponential backoff: 1m, 2m, 4m, 8m, etc.
    const backoffMs = Math.pow(2, retryCount - 1) * BASE_DELAY_MS;
    
    state.failedFiles[filePath] = {
        failedAt: new Date().toISOString(),
        retryCount,
        nextRetryAt: Date.now() + backoffMs,
        lastModifiedMs: mtimeMs
    };
}

export function clearNoteFailure(filePath: string, state: NoteTaggingState): void {
    if (state.failedFiles && state.failedFiles[filePath]) {
        delete state.failedFiles[filePath];
    }
}
