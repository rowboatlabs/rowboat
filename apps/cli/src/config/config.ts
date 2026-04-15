import path from "path";
import fs from "fs";
import { homedir } from "os";

function resolveWorkDir(): string {
    const configured = process.env.ROWBOAT_WORKDIR;
    if (!configured) {
        return path.join(homedir(), ".rowboat");
    }

    const expanded = configured === "~"
        ? homedir()
        : (configured.startsWith("~/") || configured.startsWith("~\\"))
            ? path.join(homedir(), configured.slice(2))
            : configured;

    return path.resolve(expanded);
}

export const WorkDir = resolveWorkDir();

function ensureDirs() {
    const ensure = (p: string) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
    ensure(WorkDir);
    ensure(path.join(WorkDir, "agents"));
    ensure(path.join(WorkDir, "config"));
    ensure(path.join(WorkDir, "runs"));
}

ensureDirs();
