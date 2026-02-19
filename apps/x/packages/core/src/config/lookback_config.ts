import fs from 'fs';
import path from 'path';
import { WorkDir } from './config.js';

export type LookbackDays = 7 | 30 | 90;

interface LookbackConfig {
    days: LookbackDays;
}

const CONFIG_FILE = path.join(WorkDir, 'config', 'lookback.json');
const DEFAULT_DAYS: LookbackDays = 30;
const VALID_VALUES: LookbackDays[] = [7, 30, 90];

function readConfig(): LookbackConfig {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return { days: DEFAULT_DAYS };
        }
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(raw);
        return {
            days: VALID_VALUES.includes(config.days) ? config.days : DEFAULT_DAYS,
        };
    } catch {
        return { days: DEFAULT_DAYS };
    }
}

function writeConfig(config: LookbackConfig): void {
    const configDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getLookbackDays(): LookbackDays {
    return readConfig().days;
}

export function setLookbackDays(days: LookbackDays): void {
    writeConfig({ days });
}
