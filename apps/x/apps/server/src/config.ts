import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

// ~/.rowboat/config/server.json — user-facing knobs for the transport.
// 3210 is taken by the Rowboat Apps server; 3220 is ours.
export const DEFAULT_PORT = 3220;

export const ServerConfig = z.object({
  lanEnabled: z.boolean().default(false),
  port: z.number().int().positive().default(DEFAULT_PORT),
});
export type ServerConfig = z.infer<typeof ServerConfig>;

function configPath(workDir: string): string {
  return path.join(workDir, 'config', 'server.json');
}

export async function loadServerConfig(workDir: string): Promise<ServerConfig> {
  try {
    const raw = await fs.readFile(configPath(workDir), 'utf8');
    return ServerConfig.parse(JSON.parse(raw));
  } catch {
    return ServerConfig.parse({});
  }
}

export async function saveServerConfig(workDir: string, config: ServerConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath(workDir)), { recursive: true });
  await fs.writeFile(configPath(workDir), JSON.stringify(config, null, 2) + '\n');
}
