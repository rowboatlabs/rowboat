import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The prefs file is the only copy of what the user asked to be told about.
// These tests pin the storage behaviors: overrides key on thread ROOT ids, a
// write is atomic (no half-written file for the next launch to read as
// empty), and a fresh process reads back exactly what was written.

// vi.mock factories are hoisted above module code — the temp path must be
// computable inside vi.hoisted without imports.
const workDir = vi.hoisted(() => {
    const tmp = (process.env.TMPDIR ?? process.env.TEMP ?? '/tmp').replace(/[\\/]$/, '');
    return `${tmp}/notify-prefs-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
});

vi.mock('../config/config.js', () => ({ WorkDir: workDir }));

const PREFS_FILE = path.join(workDir, 'config', 'spaces_notify_prefs.json');

type Prefs = typeof import('./notify-prefs.js');

async function fresh(): Promise<Prefs> {
    // The module caches in memory — a re-import is "the next launch".
    vi.resetModules();
    return import('./notify-prefs.js');
}

beforeEach(() => {
    fs.mkdirSync(workDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe('notify prefs', () => {
    it('resolves thread override → space level → the mentions default', async () => {
        const p = await fresh();
        expect(p.notifyLevelFor('org', 'space', 'root-1')).toBe('mentions');

        p.setNotifyPref('org', 'space', undefined, 'all');
        expect(p.notifyLevelFor('org', 'space', 'root-1')).toBe('all');

        p.setNotifyPref('org', 'space', 'root-1', 'mute');
        expect(p.notifyLevelFor('org', 'space', 'root-1')).toBe('mute');
        expect(p.notifyLevelFor('org', 'space', 'root-2')).toBe('all');
        // Other spaces are untouched.
        expect(p.notifyLevelFor('org', 'other', 'root-1')).toBe('mentions');

        expect(p.getNotifyPrefs('org', 'space')).toEqual({ spaceLevel: 'all', topics: { 'root-1': 'mute' } });
    });

    it('persists atomically: the file is complete JSON and no temp sibling is left behind', async () => {
        const p = await fresh();
        p.setNotifyPref('org', 'space', 'root-1', 'mute');

        expect(fs.existsSync(PREFS_FILE)).toBe(true);
        expect(fs.existsSync(`${PREFS_FILE}.tmp`)).toBe(false);
        expect(JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'))).toEqual({
            version: 1,
            spaces: { 'org/space': { topics: { 'root-1': 'mute' } } },
        });
    });

    it('a fresh launch reads back what was written', async () => {
        const first = await fresh();
        first.setNotifyPref('org', 'space', undefined, 'mute');
        first.setNotifyPref('org', 'space', 'root-9', 'all');
        first.setDndUntil(new Date(Date.now() + 60_000).toISOString());

        const next = await fresh();
        expect(next.notifyLevelFor('org', 'space', 'root-9')).toBe('all');
        expect(next.notifyLevelFor('org', 'space', 'root-1')).toBe('mute');
        expect(next.dndActive()).toBe(true);
    });

    it('clearing the last override drops the space entry; an expired DND reads as off', async () => {
        const p = await fresh();
        p.setNotifyPref('org', 'space', 'root-1', 'mute');
        p.setNotifyPref('org', 'space', 'root-1', null);
        expect(JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')).spaces).toEqual({});

        p.setDndUntil(new Date(Date.now() - 1_000).toISOString());
        expect(p.dndActive()).toBe(false);
        expect(p.getDndUntil()).toBeNull();
    });

    it('a corrupt file reads as empty rather than crashing the watcher', async () => {
        fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
        fs.writeFileSync(PREFS_FILE, '{not json');
        const p = await fresh();
        expect(p.notifyLevelFor('org', 'space', 'root-1')).toBe('mentions');
        expect(p.dndActive()).toBe(false);
    });
});
