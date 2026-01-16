import { ModelConfig, Provider } from "./models.js";
import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

export interface IModelConfigRepo {
    getConfig(): Promise<z.infer<typeof ModelConfig>>;
    upsert(providerName: string, config: z.infer<typeof Provider>): Promise<void>;
    delete(providerName: string): Promise<void>;
    setDefault(providerName: string, model: string): Promise<void>;
}

const defaultConfig: z.infer<typeof ModelConfig> = {
    providers: {
        "openai": {
            flavor: "openai",
        }
    },
    defaults: {
        provider: "openai",
        model: "gpt-5.1",
    }
};

export class FSModelConfigRepo implements IModelConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "models.json");

    constructor() {
        this.ensureDefaultConfig();
    }

    private async ensureDefaultConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await fs.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2));
        }
    }

    async getConfig(): Promise<z.infer<typeof ModelConfig>> {
        const config = await fs.readFile(this.configPath, "utf8");
        return ModelConfig.parse(JSON.parse(config));
    }

    private async setConfig(config: z.infer<typeof ModelConfig>): Promise<void> {
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    }

    async upsert(providerName: string, config: z.infer<typeof Provider>): Promise<void> {
        const conf = await this.getConfig();
        conf.providers[providerName] = config;
        await this.setConfig(conf);
    }

    async delete(providerName: string): Promise<void> {
        const conf = await this.getConfig();
        delete conf.providers[providerName];
        await this.setConfig(conf);
    }

    async setDefault(providerName: string, model: string): Promise<void> {
        const conf = await this.getConfig();
        conf.defaults = {
            provider: providerName,
            model,
        };
        await this.setConfig(conf);
    }
}