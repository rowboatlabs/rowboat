import path from "path";
import os from "os";
import { promises as fs } from "fs";

const ROWBOAT_ROOT = path.join(os.homedir(), ".rowboat");

async function listRecursive(dir: string): Promise<string[]> {
  const root = path.join(ROWBOAT_ROOT, dir);

  const walk = async (current: string, prefix = ""): Promise<string[]> => {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });

      for (const entry of entries) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results.push(...(await walk(path.join(current, entry.name), relPath)));
        } else if (entry.isFile()) {
          results.push(relPath);
        }
      }
    } catch {
      return results;
    }

    return results;
  };

  return walk(root);
}

export async function GET() {
  const agents = await listRecursive("agents");
  const config = await listRecursive("config");
  const runs = await listRecursive("runs");

  return Response.json({
    agents,
    config,
    runs,
  });
}
