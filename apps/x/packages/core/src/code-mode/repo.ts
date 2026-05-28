import fs from 'fs/promises';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { CodeModeConfig } from './types.js';

export interface ICodeModeConfigRepo {
    getConfig(): Promise<CodeModeConfig>;
    setConfig(config: CodeModeConfig): Promise<void>;
}

export class FSCodeModeConfigRepo implements ICodeModeConfigRepo {
    private readonly configPath = path.join(WorkDir, 'config', 'code-mode.json');
    private readonly defaultConfig: CodeModeConfig = { enabled: false };

    constructor() {
        this.ensureConfigFile();
    }

    private async ensureConfigFile(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            await fs.writeFile(this.configPath, JSON.stringify(this.defaultConfig, null, 2));
        }
    }

    async getConfig(): Promise<CodeModeConfig> {
        try {
            const content = await fs.readFile(this.configPath, 'utf8');
            return CodeModeConfig.parse(JSON.parse(content));
        } catch {
            return this.defaultConfig;
        }
    }

    async setConfig(config: CodeModeConfig): Promise<void> {
        const validated = CodeModeConfig.parse(config);
        await fs.mkdir(path.dirname(this.configPath), { recursive: true });
        await fs.writeFile(this.configPath, JSON.stringify(validated, null, 2));
    }
}
