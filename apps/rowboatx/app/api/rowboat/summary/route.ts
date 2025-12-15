import { NextRequest } from "next/server";
import path from "path";
import os from "os";
import { promises as fs } from "fs";

const ROWBOAT_ROOT = path.join(os.homedir(), ".rowboat");

async function safeList(dir: string): Promise<string[]> {
  const full = path.join(ROWBOAT_ROOT, dir);
  try {
    const entries = await fs.readdir(full, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function GET(_req: NextRequest) {
  const agents = await safeList("agents");
  const config = await safeList("config");
  const runs = await safeList("runs");

  return Response.json({
    agents,
    config,
    runs,
  });
}
