import fs from 'fs';
import path from 'path';
import { WorkDir } from './config.js';
import { loadAppSettings, saveAppSettings } from './app_settings.js';
import { isOnboardingComplete } from './note_creation_config.js';
import { TODO_REL_PATH, TODO_SEED } from '../todo/fileops.js';
import { APPS_DIR } from '../apps/constants.js';

// Todo and Apps are optional sidebar sections (2026-11-03, spaces-first
// desktop): new installs start with both off; an install that finished
// onboarding before this shipped keeps each one it has actually used.
// Decided once, persisted, and from then on changed only from Settings.

export type Sections = { todo: boolean; apps: boolean };

function hasEntries(dir: string): boolean {
    try {
        return fs.readdirSync(dir).some(name => !name.startsWith('.'));
    } catch {
        return false;
    }
}

function usedTodo(): boolean {
    try {
        const list = fs.readFileSync(path.join(WorkDir, TODO_REL_PATH), 'utf-8');
        if (list.trim() !== TODO_SEED.trim()) return true;
    } catch {
        // No list yet: never opened.
    }
    return hasEntries(path.join(WorkDir, 'todo', 'archive'));
}

export function getSections(): Sections {
    const saved = loadAppSettings().sections;
    if (saved) return saved;
    const existing = isOnboardingComplete();
    const sections = {
        todo: existing && usedTodo(),
        apps: existing && hasEntries(APPS_DIR),
    };
    saveAppSettings({ sections });
    return sections;
}

export function setSections(patch: Partial<Sections>): Sections {
    const sections = { ...getSections(), ...patch };
    saveAppSettings({ sections });
    return sections;
}
