import fs from "fs";
import path from "path";
import { z } from "zod";
import { McpServerConfig } from "../../entities/mcp.js";
import { WorkDir } from "../../config/config.js";

export function mcpConfigPath(): string {
  return path.join(WorkDir, "mcp", "servers.json");
}

export function readMcpConfig(): z.infer<typeof McpServerConfig> {
  const p = mcpConfigPath();
  if (!fs.existsSync(p)) return { mcpServers: {} };
  const raw = fs.readFileSync(p, "utf8");
  return McpServerConfig.parse(JSON.parse(raw));
}

export function writeMcpConfig(value: z.infer<typeof McpServerConfig>): void {
  const p = mcpConfigPath();
  const parsed = McpServerConfig.parse(value);
  fs.writeFileSync(p, JSON.stringify(parsed, null, 2) + "\n", "utf8");
}
