import { WorkDir } from "../config/config.js";
import { McpServerConfig, McpServerDefinition } from "@x/shared/dist/mcp.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

const DEFAULT_MCP_SERVERS = {
    exa: {
        type: "http" as const,
        url: "https://mcp.exa.ai/mcp",
    },
};

export interface IMcpConfigRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof McpServerConfig>>;
    upsert(serverName: string, config: z.infer<typeof McpServerDefinition>): Promise<void>;
    delete(serverName: string): Promise<void>;
}

export class FSMcpConfigRepo implements IMcpConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "mcp.json");

    async ensureConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await fs.writeFile(this.configPath, JSON.stringify({ mcpServers: DEFAULT_MCP_SERVERS }, null, 2));
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
