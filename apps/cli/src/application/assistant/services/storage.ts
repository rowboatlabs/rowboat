import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export type DirKind = "workflows" | "agents" | "mcp";

export interface StoragePaths {
  appRoot: string;
  workDir: string; // .rowboat
}

const defaultPaths: StoragePaths = (() => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(__dirname, "../../../../");
  const workDir = path.join(appRoot, ".rowboat");
  return { appRoot, workDir };
})();

export function getStoragePaths(): StoragePaths {
  return defaultPaths;
}

export function ensureBaseDirs(base: StoragePaths = defaultPaths) {
  const ensure = (p: string) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  };
  ensure(base.workDir);
  ensure(path.join(base.workDir, "workflows"));
  ensure(path.join(base.workDir, "agents"));
  ensure(path.join(base.workDir, "mcp"));
}

export function dirFor(kind: DirKind, base: StoragePaths = defaultPaths): string {
  switch (kind) {
    case "workflows":
      return path.join(base.workDir, "workflows");
    case "agents":
      return path.join(base.workDir, "agents");
    case "mcp":
      return path.join(base.workDir, "mcp");
  }
}

export function listJson(kind: DirKind, base: StoragePaths = defaultPaths): string[] {
  const d = dirFor(kind, base);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function readJson<T>(kind: DirKind, id: string, base: StoragePaths = defaultPaths): T | undefined {
  const p = path.join(dirFor(kind, base), `${id}.json`);
  if (!fs.existsSync(p)) return undefined;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as T;
}

export function writeJson(kind: DirKind, id: string, value: unknown, base: StoragePaths = defaultPaths): void {
  const p = path.join(dirFor(kind, base), `${id}.json`);
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function deleteJson(kind: DirKind, id: string, base: StoragePaths = defaultPaths): boolean {
  const p = path.join(dirFor(kind, base), `${id}.json`);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p);
  return true;
}
