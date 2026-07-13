import fs from 'fs';
import path from 'path';
import { WorkDir } from './config.js';

const APP_SETTINGS_PATH = path.join(WorkDir, 'config', 'app_settings.json');

export interface AppSettings {
    /**
     * Set once the app has registered itself as an OS login item (first run
     * of a packaged build, or the user touching the Settings toggle). After
     * this, the OS login-item registry is the source of truth — the app never
     * re-registers on boot, so disabling it in System Settings sticks.
     */
    loginItemRegistered?: boolean;
}

export function loadAppSettings(): AppSettings {
    try {
        if (fs.existsSync(APP_SETTINGS_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf-8'));
            if (parsed && typeof parsed === 'object') return parsed as AppSettings;
        }
    } catch (error) {
        console.error('[AppSettings] Error loading app settings:', error);
    }
    return {};
}

export function saveAppSettings(patch: Partial<AppSettings>): void {
    const merged = { ...loadAppSettings(), ...patch };
    const dir = path.dirname(APP_SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(merged, null, 2));
}
