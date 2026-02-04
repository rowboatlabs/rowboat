import { ModelConfig } from "./models.js";
import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

export interface IModelConfigRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof ModelConfig>>;
    setConfig(config: z.infer<typeof ModelConfig>): Promise<void>;
}

const defaultConfig: z.infer<typeof ModelConfig> = {
    provider: {
        flavor: "openai",
    },
    model: "gpt-4.1",
};

export class FSModelConfigRepo implements IModelConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "models.json");

    async ensureConfig(): Promise<void> {
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

    async setConfig(config: z.infer<typeof ModelConfig>): Promise<void> {
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    }
}
