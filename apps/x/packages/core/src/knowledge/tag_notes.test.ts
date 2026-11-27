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

    it('should mark notes as failed when skipped by the agent and backoff', async () => {
        const notePath = path.join(WorkDir, 'knowledge', 'People', 'TestNote.md');
        fs.writeFileSync(notePath, '# Test Note\nNo frontmatter here.');

        // Mock the agent to simulate a SKIP or FAILURE (returns empty set of files edited)
        vi.mocked(headlessApp.runWhenPossible).mockResolvedValue({
            turnId: 'test-turn',
            state: {} as any,
            outcome: { status: 'completed' } as any,
            summary: null
        });
        vi.mocked(headlessApp.toolInputPaths).mockReturnValue(new Set()); // No files edited

        // Run the process
        await processUntaggedNotes();

        let state = loadNoteTaggingState();
        expect(state.processedFiles[notePath]).toBeUndefined();
        expect(state.failedFiles?.[notePath]).toBeDefined();
        expect(state.failedFiles?.[notePath].retryCount).toBe(1);
        
        expect(headlessApp.runWhenPossible).toHaveBeenCalledTimes(1);

        // Second run - it should be skipped due to backoff
        await processUntaggedNotes();
        expect(headlessApp.runWhenPossible).toHaveBeenCalledTimes(1);
    });

    it('should handle provider failure with backoff and eventual recovery', async () => {
        const notePath = path.join(WorkDir, 'knowledge', 'People', 'TestNote.md');
        fs.writeFileSync(notePath, '# Test Note\nNo frontmatter here.');

        // First run: provider throws an error
        vi.mocked(headlessApp.runWhenPossible).mockRejectedValueOnce(new Error('Provider API down'));
        
        await processUntaggedNotes();
        
        let state = loadNoteTaggingState();
        expect(state.processedFiles[notePath]).toBeUndefined();
        expect(state.failedFiles?.[notePath]).toBeDefined();
        expect(state.failedFiles?.[notePath].retryCount).toBe(1);
        
        // Fast forward time to pass the backoff 
        state.failedFiles![notePath].nextRetryAt = Date.now() - 1000;
        fs.writeFileSync(path.join(WorkDir, 'note_tagging_state.json'), JSON.stringify(state));

        // Second run: provider recovers and agent successfully tags the note
        vi.mocked(headlessApp.runWhenPossible).mockResolvedValueOnce({
            turnId: 'test-turn-2',
            state: {} as any,
            outcome: { status: 'completed' } as any,
            summary: null
        });
        vi.mocked(headlessApp.toolInputPaths).mockReturnValueOnce(new Set(['knowledge/People/TestNote.md']));
        
        await processUntaggedNotes();
        
        state = loadNoteTaggingState();
        expect(state.processedFiles[notePath]).toBeDefined();
        expect(state.failedFiles?.[notePath]).toBeUndefined(); // Cleared on success
    });

    it('should handle partially processed batches correctly', async () => {
        const note1Path = path.join(WorkDir, 'knowledge', 'People', 'Note1.md');
        const note2Path = path.join(WorkDir, 'knowledge', 'People', 'Note2.md');
        fs.writeFileSync(note1Path, '# Note 1\n');
        fs.writeFileSync(note2Path, '# Note 2\n');

        vi.mocked(headlessApp.runWhenPossible).mockResolvedValueOnce({
            turnId: 'test-turn',
            state: {} as any,
            outcome: { status: 'completed' } as any,
            summary: null
        });
        // Agent edits Note 1 but skips Note 2
        vi.mocked(headlessApp.toolInputPaths).mockReturnValueOnce(new Set(['knowledge/People/Note1.md']));

        await processUntaggedNotes();

        const state = loadNoteTaggingState();
        
        // Note 1 should be processed
        expect(state.processedFiles[note1Path]).toBeDefined();
        expect(state.failedFiles?.[note1Path]).toBeUndefined();
        
        // Note 2 should be failed
        expect(state.processedFiles[note2Path]).toBeUndefined();
        expect(state.failedFiles?.[note2Path]).toBeDefined();
    });

    it('should save partial successes when an error is thrown mid-batch', async () => {
        const note1Path = path.join(WorkDir, 'knowledge', 'People', 'Note1.md');
        const note2Path = path.join(WorkDir, 'knowledge', 'People', 'Note2.md');
        fs.writeFileSync(note1Path, '# Note 1\n');
        fs.writeFileSync(note2Path, '# Note 2\n');

        vi.mocked(headlessApp.runWhenPossible).mockResolvedValueOnce({
            turnId: 'test-turn',
            state: {} as any,
            outcome: { status: 'failed', error: 'Mid-batch provider error' } as any,
            summary: null
        });
        // Agent edits Note 1 but fails before editing Note 2
        vi.mocked(headlessApp.toolInputPaths).mockReturnValueOnce(new Set(['knowledge/People/Note1.md']));

        await processUntaggedNotes();

        const state = loadNoteTaggingState();
        
        // Note 1 should be processed because it was edited before the error
        expect(state.processedFiles[note1Path]).toBeDefined();
        expect(state.failedFiles?.[note1Path]).toBeUndefined();
        
        // Note 2 should be failed
        expect(state.processedFiles[note2Path]).toBeUndefined();
        expect(state.failedFiles?.[note2Path]).toBeDefined();
    });

    it('should reset retries if a failed file is edited', async () => {
        const notePath = path.join(WorkDir, 'knowledge', 'People', 'EditMe.md');
        fs.writeFileSync(notePath, '# Edit Me\n');

        // Fail first time
        vi.mocked(headlessApp.runWhenPossible).mockResolvedValue({
            turnId: 'test-turn',
            state: {} as any,
            outcome: { status: 'completed' } as any,
            summary: null
        });
        vi.mocked(headlessApp.toolInputPaths).mockReturnValue(new Set()); // No edits

        await processUntaggedNotes();

        let state = loadNoteTaggingState();
        expect(state.failedFiles?.[notePath]).toBeDefined();
        
        // Set retry count to MAX (5)
        state.failedFiles![notePath].retryCount = 5;
        state.failedFiles![notePath].nextRetryAt = Date.now() - 1000;
        fs.writeFileSync(path.join(WorkDir, 'note_tagging_state.json'), JSON.stringify(state));

        // It should skip it now because of max retries
        await processUntaggedNotes();
        expect(headlessApp.runWhenPossible).toHaveBeenCalledTimes(1); 

        // Now user edits the file! Wait a small bit so mtime changes (or touch)
        await new Promise(resolve => setTimeout(resolve, 50));
        fs.appendFileSync(notePath, 'New content here.');

        // Second run after edit - it should pick it up again!
        await processUntaggedNotes();
        expect(headlessApp.runWhenPossible).toHaveBeenCalledTimes(2); 
    });
});
