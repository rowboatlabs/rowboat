import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

const STATE_FILE = path.join(WorkDir, 'labeling_state.json');

export interface LabelingState {
    processedFiles: Record<string, { labeledAt: string }>;
    lastRunTime: string;
}

export function loadLabelingState(): LabelingState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch (error) {
            console.error('Error loading labeling state:', error);
        }
    }

    return {
        processedFiles: {},
        lastRunTime: new Date(0).toISOString(),
    };
}

export function saveLabelingState(state: LabelingState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving labeling state:', error);
        throw error;
    }
}

export function markFileAsLabeled(filePath: string, state: LabelingState): void {
    state.processedFiles[filePath] = {
        labeledAt: new Date().toISOString(),
    };
}

export function resetLabelingState(): void {
    const emptyState: LabelingState = {
        processedFiles: {},
        lastRunTime: new Date().toISOString(),
    };
    saveLabelingState(emptyState);
}
