import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { RowboatApiConfig } from "@x/shared/dist/rowboat-account.js";
import { API_URL } from "./env.js";
import { WorkDir } from "./config.js";

type Config = z.infer<typeof RowboatApiConfig>;

// Refetch cadence. The config used to be cached for the whole process
// lifetime, which was fine while it only carried service URLs — but the
// Auto model selection resolves against modelRecommendations at run time,
// so a long-running app must eventually see a rotated recommendation
// without a restart. Startup stays fresh for free: the in-memory timestamp
// does not survive the process.
const CONFIG_TTL_MS = 6 * 60 * 60 * 1000;

let cached: Config | null = null;
// 0 = the cache is stale (never fetched live, or hydrated from disk):
// serve it on failure, but try the network on every call.
let fetchedAt = 0;

// Last-good copy of the parsed config, so an offline start still resolves
// Auto selections (and knows service URLs) deterministically. NOT the
// source of truth — only ever read when the live fetch fails with nothing
// in memory.
const snapshotPath = path.join(WorkDir, "config", "rowboat-config.json");

async function readSnapshot(): Promise<Config | null> {
  try {
    return RowboatApiConfig.parse(JSON.parse(await fs.readFile(snapshotPath, "utf8")));
  } catch {
    // Missing, corrupt, or schema-drifted snapshot — behave as if absent.
    return null;
  }
}

async function writeSnapshot(config: Config): Promise<void> {
  try {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    const tmpPath = `${snapshotPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2));
    await fs.rename(tmpPath, snapshotPath);
  } catch (error) {
    // Best-effort: a failed snapshot only costs the next offline start.
    console.warn("[config] Could not persist the rowboat config snapshot:", error);
  }
}

export async function getRowboatConfig(): Promise<Config> {
  if (cached && Date.now() - fetchedAt < CONFIG_TTL_MS) {
    return cached;
  }
  try {
    const response = await fetch(`${API_URL}/v1/config`);
    const data = RowboatApiConfig.parse(await response.json());
    cached = data;
    fetchedAt = Date.now();
    void writeSnapshot(data);
    return data;
  } catch (error) {
    // Serve stale over failing: the expired in-memory copy first, then the
    // last-good disk snapshot. Both leave fetchedAt at 0/expired so the
    // next call retries the network.
    if (cached) {
      return cached;
    }
    const snapshot = await readSnapshot();
    if (snapshot) {
      cached = snapshot;
      return snapshot;
    }
    throw error;
  }
}

// Test-only: reset module state so each test starts cold.
export function __resetRowboatConfigForTests(): void {
  cached = null;
  fetchedAt = 0;
}
