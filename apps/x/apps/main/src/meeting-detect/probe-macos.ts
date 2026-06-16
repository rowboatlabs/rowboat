import { execFileSync } from "node:child_process";
import type { MicProbe, MicUser } from "./types.js";

const ASSERTION_LINE = /^\s*pid\s+(\d+)\((.+?)\):\s+\[[^\]]+\]\s+\S+\s+(PreventUserIdleDisplaySleep|NoIdleSleepAssertion)/;

const PMSET_TIMEOUT_MS = 4_000;

// Sync execFileSync, NOT async execFile/spawn. In a Finder-launched packaged
// .app the async ChildProcess.spawn path fails with `spawn EBADF` (errno -9)
// every detector tick. The synchronous path avoids it and is already proven
// in this exact packaged app -- main.ts uses execFileSync at startup.
function runPmsetAssertions(): string {
    return execFileSync("/usr/bin/pmset", ["-g", "assertions"], {
        timeout: PMSET_TIMEOUT_MS,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
    });
}

export class MacOsMicProbe implements MicProbe {
    async probe(): Promise<MicUser[]> {
        let stdout: string;
        try {
            stdout = runPmsetAssertions();
        } catch (err) {
            console.error("[MeetingDetect] macOS probe failed:", err);
            return [];
        }
        return parseAssertions(stdout);
    }
}

export function parseAssertions(stdout: string): MicUser[] {
    const seen = new Map<number, MicUser>();
    for (const line of stdout.split("\n")) {
        const m = ASSERTION_LINE.exec(line);
        if (!m) continue;
        const pid = Number(m[1]);
        const command = m[2].trim();
        if (!Number.isFinite(pid)) continue;
        if (seen.has(pid)) continue;
        seen.set(pid, { executable: command, pid });
    }
    return Array.from(seen.values());
}
