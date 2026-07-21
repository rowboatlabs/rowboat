import fs from 'fs/promises';
import path from 'path';
import {
    TurnLimitsSettingsSchema,
    DEFAULT_TURN_LIMITS_SETTINGS,
    type TurnLimitsSettings,
} from '@x/shared/dist/turn-limits.js';
import { WorkDir } from './config.js';

const TURN_LIMITS_CONFIG_PATH = path.join(WorkDir, 'config', 'turn_limits.json');

/**
 * Load the model-call limit settings, falling back to the defaults (global
 * limit DEFAULT_MAX_MODEL_CALLS, no chat override) when the file is absent
 * or malformed.
 */
export async function loadTurnLimitsSettings(): Promise<TurnLimitsSettings> {
    try {
        const content = await fs.readFile(TURN_LIMITS_CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(content);
        return TurnLimitsSettingsSchema.parse({
            ...DEFAULT_TURN_LIMITS_SETTINGS,
            ...(parsed && typeof parsed === 'object' ? parsed : {}),
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[TurnLimits] Error loading turn limit settings:', error);
        }
        return DEFAULT_TURN_LIMITS_SETTINGS;
    }
}

export async function saveTurnLimitsSettings(
    settings: TurnLimitsSettings,
): Promise<void> {
    const validated = TurnLimitsSettingsSchema.parse(settings);
    await fs.mkdir(path.dirname(TURN_LIMITS_CONFIG_PATH), { recursive: true });
    await fs.writeFile(
        TURN_LIMITS_CONFIG_PATH,
        JSON.stringify(validated, null, 2),
    );
}
