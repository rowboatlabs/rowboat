import fs from 'fs';
import path from 'path';
import {
    NotificationSettingsSchema,
    DEFAULT_NOTIFICATION_SETTINGS,
    type NotificationSettings,
    type NotificationCategory,
} from '@x/shared/dist/notification-settings.js';
import { WorkDir } from './config.js';

const NOTIFICATION_CONFIG_PATH = path.join(WorkDir, 'config', 'notification_settings.json');

/**
 * Load notification settings, merging any persisted values over the defaults.
 *
 * Merging (rather than a strict parse) keeps the file forward/backward
 * compatible: a category added in a newer build is filled in from defaults
 * when an older file omits it, and a malformed file falls back to defaults
 * instead of disabling notifications entirely.
 */
export function loadNotificationSettings(): NotificationSettings {
    try {
        if (fs.existsSync(NOTIFICATION_CONFIG_PATH)) {
            const content = fs.readFileSync(NOTIFICATION_CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(content);
            const categories = parsed?.categories ?? {};
            return NotificationSettingsSchema.parse({
                categories: {
                    ...DEFAULT_NOTIFICATION_SETTINGS.categories,
                    ...categories,
                },
            });
        }
    } catch (error) {
        console.error('[NotificationConfig] Error loading notification settings:', error);
    }
    return DEFAULT_NOTIFICATION_SETTINGS;
}

export function saveNotificationSettings(settings: NotificationSettings): void {
    const dir = path.dirname(NOTIFICATION_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const validated = NotificationSettingsSchema.parse(settings);
    fs.writeFileSync(NOTIFICATION_CONFIG_PATH, JSON.stringify(validated, null, 2));
}

/** Convenience: is a single notification category currently enabled? */
export function isNotificationCategoryEnabled(category: NotificationCategory): boolean {
    return loadNotificationSettings().categories[category];
}
