import fs from 'fs';
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
export function loadTurnLimitsSettings(): TurnLimitsSettings {
    try {
        if (fs.existsSync(TURN_LIMITS_CONFIG_PATH)) {
            const content = fs.readFileSync(TURN_LIMITS_CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(content);
            return TurnLimitsSettingsSchema.parse({
                ...DEFAULT_TURN_LIMITS_SETTINGS,
                ...(parsed && typeof parsed === 'object' ? parsed : {}),
            });
        }
    } catch (error) {
        console.error('[TurnLimits] Error loading turn limit settings:', error);
    }
    return DEFAULT_TURN_LIMITS_SETTINGS;
}

export function saveTurnLimitsSettings(settings: TurnLimitsSettings): void {
    const validated = TurnLimitsSettingsSchema.parse(settings);
    const dir = path.dirname(TURN_LIMITS_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TURN_LIMITS_CONFIG_PATH, JSON.stringify(validated, null, 2));
}

/**
 * The effective model-call limit for a new turn, by execution context.
 * Interactive chat turns (a human is present) use the chat override when
 * set; everything else — headless/knowledge work, sub-agents — uses the
 * global limit.
 */
export function resolveMaxModelCalls(context: { humanAvailable: boolean }): number {
    const settings = loadTurnLimitsSettings();
    if (context.humanAvailable && settings.chatMaxModelCalls !== undefined) {
        return settings.chatMaxModelCalls;
    }
    return settings.maxModelCalls;
}
