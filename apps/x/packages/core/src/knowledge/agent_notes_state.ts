import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

const STATE_FILE = path.join(WorkDir, 'agent_notes_state.json');

export interface AgentNotesState {
    processedEmails: Record<string, { processedAt: string }>;
    processedRuns: Record<string, { processedAt: string }>;
    lastRunTime: string;
}

export function loadAgentNotesState(): AgentNotesState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            // Handle migration from older state without processedRuns
            if (!parsed.processedRuns) {
                parsed.processedRuns = {};
            }
            return parsed;
        } catch (error) {
            console.error('Error loading agent notes state:', error);
        }
    }

    return {
        processedEmails: {},
        processedRuns: {},
        lastRunTime: new Date(0).toISOString(),
    };
}

export function saveAgentNotesState(state: AgentNotesState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving agent notes state:', error);
        throw error;
    }
}

export function markEmailProcessed(filePath: string, state: AgentNotesState): void {
    state.processedEmails[filePath] = {
        processedAt: new Date().toISOString(),
    };
}

export function markRunProcessed(runFile: string, state: AgentNotesState): void {
    state.processedRuns[runFile] = {
        processedAt: new Date().toISOString(),
    };
}

export function resetAgentNotesState(): void {
    const emptyState: AgentNotesState = {
        processedEmails: {},
        processedRuns: {},
        lastRunTime: new Date().toISOString(),
    };
    saveAgentNotesState(emptyState);
}
