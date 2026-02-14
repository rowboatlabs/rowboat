import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { AppConfig } from "@x/shared/dist/config.js";
import { WorkDir } from "./config.js";
import type z from "zod";

export interface IConfigRepo {
    ensureConfig(): Promise<void>;
    getConfigSync(): z.infer<typeof AppConfig>;
    setConfig(config: z.infer<typeof AppConfig>): Promise<void>;
}

const defaultConfig: z.infer<typeof AppConfig> = {
    executionProfile: { mode: "local" },
};

export class FSConfigRepo implements IConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "config.json");

    async ensureConfig(): Promise<void> {
        try {
            await fsp.access(this.configPath);
        } catch {
            await fsp.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2));
        }
    }

    getConfigSync(): z.infer<typeof AppConfig> {
        if (!fs.existsSync(this.configPath)) {
            fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
        }
        const raw = fs.readFileSync(this.configPath, "utf8");
        return AppConfig.parse(JSON.parse(raw));
    }

    async setConfig(config: z.infer<typeof AppConfig>): Promise<void> {
        await fsp.writeFile(this.configPath, JSON.stringify(config, null, 2));
    }
}
