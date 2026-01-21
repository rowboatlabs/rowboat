import fs from 'fs';
import path from 'path';
import { WorkDir } from './config.js';

export type NoteCreationStrictness = 'low' | 'medium' | 'high';

interface NoteCreationConfig {
    strictness: NoteCreationStrictness;
    configured: boolean;
    onboardingComplete?: boolean;
}

const CONFIG_FILE = path.join(WorkDir, 'config', 'note_creation.json');
const DEFAULT_STRICTNESS: NoteCreationStrictness = 'high';

/**
 * Read the full config file.
 */
function readConfig(): NoteCreationConfig {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return { strictness: DEFAULT_STRICTNESS, configured: false };
        }
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(raw);
        return {
            strictness: ['low', 'medium', 'high'].includes(config.strictness)
                ? config.strictness
                : DEFAULT_STRICTNESS,
            configured: config.configured === true,
        };
    } catch {
        return { strictness: DEFAULT_STRICTNESS, configured: false };
    }
}

/**
 * Write the full config file.
 */
function writeConfig(config: NoteCreationConfig): void {
    const configDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get the current note creation strictness setting.
 * Defaults to 'high' if config doesn't exist.
 */
export function getNoteCreationStrictness(): NoteCreationStrictness {
    return readConfig().strictness;
}

/**
 * Set the note creation strictness setting.
 * Preserves the configured flag.
 */
export function setNoteCreationStrictness(strictness: NoteCreationStrictness): void {
    const config = readConfig();
    config.strictness = strictness;
    writeConfig(config);
}

/**
 * Check if strictness has been auto-configured based on email analysis.
 */
export function isStrictnessConfigured(): boolean {
    return readConfig().configured;
}

/**
 * Mark strictness as configured (after auto-analysis).
 */
export function markStrictnessConfigured(): void {
    const config = readConfig();
    config.configured = true;
    writeConfig(config);
}

/**
 * Set strictness and mark as configured in one operation.
 */
export function setStrictnessAndMarkConfigured(strictness: NoteCreationStrictness): void {
    writeConfig({ strictness, configured: true });
}

/**
 * Get the agent file name suffix based on strictness.
 */
export function getNoteCreationAgentSuffix(): string {
    const strictness = getNoteCreationStrictness();
    return `note_creation_${strictness}`;
}

/**
 * Check if onboarding has been completed.
 */
export function isOnboardingComplete(): boolean {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return false;
        }
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(raw);
        return config.onboardingComplete === true;
    } catch {
        return false;
    }
}

/**
 * Mark onboarding as complete.
 */
export function markOnboardingComplete(): void {
    const configDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    let config: NoteCreationConfig;
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            config = JSON.parse(raw);
        } else {
            config = { strictness: DEFAULT_STRICTNESS, configured: false };
        }
    } catch {
        config = { strictness: DEFAULT_STRICTNESS, configured: false };
    }

    config.onboardingComplete = true;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
