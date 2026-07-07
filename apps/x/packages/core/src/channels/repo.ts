import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { WorkDir } from '../config/config.js';
import { ChannelsConfig, DEFAULT_CHANNELS_CONFIG } from '@x/shared/dist/channels.js';

export interface IChannelsConfigRepo {
    getConfig(): Promise<z.infer<typeof ChannelsConfig>>;
    setConfig(config: z.infer<typeof ChannelsConfig>): Promise<void>;
}

export class FSChannelsConfigRepo implements IChannelsConfigRepo {
    private readonly configPath = path.join(WorkDir, 'config', 'channels.json');

    constructor() {
        this.ensureConfigFile();
    }

    private async ensureConfigFile(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await fs.writeFile(this.configPath, JSON.stringify(DEFAULT_CHANNELS_CONFIG, null, 2));
        }
    }

    async getConfig(): Promise<z.infer<typeof ChannelsConfig>> {
        try {
            const content = await fs.readFile(this.configPath, 'utf8');
            return ChannelsConfig.parse(JSON.parse(content));
        } catch {
            return DEFAULT_CHANNELS_CONFIG;
        }
    }

    async setConfig(config: z.infer<typeof ChannelsConfig>): Promise<void> {
        const validated = ChannelsConfig.parse(config);
        await fs.writeFile(this.configPath, JSON.stringify(validated, null, 2));
    }
}
