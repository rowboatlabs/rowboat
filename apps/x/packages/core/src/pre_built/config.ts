import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import {
    PreBuiltConfig,
    PreBuiltState,
    PreBuiltAgentConfig,
    UserConfig,
    PREBUILT_AGENTS,
} from './types.js';

const CONFIG_PATH = path.join(WorkDir, 'config', 'prebuilt.json');
const STATE_PATH = path.join(WorkDir, 'pre-built', 'runner_state.json');
const USER_CONFIG_PATH = path.join(WorkDir, 'config', 'user.json');

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function ensureConfigFile(): void {
    if (!fs.existsSync(CONFIG_PATH)) {
        ensureDir(path.dirname(CONFIG_PATH));
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(getDefaultConfig(), null, 2));
    }
}

// --- Config Management ---

export function getDefaultConfig(): PreBuiltConfig {
    const agents: Record<string, PreBuiltAgentConfig> = {};
    for (const agentName of PREBUILT_AGENTS) {
        agents[agentName] = {
            enabled: false,
            intervalMs: 5 * 60 * 1000, // 5 minutes
        };
    }
    return { agents };
}

export function loadConfig(): PreBuiltConfig {
    ensureConfigFile();
    try {
        const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(content);
        return PreBuiltConfig.parse(parsed);
    } catch (error) {
        console.error('[PreBuilt] Error loading config:', error);
        return getDefaultConfig();
    }
}

export function saveConfig(config: PreBuiltConfig): void {
    ensureDir(path.dirname(CONFIG_PATH));
    const validated = PreBuiltConfig.parse(config);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2));
}

export function getAgentConfig(agentName: string): PreBuiltAgentConfig {
    const config = loadConfig();
    return config.agents[agentName] || { enabled: false, intervalMs: 5 * 60 * 1000 };
}

export function setAgentConfig(agentName: string, agentConfig: Partial<PreBuiltAgentConfig>): void {
    const config = loadConfig();
    config.agents[agentName] = {
        ...getAgentConfig(agentName),
        ...agentConfig,
    };
    saveConfig(config);
}

// --- State Management ---

export function loadState(): PreBuiltState {
    try {
        if (fs.existsSync(STATE_PATH)) {
            const content = fs.readFileSync(STATE_PATH, 'utf-8');
            const parsed = JSON.parse(content);
            return PreBuiltState.parse(parsed);
        }
    } catch (error) {
        console.error('[PreBuilt] Error loading state:', error);
    }
    return { lastRunTimes: {} };
}

export function saveState(state: PreBuiltState): void {
    ensureDir(path.dirname(STATE_PATH));
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getLastRunTime(agentName: string): Date | null {
    const state = loadState();
    const timestamp = state.lastRunTimes[agentName];
    return timestamp ? new Date(timestamp) : null;
}

export function setLastRunTime(agentName: string, time: Date): void {
    const state = loadState();
    state.lastRunTimes[agentName] = time.toISOString();
    saveState(state);
}

export function shouldRunAgent(agentName: string): boolean {
    const config = getAgentConfig(agentName);
    if (!config.enabled) {
        return false;
    }

    const lastRun = getLastRunTime(agentName);
    if (!lastRun) {
        return true; // Never run before
    }

    const elapsed = Date.now() - lastRun.getTime();
    return elapsed >= config.intervalMs;
}

// --- User Config Management ---

export function loadUserConfig(): UserConfig | null {
    try {
        if (fs.existsSync(USER_CONFIG_PATH)) {
            const content = fs.readFileSync(USER_CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(content);
            return UserConfig.parse(parsed);
        }
    } catch (error) {
        console.error('[PreBuilt] Error loading user config:', error);
    }
    return null;
}

export function saveUserConfig(config: UserConfig): void {
    ensureDir(path.dirname(USER_CONFIG_PATH));
    const validated = UserConfig.parse(config);
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(validated, null, 2));
}

export function getUserConfigPath(): string {
    return USER_CONFIG_PATH;
}
