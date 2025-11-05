import path from "path";
import fs from "fs";
import { McpServerConfig } from "../entities/mcp.js";
import { z } from "zod";
import { homedir } from "os";

// Resolve app root relative to compiled file location (dist/...)
export const WorkDir = path.join(homedir(), ".rowboat");

function ensureDirs() {
    const ensure = (p: string) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
    ensure(WorkDir);
    ensure(path.join(WorkDir, "workflows"));
    ensure(path.join(WorkDir, "agents"));
    ensure(path.join(WorkDir, "mcp"));
}

ensureDirs();

function loadMcpServerConfig(): z.infer<typeof McpServerConfig> {
    const configPath = path.join(WorkDir, "mcp", "servers.json");
    if (!fs.existsSync(configPath)) return { mcpServers: [] };
    const config = fs.readFileSync(configPath, "utf8");
    return McpServerConfig.parse(JSON.parse(config));
}

const { mcpServers } = loadMcpServerConfig();
export const McpServers = mcpServers;
