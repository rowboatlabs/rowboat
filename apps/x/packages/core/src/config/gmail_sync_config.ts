import fs from 'fs';
import path from 'path';
import { WorkDir } from './config.js';

const CONFIG_FILE = path.join(WorkDir, 'config', 'gmail_sync.json');

/**
 * How many of the newest email threads the initial (onboarding) / recovery
 * Gmail sync pulls down. This bounds the sync by a COUNT of recent threads
 * rather than a fixed date window, so a fresh account backfills its most recent
 * `maxEmails` emails even when they span more than a week.
 */
export const DEFAULT_MAX_EMAILS = 500;

// Guard rails: at least one email, and a hard ceiling so a misconfigured value
// can't trigger a runaway onboarding sync (each thread costs a threads.get plus
// an LLM classification).
const MIN_MAX_EMAILS = 1;
const MAX_MAX_EMAILS = 5000;

interface GmailSyncConfig {
    maxEmails: number;
}

function clampMaxEmails(value: number): number {
    return Math.max(MIN_MAX_EMAILS, Math.min(MAX_MAX_EMAILS, Math.floor(value)));
}

function readConfig(): Partial<GmailSyncConfig> {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return JSON.parse(raw) as Partial<GmailSyncConfig>;
        }
    } catch (err) {
        console.warn('[GmailSyncConfig] Failed to read gmail_sync.json:', err);
    }
    return {};
}

function writeConfig(config: Partial<GmailSyncConfig>): void {
    const configDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Read the configured max email count for the onboarding/full sync.
 * Falls back to {@link DEFAULT_MAX_EMAILS} when the file is missing, malformed,
 * or holds an out-of-range value.
 */
export function getMaxEmails(): number {
    const value = Number(readConfig()?.maxEmails);
    if (Number.isFinite(value) && value > 0) {
        return clampMaxEmails(value);
    }
    return DEFAULT_MAX_EMAILS;
}

/**
 * Persist the max email count used by the onboarding/full sync. The value is
 * clamped into the supported range before writing.
 */
export function setMaxEmails(maxEmails: number): void {
    writeConfig({ ...readConfig(), maxEmails: clampMaxEmails(maxEmails) });
}

