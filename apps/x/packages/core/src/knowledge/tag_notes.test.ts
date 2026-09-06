import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock config BEFORE anything else is imported.
// By hardcoding the string here, we bypass all variable hoisting issues!
vi.mock('../config/config.js', () => ({
    WorkDir: '/tmp/rowboat-test-sandbox-tag-notes'
}));

import { WorkDir } from '../config/config.js';
import { processUntaggedNotes } from './tag_notes.js';
import * as headlessApp from '../runtime/assembly/headless-app.js';
import { loadNoteTaggingState } from './note_tagging_state.js';
import { getNoteTypeDefinitions } from './note_system.js';
import { serviceLogger } from '../services/service_logger.js';

vi.mock('../runtime/assembly/headless-app.js', () => ({
    runWhenPossible: vi.fn(),
    toolInputPaths: vi.fn(),
}));

vi.mock('../services/service_logger.js', () => ({
    serviceLogger: {
        startRun: vi.fn().mockResolvedValue({ service: 'test', runId: 'test-run-id', startedAt: Date.now() }),
        log: vi.fn().mockResolvedValue(undefined),
    }
}));

vi.mock('../models/defaults.js', () => ({
    getKgModel: vi.fn().mockResolvedValue({ model: 'mock-model', provider: 'mock-provider' }),
    asRunModelOptions: vi.fn().mockReturnValue({ model: 'mock-model', provider: 'mock-provider' })
}));

describe('tag_notes', () => {
    beforeEach(() => {
        // Create necessary directories using the mocked WorkDir
        process.env.ROWBOAT_WORKDIR = WorkDir;
        if (fs.existsSync(WorkDir)) {
            fs.rmSync(WorkDir, { recursive: true, force: true });
        }
        fs.mkdirSync(WorkDir, { recursive: true });
        
        fs.mkdirSync(path.join(WorkDir, 'knowledge'), { recursive: true });
        fs.mkdirSync(path.join(WorkDir, 'config'), { recursive: true });
        
        for (const def of getNoteTypeDefinitions()) {
            fs.mkdirSync(path.join(WorkDir, 'knowledge', def.folder), { recursive: true });
        }
    });

    afterEach(() => {
        fs.rmSync(WorkDir, { recursive: true, force: true });
        vi.clearAllMocks();
    });

    it('should mark notes as processed even if the agent fails to tag them to prevent infinite loops', async () => {
        // Create an untagged note
        const notePath = path.join(WorkDir, 'knowledge', 'People', 'TestNote.md');
        fs.writeFileSync(notePath, '# Test Note\nNo frontmatter here.');

        // Verify it is untagged
        let state = loadNoteTaggingState();
        expect(state.processedFiles[notePath]).toBeUndefined();

        // Mock the agent to simulate a SKIP or FAILURE (returns empty set of files edited)
        vi.mocked(headlessApp.runWhenPossible).mockResolvedValue({
            turnId: 'test-turn',
            state: {} as any,
            outcome: {} as any,
            summary: null
        });
        vi.mocked(headlessApp.toolInputPaths).mockReturnValue(new Set()); // No files edited

        // Run the process
        await processUntaggedNotes();

        // Verify the file was marked as processed despite the agent failing
        state = loadNoteTaggingState();
        expect(state.processedFiles[notePath]).toBeDefined();
        
        // Prove the AI was called exactly 1 time on the first run
        expect(headlessApp.runWhenPossible).toHaveBeenCalledTimes(1);

        // Simulate the 15-second timer ticking and triggering a SECOND run
        await processUntaggedNotes();

        // Prove the AI was STILL only called 1 time overall! 
        // This proves the note was correctly skipped on the second run.
        expect(headlessApp.runWhenPossible).toHaveBeenCalledTimes(1);

        // Furthermore, prove that the file wasn't even sent for processing internally!
        // `serviceLogger.startRun` is ONLY called if `untagged.length > 0`.
        // Because it was only called 1 time, it proves `getUntaggedNotes` returned an empty list on the second run.
        expect(serviceLogger.startRun).toHaveBeenCalledTimes(1);
    });
});
