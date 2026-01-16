import fs from 'fs/promises';
import path from 'path';
import { WorkDir } from '../../config/config.js';
import { GranolaConfig } from './types.js';

export interface IGranolaConfigRepo {
    getConfig(): Promise<GranolaConfig>;
    setConfig(config: GranolaConfig): Promise<void>;
}

export class FSGranolaConfigRepo implements IGranolaConfigRepo {
    private readonly configPath = path.join(WorkDir, 'config', 'granola.json');
    private readonly defaultConfig: GranolaConfig = { enabled: false };

    constructor() {
        this.ensureConfigFile();
    }

    private async ensureConfigFile(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            // File doesn't exist, create it with default config
            await fs.writeFile(this.configPath, JSON.stringify(this.defaultConfig, null, 2));
        }
    }

    async getConfig(): Promise<GranolaConfig> {
        try {
            const content = await fs.readFile(this.configPath, 'utf8');
            const parsed = JSON.parse(content);
            return GranolaConfig.parse(parsed);
        } catch {
            // If file doesn't exist or is invalid, return default
            return this.defaultConfig;
        }
    }

    async setConfig(config: GranolaConfig): Promise<void> {
        // Validate before saving
        const validated = GranolaConfig.parse(config);
        await fs.writeFile(this.configPath, JSON.stringify(validated, null, 2));
    }
}

