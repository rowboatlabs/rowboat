import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { WorkDir } from './config.js';

const USER_CONFIG_PATH = path.join(WorkDir, 'config', 'user.json');

export const UserConfig = z.object({
    name: z.string().optional(),
    email: z.string().email(),
    domain: z.string().optional(),
});

export type UserConfig = z.infer<typeof UserConfig>;

export function loadUserConfig(): UserConfig | null {
    try {
        if (fs.existsSync(USER_CONFIG_PATH)) {
            const content = fs.readFileSync(USER_CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(content);
            return UserConfig.parse(parsed);
        }
    } catch (error) {
        console.error('[UserConfig] Error loading user config:', error);
    }
    return null;
}

export function saveUserConfig(config: UserConfig): void {
    const dir = path.dirname(USER_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const validated = UserConfig.parse(config);
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(validated, null, 2));
}

export function updateUserEmail(email: string): void {
    const existing = loadUserConfig();
    const config = existing
        ? { ...existing, email }
        : { email };
    saveUserConfig(config);
}
