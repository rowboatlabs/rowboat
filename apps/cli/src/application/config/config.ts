import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { McpServerConfig } from "../entities/mcp.js";
import { z } from "zod";

// Resolve app root relative to compiled file location (dist/...)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AppRoot = path.resolve(__dirname, "../../..");
export const WorkDir = path.join(AppRoot, ".rowboat");

function ensureDirs() {
    const ensure = (p: string) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
    ensure(WorkDir);
    ensure(path.join(WorkDir, "workflows"));
    ensure(path.join(WorkDir, "agents"));
    ensure(path.join(WorkDir, "mcp"));
}

function loadMcpServerConfig(): z.infer<typeof McpServerConfig> {
    ensureDirs();
    const configPath = path.join(WorkDir, "mcp", "servers.json");
    if (!fs.existsSync(configPath)) return { mcpServers: [] };
    const config = fs.readFileSync(configPath, "utf8");
    return McpServerConfig.parse(JSON.parse(config));
}

const { mcpServers } = loadMcpServerConfig();
export const McpServers = mcpServers;
