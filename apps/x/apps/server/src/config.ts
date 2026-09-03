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

// Per-instance override for sandboxed dev instances (`npm run dev:sandbox`):
// lets several rowboat-servers coexist on one machine, each on its own port,
// without touching the workdir's server.json. Explicit opts.port (tests)
// still wins over this — see createRowboatServer.
function envPortOverride(): number | undefined {
  const port = Number(process.env.ROWBOAT_SERVER_PORT);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

export async function loadServerConfig(workDir: string): Promise<ServerConfig> {
  let config: ServerConfig;
  try {
    const raw = await fs.readFile(configPath(workDir), 'utf8');
    config = ServerConfig.parse(JSON.parse(raw));
  } catch {
    config = ServerConfig.parse({});
  }
  const envPort = envPortOverride();
  return envPort === undefined ? config : { ...config, port: envPort };
}

export async function saveServerConfig(workDir: string, config: ServerConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath(workDir)), { recursive: true });
  await fs.writeFile(configPath(workDir), JSON.stringify(config, null, 2) + '\n');
}
