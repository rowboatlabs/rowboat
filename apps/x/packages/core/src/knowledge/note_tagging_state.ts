import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

const STATE_FILE = path.join(WorkDir, 'note_tagging_state.json');

export interface NoteTaggingState {
    processedFiles: Record<string, { taggedAt: string }>;
    lastRunTime: string;
}

export function loadNoteTaggingState(): NoteTaggingState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch (error) {
            console.error('Error loading note tagging state:', error);
        }
    }

    return {
        processedFiles: {},
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
        lastRunTime: new Date().toISOString(),
    };
    saveNoteTaggingState(emptyState);
}
