import { WorkDir } from "../config/config.js";
import { McpServerConfig, McpServerDefinition } from "./schema.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

export interface IMcpConfigRepo {
    getConfig(): Promise<z.infer<typeof McpServerConfig>>;
    upsert(serverName: string, config: z.infer<typeof McpServerDefinition>): Promise<void>;
    delete(serverName: string): Promise<void>;
}

export class FSMcpConfigRepo implements IMcpConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "mcp.json");

    constructor() {
        this.ensureDefaultConfig();
    }

    private async ensureDefaultConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch (error) {
            await fs.writeFile(this.configPath, JSON.stringify({ mcpServers: {} }, null, 2));
        }
    }

    async getConfig(): Promise<z.infer<typeof McpServerConfig>> {
        const config = await fs.readFile(this.configPath, "utf8");
        return McpServerConfig.parse(JSON.parse(config));
    }

    async upsert(serverName: string, config: z.infer<typeof McpServerDefinition>): Promise<void> {
        const conf = await this.getConfig();
        conf.mcpServers[serverName] = config;
        await fs.writeFile(this.configPath, JSON.stringify(conf, null, 2));
    }

    async delete(serverName: string): Promise<void> {
        const conf = await this.getConfig();
        delete conf.mcpServers[serverName];
        await fs.writeFile(this.configPath, JSON.stringify(conf, null, 2));
    }
}
