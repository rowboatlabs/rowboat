import fs from "fs";
import path from "path";
import { WorkDir } from "../../config/config.js";

export type DirKind = "workflows" | "agents" | "mcp";

export function dirFor(kind: DirKind): string {
  switch (kind) {
    case "workflows":
      return path.join(WorkDir, "workflows");
    case "agents":
      return path.join(WorkDir, "agents");
    case "mcp":
      return path.join(WorkDir, "mcp");
  }
}

export function listJson(kind: DirKind): string[] {
  const d = dirFor(kind);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function readJson<T>(kind: DirKind, id: string): T | undefined {
  const p = path.join(dirFor(kind), `${id}.json`);
  if (!fs.existsSync(p)) return undefined;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as T;
}

export function writeJson(kind: DirKind, id: string, value: unknown): void {
  const p = path.join(dirFor(kind), `${id}.json`);
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function deleteJson(kind: DirKind, id: string): boolean {
  const p = path.join(dirFor(kind), `${id}.json`);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p);
  return true;
}
