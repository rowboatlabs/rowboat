import path from "path";
import fs from "fs";
import { McpServerConfig } from "../entities/mcp.js";
import { z } from "zod";

export const WorkDir = "/Users/ramnique/work/rb/rowboat/apps/cli/.rowboat"


function loadMcpServerConfig(): z.infer<typeof McpServerConfig> {
    const configPath = path.join(WorkDir, "config", "mcp.json");
    const config = fs.readFileSync(configPath, "utf8");
    return McpServerConfig.parse(JSON.parse(config));
}

const { mcpServers } = loadMcpServerConfig();
export const McpServers = mcpServers;   