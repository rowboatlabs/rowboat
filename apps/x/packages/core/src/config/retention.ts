import fs from 'fs/promises';
import path from 'path';
import {
    RetentionSettingsSchema,
    DEFAULT_RETENTION_SETTINGS,
    type RetentionSettings,
} from '@x/shared/dist/retention.js';
import { WorkDir } from './config.js';

const RETENTION_CONFIG_PATH = path.join(WorkDir, 'config', 'retention.json');

/**
 * Load the storage-retention settings, falling back to the defaults
 * (enabled, 30-day chats, 14-day task transcripts, notice not yet shown)
 * when the file is absent or malformed.
 */
export async function loadRetentionSettings(): Promise<RetentionSettings> {
    try {
        const content = await fs.readFile(RETENTION_CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(content);
        return RetentionSettingsSchema.parse({
            ...DEFAULT_RETENTION_SETTINGS,
            ...(parsed && typeof parsed === 'object' ? parsed : {}),
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[Retention] Error loading retention settings:', error);
        }
        return DEFAULT_RETENTION_SETTINGS;
    }
}

export async function saveRetentionSettings(
    patch: Partial<RetentionSettings>,
): Promise<RetentionSettings> {
    const merged = RetentionSettingsSchema.parse({
        ...(await loadRetentionSettings()),
        ...patch,
    });
    await fs.mkdir(path.dirname(RETENTION_CONFIG_PATH), { recursive: true });
    await fs.writeFile(RETENTION_CONFIG_PATH, JSON.stringify(merged, null, 2));
    return merged;
}
